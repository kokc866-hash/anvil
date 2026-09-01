import { createServerFn } from "@tanstack/react-start";
import { sameOriginMiddleware } from "@/lib/auth/middleware";
import { AGENT_TOOLS, CORE_TOOLS, asToolCall, stampToolCalls, type LlmChoice, type ToolCall } from "./agent-core";
import { isContextError, prepChatPayload } from "./compact";
import { applyLlmOptions, usesResponsesApi, type ThinkingMode } from "./llm-options";
import { shrinkTools, stripPayload } from "./tool-fallback";
import { applyCapToPayload, classifyLlmError, sendTools, type ModelCap } from "./model-caps";
import { isPrivateHost } from "./net-guard";
import { providerOf, resolveCodexModel } from "./providers";
import { isClaudeOauth, isGeminiOauth, jwtAccountId, refreshClaudeToken, refreshCodexToken } from "./sub-auth";

const CLOUD_HOSTS = new Set([
  "api.openai.com",
  "chatgpt.com",
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
  "models.inference.ai.azure.com",
  "models.github.ai",
  "api.githubcopilot.com",
  "api.individual.githubcopilot.com",
]);

function assertUrl(raw: string, providerId: string): URL {
  const spec = providerOf(providerId);
  const fallback = spec.baseUrl;
  const value = (raw.trim() || fallback).replace(/\/+$/, "");
  if (!value) throw new Error("Keine API-URL.");
  const url = new URL(value.includes("://") ? value : `https://${value}`);
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
  if (kind === "codex" && /not supported when using Codex with a ChatGPT account/i.test(t)) {
    throw new Error("Modell geht nicht mit ChatGPT-Abo. Nimm gpt-5.6-terra oder gpt-5.6-luna — nicht …-codex.");
  }
  if ((status === 401 || status === 403) && kind === "codex") {
    throw new Error(
      status === 401
        ? "ChatGPT-Abo abgelaufen. Magazin → Abo → Anmelden."
        : "ChatGPT-Abo abgelehnt (403). Nochmal anmelden — nicht die OpenAI-API.",
    );
  }
  if ((status === 401 || status === 403) && kind === "github") {
    throw new Error("Copilot hat abgelehnt. Terminal: gh auth login, dann Magazin Abo → Copilot → Laden.");
  }
  if ((status === 401 || status === 403) && kind === "anthropic") {
    throw new Error("Anthropic hat abgelehnt. API-Key oder Abo neu laden (claude /login).");
  }
  if ((status === 401 || status === 403) && kind === "huggingface") {
    throw new Error("Hugging Face hat abgelehnt. Token braucht Inference, oder huggingface-cli login.");
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
  accountId?: string;
  refresh?: string;
};

export const proxyLlm = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator((input: ChatInput) => input)
  .handler(async ({ data }) => {
    const spec = providerOf(data.provider);
    const key = data.apiKey.trim();
    if (!key) {
      if (spec.needsSub) {
        return { ok: false as const, error: `Abo fehlt für ${spec.label}. Magazin → Abo → Laden. Kein API-Key.` };
      }
      if (spec.needsKey) {
        return { ok: false as const, error: `API-Key für ${spec.label} fehlt.` };
      }
    }
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
          ? await anthropicChat(data.baseUrl, data.model, key, messages, useTools, rt, cap, data.refresh)
          : spec.api === "azure"
            ? await azureChat(data.baseUrl, data.model, key, messages, useTools, rt, cap)
            : await openaiChat(spec.id, data.baseUrl, data.model, key, messages, useTools, rt, cap, data.accountId, data.refresh);
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
      headers: hdr,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000),
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
  httpFail(res.status, body, kind || (/chatgpt\.com/.test(endpoint) ? "codex" : ""));
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "text" in (c as object)) return String((c as { text?: string }).text ?? "");
        return "";
      })
      .join("\n");
  }
  return content == null ? "" : String(content);
}

function toResponsesInput(messages: Record<string, unknown>[]): { instructions: string; input: unknown[] } {
  const inst: string[] = [];
  const input: unknown[] = [];
  for (const m of messages) {
    const role = String(m.role ?? "");
    if (role === "system") {
      inst.push(textOf(m.content));
      continue;
    }
    if (role === "tool") {
      input.push({ type: "function_call_output", call_id: String(m.tool_call_id ?? ""), output: textOf(m.content) });
      continue;
    }
    if (role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as ToolCall[]) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments || "{}",
        });
      }
      const t = textOf(m.content);
      if (t) input.push({ role: "assistant", content: t });
      continue;
    }
    input.push({ role, content: textOf(m.content) });
  }
  return { instructions: inst.filter(Boolean).join("\n\n"), input };
}

