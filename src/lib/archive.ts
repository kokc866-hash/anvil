import { keepDotName } from "./ws-skip.ts";

import { ARCHIVE_MAX_COMPRESSED, checkArchiveInput, decodeArchive, encodeArchive } from "./archive-codec.ts";
export { ARCHIVE_MAX_COMPRESSED, ARCHIVE_MAX_EXPANDED, ARCHIVE_MAX_FILE, ARCHIVE_MAX_FILES, u8ToB64, bytesToDataUrl, extractPdfText } from "./archive-codec.ts";

export type ArchiveOptions = { signal?: AbortSignal; timeoutMs?: number };
type ArchiveResult = { ok: boolean; bytes?: Uint8Array; files?: Record<string, string>; error?: string };

function timeout(options: ArchiveOptions): number {
  const value = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(value) || value < 1 || value > 120_000) throw new Error("Ungültiges ZIP-Zeitlimit.");
  return value;
}

/** Termination bounds CPU work as well as waiting; abort never falls back to UI-thread work. */
function workerTask(payload: { operation: "zip"; files: Record<string, string> } | { operation: "unzip"; buffer: ArrayBuffer }, options: ArchiveOptions): Promise<ArchiveResult> {
  options.signal?.throwIfAborted();
  const limit = timeout(options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./archive-worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (result?: ArchiveResult, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(undefined, options.signal?.reason ?? new DOMException("ZIP abgebrochen", "AbortError"));
    const timer = setTimeout(() => finish(undefined, new DOMException("ZIP-Zeitlimit überschritten", "TimeoutError")), limit);
    worker.onmessage = event => {
      const result = event.data as ArchiveResult;
      if (!result.ok) finish(undefined, new Error(result.error || "ZIP-Verarbeitung fehlgeschlagen."));
      else finish(result);
    };
    worker.onerror = event => finish(undefined, new Error(event.message || "ZIP-Worker konnte nicht geladen werden."));
    worker.onmessageerror = () => finish(undefined, new Error("ZIP-Worker-Antwort ungültig."));
    options.signal?.addEventListener("abort", abort, { once: true });
    try { worker.postMessage(payload, "buffer" in payload ? [payload.buffer] : []); }
    catch (error) { finish(undefined, error); }
  });
}

export async function zipFiles(files: Record<string, string>, options: ArchiveOptions = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  timeout(options);
  checkArchiveInput(files);
  const bytes = typeof window !== "undefined" && typeof Worker !== "undefined"
    ? (await workerTask({ operation: "zip", files }, options)).bytes!
    : encodeArchive(files);
  return new Blob([Uint8Array.from(bytes)], { type: "application/zip" });
}

export async function unzipFiles(buf: ArrayBuffer, options: ArchiveOptions = {}): Promise<Record<string, string>> {
  options.signal?.throwIfAborted();
  const limit = timeout(options);
  if (buf.byteLength > ARCHIVE_MAX_COMPRESSED) throw new Error("ZIP: komprimiertes Archiv überschreitet 64 MiB.");
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    return (await workerTask({ operation: "unzip", buffer: buf.slice(0) }, options)).files!;
  }
  return decodeArchive(buf, options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(limit)]) : AbortSignal.timeout(limit));
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function stripZipRoot(files: Record<string, string>): Record<string, string> {
  const keys = Object.keys(files);
  if (!keys.length) return files;
  const root = keys[0].split("/")[0];
  if (!keys.every((k) => k.startsWith(`${root}/`))) return files;
  const out: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(files)) {
    const n = k.slice(root.length + 1);
    if (!n) continue;
    const first = n.split("/")[0] ?? n;
    if (first.startsWith(".") && !keepDotName(first)) continue;
    out[n] = v;
  }
  return out;
}
