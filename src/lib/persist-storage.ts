import type { PersistStorage, StorageValue } from "zustand/middleware";

const TOTAL = 12_000_000;
const EACH = 1_500_000;
const LS_FILES = 2_000_000;

export function shrinkFiles(files: Record<string, string>, budget = TOTAL): Record<string, string> {
  const out: Record<string, string> = {};
  let used = 0;
  for (const path of Object.keys(files).sort()) {
    const c = files[path];
    if (c.length > EACH) continue;
    if (used + c.length > budget) continue;
    out[path] = c;
    used += c.length;
  }
  return out;
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
      const req = indexedDB.open("anvil-persist", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
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
          const q = d.transaction("kv").objectStore("kv").get(key);
          q.onsuccess = () => resolve((q.result as Record<string, string>) ?? null);
          q.onerror = () => reject(q.error);
        }),
    )
    .catch(() => null);
}

function idbSet(key: string, value: Record<string, string>): Promise<void> {
  return db()
    .then(
      (d) =>
        new Promise<void>((resolve, reject) => {
          const q = d.transaction("kv", "readwrite").objectStore("kv").put(value, key);
          q.onsuccess = () => resolve();
          q.onerror = () => reject(q.error);
        }),
    )
    .catch(() => undefined);
}

function idbDel(key: string): Promise<void> {
  return db()
    .then(
      (d) =>
        new Promise<void>((resolve, reject) => {
          const q = d.transaction("kv", "readwrite").objectStore("kv").delete(key);
          q.onsuccess = () => resolve();
          q.onerror = () => reject(q.error);
        }),
    )
    .catch(() => undefined);
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

export function idePersistStorage(): PersistStorage<unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  const bag = new Map<string, StorageValue<unknown>>();
  const seen = new Set<string>();
  let timer = 0;
  const fileSig = new Map<string, string>();

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
        const slim = shrinkFiles(files);
        const sig = `${Object.keys(slim).length}:${Object.values(slim).reduce((n, c) => n + c.length, 0)}`;
        if (fileSig.get(name) === sig) continue;
        fileSig.set(name, sig);
        void idbSet(`${name}:files`, slim);
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
        let files = await idbGet(`${name}:files`);
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
      try {
        localStorage.removeItem(name);
        localStorage.removeItem(`${name}:files`);
      } catch {
        /* */
      }
      void idbDel(`${name}:files`);
    },
  };
}
