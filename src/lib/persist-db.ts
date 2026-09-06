/** IndexedDB holds full files and chat; localStorage is a compact recovery copy. */
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
      const request = indexedDB.open("anvil-persist", 3);
      let cancelled = false;
      request.onupgradeneeded = () => {
        for (const name of ["kv", "file", "chat"]) {
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
): Promise<{ files: Record<string, string> | null; chat: ArchiveMessage[] | null }> {
  const db = await database();
  const tx = db.transaction(["kv", "file", "chat"], "readonly");
  const done = complete(tx);
  const kv = tx.objectStore("kv");
  const marker = result(kv.get(`${name}:files-present`));
  const legacy = result(kv.get(`${name}:files`));
  const order = result(kv.get(`${name}:chat-order`));
  const files: Record<string, string> = {};
  const messages = new Map<string, ArchiveMessage>();
  const read = (store: "file" | "chat", receive: (key: string, value: unknown) => void) => {
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
  const [present, oldFiles, ids] = await Promise.all([marker, legacy, order, done]);
  return {
    files: present || Object.keys(files).length ? files : ((oldFiles as Record<string, string> | undefined) ?? null),
    chat: Array.isArray(ids) ? ids.flatMap((id: string) => (messages.has(id) ? [messages.get(id)!] : [])) : null,
  };
}

export type ArchiveSnapshot = { files?: Record<string, string>; chat?: ArchiveMessage[] };

/** One transaction commits deletions, message order and changed contents together. */
export async function saveArchive(name: string, next: ArchiveSnapshot, previous: ArchiveSnapshot): Promise<void> {
  const db = await database();
  const tx = db.transaction(["kv", "file", "chat"], "readwrite");
  const done = complete(tx);
  const kv = tx.objectStore("kv");
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
  await done;
}

export async function removeArchive(name: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(["kv", "file", "chat"], "readwrite");
  const done = complete(tx);
  tx.objectStore("file").delete(range(name));
  tx.objectStore("chat").delete(range(name));
  for (const suffix of [":files", ":files-present", ":chat-order"]) tx.objectStore("kv").delete(name + suffix);
  await done;
}
