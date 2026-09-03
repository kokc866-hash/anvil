import type { LlmChoice, ToolCall } from "./agent-core.ts";

function asToolCall(id: string, name: string, args: string): ToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

type ResponsesJson = {
  output_text?: string;
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
    summary?: { text?: string }[];
    call_id?: string;
    id?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
    text?: string;
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function parseResponses(json: ResponsesJson): LlmChoice {
  let content = typeof json.output_text === "string" ? json.output_text : "";
  let reasoning = "";
  const tool_calls: ToolCall[] = [];
  for (const item of json.output ?? []) {
    const type = String(item.type ?? "");
    if (type === "message") {
      for (const p of item.content ?? []) content += p.text ?? "";
    } else if (type === "output_text") {
      content += item.text ?? "";
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

export function parseResponsesSse(raw: string): LlmChoice {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return parseResponses(JSON.parse(trimmed) as ResponsesJson);
  }
  let content = "";
  let reasoning = "";
  const tools = new Map<string, { id: string; name: string; args: string }>();
  let completed: LlmChoice | null = null;
  for (const block of raw.split(/\n\n+/)) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(j.type ?? "");
    if (type === "response.output_text.delta") content += String(j.delta ?? j.text ?? "");
    if (type === "response.reasoning_summary_text.delta") reasoning += String(j.delta ?? "");
    if (type === "response.function_call_arguments.delta") {
      const id = String(j.call_id ?? j.item_id ?? "call");
      const cur = tools.get(id) ?? { id, name: String(j.name ?? ""), args: "" };
      cur.args += String(j.delta ?? "");
      if (j.name) cur.name = String(j.name);
      tools.set(id, cur);
    }
    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item = (j.item && typeof j.item === "object" ? j.item : j) as {
        type?: string;
        call_id?: string;
        id?: string;
        name?: string;
        arguments?: string | Record<string, unknown>;
      };
      if (item.type === "function_call" || item.type === "custom_tool_call" || item.type === "tool_call") {
        const id = String(item.call_id ?? item.id ?? "call");
        const args = item.arguments;
        tools.set(id, {
          id,
          name: String(item.name ?? tools.get(id)?.name ?? ""),
          args: typeof args === "string" ? args : args ? JSON.stringify(args) : tools.get(id)?.args ?? "",
        });
      }
    }
    if ((type === "response.completed" || type === "response.incomplete") && j.response && typeof j.response === "object") {
      completed = parseResponses(j.response as ResponsesJson);
    }
  }
  if (completed && (completed.content || completed.tool_calls?.length)) return completed;
  const tool_calls = [...tools.values()].filter((t) => t.name).map((t) => asToolCall(t.id, t.name, t.args));
  return {
    role: "assistant",
    content: content || completed?.content || null,
    reasoning: reasoning || completed?.reasoning,
    tool_calls: tool_calls.length ? tool_calls : completed?.tool_calls,
    usage: completed?.usage,
  };
}
