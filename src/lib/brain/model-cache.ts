import { LOCAL_MODEL_ORIGIN } from "./runtime-environment";

type ModelRecord = { model_id: string; model: string; model_lib: string };
const SCOPES = ["webllm/model", "webllm/config", "webllm/wasm"];

export function modelCacheMatch(record: ModelRecord, raw: string): boolean {
  try {
    const url = new URL(raw);
    const root = record.model.replace(/\/+$/, "");
    if (raw.startsWith(`${root}/`) || raw === record.model_lib) return true;
    if (url.origin === LOCAL_MODEL_ORIGIN) return url.pathname.startsWith(`/${record.model_id}/`);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return false;
    const path = decodeURIComponent(url.pathname).replace(/^\/t\/[^/]+/, "");
    return path.startsWith(`/${record.model_id}/`) || path === `/libs/${record.model_lib.split("/").pop()}`;
  } catch { return false; }
}

/** Remove only this model's entries, including legacy token URLs. Never delete
 * whole storage databases; other models, pins and workspace data are untouched. */
export async function removeModelCache(record: ModelRecord): Promise<void> {
  const matches = (url: string) => modelCacheMatch(record, url);
  if (typeof caches !== "undefined") {
    const names = await caches.keys();
    for (const scope of SCOPES.filter((s) => names.includes(s))) {
      const cache = await caches.open(scope);
      for (const request of await cache.keys()) if (matches(request.url)) await cache.delete(request);
    }
  }
  if (typeof indexedDB !== "undefined" && indexedDB.databases) {
    const names = (await indexedDB.databases()).map((d) => d.name);
    for (const scope of SCOPES.filter((s) => names.includes(s))) {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(scope);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("urls")) { db.close(); resolve(); return; }
          const tx = db.transaction("urls", "readwrite");
          const cursor = tx.objectStore("urls").openKeyCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c) return;
            if (matches(String(c.key))) tx.objectStore("urls").delete(c.primaryKey);
            c.continue();
          };
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
        };
      });
    }
  }
  if (typeof navigator !== "undefined" && navigator.storage?.getDirectory) {
    let root: FileSystemDirectoryHandle;
    try { root = await (await navigator.storage.getDirectory()).getDirectoryHandle("tvmjs-opfs-store"); }
    catch (err) { if ((err as DOMException).name === "NotFoundError") return; throw err; }
    for (const scope of SCOPES) {
      let dir = root;
      try { for (const part of scope.split("/")) dir = await dir.getDirectoryHandle(part); }
      catch (err) { if ((err as DOMException).name === "NotFoundError") continue; throw err; }
      const entries = (dir as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }).values();
      for await (const handle of entries) {
        if (handle.kind !== "file" || !handle.name.endsWith(".meta.json")) continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        if (file.size > 16_384) continue;
        let meta: { url?: string };
        try { meta = JSON.parse(await file.text()); } catch { continue; }
        if (!meta.url || !matches(meta.url)) continue;
        await dir.removeEntry(handle.name.replace(/\.meta\.json$/, ".bin")).catch((err) => { if (err.name !== "NotFoundError") throw err; });
        await dir.removeEntry(handle.name);
      }
    }
  }
}
