import { BRAIN_MODELS } from "./brain/models";

export const HELPER_HTTP = "http://127.0.0.1:7847";
let helperPort = 7847;
let helperToken = "";

type Native = {
  helperDir: () => Promise<string>;
  helperPort: () => Promise<number>;
  helperAuth?: () => Promise<{ port: number; token: string }>;
  helperList: () => Promise<{ id: string; bytes: number; ready: boolean; revision?: string }[]>;
  helperHas: (id: string, wasmName?: string) => Promise<boolean>;
  helperDelete: (id: string) => Promise<boolean>;
  helperCancel?: (id: string) => Promise<boolean>;
  helperDownload: (job: { id: string; update?: boolean; files: { url: string; rel: string; lib?: boolean }[] }) => Promise<{ ok: boolean }>;
  helperJson?: (url: string) => Promise<string>;
  onHelperProgress: (fn: (p: { id: string; rel: string; done: number; total: number }) => void) => () => void;
  openChild?: (path: string, opts?: { w?: number; h?: number; title?: string }) => Promise<number>;
  focusChild?: (path: string) => Promise<boolean>;
  closeChild?: (path: string) => Promise<boolean>;
  childAlive?: (path: string) => Promise<boolean>;
  fitRunWindow?: (size: { width: number; height: number }) => Promise<boolean>;
  canvasCapture?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string>;
  pathsGet?: () => Promise<{ data: string; helper: string; logs: string; packages?: string }>;
  pathsPick?: (kind: "data" | "helper" | "logs" | "packages") => Promise<{ data: string; helper: string; logs: string; packages?: string }>;
  pathsWrite?: (name: string, text: string) => Promise<string>;
  pathsRead?: (name: string) => Promise<string | null>;
  workspacePick?: () => Promise<string | null>;
  clipboardRead?: () => Promise<{ text: string; image: string }>;
  companionEnsure?: () => Promise<{ ok: boolean; token?: string; owned?: boolean }>;
  companionIdle?: (keep?: boolean) => Promise<{ ok: boolean; running?: boolean }>;
  companionRelease?: (keep?: boolean) => Promise<{ ok: boolean; running?: boolean }>;
  hwMachine?: () => Promise<{ cores: number; ramGb: number; freeGb: number; vendor?: string; gpu?: string; arch?: string }>;
  llmPipe?: () => Promise<{ port: number; token: string }>;
  companionToken?: () => Promise<string>;
  updateCheck?: () => Promise<{
    ok: boolean;
    newer?: boolean;
    latest?: string;
    current?: string;
    name?: string;
    notes?: string;
    htmlUrl?: string;
    zipUrl?: string;
    setupUrl?: string;
    error?: string;
  }>;
  updateZip?: () => Promise<{ ok: boolean; canceled?: boolean; dir?: string; latest?: string; error?: string }>;
  updateSetup?: () => Promise<{ ok: boolean; path?: string; latest?: string; error?: string }>;
  updateOpen?: (url: string) => Promise<boolean>;
};

export function nativeHelper(): Native | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { anvilNative?: Native }).anvilNative ?? null;
}

let authOwner: Native | null = null;
let authPromise: Promise<{ port: number; token: string }> | null = null;
export function syncHelperAuth(): Promise<{ port: number; token: string }> {
  const n = nativeHelper();
  if (authOwner === n && authPromise) return authPromise;
  authOwner = n;
  authPromise = (async () => {
    if (n?.helperAuth) {
      const a = await n.helperAuth();
      if (Number(a?.port) > 0) helperPort = Number(a.port);
      helperToken = String(a?.token || "");
    } else if (n?.helperPort) {
      const p = await n.helperPort();
      if (Number(p) > 0) helperPort = Number(p);
    }
    return { port: helperPort, token: helperToken };
  })().catch((err) => { authPromise = null; throw err; });
  return authPromise;
}

function helperBase() {
  return `http://127.0.0.1:${helperPort}`;
}

function hfFile(repoUrl: string, file: string): string {
  return `${repoUrl.replace(/\/+$/, "").replace(/\/resolve\/[^/]+$/, "")}/resolve/main/${file}`;
}

async function readJson(url: string): Promise<unknown> {
  const native = nativeHelper();
  if (native?.helperJson) {
    try {
      const text = await native.helperJson(url);
      return JSON.parse(text);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "");
      throw new Error(msg);
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) throw new Error("leere Antwort");
  return JSON.parse(text);
}

