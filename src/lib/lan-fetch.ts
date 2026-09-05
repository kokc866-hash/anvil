import { DEFAULT_COMPANION } from "./companion";
import { loadSecrets } from "./secrets";
import { useIde } from "@/store/ide";
import { lanAlts } from "./lan-url";
import { hardStopMs } from "./abort";
import { rewriteOllamaChat, wrapOllamaResponse } from "./local-wire";

export { lanAlts };

type PipeInfo = { port: number; token: string };

function companionBase(): string {
  return (useIde.getState().companionUrl || DEFAULT_COMPANION).replace(/\/$/, "");
}

function token(): string {
  const s = loadSecrets().companionToken.trim();
  if (s) return s;
  if (typeof window === "undefined") return "";
  return String((window as unknown as { anvilCompanionToken?: string }).anvilCompanionToken || "").trim();
}

function nativeApi() {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { anvilNative?: { llmPipe?: () => Promise<PipeInfo> } }).anvilNative;
}

function hdrsOf(init: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = init.headers;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && !(raw instanceof Headers)) {
    Object.assign(out, raw);
  } else if (raw instanceof Headers) {
    raw.forEach((v, k) => {
      out[k] = v;
    });
  }
  return out;
}

function usable(r: Response | null): r is Response {
  return Boolean(r) && r!.headers.get("x-anvil-lan") !== "fail" && (r!.ok || r!.status < 500);
}

function throwIfSig(init: RequestInit, err?: unknown): void {
  if (!init.signal?.aborted) return;
  throw err instanceof Error ? err : new DOMException("Aborted", "AbortError");
}

let pipeInfo: PipeInfo | null = null;

async function pipeOf(): Promise<PipeInfo | null> {
  if (pipeInfo?.port && pipeInfo?.token) return pipeInfo;
  const fn = nativeApi()?.llmPipe;
  if (!fn) return null;
  try {
    const info = await fn();
    if (info?.port && info?.token) {
      pipeInfo = info;
      return info;
    }
  } catch {
    /* */
  }
  return pipeInfo;
}

/** Electron: Node holt Ollama. Renderer bleibt auf 127.0.0.1. */
async function viaPipe(url: string, init: RequestInit): Promise<Response | null> {
  const info = await pipeOf();
  if (!info) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/pipe`, {
      method: init.method || "GET",
      headers: {
        "x-anvil-target": url,
        "x-anvil-pipe": info.token,
        ...hdrsOf(init),
      },
      body: typeof init.body === "string" ? init.body : undefined,
      signal: init.signal,
    });
    if (r.status === 401) {
      pipeInfo = null;
      return null;
    }
    if (r.headers.get("x-anvil-lan") !== "1") return null;
    return r;
  } catch (err) {
    throwIfSig(init, err);
    return null;
  }
}

async function viaVite(url: string, init: RequestInit): Promise<Response | null> {
  if (typeof window === "undefined") return null;
  try {
    const r = await fetch("/__lan", {
      method: init.method || "GET",
      headers: { "x-anvil-target": url, ...hdrsOf(init) },
      body: typeof init.body === "string" ? init.body : undefined,
      signal: init.signal,
    });
    if (r.headers.get("x-anvil-lan") !== "1") return null;
    return r;
  } catch (err) {
    throwIfSig(init, err);
    return null;
  }
}

async function viaCompanion(url: string, init: RequestInit): Promise<Response | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const hard = hardStopMs(useIde.getState().llmHardStopMin);
    const r = await fetch(`${companionBase()}/v1/llm`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-anvil-token": tok },
      body: JSON.stringify({
        url,
        method: init.method || "GET",
        headers: hdrsOf(init),
        body: typeof init.body === "string" ? init.body : undefined,
        timeoutMs: hard,
      }),
      signal: init.signal,
    });
    if (r.status === 401) throw new Error("Companion-Token fehlt oder falsch. Einstellungen → Companion.");
    return r;
  } catch (err) {
    throwIfSig(init, err);
    return null;
  }
}

async function lanFetchOne(url: string, init: RequestInit = {}): Promise<Response | null> {
  const pipe = await viaPipe(url, init);
  if (usable(pipe)) return pipe;
  const vite = await viaVite(url, init);
  if (usable(vite)) return vite;
  const proxied = await viaCompanion(url, init);
  if (usable(proxied)) return proxied;
  return pipe || vite || proxied;
}

export async function lanFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const rw = rewriteOllamaChat(url, init);
  url = rw.url;
  init = rw.init;
  const alts = lanAlts(url);
  let last: Response | null = null;
  const errs: string[] = [];
  for (const u of alts) {
    try {
      const r = await lanFetchOne(u, init);
      if (r && usable(r)) {
        if (u !== url) {
          try {
            const st = useIde.getState();
            if (/127\.168\./.test(st.llmBaseUrl) && /192\.168\./.test(u)) {
              st.setLlmBaseUrl(st.llmBaseUrl.replace("127.168.", "192.168."));
            }
          } catch {
            /* */
          }
        }
        return wrapOllamaResponse(u, r);
      }
      if (r) last = r;
    } catch (e) {
      if (init.signal?.aborted) throw e instanceof Error ? e : new DOMException("Aborted", "AbortError");
      errs.push(`${u}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (last) return wrapOllamaResponse(url, last);
  throw new Error(errs.join(" · ") || "Keine Verbindung zum Modell.");
}
