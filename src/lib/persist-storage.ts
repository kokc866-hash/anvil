import type { PersistStorage, StorageValue } from "zustand/middleware";
import { formatBytes, rankPaths, skipPath } from "./ws-skip.ts";
import { isSecretPath, isRefPath } from "./ref.ts";
import {
  loadArchive,
  saveArchive,
  removeArchive,
  type ArchiveMessage,
  type ArchiveSnapshot,
} from "./persist-db.ts";
import { persistChat } from "./session.ts";

export const PERSIST_TOTAL = 96_000_000;
export const PERSIST_EACH = 3_000_000;
const LS_FILES = 1_500_000;

export { formatBytes };

export function shrinkFiles(
  files: Record<string, string>,
  budget = PERSIST_TOTAL,
  prefer: string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  let used = 0;
  const order = rankPaths(
    Object.keys(files).filter(
      (p) => (!skipPath(p) && !isSecretPath(p)) || prefer.includes(p) || isRefPath(p),
    ),
    [...prefer, ...Object.keys(files).filter(isRefPath)],
  );
  for (const path of order) {
    const c = files[path];
    if (c == null) continue;
    const cap = isRefPath(path) || prefer.includes(path) ? 8_000_000 : PERSIST_EACH;
    if (c.length > cap) continue;
    if (used + c.length > budget) continue;
    out[path] = c;
    used += c.length;
  }
  return out;
}

export function persistDropped(
  files: Record<string, string>,
  kept: Record<string, string>,
): number {
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
      if (parsed.state && Array.isArray(parsed.state.chat))
        parsed.state.chat = parsed.state.chat.slice(-12);
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
  const dirty =
    state.dirty && typeof state.dirty === "object" ? Object.keys(state.dirty as object) : [];
  return [...open, ...dirty, ...recent];
}

const flushers = new Set<() => Promise<void>>();
export async function flushPersistence(): Promise<void> {
  await Promise.all([...flushers].map((flush) => flush()));
}

