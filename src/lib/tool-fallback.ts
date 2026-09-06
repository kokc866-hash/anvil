export const STRIP_ON_400 = [
  "think",
  "options",
  "keep_alive",
  "reasoning_effort",
  "temperature",
  "stream_options",
  "stop",
  "presence_penalty",
  "frequency_penalty",
] as const;

type ToolLike = { function: { name: string; description?: string; parameters?: unknown } };

function compactSchema(value: unknown, propertyMap = false): unknown {
  if (Array.isArray(value)) return value.map((child) => compactSchema(child));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => propertyMap || key !== "description")
    .map(([key, child]) => [key, propertyMap ? compactSchema(child) :
      ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"].includes(key) ? compactSchema(child, true) :
      ["items", "additionalProperties", "unevaluatedProperties", "contains", "not", "if", "then", "else", "allOf", "anyOf", "oneOf", "prefixItems"].includes(key) ? compactSchema(child) : child]));
}

/** Reduce schema prose, preserving every tool and its argument/enum contract. */
export function shrinkTools<T extends ToolLike>(current: T[] | null | undefined): T[] | null {
  if (!current?.length) return current ?? null;
  const next = current.map((tool) => ({ ...tool, function: { ...tool.function,
    ...(tool.function.description ? { description: tool.function.description.slice(0, 100) } : {}),
    ...(tool.function.parameters ? { parameters: compactSchema(tool.function.parameters) } : {}),
  } }));
  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}

import { patchResponses400 } from "./llm-options.ts";

export function stripPayload(payload: Record<string, unknown>, body = "") {
  if (/max_completion_tokens/i.test(body) && payload.max_tokens != null) {
    payload.max_completion_tokens = payload.max_tokens;
    delete payload.max_tokens;
  } else if (/\bmax_tokens\b/i.test(body) && payload.max_completion_tokens != null) {
    payload.max_tokens = payload.max_completion_tokens;
    delete payload.max_completion_tokens;
  }
  patchResponses400(payload, body);
  for (const k of STRIP_ON_400) delete payload[k];
  if (/tool_choice/i.test(body)) delete payload.tool_choice;
}

export function stillHasTools(useTools: boolean, tools: unknown): boolean {
  return !useTools || (Array.isArray(tools) && tools.length > 0);
}

const TEXT_TOOLS = "\nTool transport for this request (text mode):";
/** Models without native function calling still receive the actual allowed tool contracts. */
export function prepareTextTools(payload: Record<string, unknown>, tools: ToolLike[]): void {
  delete payload.tools;
  delete payload.tool_choice;
  if (!tools.length || !Array.isArray(payload.messages)) return;
  const catalog = shrinkTools(tools) || tools;
  const instruction = `${TEXT_TOOLS}\nTo call a tool, the ENTIRE answer must be one JSON object (no prose, Markdown, XML, or thinking): {"name":"tool_name","arguments":{...}}. Anvil executes it and returns the real result. This text format replaces native function calls for this request. When finished or answering a question, reply normally without a tool object. Use only the listed tools; if select_tools is listed, use it to discover/select more tools. Skip flow steps whose tools are not listed. These tools are available; do not claim they are inactive. Do not invent results.\nAllowed tools and arguments:\n${JSON.stringify(catalog.map((t) => t.function))}`;
  const messages = (payload.messages as Record<string, unknown>[]).map((m) => {
    if (m.role === "tool") return { role: "user", content: `Tool result (${m.name || m.tool_call_id || "tool"}):\n${String(m.content || "")}` };
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) return { role: "assistant", content: [m.content, ...m.tool_calls.map((c) => JSON.stringify({ name: c.function?.name, arguments: historyArgs(c.function?.arguments) }))].filter(Boolean).join("\n") };
    return { ...m };
  });
  const system = messages.find((m) => m.role === "system" && typeof m.content === "string");
  if (system) system.content = String(system.content).split(TEXT_TOOLS)[0].replace("- While working: tool call only — no essay, no plan sentence, no tool XML/JSON in the text.", "- While working: use the text tool format specified below.") + instruction;
  else messages.unshift({ role: "system", content: instruction.trim() });
  payload.messages = messages;
}

function historyArgs(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value); } catch { return {}; }
}
