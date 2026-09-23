import { applyLlmOptions, type ThinkingMode } from "../lib/llm-options";
import { localChatUrl, sanitizeLocalPayload, wrapOllamaResponse } from "../lib/local-wire";
import { prepChatPayload, fitMessages, isContextError, isVramError, shrinkLocalCtx } from "../lib/compact";
import { chatUsage, withRequestTokens, type RequestTokens } from "../lib/token-usage";
import type { LlmChoice } from "../lib/agent-core";
import { prepareTextTools, shrinkTools } from "../lib/tool-fallback";
import type { ToolSession, ToolCompatibility } from "../lib/tool-compat";
import { applyCapToPayload, classifyLlmError, type ModelCap } from "../lib/model-caps";

export type RuntimeModel = {
  provider: string; baseUrl: string; model: string; apiKey: string;
  context: number; thinking: ThinkingMode; temperature: number; maxOut: number; hardStopMin: number;
  toolMode?: ToolCompatibility;
  retries?: number;
  capabilities?: ModelCap;
  vision?: boolean;
  cliKind?: import('../lib/cli-protocol').CliKind;
};

/** No renderer, proxy server or global UI store owns this request. */
export async function completeRuntime(model: RuntimeModel, messages: Record<string, unknown>[], tools: Parameters<ToolSession['record']>[0],
  signal: AbortSignal, delta: (text: string, kind?: "text" | "think") => void, session?: ToolSession, onRequest?: (tokens: RequestTokens) => void): Promise<LlmChoice> {
  let cap: ModelCap = { tools: "unknown", noThinkWithTools: false, noStreamTools: false, noRequired: false, responsesApi: false, note: "", at: 0, ...model.capabilities };
  if (session?.text && cap.tools !== "off") cap = { ...cap, tools: "text" };
  const nativeTools = tools.length > 0 && cap.tools !== "text" && cap.tools !== "off";
  const payload = applyLlmOptions({ model: model.model, messages, stream: true,
    ...(nativeTools ? { tools, tool_choice: "auto" } : {}) }, { ...model, thinking: nativeTools && cap.noThinkWithTools ? "off" : model.thinking, api: "openai" }, { tools: nativeTools });
  if (tools.length) {
    session?.prepare(payload);
    if (cap.tools === "text") prepareTextTools(payload, tools);
  }
  applyCapToPayload(payload, cap, nativeTools);
  if (nativeTools && cap.noThinkWithTools) disableLocalThinking(payload, model.provider);
  session?.record(cap.tools === "off" ? [] : tools, cap.tools === "text");
  let context = Math.max(2048, model.context || 32768);
  const attempts = Number.isFinite(model.retries) ? Math.min(8, Math.max(1, Math.floor(model.retries!))) : 3;
  // One deadline covers all attempts, response reads and backoff. A retry never resets it.
  const requestSignal = model.hardStopMin > 0 ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.floor(model.hardStopMin * 60000)))]) : signal;
  const url = localChatUrl(model.provider, model.baseUrl);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    requestSignal.throwIfAborted();
    prepChatPayload(payload, context);
    onRequest?.(withRequestTokens<LlmChoice>({}, payload, context).requestTokens!);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: payload.stream ? "text/event-stream, application/json" : "application/json",
          ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}) },
        body: JSON.stringify(sanitizeLocalPayload(model.provider, payload)), signal: requestSignal, redirect: "error",
      });
    } catch (error) {
      requestSignal.throwIfAborted();
      // Only failures before response headers are retryable. Never replay a partial answer.
      if (attempt >= attempts || !(error instanceof TypeError) || !/fetch failed|network|failed to fetch/i.test(error.message)) throw error;
      await backoff(attempt, requestSignal);
      continue;
    }
    if (!response.ok) {
      const body = await boundedText(response, 64 * 1024);
      const error = new Error(`Modellanfrage fehlgeschlagen (HTTP ${response.status}): ${body.slice(0, 500) || response.statusText}`);
      requestSignal.throwIfAborted();
      if (attempt >= attempts) throw error;
      if (isVramError(body) && context > 4096) {
        context = shrinkLocalCtx(context);
        // Remember the successful lower request budget within this job.
        model.context = context;
        continue;
      }
      if (isContextError(body)) {
        const opts = payload.options as Record<string, unknown> | undefined;
        for (const key of ["max_tokens", "max_completion_tokens"]) if (typeof payload[key] === "number") payload[key] = Math.max(256, Math.floor(Number(payload[key]) / 2));
        if (typeof opts?.num_predict === "number") opts.num_predict = Math.max(256, Math.floor(opts.num_predict / 2));
        payload.messages = fitMessages(payload.messages as Record<string, unknown>[], Math.max(512, Math.floor(context * Math.max(0.15, 0.45 - attempt * 0.08))));
        if (Array.isArray(payload.tools)) payload.tools = shrinkTools(payload.tools);
        continue;
      }
      if (response.status === 400 || response.status === 422) {
        const before = JSON.stringify(payload);
        const learned = classifyLlmError(response.status, body);
        if (learned) {
          cap = { ...cap, ...learned, at: Date.now() };
          if (cap.tools === "text" && tools.length) prepareTextTools(payload, tools);
          applyCapToPayload(payload, cap, tools.length > 0);
          if (cap.noThinkWithTools && tools.length) {
            delete payload.enable_thinking; delete payload.reasoning_budget; delete payload.chat_template_kwargs;
            if (cap.tools !== "off" && cap.tools !== "text") disableLocalThinking(payload, model.provider);
          }
          // Some endpoints reject tool_choice itself, including "auto".
          if (/tool_choice/i.test(body) && cap.noRequired) delete payload.tool_choice;
          session?.record(cap.tools === "off" ? [] : tools, cap.tools === "text");
          model.capabilities = cap;
        }
        if (/stream(?:ing)?.*(?:not support|unsupported|not allowed)|(?:not support|unsupported).*stream/i.test(body)) { payload.stream = false; delete payload.stream_options; }
        removeRejectedOption(payload, body);
        if (JSON.stringify(payload) !== before) continue;
      }
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) throw error;
      await backoff(attempt, requestSignal);
      continue;
    }
    // Once headers arrive the response is consumed exactly once, even if it is empty or truncated.
    const res = wrapOllamaResponse(url, response);
    const choice = res.headers.get("content-type")?.includes("application/json")
      ? await readJson(res, delta) : await readStream(res, delta);
    return withRequestTokens(choice, payload, context);
  }
  throw new Error("Modellanfrage nach allen Versuchen fehlgeschlagen.");
}

