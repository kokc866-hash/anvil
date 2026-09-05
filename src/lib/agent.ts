import { createServerFn } from "@tanstack/react-start";
import { sameOriginMiddleware } from "@/lib/auth/middleware";
import {
  AGENT_TOOLS,
  runAgentLoop,
  stampToolCalls,
  type AgentFile,
  type AgentMessage,
  type AgentResult,
  type LlmChoice,
} from "./agent-core";
import { shrinkTools, stripPayload } from "./tool-fallback";
import { applyLlmOptions } from "./llm-options";
import { readWebPage } from "./web-fetch";
import { foldChatMessages } from "./chat-roles";
import { isContextError, prepChatPayload } from "./compact";

export type { AgentFile, AgentMessage, AgentResult };

async function grokChat(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<LlmChoice> {
  let payload = applyLlmOptions(
    { ...body },
    {
      provider: "xai",
      model: String(body.model || "grok-4.5"),
      api: "openai",
      context: 131072,
      thinking: "auto",
    },
    { tools: Array.isArray(body.tools) },
  );
  if (Array.isArray(payload.messages)) {
    payload.messages = stampToolCalls(foldChatMessages(payload.messages as Record<string, unknown>[]));
  }
  prepChatPayload(payload, 131072);
  const send = (p: Record<string, unknown>) =>
    fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(p),
    });
  let res = await send(payload);
  let raw = await res.text();
  if (!res.ok && res.status === 400 && Array.isArray(payload.tools)) {
    const next = shrinkTools(payload.tools as typeof AGENT_TOOLS);
    if (next && next !== payload.tools) {
      payload = { ...payload, tools: next };
      res = await send(payload);
      raw = await res.text();
    }
  }
  if (!res.ok && res.status === 400) {
    stripPayload(payload, raw);
    res = await send(payload);
    raw = await res.text();
  }
  if (!res.ok && isContextError(raw)) {
    prepChatPayload(payload, 65536);
    if (payload.max_tokens != null) payload.max_tokens = Math.max(256, Math.floor(Number(payload.max_tokens) * 0.5));
    if (payload.max_completion_tokens != null)
      payload.max_completion_tokens = Math.max(256, Math.floor(Number(payload.max_completion_tokens) * 0.5));
    res = await send(payload);
    raw = await res.text();
  }
  if (!res.ok) throw new Error(`xAI-Fehler ${res.status}: ${raw.slice(0, 300)}`);
  let json: { choices?: { message?: LlmChoice }[] };
  try {
    json = JSON.parse(raw) as { choices?: { message?: LlmChoice }[] };
  } catch {
    throw new Error(raw.slice(0, 280) || "Leere xAI-Antwort.");
  }
  const choice = json.choices?.[0]?.message;
  if (!choice) throw new Error("Leere Antwort vom Modell.");
  return choice;
}

export const grokRound = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator(
    (input: {
      messages: Record<string, unknown>[];
      useTools?: boolean;
    }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: boolean; choice?: LlmChoice; error?: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "AI is not available" };
    try {
      const choice = await grokChat(apiKey, {
        model: "grok-4.5",
        temperature: 0.3,
        max_tokens: 1800,
        tools: data.useTools ? AGENT_TOOLS : undefined,
        tool_choice: data.useTools ? "auto" : undefined,
        messages: data.messages,
      });
      return { ok: true, choice };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const chatWithAgent = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator((input: { messages: AgentMessage[]; files: AgentFile[] }) => input)
  .handler(async ({ data }): Promise<AgentResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        reply:
          "Dieses Modell ist hier nicht erreichbar. Unter Einstellungen ein anderes wählen (Ollama, OpenAI, …).",
        error: "AI is not available",
      };
    }
    try {
      return await runAgentLoop(
        data,
        async (messages, useTools, onDelta) => {
          const choice = await grokChat(apiKey, {
            model: "grok-4.5",
            temperature: 0.3,
            max_tokens: 1800,
            tools: useTools ? AGENT_TOOLS : undefined,
            tool_choice: useTools === "required" ? "required" : useTools ? "auto" : undefined,
            messages,
          });
          if (choice.content && onDelta && !choice.tool_calls?.length) onDelta(choice.content);
          return choice;
        },
        {
          fetchUrl: async (url) => {
            const r = await readWebPage(url);
            if (!r.ok) throw new Error(r.text);
            return r.text;
          },
        },
      );
    } catch (err) {
      return {
        ok: false,
        reply: err instanceof Error ? err.message : String(err),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

export const completePrompt = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator((input: { prompt: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; text: string; error?: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, text: "", error: "AI is not available" };
    try {
      const choice = await grokChat(apiKey, {
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 1200,
        messages: [{ role: "user", content: data.prompt.slice(0, 12000) }],
      });
      return { ok: true, text: choice.content?.trim() || "" };
    } catch (err) {
      return {
        ok: false,
        text: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
