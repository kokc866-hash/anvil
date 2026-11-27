import type { PersistStorage, StorageValue } from "zustand/middleware";
import { formatBytes, isImportedPluginPath, rankPaths, skipPath } from "./ws-skip.ts";
import { isSecretPath, isRefPath } from "./ref.ts";
import {
  loadArchive,
  saveArchive,
  removeArchive,
  type ArchiveMessage,
  type ArchiveSnapshot,
} from "./persist-db.ts";
import { persistChat } from "./session.ts";
import type { Checkpoint } from "@/store/ide-types";
import { prepareCheckpointArchive } from "./checkpoint-archive.ts";

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
      (p) => isImportedPluginPath(p) ? !isSecretPath(p) : (!skipPath(p) && !isSecretPath(p)) || prefer.includes(p) || isRefPath(p),
    ),
    [...prefer, ...Object.keys(files).filter(isRefPath)],
  );
  for (const path of order) {
    const c = files[path];
    if (c == null) continue;
    const cap = isImportedPluginPath(path) ? 16 * 1024 * 1024 : isRefPath(path) || prefer.includes(path) ? 8_000_000 : PERSIST_EACH;
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

function projectScope(state?: Slice): string {
  const cwd = typeof state?.workspaceCwd === "string" ? state.workspaceCwd.trim().replace(/\\/g, "/").replace(/\/$/, "") : "";
  // A remote Companion may expose the same path on a different machine.
  return JSON.stringify(cwd ? [cwd, state?.companionUrl ?? ""] : [state?.workspaceMemoryId ?? state?.memoryWorkspace ?? ""]);
}

type FileRecovery = { schema: 2; savedAt: number; scope: string; complete: boolean; baseSavedAt: number; files: Record<string, string>; removed: string[]; unavailable: string[] };
function fileRecovery(files: Record<string, string>, previous: ArchiveSnapshot, savedAt: number, scope: string): FileRecovery {
  const size = Object.entries(files).reduce((n, [path, text]) => n + path.length + text.length + 6, 2);
  if (size < LS_FILES) return { schema: 2, savedAt, scope, complete: true, baseSavedAt: previous.savedAt ?? 0, files, removed: [], unavailable: [] };
  const baseline = projectScope(previous.state) === scope ? previous.files ?? {} : {};
  let used = 0;
  const changed: Record<string, string> = {}, unavailable: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (baseline[path] === text) continue;
    const count = JSON.stringify([path, text]).length;
    if (used + count > LS_FILES - 20_000) unavailable.push(path);
    else { changed[path] = text; used += count; }
  }
  return { schema: 2, savedAt, scope, complete: false, baseSavedAt: previous.savedAt ?? 0, files: changed,
    removed: Object.keys(baseline).filter((p) => !(p in files)), unavailable };
}

