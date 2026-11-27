import type { Checkpoint } from "@/store/ide-types";
import { prepareCheckpointArchive, materializeCheckpoint, checkpointReferences, type CheckpointRecord } from "./checkpoint-archive.ts";

/** IndexedDB holds full files, chat and deduplicated history; localStorage is a compact recovery copy. */
export type ArchiveMessage = {
  id: string;
  role: string;
  content: string;
  thinking?: string;
  steps?: unknown[];
  images?: unknown[];
  plan?: unknown[];
  lastRun?: { stdout: string; stderr: string; running?: boolean };
};

let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB ist nicht verfügbar."));
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("anvil-persist", 4);
      let cancelled = false;
      request.onupgradeneeded = () => {
        for (const name of ["kv", "file", "chat", "checkpoint", "blob"]) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (cancelled) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        opening = null;
        reject(request.error);
      };
      request.onblocked = () => {
        cancelled = true;
        opening = null;
        reject(new Error("Anvil in weiteren Fenstern schließen, damit die Sicherung aktualisiert werden kann."));
      };
    });
  }
  return opening;
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Sicherung abgebrochen."));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function range(name: string) {
  return IDBKeyRange.bound(`${name}\t`, `${name}\n`, false, true);
}

export async function loadArchive(
  name: string,
): Promise<{ files: Record<string, string> | null; chat: ArchiveMessage[] | null; checkpoints: Checkpoint[] | null; recovery: ArchiveSnapshot["recovery"] | null; state?: Record<string, unknown>; savedAt?: number }> {
  const db = await database();
  const tx = db.transaction(["kv", "file", "chat", "checkpoint", "blob"], "readonly");
  const done = complete(tx);
  const kv = tx.objectStore("kv");
  const marker = result(kv.get(`${name}:files-present`));
  const legacy = result(kv.get(`${name}:files`));
  const order = result(kv.get(`${name}:chat-order`));
  const recovery = result(kv.get(`${name}:recovery`));
  const metadata = result(kv.get(`${name}:state`));
  const checkpointOrder = result(kv.get(`${name}:checkpoint-order`));
  const files: Record<string, string> = {};
  const messages = new Map<string, ArchiveMessage>();
  const checkpoints = new Map<string, CheckpointRecord>(), contents = new Map<string, string>();
  const read = (store: "file" | "chat" | "checkpoint" | "blob", receive: (key: string, value: unknown) => void) => {
    const cursor = tx.objectStore(store).openCursor(range(name));
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      receive(String(row.key).slice(name.length + 1), row.value);
      row.continue();
    };
  };
  read("file", (key, value) => {
    if (typeof value === "string") files[key] = value;
  });
  read("chat", (key, value) => {
    if (value && typeof value === "object") messages.set(key, value as ArchiveMessage);
  });
  read("checkpoint", (key, value) => { if (value && typeof value === "object") checkpoints.set(key, value as CheckpointRecord); });
  read("blob", (key, value) => { if (typeof value === "string") contents.set(key, value); });
  const [present, oldFiles, ids] = await Promise.all([marker, legacy, order, done]);
  const saved = await metadata;
  const checkpointIds = await checkpointOrder;
  const state = saved?.state ? { ...saved.state } as Record<string, unknown> : undefined;
  const legacyCheckpoints = Array.isArray(state?.checkpoints) ? state.checkpoints as Checkpoint[] : null;
  if (state) delete state.checkpoints;
  return {
    ...(state ? { state, savedAt: Number(saved.savedAt) || 0 } : {}),
    files: present || Object.keys(files).length ? files : ((oldFiles as Record<string, string> | undefined) ?? null),
    recovery: (await recovery) ?? null,
    chat: Array.isArray(ids) ? ids.flatMap((id: string) => (messages.has(id) ? [messages.get(id)!] : [])) : null,
    checkpoints: Array.isArray(checkpointIds) ? checkpointIds.flatMap((id: string) => checkpoints.has(id) ? [materializeCheckpoint(checkpoints.get(id)!, contents)] : []) : legacyCheckpoints,
  };
}

export type ArchiveSnapshot = { state?: Record<string, unknown>; savedAt?: number; files?: Record<string, string>; chat?: ArchiveMessage[]; checkpoints?: Checkpoint[]; recovery?: { pendingDiffs: unknown[]; editBases: Record<string, string | null> } };

