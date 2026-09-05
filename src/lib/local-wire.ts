/** What we actually POST to Ollama / LM Studio / llama.cpp. Keep this boring. */

const OLLAMA_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "tools",
  "think",
  "keep_alive",
  "options",
  "temperature",
]);

const LOCAL_KEYS = new Set([
  ...OLLAMA_KEYS,
  "max_tokens",
  "enable_thinking",
  "chat_template_kwargs",
  "reasoning_budget",
]);

const OPT_KEYS = new Set(["num_ctx", "n_ctx", "num_predict", "temperature", "think", "keep_alive"]);

export function ollamaRoot(baseUrl: string): string {
  return String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "")
    .replace(/\/openai$/i, "");
}

export function usesOllamaNative(provider: string, baseUrl = ""): boolean {
  const p = String(provider || "").toLowerCase();
  if (p === "ollama") return true;
  const u = String(baseUrl || "");
  return /:11434\b/.test(u) || /\/api\/(chat|tags|generate)\b/i.test(u);
}

export function localChatUrl(provider: string, baseUrl: string): string {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (usesOllamaNative(provider, baseUrl)) return `${ollamaRoot(base)}/api/chat`;
  return `${base}/chat/completions`;
}

export function sanitizeLocalPayload(
  provider: string,
  payload: Record<string, unknown>,
  toolsOn: boolean,
): Record<string, unknown> {
  const ollama = usesOllamaNative(provider, "");
  const allow = ollama ? OLLAMA_KEYS : LOCAL_KEYS;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (allow.has(k) && v !== undefined) out[k] = v;
  }
  if (out.options && typeof out.options === "object") {
    const src = out.options as Record<string, unknown>;
    const opt: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (OPT_KEYS.has(k) && v !== undefined) opt[k] = v;
    }
    out.options = opt;
  }
  // Think stays what the user set. Do not force it off when tools are on.
  if (toolsOn && out.tool_choice === "required") out.tool_choice = "auto";
  if (!Array.isArray(out.messages) || !(out.messages as unknown[]).length) {
    out.messages = [{ role: "user", content: " " }];
  }
  return out;
}

export function localWireNote(url: string, payload: Record<string, unknown>): string {
  const msgs = Array.isArray(payload.messages) ? payload.messages.length : 0;
  const tools = Array.isArray(payload.tools) ? payload.tools.length : 0;
  const opt = (payload.options as { num_ctx?: number }) || {};
  const raw = JSON.stringify(payload);
  return `POST ${url} model=${payload.model || "-"} stream=${payload.stream ? 1 : 0} think=${String(payload.think)} tools=${tools} ctx=${opt.num_ctx ?? "-"} msgs=${msgs} bytes=${raw.length}`;
}

/** Pack-UI greift nach dieser Marke — sonst ist der Wire nicht im Bundle. */
export const LOCAL_WIRE_MARK = "anvil-local-wire-v18";

export function rewriteOllamaChat(url: string, init: RequestInit): { url: string; init: RequestInit } {
  try {
    const parsed = new URL(url.includes("://") ? url : `http://${url}`);
    const ollama = parsed.port === "11434" || /:11434\b/.test(url);
    if (!ollama) return { url, init };
  } catch {
    return { url, init };
  }
  if (typeof init.body !== "string") return { url, init };
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const toolsOn = Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;
    const clean = sanitizeLocalPayload("ollama", body, toolsOn);
    return { url, init: { ...init, body: JSON.stringify(clean) } };
  } catch {
    return { url, init };
  }
}

export function ndjsonLineToSse(line: string): string {
  const raw = line.trim();
  if (!raw) return "";
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return "";
  }
  if (j.error) return `data: ${JSON.stringify({ error: j.error })}\n\n`;
  if (j.done === true) return "data: [DONE]\n\n";
  const msg = (j.message && typeof j.message === "object" ? j.message : {}) as {
    content?: string;
    thinking?: string;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown }; index?: number }[];
  };
  const delta: Record<string, unknown> = {};
  if (msg.content) delta.content = msg.content;
  if (msg.thinking) delta.reasoning = msg.thinking;
  if (msg.tool_calls?.length) {
    delta.tool_calls = msg.tool_calls.map((tc, i) => ({
      index: typeof tc.index === "number" ? tc.index : i,
      id: tc.id,
      function: {
        name: tc.function?.name,
        arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
      },
    }));
  }
  if (!Object.keys(delta).length) return "";
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

export function wrapOllamaResponse(url: string, res: Response): Response {
  if (!/\/api\/chat(?:\?|$)/i.test(url)) return res;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) return res;
  if (!res.body) return res;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { value, done } = await reader.read();
      if (done) {
        const tail = ndjsonLineToSse(buf);
        if (tail) ctrl.enqueue(enc.encode(tail));
        ctrl.close();
        return;
      }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      let out = "";
      for (const line of lines) out += ndjsonLineToSse(line);
      if (out) ctrl.enqueue(enc.encode(out));
    },
    cancel() {
      return reader.cancel();
    },
  });
  const headers = new Headers(res.headers);
  headers.set("content-type", "text/event-stream");
  return new Response(stream, { status: res.status, statusText: res.statusText, headers });
}