function sameSlice(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Slice,
    right = b as Slice;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function persistenceError(name: string, error: unknown) {
  if (name === "anvil-intern") return;
  const detail = error instanceof Error ? error.message : "Speicher voll oder gesperrt.";
  void import("./intern").then((m) => m.note("persist", `Sicherung unvollständig: ${detail}`));
}

export function idePersistStorage(): PersistStorage<unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  const bag = new Map<string, StorageValue<unknown>>();
  const seen = new Set<string>();
  const latest = new Map<string, StorageValue<unknown>>();
  const generations = new Map<string, number>();
  const written = new Map<string, ArchiveSnapshot>();
  const fileCache = new Map<
    string,
    { source: Record<string, string>; preference: string; files: Record<string, string> }
  >();
  let timer = 0,
    deadline = 0;
  let tail: Promise<void> = Promise.resolve();
  let dropNoted = false;

  function enqueue(work: () => Promise<void>) {
    const next = tail.catch(() => undefined).then(work);
    tail = next;
    void next.catch(() => undefined);
    return next;
  }

  function flush(): Promise<void> {
    window.clearTimeout(timer);
    window.clearTimeout(deadline);
    timer = deadline = 0;
    const entries = [...bag.entries()]
      .filter(([name]) => seen.has(name))
      .map(([name, value]) => ({ name, value, generation: generations.get(name) ?? 0 }));
    for (const { name } of entries) bag.delete(name);
    if (!entries.length) return tail;
    return enqueue(async () => {
      const failures: unknown[] = [];
      for (const { name, value, generation } of entries) {
        if ((generations.get(name) ?? 0) !== generation) continue;
        try {
          const state = { ...((value.state as Slice) ?? {}) };
          const source = state.files;
          const chat = Array.isArray(state.chat) ? (state.chat as ArchiveMessage[]) : undefined;
          delete state.files;
          // Keep a small recovery copy. The primary archive retains complete messages.
          if (chat)
            state.chat = persistChat(chat).map((m) => ({
              ...m,
              steps: m.steps?.map((step) => {
                if (!step || typeof step !== "object") return step;
                const { image: _image, ...rest } = step as Record<string, unknown>;
                return rest;
              }),
            }));
          if (name === "anvil-ide") snapLlm(state);
          const localOk = writeLs(name, JSON.stringify({ ...value, state }));
          let files: Record<string, string> | undefined;
          if (source) {
            const onDisk =
              typeof state.workspaceCwd === "string" && Boolean(state.workspaceCwd.trim());
            const prefer = preferOf(state);
            const preference = JSON.stringify([onDisk, prefer]);
            const cached = fileCache.get(name);
            if (cached?.source === source && cached.preference === preference) files = cached.files;
            else {
              files = shrinkFiles(source, onDisk ? 12_000_000 : PERSIST_TOTAL, prefer);
              const dropped = persistDropped(source, files);
              if (dropped && !dropNoted) {
                dropNoted = true;
                void import("./intern").then((m) =>
                  m.note(
                    "persist",
                    `${dropped} Dateien passen nicht in die Browser-Sicherung. ${onDisk ? "Speicherstatus des Ordners beachten." : "Einen Ordner auf der Platte nutzen."}`,
                  ),
                );
              }
              fileCache.set(name, { source, preference, files });
              // Do not stringify a large workspace merely to discover it exceeds this limit.
              const size = Object.entries(files).reduce(
                (n, [path, content]) => n + path.length + content.length + 6,
                2,
              );
              const blob = size < LS_FILES ? JSON.stringify(files) : "";
              if (blob && blob.length < LS_FILES) writeLs(`${name}:files`, blob);
              else {
                mem.delete(`${name}:files`);
                try {
                  localStorage.removeItem(`${name}:files`);
                } catch {
                  /* unavailable */
                }
              }
            }
          }
          if (files || chat) {
            const snapshot = { files, chat };
            const previous = written.get(name) ?? {};
            if (snapshot.files !== previous.files || snapshot.chat !== previous.chat)
              await saveArchive(name, snapshot, previous);
            written.set(name, snapshot);
          }
          if (!localOk) throw new Error("Einstellungen konnten nicht gespeichert werden.");
        } catch (error) {
          persistenceError(name, error);
          failures.push(error);
          // A later state change or explicit save can retry the latest snapshot.
          if ((generations.get(name) ?? 0) === generation) {
            if (!bag.has(name)) bag.set(name, latest.get(name) ?? value);
            latest.delete(name);
          }
        }
      }
      if (failures.length) throw new AggregateError(failures, "Sicherung unvollständig.");
    });
  }

  const backgroundFlush = () => {
    void flush().catch(() => undefined);
  };
  flushers.add(flush);
  window.addEventListener("beforeunload", backgroundFlush);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) backgroundFlush();
  });

  return {
    getItem: async (name) => {
      await tail.catch(() => undefined);
      const raw = lsGet(name);
      try {
        let parsed: StorageValue<Slice> | null = null;
        try {
          const value = raw ? JSON.parse(raw) : null;
          if (value?.state && typeof value.state === "object")
            parsed = value as StorageValue<Slice>;
        } catch {
          /* Recover the primary archive even if the compact copy is damaged. */
        }
        if (!parsed && name !== "anvil-ide") {
          seen.add(name);
          return bag.get(name) ?? null;
        }
        const archive = await loadArchive(name).catch((error) => {
          if (name === "anvil-ide") persistenceError(name, error);
          return { files: null, chat: null };
        });
        const llm = name === "anvil-ide" ? readLlm() : null;
        if (!parsed && archive.files === null && archive.chat === null && !llm) {
          seen.add(name);
          return bag.get(name) ?? null;
        }
        parsed ??= { state: {} };
        let files = archive.files;
        if (files === null) {
          const backup = lsGet(`${name}:files`);
          try {
            files = backup ? (JSON.parse(backup) as Record<string, string>) : null;
          } catch {
            /* legacy recovery */
          }
        }
        files ??= parsed.state?.files ?? {};
        written.set(name, { files: archive.files ?? undefined, chat: archive.chat ?? undefined });
        parsed.state = { ...(llm ?? {}), ...(parsed.state ?? {}), files };
        if (archive.chat !== null) parsed.state.chat = archive.chat;
        seen.add(name);
        return parsed as StorageValue<unknown>;
      } catch {
        seen.add(name);
        return null;
      }
    },
    setItem: (name, value) => {
      if (!seen.has(name)) return;
      const previous = latest.get(name);
      if (previous?.version === value.version && sameSlice(previous?.state, value.state)) return;
      latest.set(name, value);
      bag.set(name, value);
      window.clearTimeout(timer);
      timer = window.setTimeout(backgroundFlush, 480);
      deadline ||= window.setTimeout(backgroundFlush, 3000);
    },
    removeItem: (name) => {
      generations.set(name, (generations.get(name) ?? 0) + 1);
      bag.delete(name);
      latest.delete(name);
      // Queue removal after in-flight writes; no earlier snapshot may reappear afterwards.
      return enqueue(async () => {
        await removeArchive(name);
        written.delete(name);
        fileCache.delete(name);
        mem.delete(name);
        mem.delete(`${name}:files`);
        localStorage.removeItem(name);
        localStorage.removeItem(`${name}:files`);
      }).catch((error) => {
        persistenceError(name, error);
        throw error;
      });
    },
  };
}
