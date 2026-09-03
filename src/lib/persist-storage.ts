import type { PersistStorage, StorageValue } from "zustand/middleware";
import { contentSig, formatBytes, rankPaths, skipPath } from "./ws-skip.ts";

export const PERSIST_TOTAL = 96_000_000;
export const PERSIST_EACH = 3_000_000;
const LS_FILES = 1_500_000;

export { formatBytes };

export function shrinkFiles(files: Record<string, string>, budget = PERSIST_TOTAL, prefer: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  let used = 0;
  const order = rankPaths(
    Object.keys(files).filter((p) => !skipPath(p) || prefer.includes(p)),
    prefer,
  );
  for (const path of order) {
    const c = files[path];
    if (c == null) continue;
    if (c.length > PERSIST_EACH && !prefer.includes(path)) continue;
    if (c.length > PERSIST_EACH * 2) continue;
    if (used + c.length > budget) continue;
    out[path] = c;
    used += c.length;
  }
  return out;
}

export function persistDropped(files: Record<string, string>, kept: Record<string, string>): number {
  return Object.keys(files).filter((p) => !(p in kept)).length;
}

type Slice = { files?: Record<string, string>; [k: string]: unknown };

const LLM_SNAP = "anvil-llm";
const LLM_KEYS = [
  "llmProvider",
  "llmBaseUrl",
  "llmModel",
  "llmContext",
  "llmContextAuto",
  "llmThinking",
  "llmCompact",
  "llmTemperature",
  "llmMaxOut",
  "llmRetries",
  "llmHardStopMin",
  "llmSlots",
  "llmProfiles",
] as const;

function snapLlm(state: Slice) {
  const out: Record<string, unknown> = {};
  for (const k of LLM_KEYS) {
    if (state[k] != null) out[k] = state[k];
  }
  if (!out.llmProvider) return;
  writeLs(LLM_SNAP, JSON.stringify(out));
}

function readLlm(): Record<string, unknown> | null {
  try {
    const raw = lsGet(LLM_SNAP);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    return v && typeof v.llmProvider === "string" ? v : null;
  } catch {
    return null;
  }
}

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no idb"));
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open("anvil-persist", 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("file")) d.createObjectStore("file");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function idbGet(key: string): Promise<Record<string, string> | null> {
  return db()
    .then(
      (d) =>
        new Promise<Record<string, string> | null>((resolve, reject) => {
          if (!d.objectStoreNames.contains("kv")) {
            resolve(null);
            return;
          }
          const q = d.transaction("kv").objectStore("kv").get(key);
          q.onsuccess = () => resolve((q.result as Record<string, string>) ?? null);
          q.onerror = () => reject(q.error);
        }),
    )
    .catch(() => null);
}

function idbDel(key: string): Promise<void> {
  return db()
    .then(
      (d) =>
        new Promise<void>((resolve, reject) => {
          if (!d.objectStoreNames.contains("kv")) {
            resolve();
            return;
          }
          const q = d.transaction("kv", "readwrite").objectStore("kv").delete(key);
          q.onsuccess = () => resolve();
          q.onerror = () => reject(q.error);
        }),
    )
    .catch(() => undefined);
}

function fileKey(name: string, path: string): string {
  return `${name}\t${path}`;
}

