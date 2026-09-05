/** What we actually POST to Ollama / LM Studio / llama.cpp. Keep this boring. */

const OLLAMA_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "tools",
  "tool_choice",
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
  if (toolsOn) {
    out.think = false;
    const opt = (out.options as Record<string, unknown>) || {};
    opt.think = false;
    out.options = opt;
    if (out.tool_choice === "required") out.tool_choice = "auto";
    delete out.enable_thinking;
    delete out.reasoning_budget;
    if (out.chat_template_kwargs && typeof out.chat_template_kwargs === "object") {
      out.chat_template_kwargs = { ...(out.chat_template_kwargs as object), enable_thinking: false };
    }
  }
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
