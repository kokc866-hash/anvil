import { createServerFn } from "@tanstack/react-start";
import { sameOriginMiddleware } from "@/lib/auth/middleware";
import { AGENT_TOOLS, CORE_TOOLS, asToolCall, stampToolCalls, type LlmChoice, type ToolCall } from "./agent-core";
import { isContextError, prepChatPayload } from "./compact";
import { applyLlmOptions, patchResponses400, responsesBody, toResponsesTools, usesResponsesApi, type ThinkingMode } from "./llm-options";
import { parseResponses, parseResponsesSse } from "./responses-parse";
import { shrinkTools, stripPayload } from "./tool-fallback";
import { applyCapToPayload, classifyLlmError, sendTools, type ModelCap } from "./model-caps";
import { isPrivateHost } from "./net-guard";
import { providerOf } from "./providers";
import { anthropicHeaders } from "./llm-headers";
import { fetchModels, normalizeBaseUrl } from "./connection";

const CLOUD_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.together.xyz",
  "api.together.ai",
  "api.fireworks.ai",
  "api.mistral.ai",
  "api.deepseek.com",
  "openrouter.ai",
  "api.x.ai",
  "api.perplexity.ai",
  "api.cohere.ai",
  "api.cohere.com",
  "router.huggingface.co",
  "api.cerebras.ai",
  "integrate.api.nvidia.com",
]);

function assertUrl(raw: string, providerId: string): URL {
  const spec = providerOf(providerId);
  const fallback = spec.baseUrl;
  const value = (raw.trim() || fallback).replace(/\/+$/, "");
  if (!value) throw new Error("Keine API-URL.");
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("Ungültige API-URL.");
  if (isPrivateHost(url.hostname)) throw new Error("Lokale URLs laufen im Browser, nicht über den Server.");
  const allowed =
    CLOUD_HOSTS.has(url.hostname) ||
    url.hostname.endsWith(".openai.azure.com") ||
    url.hostname.endsWith(".googleapis.com");
  if (!allowed) throw new Error(`Host nicht erlaubt: ${url.hostname}. Lokal im Browser (Ollama), nicht über den Server.`);
  return url;
}

function looksHtml(body: string) {
  return /^\s*</.test(body) || /<html/i.test(body);
}

function withUa(headers: Record<string, string>, ua = "Anvil/1.1"): Record<string, string> {
  return { Accept: "application/json", "User-Agent": ua, ...headers };
}

function httpFail(status: number, body: string, kind = ""): never {
  const t = String(body || "");
  const html = looksHtml(t);
  if ((status === 401 || status === 403) && kind === "anthropic") {
    throw new Error("Anthropic hat den API-Key abgelehnt. Für Claude Code die Abo-Verbindung wählen.");
  }
  if ((status === 401 || status === 403) && kind === "huggingface") {
    throw new Error("Hugging Face hat abgelehnt. Token braucht Inference-Berechtigung.");
  }
  if ((status === 401 || status === 403) && kind === "google") {
    throw new Error("Gemini hat abgelehnt. API-Key von aistudio.google.com — das Gemini-CLI-Abo geht in Anvil nicht.");
  }
  if (html) throw new Error(`HTTP ${status}: HTML statt JSON. Falsche URL oder abgelehnt.`);
  throw new Error(`HTTP ${status}: ${t.slice(0, 280)}`);
}

type ChatInput = {
  action: "chat" | "models" | "complete";
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  messages?: Record<string, unknown>[];
  useTools?: boolean;
  prompt?: string;
  context?: number;
  thinking?: ThinkingMode;
  temperature?: number;
  maxOut?: number;
  caps?: ModelCap;
};