async function idbLoadFiles(name: string): Promise<Record<string, string> | null> {
  try {
    const d = await db();
    if (!d.objectStoreNames.contains("file")) return null;
    const prefix = `${name}\t`;
    const out: Record<string, string> = {};
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction("file", "readonly");
      const store = tx.objectStore("file");
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const key = String(cur.key);
        if (key.startsWith(prefix) && typeof cur.value === "string") {
          out[key.slice(prefix.length)] = cur.value;
        }
        cur.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

async function idbSyncFiles(name: string, files: Record<string, string>, prev: Map<string, string>): Promise<Map<string, string>> {
  const next = new Map<string, string>();
  try {
    const d = await db();
    if (!d.objectStoreNames.contains("file")) return prev;
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction("file", "readwrite");
      const store = tx.objectStore("file");
      for (const [path, content] of Object.entries(files)) {
        const sig = contentSig(content);
        next.set(path, sig);
        if (prev.get(path) === sig) continue;
        store.put(content, fileKey(name, path));
      }
      for (const path of prev.keys()) {
        if (!(path in files)) store.delete(fileKey(name, path));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    void idbDel(`${name}:files`);
    return next;
  } catch {
    void import("./intern").then((m) => m.note("persist", "IndexedDB voll oder gesperrt — Dateien nicht komplett gesichert."));
    return prev;
  }
}

const mem = new Map<string, string>();

function lsGet(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v != null) {
      mem.set(key, v);
      return v;
    }
  } catch {
    /* iframe / Grok-Vorschau */
  }
  return mem.get(key) ?? null;
}

function writeLs(name: string, raw: string) {
  mem.set(name, raw);
  try {
    localStorage.setItem(name, raw);
    return true;
  } catch {
    try {
      const parsed = JSON.parse(raw) as { state?: { chat?: unknown[] } };
      if (parsed.state && Array.isArray(parsed.state.chat)) parsed.state.chat = parsed.state.chat.slice(-12);
      const slim = JSON.stringify(parsed);
      mem.set(name, slim);
      localStorage.setItem(name, slim);
      return true;
    } catch {
      return false;
    }
  }
}

function preferOf(state: Slice): string[] {
  const open = Array.isArray(state.openPaths) ? (state.openPaths as string[]) : [];
  const recent = Array.isArray(state.recentPaths) ? (state.recentPaths as string[]) : [];
  const dirty = state.dirty && typeof state.dirty === "object" ? Object.keys(state.dirty as object) : [];
  return [...open, ...dirty, ...recent];
}

export function idePersistStorage(): PersistStorage<unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  const bag = new Map<string, StorageValue<unknown>>();
  const seen = new Set<string>();
  let timer = 0;
  const written = new Map<string, Map<string, string>>();
  let dropNoted = false;

  function flush() {
    const entries = [...bag.entries()].filter(([name]) => seen.has(name));
    for (const [name] of entries) bag.delete(name);
    for (const [name, value] of entries) {
      const state = { ...((value.state as Slice) ?? {}) };
      const files = state.files;
      delete state.files;
      if (name === "anvil-ide") snapLlm(state);
      const packed = JSON.stringify({ ...value, state });
      const ok = writeLs(name, packed);
      if (!ok && name !== "anvil-intern") {
        void import("./intern").then((m) => m.note("persist", `Speichern fehlgeschlagen (${name})`));
      } else if (ok && name === "anvil-ide") {
        void import("./intern").then((m) => m.resolveKind("persist"));
      }
      if (files && Object.keys(files).length) {
        const onDisk = typeof state.workspaceCwd === "string" && Boolean(state.workspaceCwd.trim());
        const prefer = preferOf(state);
        const slim = shrinkFiles(files, onDisk ? 12_000_000 : PERSIST_TOTAL, prefer);
        const dropped = persistDropped(files, slim);
        const lostOpen = prefer.filter((p) => p in files && !(p in slim));
        if (lostOpen.length && !dropNoted) {
          dropNoted = true;
          void import("./intern").then((m) =>
            m.note("persist", `${lostOpen.length} offene Dateien nicht gesichert. ${onDisk ? "Stand liegt im Ordner." : "Ordner auf der Platte nutzen."}`),
          );
        } else if (dropped && !onDisk && !dropNoted) {
          dropNoted = true;
          void import("./intern").then((m) =>
            m.note("persist", `${dropped} Dateien nicht gesichert (${formatBytes(Object.values(files).reduce((n, c) => n + c.length, 0))}). Ordner auf der Platte nutzen.`),
          );
        }
        const prev = written.get(name) ?? new Map();
        void idbSyncFiles(name, slim, prev).then((next) => written.set(name, next));
        const blob = JSON.stringify(slim);
        if (blob.length < LS_FILES) writeLs(`${name}:files`, blob);
        else {
          mem.delete(`${name}:files`);
          try {
            localStorage.removeItem(`${name}:files`);
          } catch {
            /* */
          }
        }
      }
    }
  }

  window.addEventListener("beforeunload", () => flush());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });

  return {
    getItem: async (name) => {
      const raw = lsGet(name);
      if (!raw) {
        seen.add(name);
        return bag.get(name) ?? null;
      }
      try {
        const parsed = JSON.parse(raw) as StorageValue<Slice>;
        let files = await idbLoadFiles(name);
        if (!files) files = await idbGet(`${name}:files`);
        if (!files) {
          const ls = lsGet(`${name}:files`);
          if (ls) {
            try {
              files = JSON.parse(ls) as Record<string, string>;
            } catch {
              files = null;
            }
          }
        }
        if (!files && parsed.state?.files) files = parsed.state.files;
        if (files) {
          const sigs = new Map<string, string>();
          for (const [p, c] of Object.entries(files)) sigs.set(p, contentSig(c));
          written.set(name, sigs);
        }
        const llm = name === "anvil-ide" ? readLlm() : null;
        parsed.state = { ...(llm ?? {}), ...(parsed.state ?? {}), files: files ?? parsed.state?.files ?? {} };
        seen.add(name);
        return parsed as StorageValue<unknown>;
      } catch {
        seen.add(name);
        return null;
      }
    },
    setItem: (name, value) => {
      if (!seen.has(name)) return;
      bag.set(name, value);
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 480);
    },
    removeItem: (name) => {
      bag.delete(name);
      mem.delete(name);
      mem.delete(`${name}:files`);
      written.delete(name);
      try {
        localStorage.removeItem(name);
        localStorage.removeItem(`${name}:files`);
      } catch {
        /* */
      }
      void idbDel(`${name}:files`);
      void idbSyncFiles(name, {}, written.get(name) ?? new Map());
    },
  };
}