function parseResponses(json: {
  output_text?: string;
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
    summary?: { text?: string }[];
    call_id?: string;
    id?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}): LlmChoice {
  let content = typeof json.output_text === "string" ? json.output_text : "";
  let reasoning = "";
  const tool_calls: ToolCall[] = [];
  for (const item of json.output ?? []) {
    const type = String(item.type ?? "");
    if (type === "message") {
      for (const p of item.content ?? []) content += p.text ?? "";
    } else if (type === "output_text") {
      content += (item as { text?: string }).text ?? "";
    } else if (type === "reasoning") {
      reasoning += (item.summary ?? []).map((s) => s.text ?? "").join("\n");
    } else if (type === "function_call" || type === "tool_call" || type === "custom_tool_call") {
      const args = item.arguments;
      tool_calls.push(
        asToolCall(String(item.call_id ?? item.id ?? "call"), String(item.name ?? ""), typeof args === "string" ? args : JSON.stringify(args ?? {})),
      );
    }
  }
  return {
    role: "assistant",
    content: content || null,
    reasoning: reasoning || undefined,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    usage: json.usage ? { prompt: json.usage.input_tokens ?? 0, completion: json.usage.output_tokens ?? 0 } : undefined,
  };
}

async function postResponses(
  endpoint: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  useTools: boolean,
  kind = "",
): Promise<LlmChoice> {
  const { instructions, input } = toResponsesInput((payload.messages as Record<string, unknown>[]) ?? []);
  const effort = payload.reasoning_effort;
  const body: Record<string, unknown> = {
    model: payload.model,
    input,
    instructions: instructions || undefined,
    max_output_tokens: payload.max_completion_tokens ?? payload.max_tokens,
  };
  if (effort) body.reasoning = { effort };
  if (useTools) {
    body.tools = AGENT_TOOLS.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters ?? { type: "object", properties: {} },
    }));
    body.tool_choice = "auto";
  }
  const hdr = withUa(headers);
  const send = (b: Record<string, unknown>) =>
    fetch(endpoint, {
      method: "POST",
      headers: hdr,
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(180000),
    });
  let res = await send(body);
  let raw = await res.text();
  if (!res.ok && res.status === 400 && body.reasoning && /reasoning/i.test(raw)) {
    delete body.reasoning;
    if (effort) body.reasoning_effort = effort;
    res = await send(body);
    raw = await res.text();
  }
  if (!res.ok && res.status === 400 && useTools) {
    const next = shrinkTools(AGENT_TOOLS);
    if (next) {
      body.tools = next.map((t) => ({
        type: "function",
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters ?? { type: "object", properties: {} },
      }));
      res = await send(body);
      raw = await res.text();
    }
  }
  if (!res.ok) httpFail(res.status, raw, kind || (/chatgpt\.com/.test(endpoint) ? "codex" : ""));
  try {
    return parseResponses(JSON.parse(raw) as Parameters<typeof parseResponses>[0]);
  } catch {
    throw new Error(raw.slice(0, 280) || "Leere Responses-Antwort.");
  }
}

async function copilotBearer(apiKey: string): Promise<string> {
  const k = apiKey.trim();
  if (/^tid=/.test(k) || /;exp=/.test(k)) return k;
  if (!/^(gho_|ghu_|ghp_)/.test(k)) return k;
  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: withUa({
      Authorization: `token ${k}`,
      "Editor-Version": "vscode/1.103.0",
      "Editor-Plugin-Version": "copilot-chat/0.30.0",
      "User-Agent": "GitHubCopilotChat/0.30.0",
    }),
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  if (!res.ok) httpFail(res.status, text, "github");
  let j: { token?: string };
  try {
    j = JSON.parse(text) as { token?: string };
  } catch {
    httpFail(res.status, text, "github");
  }
  const tok = String(j.token || "").trim();
  if (!tok) throw new Error("Copilot-Token leer. gh auth login, Copilot-Abo prüfen.");
  return tok;
}