export const proxyLlm = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator((input: ChatInput) => input)
  .handler(async ({ data }) => {
    const spec = providerOf(data.provider);
    const key = data.apiKey.trim();
    if (spec.id === "codex" || spec.id === "github") return { ok: false as const, error: "Dieses Abo läuft ausschließlich über die Desktop-CLI." };
    if (spec.needsKey && !key) return { ok: false as const, error: `API-Key für ${spec.label} fehlt.` };
    try {
      if (data.action === "models") {
        const ids = await listModels(spec.id, data.baseUrl, key);
        return { ok: true as const, models: ids };
      }
      const messages =
        data.action === "complete"
          ? [{ role: "user", content: (data.prompt ?? "").slice(0, 12000) }]
          : (data.messages ?? []);
      const rt = {
        provider: spec.id,
        model: data.model,
        api: spec.api,
        context: data.context ?? 32768,
        thinking: data.thinking ?? "auto",
        temperature: data.temperature,
        maxOut: data.maxOut,
      };
      const cap = data.caps;
      let useTools = Boolean(data.useTools);
      if (cap) {
        useTools = sendTools(cap, useTools);
        if (useTools && cap.noThinkWithTools) rt.thinking = "off";
      }
      const choice =
        spec.api === "anthropic"
          ? await anthropicChat(data.baseUrl, data.model, key, messages, useTools, rt, cap)
          : spec.api === "azure"
            ? await azureChat(data.baseUrl, data.model, key, messages, useTools, rt, cap)
            : await openaiChat(spec.id, data.baseUrl, data.model, key, messages, useTools, rt, cap);
      return { ok: true as const, choice };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

function parseOpenAiChoice(json: {
  choices?: { message?: LlmChoice & { reasoning_content?: string; function_call?: { name?: string; arguments?: string } } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}): LlmChoice {
  const choice = json.choices?.[0]?.message;
  if (!choice) throw new Error("Leere Antwort.");
  if (choice.reasoning_content && !choice.reasoning) choice.reasoning = choice.reasoning_content;
  if (!choice.tool_calls?.length && choice.function_call?.name) {
    choice.tool_calls = [
      asToolCall("legacy", choice.function_call.name, choice.function_call.arguments || "{}"),
    ];
  }
  if (json.usage) choice.usage = { prompt: json.usage.prompt_tokens ?? 0, completion: json.usage.completion_tokens ?? 0 };
  if (choice.tool_calls?.length) {
    const stamped = stampToolCalls([{ tool_calls: choice.tool_calls }])[0]?.tool_calls;
    if (Array.isArray(stamped)) choice.tool_calls = stamped as ToolCall[];
  }
  return choice;
}

async function postOpenAi(
  endpoint: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  useTools: boolean,
  allowResponses = true,
  ctx = 32768,
  cap?: ModelCap,
  kind = "",
): Promise<LlmChoice> {
  let tools = useTools ? AGENT_TOOLS : null;
  if (tools) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }
  if (cap) applyCapToPayload(payload, cap, Boolean(tools));
  prepChatPayload(payload, ctx);
  const hdr = withUa(headers);
  const send = () =>
    fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: hdr,
      body: JSON.stringify(payload),
    });
  let res = await send();
  if (res.ok) {
    const raw = await res.text();
    if (looksHtml(raw)) httpFail(res.status, raw, kind);
    return parseOpenAiChoice(JSON.parse(raw) as Parameters<typeof parseOpenAiChoice>[0]);
  }
  let body = await res.text();
  if (isContextError(body)) {
    prepChatPayload(payload, Math.max(2048, Math.floor(ctx * 0.7)));
    if (payload.max_tokens != null) payload.max_tokens = Math.max(256, Math.floor(Number(payload.max_tokens) * 0.5));
    if (payload.max_completion_tokens != null)
      payload.max_completion_tokens = Math.max(256, Math.floor(Number(payload.max_completion_tokens) * 0.5));
    res = await send();
    if (res.ok) return parseOpenAiChoice((await res.json()) as Parameters<typeof parseOpenAiChoice>[0]);
    body = await res.text();
  }
  if (res.status === 400) {
    const patch = classifyLlmError(400, body);
    if (patch) {
      applyCapToPayload(payload, { tools: "unknown", noThinkWithTools: false, noStreamTools: false, noRequired: false, responsesApi: false, note: "", at: 0, ...patch }, Boolean(tools) && patch.tools !== "off" && patch.tools !== "text");
      if (patch.tools === "off" || patch.tools === "text") {
        tools = null;
        delete payload.tools;
        delete payload.tool_choice;
      }
      res = await send();
      if (res.ok) return parseOpenAiChoice((await res.json()) as Parameters<typeof parseOpenAiChoice>[0]);
      body = await res.text();
    }
  }
  if (res.status === 400 && tools) {
    const next = shrinkTools(tools);
    if (next && next !== tools) {
      tools = next;
      payload.tools = next;
      res = await send();
      if (res.ok) return parseOpenAiChoice((await res.json()) as Parameters<typeof parseOpenAiChoice>[0]);
      body = await res.text();
    }
  }
  if (res.status === 400) {
    stripPayload(payload, body);
    res = await send();
    if (res.ok) return parseOpenAiChoice((await res.json()) as Parameters<typeof parseOpenAiChoice>[0]);
    body = await res.text();
  }
  if (allowResponses && res.status === 400 && tools && /reasoning_effort/i.test(body) && /function tools|tool/i.test(body)) {
    const alt = endpoint.replace(/\/chat\/completions.*$/, "/responses");
    return postResponses(alt, headers, payload, true, kind);
  }
  httpFail(res.status, body, kind);
}

async function postResponses(
  endpoint: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  useTools: boolean,
  kind = "",
): Promise<LlmChoice> {
  const body: Record<string, unknown> = responsesBody(payload, kind);
  if (useTools) {
    body.tools = toResponsesTools(AGENT_TOOLS);
    body.tool_choice = "auto";
  }
  const send = (b: Record<string, unknown>) =>
    fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: withUa({ ...headers, ...(b.stream ? { Accept: "text/event-stream" } : {}) }),
      body: JSON.stringify(b),
    });
  let res = await send(body);
  let raw = await res.text();
  for (let i = 0; i < 4 && !res.ok && res.status === 400; i++) {
    if (!patchResponses400(body, raw)) break;
    res = await send(body);
    raw = await res.text();
  }
  if (!res.ok && res.status === 400 && body.reasoning && /reasoning/i.test(raw)) {
    delete body.reasoning;
    if (payload.reasoning_effort) body.reasoning_effort = payload.reasoning_effort;
    res = await send(body);
    raw = await res.text();
  }
  if (!res.ok && res.status === 400 && useTools) {
    const next = shrinkTools(AGENT_TOOLS);
    if (next) {
      body.tools = toResponsesTools(next);
      res = await send(body);
      raw = await res.text();
    }
  }
  if (!res.ok) httpFail(res.status, raw, kind);
  try {
    return parseResponsesSse(raw);
  } catch {
    throw new Error(raw.slice(0, 280) || "Leere Responses-Antwort.");
  }
}