const LLM_SNAP = "anvil-llm";
const LLM_KEYS = [
  "llmProvider",
  "llmAuthMode",
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
  "llmToolModes",
  "llmToolLearning",
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
const volatile = new Set<string>();

function lsGet(key: string): string | null {
  if (volatile.has(key)) return mem.get(key) ?? null;
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
    volatile.delete(name);
    return true;
  } catch {
    try {
      const parsed = JSON.parse(raw) as { state?: { chat?: unknown[] } };
      if (parsed.state && Array.isArray(parsed.state.chat))
        parsed.state.chat = parsed.state.chat.slice(-12);
      const slim = JSON.stringify(parsed);
      mem.set(name, slim);
      localStorage.setItem(name, slim);
      volatile.delete(name);
      return true;
    } catch {
      volatile.add(name);
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
  if (name === "anvil-ide") window.dispatchEvent(new CustomEvent("anvil-persistence", { detail: { error: detail } }));
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
  let scheduled: { generations: Map<string, number>; promise: Promise<void> } | null = null;
  let dropNoted = false;
  let lastSavedAt = 0;

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
    if (![...bag.keys()].some(name => seen.has(name))) return tail;
    if (scheduled) {
      for (const name of bag.keys()) if (seen.has(name)) scheduled.generations.set(name, generations.get(name) ?? 0);
      return scheduled.promise;
    }
    // Keep one active write and one latest pending value per store. Capturing
    // every stream snapshot here retained entire old states when disk/IDB was
    // slower than the live update interval.
    const batch = { generations: new Map<string, number>(), promise: Promise.resolve() };
    for (const name of bag.keys()) if (seen.has(name)) batch.generations.set(name, generations.get(name) ?? 0);
    scheduled = batch;
    batch.promise = enqueue(async () => {
      if (scheduled === batch) scheduled = null;
      const entries = [...batch.generations].flatMap(([name, generation]) => {
        const value = bag.get(name);
        if (!value || (generations.get(name) ?? 0) !== generation) return [];
        bag.delete(name);
        return [{ name, value, generation }];
      });
      const failures: unknown[] = [];
      for (const { name, value, generation } of entries) {
        if ((generations.get(name) ?? 0) !== generation) continue;
        try {
          const state = { ...((value.state as Slice) ?? {}) };
          const source = state.files;
          const chat = Array.isArray(state.chat) ? (state.chat as ArchiveMessage[]) : undefined;
          const checkpoints = Array.isArray(state.checkpoints) ? state.checkpoints as Checkpoint[] : undefined;
          const history = checkpoints ? await prepareCheckpointArchive(checkpoints) : undefined;
          if ((generations.get(name) ?? 0) !== generation) continue;
          const previous = written.get(name) ?? {};
          delete state.files;
          const savedAt = lastSavedAt = Math.max(Date.now(), lastSavedAt + 1, (previous.savedAt ?? 0) + 1);
          const archiveState = name === "anvil-ide" || name === "anvil-learn" ? { ...state } : undefined;
          if (archiveState) { delete archiveState.chat; delete archiveState.pendingDiffs; delete archiveState.editBases; delete archiveState.checkpoints; }
          if (history) state.checkpoints = history.summaries;
          // Complete inactive sessions live in IndexedDB, not the small recovery copy.
          delete state.workspaceSessions;
          const recovery = Array.isArray(state.pendingDiffs) ? {
            pendingDiffs: state.pendingDiffs,
            editBases: (state.editBases ?? {}) as Record<string, string | null>,
          } : undefined;
          if (recovery) {
            // Compact recovery keeps whole documents only; primary backups are never truncated.
            let budget = 500_000;
            state.pendingDiffs = recovery.pendingDiffs.filter((d) => { const n = JSON.stringify(d).length; if (n > budget) return false; budget -= n; return true; });
            state.editBases = Object.fromEntries(Object.entries(recovery.editBases).filter(([, text]) => { const n = text?.length ?? 0; if (n > budget) return false; budget -= n; return true; }));
          }
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
          let files: Record<string, string> | undefined;
          if (source) {
            const onDisk =
              typeof state.workspaceCwd === "string" && Boolean(state.workspaceCwd.trim());
            const prefer = preferOf(state);
            const preference = JSON.stringify([onDisk, prefer]);
            const cached = fileCache.get(name);
            if (cached?.source === source && cached.preference === preference) files = cached.files;
            else {
              const hasPackages = Object.keys(source).some(isImportedPluginPath);
              files = shrinkFiles(source, onDisk && !hasPackages ? 12_000_000 : PERSIST_TOTAL, prefer);
              const dropped = persistDropped(source, files);
              if (dropped && !dropNoted) {
                dropNoted = true;
                void import("./intern").then((m) =>
                  m.note(
                    "persist",
                    `${dropped} Dateien passen nicht in die Browser-Sicherung. ${onDisk ? "Prüfe, ob die Dateien im Projektordner gespeichert sind." : "Wähle einen lokalen Projektordner, um die Dateien dort zu speichern."}`,
                  ),
                );
              }
              fileCache.set(name, { source, preference, files });
            }
          }
          // Both compact records carry one generation; mismatches after a partial local write are rejected on load.
          if (files) writeLs(`${name}:files`, JSON.stringify(fileRecovery(files, previous, savedAt, projectScope(state))));
          const localOk = writeLs(name, JSON.stringify({ ...value, state, savedAt }));
          if (files || chat || recovery || checkpoints || archiveState) {
            const snapshot = { files, chat, recovery, checkpoints, state: archiveState, savedAt };
            if (snapshot.files !== previous.files || snapshot.chat !== previous.chat || snapshot.recovery !== previous.recovery || snapshot.checkpoints !== previous.checkpoints || snapshot.state !== previous.state)
              await saveArchive(name, snapshot, previous);
            written.set(name, snapshot);
            if (name === "anvil-ide") window.dispatchEvent(new CustomEvent("anvil-persistence", { detail: { error: "" } }));
          }
          if (!localOk && !archiveState) throw new Error("Einstellungen konnten nicht gespeichert werden.");
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
    return batch.promise;
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
        let parsed: (StorageValue<Slice> & { savedAt?: number }) | null = null;
        try {
          const value = raw ? JSON.parse(raw) : null;
          if (value?.state && typeof value.state === "object")
            parsed = value as StorageValue<Slice>;
        } catch {
          /* Recover the primary archive even if the compact copy is damaged. */
        }
        if (!parsed && name !== "anvil-ide" && name !== "anvil-learn") {
          seen.add(name);
          return bag.get(name) ?? null;
        }
        const archive = await loadArchive(name).catch((error) => {
          if (name === "anvil-ide") persistenceError(name, error);
          return { files: null, chat: null, checkpoints: null, recovery: null, state: undefined, savedAt: 0 };
        });
        const llm = name === "anvil-ide" ? readLlm() : null;
        if (!parsed && archive.files === null && archive.chat === null && !archive.state && !llm) {
          seen.add(name);
          return bag.get(name) ?? null;
        }
        parsed ??= { state: {} };
        lastSavedAt = Math.max(lastSavedAt, parsed.savedAt ?? 0, archive.savedAt ?? 0);
        const local = parsed.state;
        let localNewer = !archive.state || (parsed.savedAt ?? 0) > (archive.savedAt ?? 0);
        const sameProject = !archive.state || projectScope(local) === projectScope(archive.state);
        let files: Record<string, string> | null = localNewer && !sameProject ? null : archive.files;
        let localFilesComplete = Boolean(local.files);
        let rejectedLocal = false;
        let recoveryWarning = "";
        if (localNewer || files === null) {
          try {
            const rawFiles = lsGet(`${name}:files`);
            const backup = rawFiles ? JSON.parse(rawFiles) as FileRecovery | Record<string, string> : null;
            if (backup?.schema === 2) {
              const copy = backup as FileRecovery;
              if (copy.savedAt === parsed.savedAt && copy.scope === projectScope(local)) {
                const baseline = sameProject && copy.baseSavedAt === (archive.savedAt ?? 0) ? archive.files : null;
                files = copy.complete ? copy.files : { ...baseline, ...copy.files };
                for (const path of [...copy.removed, ...copy.unavailable]) delete files[path];
                localFilesComplete = copy.complete || Boolean(baseline) && !copy.unavailable.length;
                if (copy.unavailable.length) {
                  recoveryWarning = "Einige neuere Dateiinhalte fehlen in der Notfallsicherung. Prüfe die gespeicherten Projektdateien, bevor du weiterarbeitest.";
                  persistenceError(name, new Error(recoveryWarning));
                }
              }
            } else if (backup && (sameProject || archive.files === null)) { files = backup as Record<string, string>; localFilesComplete = true; }
          } catch {
            /* Recover from the coherent primary generation if the compact file copy is damaged. */
          }
          if (local.files) files = local.files;
        }
        if (localNewer && name === "anvil-ide" && !localFilesComplete && archive.state && archive.files !== null) {
          // Preserve the rejected newer metadata for diagnosis, but never pair it with older project files.
          if (raw) writeLs(`${name}:incomplete-recovery`, raw);
          recoveryWarning = "Die neuere Notfallsicherung enthält keinen vollständigen passenden Dateistand. Der letzte vollständige Archivstand wurde geladen; die neuere Metadatenkopie bleibt separat erhalten.";
          persistenceError(name, new Error(recoveryWarning));
          localNewer = false;
          rejectedLocal = true;
          files = archive.files;
        }
        files ??= {};
        // Inline v3 history has no content revisions yet: force one migration on the next save.
        written.set(name, { files: archive.files ?? undefined, chat: archive.chat ?? undefined,
          checkpoints: archive.checkpoints?.every((c) => c.archiveRevision) ? archive.checkpoints : undefined,
          recovery: archive.recovery ?? undefined, state: archive.state, savedAt: archive.savedAt });
        const metadata = localNewer ? { ...(sameProject ? archive.state : {}), ...local } : { ...(sameProject && !rejectedLocal ? local : {}), ...archive.state };
        parsed.state = { ...(llm ?? {}), ...metadata, ...(name === "anvil-ide" || archive.files !== null ? { files } : {}) };
        if (name === "anvil-ide" && recoveryWarning) parsed.state.persistenceWarning = recoveryWarning;
        if (archive.recovery && (!localNewer || sameProject)) {
          for (const [key, value] of Object.entries(archive.recovery)) if (!localNewer || !Object.hasOwn(local, key)) parsed.state[key] = value;
        }
        if (archive.chat !== null && (!localNewer || sameProject && !Object.hasOwn(local, "chat"))) parsed.state.chat = archive.chat;
        if (localNewer && Array.isArray(local.checkpoints)) {
          const primary = new Map(archive.checkpoints?.map((c) => [c.id, c]));
          parsed.state.checkpoints = (local.checkpoints as Checkpoint[]).map((c) => {
            if (!c.archiveMissing || !sameProject) return c;
            const full = primary.get(c.id);
            return full?.archiveRevision === c.archiveRevision ? full : c;
          });
        } else if (archive.checkpoints !== null) parsed.state.checkpoints = archive.checkpoints;
        seen.add(name);
        return parsed as StorageValue<unknown>;
      } catch {
        seen.add(name);
        return null;
      }
    },
    setItem: (name, value) => {
      if (name === "anvil-ide" && /^\/(run|console)(\/|$)/.test(window.location?.pathname ?? "")) return;
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
      // A following generation must queue behind the removal, never be folded
      // into a flush scheduled before this barrier.
      scheduled = null;
      // Queue removal after in-flight writes; no earlier snapshot may reappear afterwards.
      return enqueue(async () => {
        await removeArchive(name);
        written.delete(name);
        fileCache.delete(name);
        mem.delete(name);
        mem.delete(`${name}:files`);
        volatile.delete(name);
        volatile.delete(`${name}:files`);
        mem.delete(`${name}:incomplete-recovery`);
        volatile.delete(`${name}:incomplete-recovery`);
        localStorage.removeItem(name);
        localStorage.removeItem(`${name}:files`);
        localStorage.removeItem(`${name}:incomplete-recovery`);
      }).catch((error) => {
        persistenceError(name, error);
        throw error;
      });
    },
  };
}
