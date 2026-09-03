import { BRAIN_MODELS } from "./brain/models";

export const HELPER_HTTP = "http://127.0.0.1:7847";
let helperPort = 7847;

type Native = {
  helperDir: () => Promise<string>;
  helperPort: () => Promise<number>;
  helperList: () => Promise<{ id: string; bytes: number; ready: boolean }[]>;
  helperHas: (id: string) => Promise<boolean>;
  helperDelete: (id: string) => Promise<boolean>;
  helperDownload: (job: { id: string; files: { url: string; rel: string; lib?: boolean }[] }) => Promise<{ ok: boolean }>;
  helperJson?: (url: string) => Promise<string>;
  onHelperProgress: (fn: (p: { id: string; rel: string; done: number; total: number }) => void) => () => void;
  openChild?: (path: string, opts?: { w?: number; h?: number; title?: string }) => Promise<number>;
  focusChild?: (path: string) => Promise<boolean>;
  closeChild?: (path: string) => Promise<boolean>;
  childAlive?: (path: string) => Promise<boolean>;
  pathsGet?: () => Promise<{ data: string; helper: string; logs: string; packages?: string }>;
  pathsPick?: (kind: "data" | "helper" | "logs" | "packages") => Promise<{ data: string; helper: string; logs: string; packages?: string }>;
  pathsWrite?: (name: string, text: string) => Promise<string>;
  pathsRead?: (name: string) => Promise<string | null>;
  workspacePick?: () => Promise<string | null>;
  clipboardRead?: () => Promise<{ text: string; image: string }>;
  companionEnsure?: () => Promise<{ ok: boolean; token?: string; owned?: boolean }>;
  companionRelease?: (keep?: boolean) => Promise<{ ok: boolean; running?: boolean }>;
  llmPipe?: () => Promise<{ port: number; token: string }>;
  companionToken?: () => Promise<string>;
};

export function nativeHelper(): Native | null {
  if (typeof window === "undefined") return null;
  const n = (window as unknown as { anvilNative?: Native }).anvilNative;
  if (n?.helperPort) {
    void n.helperPort().then((p) => {
      if (Number(p) > 0) helperPort = Number(p);
    });
  }
  return n ?? null;
}

function helperBase() {
  return `http://127.0.0.1:${helperPort}`;
}

function hfFile(repoUrl: string, file: string): string {
  return `${repoUrl.replace(/\/+$/, "")}/resolve/main/${file}`;
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

export async function helperFileList(id: string): Promise<{ url: string; rel: string; lib?: boolean }[]> {
  const llm = await import("@mlc-ai/web-llm");
  const rec = llm.prebuiltAppConfig.model_list.find((m: { model_id: string }) => m.model_id === id);
  if (!rec) throw new Error(`Unbekanntes Modell: ${id}`);
  const base = String(rec.model).replace(/\/+$/, "");
  const files: { url: string; rel: string; lib?: boolean }[] = [
    { url: hfFile(base, "ndarray-cache.json"), rel: "ndarray-cache.json" },
    { url: hfFile(base, "mlc-chat-config.json"), rel: "mlc-chat-config.json" },
  ];
  const cfg = (await readJson(hfFile(base, "mlc-chat-config.json"))) as { tokenizer_files?: string[] };
  for (const t of cfg.tokenizer_files ?? ["tokenizer.json"]) {
    files.push({ url: hfFile(base, t), rel: t });
  }
  const cache = (await readJson(hfFile(base, "ndarray-cache.json"))) as { records?: { dataPath: string }[] };
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

export async function downloadHelperLocal(
  id: string,
  onProgress?: (p: { done: number; total: number; rel: string }) => void,
): Promise<void> {
  const native = nativeHelper();
  if (!native) throw new Error("Lokale Bibliothek nur im Anvil-Fenster (start.bat), nicht im Browser.");
  const files = await helperFileList(id);
  const off = native.onHelperProgress((p) => {
    if (p.id === id) onProgress?.({ done: p.done, total: p.total, rel: p.rel });
  });
  try {
    await native.helperDownload({ id, files });
  } finally {
    off();
  }
}

export async function helperLocalReady(id: string): Promise<boolean> {
  return Boolean(await helperLocalId(id));
}

export async function helperLocalId(id: string): Promise<string | null> {
  const native = nativeHelper();
  if (!native) return null;
  try {
    if (await native.helperHas(id)) return id;
  } catch {
    /* */
  }
  return null;
}

export function helperLocalUrls(id: string, modelLibUrl: string): { model: string; model_lib: string } {
  const wasm = modelLibUrl.split("/").pop() || "model.wasm";
  const q = /^https:\/\//i.test(modelLibUrl) ? `?src=${encodeURIComponent(modelLibUrl)}` : "";
  return {
    model: `${helperBase()}/${id}`,
    model_lib: `${helperBase()}/libs/${wasm}${q}`,
  };
}

export function helperSizeHint(id: string): string {
  return BRAIN_MODELS.find((m) => m.id === id || m.alt === id)?.size ?? "";
}