/** One transaction commits deletions, message order and changed contents together. */
export async function saveArchive(name: string, next: ArchiveSnapshot, previous: ArchiveSnapshot): Promise<void> {
  const historyChanged = next.checkpoints !== undefined && next.checkpoints !== previous.checkpoints;
  const history = next.checkpoints ? await prepareCheckpointArchive(next.checkpoints) : undefined;
  const db = await database();
  const tx = db.transaction(["kv", "file", "chat", "checkpoint", "blob"], "readwrite");
  const done = complete(tx);
  const kv = tx.objectStore("kv");
  const cached = previous;
  const write = (previous: ArchiveSnapshot) => {
  if (history && (historyChanged || previous !== cached)) {
    const records = tx.objectStore("checkpoint"), blobs = tx.objectStore("blob");
    const ids = new Set(history.records.map((r) => r.checkpoint.id));
    const used = new Set(history.records.flatMap(checkpointReferences));
    // Idempotent writes also repair content removed by another browser tab's history GC.
    for (const record of history.records) records.put(record, `${name}\t${record.checkpoint.id}`);
    for (const [hash, content] of history.contents) blobs.put(content, `${name}\t${hash}`);
    for (const [store, keep] of [[records, ids], [blobs, used]] as const) {
      const cursor = store.openCursor(range(name));
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (!keep.has(String(row.key).slice(name.length + 1))) row.delete();
        row.continue();
      };
    }
    kv.put([...ids], `${name}:checkpoint-order`);
  }
  if (next.files && next.files !== previous.files) {
    const files = tx.objectStore("file");
    for (const [path, content] of Object.entries(next.files)) {
      if (previous.files?.[path] !== content) files.put(content, `${name}\t${path}`);
    }
    for (const path of Object.keys(previous.files ?? {})) {
      if (!(path in next.files)) files.delete(`${name}\t${path}`);
    }
    if (!previous.files) {
      const cursor = files.openCursor(range(name));
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (!(String(row.key).slice(name.length + 1) in next.files!)) row.delete();
        row.continue();
      };
    }
    if (!Object.keys(next.files).length) files.delete(range(name));
    kv.put(true, `${name}:files-present`);
    kv.delete(`${name}:files`);
  }
  if (next.chat && next.chat !== previous.chat) {
    const chat = tx.objectStore("chat");
    const before = new Map(previous.chat?.map((message) => [message.id, message]));
    const ids = new Set(next.chat.map((message) => message.id));
    for (const message of next.chat) {
      if (before.get(message.id) === message) continue;
      chat.put(
        { ...message, lastRun: message.lastRun ? { ...message.lastRun, running: false } : undefined },
        `${name}\t${message.id}`,
      );
    }
    for (const id of before.keys()) if (!ids.has(id)) chat.delete(`${name}\t${id}`);
    if (!previous.chat) {
      const cursor = chat.openCursor(range(name));
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (!ids.has(String(row.key).slice(name.length + 1))) row.delete();
        row.continue();
      };
    }
    if (!ids.size) chat.delete(range(name));
    kv.put([...ids], `${name}:chat-order`);
  }
  if (next.state && next.state !== previous.state) kv.put({ state: next.state, savedAt: next.savedAt }, `${name}:state`);
  if (next.recovery && next.recovery !== previous.recovery) kv.put(next.recovery, `${name}:recovery`);
  };
  const current = kv.get(`${name}:state`);
  current.onsuccess = () => {
    const savedAt = Number(current.result?.savedAt) || 0;
    const sameGeneration = savedAt === (cached.savedAt ?? 0);
    if (next.savedAt !== undefined) next.savedAt = Math.max(next.savedAt, savedAt + 1);
    // Another tab or a project reload invalidates every incremental cache, not just history.
    write(sameGeneration ? cached : {});
  };
  await done;
}

export async function removeArchive(name: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["kv", "file", "chat", "checkpoint", "blob"], "readwrite");
  const done = complete(tx);
  tx.objectStore("file").delete(range(name));
  tx.objectStore("chat").delete(range(name));
  tx.objectStore("checkpoint").delete(range(name));
  tx.objectStore("blob").delete(range(name));
  for (const suffix of [":files", ":files-present", ":chat-order", ":checkpoint-order", ":recovery", ":state"]) tx.objectStore("kv").delete(name + suffix);
  await done;
}
