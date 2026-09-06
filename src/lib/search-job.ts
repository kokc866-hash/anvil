import type { SearchHit, SearchOpts } from "./search";
export type SearchResult = { hits?: SearchHit[]; more?: boolean; patched?: Record<string, string>; total?: number };
/** Each search owns a worker so a pathological regexp is cancellable. */
export function searchJob(input: { files: Record<string, string>; needle: string; opts: SearchOpts; replacement?: string; selected?: SearchHit[] }, signal?: AbortSignal): Promise<SearchResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Abgebrochen", "AbortError")); return; }
    const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
    const finish = (error?: Error, result?: SearchResult) => {
      clearTimeout(timer); worker.terminate(); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException("Abgebrochen", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Suche dauert zu lange. Suchmuster eingrenzen.")), 5000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("Suche konnte nicht gestartet werden."));
    worker.onmessage = (event) => finish(event.data.error ? new Error(event.data.error) : undefined, event.data);
    worker.postMessage(input);
  });
}