async function openaiChat(
  providerId: string,
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: Record<string, unknown>[],
  useTools: boolean,
  rt: { provider: string; model: string; api?: "openai" | "anthropic" | "azure"; context: number; thinking: ThinkingMode; temperature?: number; maxOut?: number },
  cap?: ModelCap,
): Promise<LlmChoice> {
  const spec = providerOf(providerId);
  const url = assertUrl(normalizeBaseUrl(baseUrl || spec.baseUrl), providerId);
  const key = apiKey;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://openrouter.ai";
    headers["X-Title"] = "Anvil";
  }
  if (providerId === "google" && /^AIza/.test(apiKey.trim())) headers["x-goog-api-key"] = apiKey.trim();
  const payload: Record<string, unknown> = applyLlmOptions({ model, temperature: 0.3, messages }, rt, { tools: useTools });
  prepChatPayload(payload, rt.context);

  const talk = (host: URL) => {
    const endpoint = `${host.toString().replace(/\/+$/, "")}/chat/completions`;
    if (usesResponsesApi(rt, useTools)) {
      const respUrl = endpoint.replace(/\/chat\/completions$/, "/responses");
      return postResponses(respUrl, headers, payload, useTools, providerId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/HTTP 404|not found/i.test(msg)) throw err;
        delete payload.reasoning_effort;
        return postOpenAi(endpoint, headers, payload, useTools, false, rt.context, cap, providerId);
      });
    }
    return postOpenAi(endpoint, headers, payload, useTools, true, rt.context, cap, providerId);
  };

  return talk(url);
}

async function azureChat(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: Record<string, unknown>[],
  useTools: boolean,
  rt: { provider: string; model: string; api?: "openai" | "anthropic" | "azure"; context: number; thinking: ThinkingMode; temperature?: number; maxOut?: number },
  cap?: ModelCap,
): Promise<LlmChoice> {
  const url = assertUrl(baseUrl, "azure");
  const endpoint = `${url.origin}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=2024-10-21`;
  const payload: Record<string, unknown> = applyLlmOptions({ temperature: 0.3, messages }, { ...rt, api: "azure" }, { tools: useTools });
  prepChatPayload(payload, rt.context);
  const headers = { "Content-Type": "application/json", "api-key": apiKey };
  if (usesResponsesApi({ ...rt, api: "azure" }, useTools)) {
    const resp = `${url.origin}/openai/v1/responses`;
    return postResponses(resp, headers, { ...payload, model }, useTools, "azure");
  }
  return postOpenAi(endpoint, headers, payload, useTools, false, rt.context, cap, "azure");
}