async function backoff(attempt: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250 * attempt);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Drop only an explicitly rejected optional field. Unknown 400s must remain visible.
function removeRejectedOption(payload: Record<string, unknown>, body: string) {
  if (!/unknown|unexpected|unsupported|not support|not allowed|unrecognized/i.test(body)) return;
  for (const key of ["think", "enable_thinking", "reasoning_budget", "chat_template_kwargs", "reasoning_effort", "temperature", "keep_alive", "stream_options", "n_ctx"]) {
    if (new RegExp(`\\b${key}\\b`, "i").test(body)) {
      delete payload[key];
      const options = payload.options as Record<string, unknown> | undefined;
      if (options) delete options[key];
    }
  }
}

function disableLocalThinking(payload: Record<string, unknown>, provider: string) {
  if (!["ollama", "lmstudio", "llamacpp"].includes(provider)) return;
  // Omitting think would restore the model's default (often on).
  payload.think = false;
  if (provider !== "ollama") {
    payload.enable_thinking = false;
    payload.reasoning_budget = 0;
    payload.chat_template_kwargs = { enable_thinking: false };
  }
}

async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return text + decoder.decode();
      bytes += part.value.byteLength;
      if (bytes > limit) throw new Error("Modellantwort überschreitet die Speichergrenze.");
      text += decoder.decode(part.value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

async function readJson(res: Response, delta: (text: string, kind?: "text" | "think") => void): Promise<LlmChoice> {
  const value = JSON.parse(await boundedText(res, 64 * 1024 * 1024));
  if (value.error) throw new Error("Der Modellserver meldet einen Fehler in der Antwort.");
  const item = value.choices?.[0], message = item?.message;
  if (!message || typeof message !== "object") throw new Error("Modellantwort ohne Nachricht.");
  const choice: LlmChoice = { ...message, reasoning: message.reasoning_content ?? message.reasoning, finish_reason: item.finish_reason, usage: chatUsage(value.usage) };
  if (!choice.content && !choice.tool_calls?.length) throw new Error("Modell hat keine Antwort geliefert.");
  if (choice.reasoning) delta(choice.reasoning, "think");
  if (choice.content) delta(choice.content, "text");
  return choice;
}

async function readStream(res: Response, delta: (text: string, kind?: "text" | "think") => void): Promise<LlmChoice> {
  if (!res.body) throw new Error("Modellantwort ohne Inhalt.");
  const reader = res.body.getReader(), decoder = new TextDecoder();
  const choice: LlmChoice = { content: "", reasoning: "" };
  const calls = new Map<number, { id: string; type: "function"; function: { name: string; arguments: string } }>();
  let buffer = "", done = false, bytes = 0;
  try {
    while (!done) {
      const part = await reader.read();
      buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      bytes += part.value?.byteLength || 0;
      if (bytes > 64 * 1024 * 1024 || buffer.length > 4 * 1024 * 1024) throw new Error("Modellantwort überschreitet die Speichergrenze des Testbetriebs.");
      const lines = buffer.split(/\r?\n/);
      buffer = part.done ? "" : lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const value = line.slice(5).trim();
        if (value === "[DONE]") { done = true; break; }
        if (!value) continue;
        const event = JSON.parse(value);
        if (event.error) throw new Error("Der Modellserver meldet einen Fehler im Antwortstrom.");
        if (event.usage) choice.usage = chatUsage(event.usage);
        const item = event.choices?.[0], d = item?.delta;
        if (item?.finish_reason) choice.finish_reason = item.finish_reason;
        if (!d) continue;
        if (typeof d.content === "string") { choice.content += d.content; delta(d.content, "text"); }
        const thought = d.reasoning_content ?? d.reasoning;
        if (typeof thought === "string") { choice.reasoning = ((choice.reasoning || "") + thought).slice(-1_000_000); delta(thought, "think"); }
        for (const call of d.tool_calls || []) {
          const index = Number(call.index || 0);
          if (!Number.isInteger(index) || index < 0 || index > 64) throw new Error("Ungültiger Werkzeugaufruf.");
          const current = calls.get(index) || { id: "", type: "function" as const, function: { name: "", arguments: "" } };
          if (call.id) current.id = call.id;
          if (call.function?.name) current.function.name += call.function.name;
          if (call.function?.arguments) current.function.arguments += call.function.arguments;
          if (current.function.arguments.length > 4_000_000) throw new Error("Werkzeugausgabe zu groß.");
          calls.set(index, current);
        }
      }
      if (part.done && !done) {
        if (!choice.finish_reason) throw new Error("Modellantwort unterbrochen: Abschluss fehlt.");
        done = true;
      }
    }
  } finally { await reader.cancel().catch(() => undefined); }
  if (calls.size) choice.tool_calls = [...calls.values()].map((call) => ({ ...call, id: call.id || crypto.randomUUID() }));
  if (!choice.content && !choice.tool_calls?.length) throw new Error("Modell hat keine Antwort geliefert.");
  return choice;
}
