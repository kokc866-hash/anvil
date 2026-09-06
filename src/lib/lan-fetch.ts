import { DEFAULT_COMPANION } from "./companion";
import { loadSecrets, credentialHeaders } from "./secrets";
import { useIde } from "@/store/ide";
import { hardStopMs, agentGen } from "./abort";
import { appLog } from "./app-log";
export { lanAlts } from "./lan-url";

type PipeInfo = { port: number; token: string; credentialRefs?: boolean };
function nativeApi() {
  return typeof window === "undefined" ? undefined : (window as unknown as { anvilNative?: { llmPipe?: () => Promise<PipeInfo> } }).anvilNative;
}
function companionToken(): string {
  return loadSecrets().companionToken.trim() || (typeof window === "undefined" ? "" : String((window as unknown as { anvilCompanionToken?: string }).anvilCompanionToken || "").trim());
}
export function hasLlmTransport(): boolean {
  return Boolean(nativeApi()?.llmPipe || import.meta.env.DEV || companionToken());
}

let requestNumber = 0;

/** Log actual HTTP attempts, including Responses API requests, without keys or prompts. */
export async function lanFetch(url: string, init: RequestInit = {}, customBase = ""): Promise<Response> {
  let payload: Record<string, unknown> | undefined;
  if (init.method === "POST" && typeof init.body === "string") {
    try { payload = JSON.parse(init.body); } catch { /* not a model request */ }
  }
  if (!payload?.model) return transportFetch(url, init, customBase);
  const id = `R${agentGen()} H${++requestNumber}`;
  const parsed = new URL(url);
  const started = Date.now();
  appLog("http", `${id} POST ${parsed.origin}${parsed.pathname}`);
  const options = payload.options as { num_ctx?: number } | undefined;
  const reasoning = payload.reasoning as { effort?: string } | undefined;
  appLog("http", `${id} schemas=${Array.isArray(payload.tools) ? payload.tools.length : 0} ctx=${options?.num_ctx ?? "-"} think=${String(payload.think ?? reasoning?.effort ?? payload.reasoning_effort ?? "-")} stream=${payload.stream ? 1 : 0} model=${payload.model}`);
  try {
    const response = await transportFetch(url, init, customBase);
    appLog("http", `${id} HTTP ${response.status} · Headers nach ${Date.now() - started}ms`);
    return response;
  } catch (error) {
    appLog("http", `${id} ${init.signal?.aborted ? "abgebrochen" : "Transportfehler"} nach ${Date.now() - started}ms`);
    throw error;
  }
}

/** Select one transport before sending. Never replay a POST through another proxy. */
async function transportFetch(url: string, init: RequestInit, customBase: string): Promise<Response> {
  init.signal?.throwIfAborted();
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const native = nativeApi();
  if (native?.llmPipe) {
    const info = await native.llmPipe();
    if (!info?.port || !info.token) throw new Error("Native Modellverbindung nicht bereit. Anvil neu starten.");
    const credentials = info.credentialRefs ? credentialHeaders(headers) : { headers, refs: "" };
    const response = await fetch(`http://127.0.0.1:${info.port}/pipe`, {
      ...init, headers: { ...credentials.headers, ...(credentials.refs ? { "x-anvil-credentials": credentials.refs } : {}), "x-anvil-target": url, "x-anvil-pipe": info.token, ...(customBase ? { "x-anvil-custom-base": customBase } : {}) },
    });
    if (response.headers.get("x-anvil-pipe-auth") === "invalid") throw new Error("Native Modellverbindung abgelaufen. Anvil neu starten.");
    if (response.headers.get("x-anvil-lan") !== "1") throw new Error("Native Modellverbindung antwortet nicht korrekt.");
    return response;
  }
  if (import.meta.env.DEV) {
    const response = await fetch("/__lan", { ...init, headers: { ...headers, "x-anvil-target": url, ...(customBase ? { "x-anvil-custom-base": customBase } : {}) } });
    if (response.headers.get("x-anvil-lan") !== "1") throw new Error("Anvil-Entwicklungsserver unterstützt die Modellverbindung nicht.");
    return response;
  }
  const token = companionToken();
  if (token) {
    const st = useIde.getState();
    return fetch(`${(st.companionUrl || DEFAULT_COMPANION).replace(/\/$/, "")}/v1/llm`, {
      method: "POST", headers: { "content-type": "application/json", "x-anvil-token": token },
      body: JSON.stringify({ url, customBase, method: init.method || "GET", headers, body: typeof init.body === "string" ? init.body : undefined, timeoutMs: hardStopMs(st.llmHardStopMin) }),
      signal: init.signal,
    });
  }
  // Browser-only installations need endpoints which allow the browser's origin.
  return fetch(url, init);
}