async function anthropicChat(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: Record<string, unknown>[],
  useTools: boolean,
  rt: { provider: string; model: string; api?: "openai" | "anthropic" | "azure"; context: number; thinking: ThinkingMode; temperature?: number; maxOut?: number },
  _cap?: ModelCap,
): Promise<LlmChoice> {
  const url = assertUrl(baseUrl || "https://api.anthropic.com", "anthropic");
  const fitted = { messages: [...messages] };
  prepChatPayload(fitted, rt.context);
  const system = (fitted.messages as Record<string, unknown>[])
    .filter((m) => m.role === "system")
    .map((m) => String(m.content ?? ""))
    .join("\n\n");
  const converted = toAnthropicMessages((fitted.messages as Record<string, unknown>[]).filter((m) => m.role !== "system"));
  const body: Record<string, unknown> = applyLlmOptions(
    {
      model,
      temperature: 0.3,
      system: system || undefined,
      messages: converted,
    },
    { ...rt, api: "anthropic" },
  );
  let tools = useTools ? AGENT_TOOLS : null;
  const mapTools = (list: typeof AGENT_TOOLS) =>
    list.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  if (tools) body.tools = mapTools(tools);
  const headers = anthropicHeaders(apiKey);
  const hdr = withUa(headers);
  const send = (h: Record<string, string>) =>
    fetch(`${url.origin}/v1/messages`, {
      method: "POST",
      redirect: "error",
      headers: h,
      body: JSON.stringify(body),
    });
  let res = await send(hdr);
  if (!res.ok) {
    let err = await res.text();
    if (res.status === 400 && tools === AGENT_TOOLS) {
      tools = CORE_TOOLS;
      body.tools = mapTools(CORE_TOOLS);
      res = await send(hdr);
      if (!res.ok) err = await res.text();
    }
    if (!res.ok && res.status === 400 && body.thinking) {
      const think = body.thinking as { type?: string; budget_tokens?: number };
      if (think.budget_tokens != null) {
        body.thinking = { type: "adaptive" };
        res = await send(hdr);
        if (!res.ok) err = await res.text();
      }
    }
    if (!res.ok && res.status === 400 && body.thinking) {
      delete body.thinking;
      res = await send(hdr);
      if (!res.ok) err = await res.text();
    }
    if (!res.ok) httpFail(res.status, err, "anthropic");
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const blocks = json.content ?? [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  const reasoning = blocks.filter((b) => b.type === "thinking").map((b) => b.thinking ?? b.text ?? "").join("\n");
  const tool_calls: ToolCall[] = blocks
    .filter((b) => b.type === "tool_use" && b.id && b.name)
    .map((b) => asToolCall(b.id as string, b.name as string, JSON.stringify(b.input ?? {})));
  return {
    role: "assistant",
    content: text || null,
    reasoning: reasoning || undefined,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    usage: json.usage
      ? { prompt: json.usage.input_tokens ?? 0, completion: json.usage.output_tokens ?? 0 }
      : undefined,
  };
}

export function toAnthropicMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    const role = String(m.role ?? "");
    if (role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: String(m.tool_call_id ?? ""),
        content: String(m.content ?? ""),
      };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (role === "assistant" && Array.isArray(m.tool_calls) && (m.tool_calls as ToolCall[]).length) {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: String(m.content) });
      for (const tc of m.tool_calls as ToolCall[]) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || "{}");
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    if (role === "user" || role === "assistant") {
      out.push({ role, content: String(m.content ?? "") });
    }
  }
  return out;
}

async function listModels(providerId: string, baseUrl: string, apiKey: string): Promise<string[]> {
  const spec = providerOf(providerId);
  assertUrl(baseUrl || spec.baseUrl, providerId);
  const result = await fetchModels({ provider: providerId, baseUrl, apiKey }, (url, init) => fetch(url, { ...init, redirect: "error" }));
  return result.ids;
}
