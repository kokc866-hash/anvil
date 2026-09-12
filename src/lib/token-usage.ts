import { estimatePrompt } from "./compact.ts";
import { estimateTokens } from "./tokens.ts";

export type ReportedUsage = { prompt?: number; completion?: number; estimated?: boolean };
export type TokenUsage = { prompt: number; completion: number; estimated: boolean };
export type RequestTokens = { prompt: number; limit: number; estimated: boolean };

export function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function chatUsage(value: unknown): ReportedUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const u = value as Record<string, unknown>;
  const prompt = tokenCount(u.prompt_tokens ?? u.input_tokens);
  const completion = tokenCount(u.completion_tokens ?? u.output_tokens);
  return prompt === undefined && completion === undefined ? undefined : { prompt, completion };
}

export function anthropicUsage(value: unknown): ReportedUsage | undefined {
  const usage = chatUsage(value);
  if (!usage) return undefined;
  const u = value as Record<string, unknown>;
  if (usage.prompt !== undefined) {
    usage.prompt += (tokenCount(u.cache_creation_input_tokens) ?? 0) + (tokenCount(u.cache_read_input_tokens) ?? 0);
  }
  return usage;
}

type Choice = { content?: string | null; reasoning?: string; tool_calls?: unknown; usage?: ReportedUsage; requestTokens?: RequestTokens };
export function resolvedUsage(choice: Choice, messages: unknown, tools?: unknown): TokenUsage {
  const prompt = tokenCount(choice.usage?.prompt);
  const completion = tokenCount(choice.usage?.completion);
  return {
    prompt: prompt ?? choice.requestTokens?.prompt ?? estimatePrompt(messages, tools),
    completion: completion ?? estimateTokens([choice.content || "", choice.reasoning || "", choice.tool_calls ? JSON.stringify(choice.tool_calls) : ""].join("")),
    estimated: Boolean(choice.usage?.estimated) || prompt === undefined || completion === undefined,
  };
}

/** Attach accounting metadata to the reply, never to the outgoing API payload. */
export function withRequestTokens<T extends Choice>(choice: T, payload: Record<string, unknown>, limit: number): T {
  const prompt = tokenCount(choice.usage?.prompt);
  choice.requestTokens = { prompt: prompt ?? estimatePrompt(payload.messages, payload.tools), limit, estimated: prompt === undefined || Boolean(choice.usage?.estimated) };
  choice.usage = resolvedUsage(choice, payload.messages, payload.tools);
  return choice;
}