function copilotHeaders(headers: Record<string, string>) {
  headers["Editor-Version"] = "vscode/1.103.0";
  headers["Editor-Plugin-Version"] = "copilot-chat/0.30.0";
  headers["Copilot-Integration-Id"] = "vscode-chat";
  headers["Openai-Intent"] = "conversation-panel";
  headers["User-Agent"] = "GitHubCopilotChat/0.30.0";
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
  accountId?: string,
  refresh?: string,
): Promise<LlmChoice> {
  if (providerId === "codex") {
    return codexChat(model, apiKey, messages, useTools, rt, accountId, refresh);
  }
  if (providerId === "google" && isGeminiOauth(apiKey)) {
    throw new Error("Gemini-CLI-Abo geht in Anvil nicht. API-Key von aistudio.google.com eintragen.");
  }
  const spec = providerOf(providerId);
  const url = assertUrl(baseUrl || spec.baseUrl, providerId);
  const key = providerId === "github" ? await copilotBearer(apiKey) : apiKey;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key || "none"}`,
  };
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://openrouter.ai";
    headers["X-Title"] = "Anvil";
  }
  if (providerId === "google" && /^AIza/.test(apiKey.trim())) headers["x-goog-api-key"] = apiKey.trim();
  if (providerId === "github") copilotHeaders(headers);
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

  try {
    return await talk(url);
  } catch (err) {
    if (providerId !== "github") throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (!/403|401|abgelehnt/.test(msg)) throw err;
    return talk(new URL("https://api.individual.githubcopilot.com"));
  }
}

function codexHeaders(apiKey: string, accountId?: string): Record<string, string> {
  const acc = accountId || jwtAccountId(apiKey);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/0.144.0",
    version: "0.144.0",
  };
  if (acc) headers["ChatGPT-Account-ID"] = acc;
  return headers;
}

async function codexChat(
  model: string,
  apiKey: string,
  messages: Record<string, unknown>[],
  useTools: boolean,
  rt: { provider: string; model: string; api?: "openai" | "anthropic" | "azure"; context: number; thinking: ThinkingMode; temperature?: number; maxOut?: number },
  accountId?: string,
  refresh?: string,
): Promise<LlmChoice> {
  const endpoint = "https://chatgpt.com/backend-api/codex/responses";
  const payload: Record<string, unknown> = applyLlmOptions({ model: resolveCodexModel(model), temperature: 0.3, messages }, { ...rt, provider: "codex", model: resolveCodexModel(model) }, { tools: useTools });
  prepChatPayload(payload, rt.context);
  const send = (key: string, acc?: string) => postResponses(endpoint, codexHeaders(key, acc), payload, useTools, "codex");
  try {
    return await send(apiKey, accountId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!refresh || !/401|abgelaufen|abgelehnt \(403\)/i.test(msg)) throw err;
    const next = await refreshCodexToken(refresh);
    return send(next.token, next.accountId || accountId);
  }
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
    const resp = `${url.origin}/openai/v1/responses?api-version=2025-04-01-preview`;
    try {
      return await postResponses(resp, headers, { ...payload, model }, useTools, "azure");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/HTTP 404|not found/i.test(msg)) throw err;
      delete payload.reasoning_effort;
    }
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
  refresh?: string,
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (isClaudeOauth(apiKey)) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["anthropic-beta"] = "oauth-2025-04-20,claude-code-20250219";
    headers["User-Agent"] = "claude-cli/2.0.27 (external, cli)";
  } else {
    headers["x-api-key"] = apiKey;
  }
  const hdr = withUa(headers);
  const send = (h: Record<string, string>) =>
    fetch(`${url.origin}/v1/messages`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  let res = await send(hdr);
  if (!res.ok) {
    let err = await res.text();
    if ((res.status === 401 || res.status === 403) && refresh && isClaudeOauth(apiKey)) {
      const next = await refreshClaudeToken(refresh);
      hdr.Authorization = `Bearer ${next.token}`;
      res = await send(hdr);
      if (!res.ok) err = await res.text();
    }
    if (res.status === 400 && tools === AGENT_TOOLS) {
      tools = CORE_TOOLS;
      body.tools = mapTools(CORE_TOOLS);
      res = await send(hdr);
      if (!res.ok) err = await res.text();
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

function toAnthropicMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
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
  if (spec.api === "azure") return spec.models;
  if (providerId === "codex") return spec.models;
  if (providerId === "google" && isGeminiOauth(apiKey)) return spec.models;
  try {
    const url = assertUrl(baseUrl || spec.baseUrl, providerId);
    const endpoint =
      spec.api === "anthropic"
        ? `${url.origin}/v1/models`
        : `${url.toString().replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {};
    if (spec.api === "anthropic") {
      headers["anthropic-version"] = "2023-06-01";
      if (isClaudeOauth(apiKey)) {
        headers.Authorization = `Bearer ${apiKey}`;
        headers["anthropic-beta"] = "oauth-2025-04-20";
      } else {
        headers["x-api-key"] = apiKey;
      }
    } else {
      const key = providerId === "github" ? await copilotBearer(apiKey) : apiKey;
      headers.Authorization = `Bearer ${key || "none"}`;
    }
    if (providerId === "github") copilotHeaders(headers);
    if (providerId === "google" && /^AIza/.test(apiKey.trim())) headers["x-goog-api-key"] = apiKey.trim();
    const res = await fetch(endpoint, { headers: withUa(headers), signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok) {
      if (spec.models.length) return spec.models;
      httpFail(res.status, text, providerId);
    }
    if (looksHtml(text)) {
      if (spec.models.length) return spec.models;
      httpFail(res.status, text, providerId);
    }
    const json = JSON.parse(text) as { data?: Record<string, unknown>[]; models?: Record<string, unknown>[] };
    const rows = json.data ?? json.models ?? [];
    const ids: string[] = [];
    for (const m of rows) {
      const id = String(m.id ?? m.name ?? "").replace(/^models\//, "");
      if (id) ids.push(id);
      void import("./model-context").then((c) => c.ingestModelRow(m));
    }
    return ids.length ? ids : spec.models;
  } catch (err) {
    if (spec.models.length) return spec.models;
    throw err;
  }
}