export async function helperFileList(id: string, signal?: AbortSignal): Promise<{ url: string; rel: string; lib?: boolean }[]> {
  signal?.throwIfAborted();
  const llm = await import("@mlc-ai/web-llm");
  signal?.throwIfAborted();
  const rec = llm.prebuiltAppConfig.model_list.find((m: { model_id: string }) => m.model_id === id);
  if (!rec) throw new Error(`Unbekanntes Modell: ${id}`);
  const base = String(rec.model).replace(/\/+$/, "");
  let manifestUrl = hfFile(base, "tensor-cache.json");
  let cache: { records?: { dataPath: string }[] };
  try { cache = await readJson(manifestUrl) as typeof cache; }
  catch { signal?.throwIfAborted(); manifestUrl = hfFile(base, "ndarray-cache.json"); cache = await readJson(manifestUrl) as typeof cache; }
  signal?.throwIfAborted();
  const files: { url: string; rel: string; lib?: boolean }[] = [
    { url: manifestUrl, rel: "tensor-cache.json" },
    { url: hfFile(base, "mlc-chat-config.json"), rel: "mlc-chat-config.json" },
  ];
  const cfg = (await readJson(hfFile(base, "mlc-chat-config.json"))) as { tokenizer_files?: string[] };
  signal?.throwIfAborted();
  for (const t of cfg.tokenizer_files?.length ? cfg.tokenizer_files : ["tokenizer.json"]) {
    files.push({ url: hfFile(base, t), rel: t });
  }
  for (const r of cache.records ?? []) {
    files.push({ url: hfFile(base, r.dataPath), rel: r.dataPath });
  }
  const lib = String(rec.model_lib || "");
  if (lib) {
    const name = lib.split("/").pop() || "model.wasm";
    files.push({ url: lib, rel: name, lib: true });
  }
  const seen = new Set<string>();
  return files.filter((f) => {
    const k = `${f.lib ? "lib:" : ""}${f.rel}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type LocalProgress = { done: number; total: number; rel: string };
const downloading = new Map<string, { promise: Promise<void>; ctrl: AbortController; consumers: number; listeners: Set<(p: LocalProgress) => void> }>();
const fileGenerations = new Map<string, number>();
/** Includes work before native IPC starts, such as reading model manifests. */
export function captureHelperLocal(id: string): () => void {
  const generation = fileGenerations.get(id);
  return () => {
    if (fileGenerations.get(id) !== generation) throw new DOMException("Modellablage geändert; vorheriger Auftrag abgebrochen.", "AbortError");
  };
}
export function cancelHelperLocal(id: string): void {
  fileGenerations.set(id, (fileGenerations.get(id) || 0) + 1);
  downloading.get(id)?.ctrl.abort();
}
export async function downloadHelperLocal(
  id: string, onProgress?: (p: LocalProgress) => void, options: { update?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  const native = nativeHelper();
  if (!native) throw new Error("Lokale Bibliothek nur im Anvil-Desktopprogramm.");
  const check = captureHelperLocal(id);
  options.signal?.throwIfAborted();
  let task = downloading.get(id);
  if (task?.ctrl.signal.aborted) {
    await task.promise.catch(() => undefined);
    check();
    options.signal?.throwIfAborted();
    return downloadHelperLocal(id, onProgress, options);
  }
  if (!task) {
    const ctrl = new AbortController();
    const listeners = new Set<(p: LocalProgress) => void>();
    const off = native.onHelperProgress((p) => { if (p.id === id) listeners.forEach((fn) => fn(p)); });
    const promise = (async () => {
      const files = await helperFileList(id, ctrl.signal);
      ctrl.signal.throwIfAborted();
      const cancel = () => { void native.helperCancel?.(id).catch(() => undefined); };
      ctrl.signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await native.helperDownload({ id, files, update: options.update });
        if (!result.ok) throw new Error("Helfer-Download fehlgeschlagen");
        ctrl.signal.throwIfAborted();
        const { invalidateModelCache } = await import("./brain/engine");
        await invalidateModelCache(id);
      } finally { ctrl.signal.removeEventListener("abort", cancel); }
    })().finally(() => { off(); downloading.delete(id); });
    task = { promise, ctrl, consumers: 0, listeners };
    downloading.set(id, task);
  }
  const owned = task;
  owned.consumers++;
  if (onProgress) owned.listeners.add(onProgress);
  let abort: () => void = () => {};
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(options.signal?.reason ?? new DOMException("Abgebrochen", "AbortError"));
    options.signal?.addEventListener("abort", abort, { once: true });
  });
  try { await Promise.race([owned.promise, canceled]); }
  finally {
    options.signal?.removeEventListener("abort", abort);
    if (onProgress) owned.listeners.delete(onProgress);
    if (--owned.consumers === 0 && options.signal?.aborted) owned.ctrl.abort();
  }
}

export async function helperLocalReady(id: string): Promise<boolean> {
  return Boolean(await helperLocalId(id));
}

export async function helperLocalId(id: string, adopt = false): Promise<string | null> {
  const native = nativeHelper();
  if (!native) return null;
  const check = captureHelperLocal(id);
  try {
    const record = adopt ? (await import("@mlc-ai/web-llm")).prebuiltAppConfig.model_list.find((m) => m.model_id === id) : undefined;
    check();
    const ready = await native.helperHas(id, record?.model_lib.split("/").pop());
    check();
    if (ready) return id;
  } catch {
    // A cancelled adoption is not a cache miss: callers must not start a new
    // download after the user has removed this model.
    if (adopt) check();
  }
  return null;
}

export function helperLocalUrls(id: string, modelLibUrl: string): { model: string; model_lib: string } {
  const wasm = modelLibUrl.split("/").pop() || "model.wasm";
  const auth = helperToken ? `/t/${helperToken}` : "";
  return {
    model: `${helperBase()}${auth}/${id}`,
    model_lib: `${helperBase()}${auth}/${id}/${wasm}`,
  };
}

export function helperSizeHint(id: string): string {
  return BRAIN_MODELS.find((m) => m.id === id || m.alt === id)?.size ?? "";
}
