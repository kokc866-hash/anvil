import { chatUsage } from "./token-usage.ts";
import type { LlmChoice, ToolCall } from "./agent-core.ts";
import { withModelFailureContext } from "../../electron/agent-failure.mjs";

function asToolCall(id: string, name: string, args: string): ToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

type ResponsesJson = {
  status?: string;
  error?: unknown;
  incomplete_details?: { reason?: string };
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

function errorMessage(value: unknown, fallback = "Der Modellserver meldet einen Fehler in der Antwort."): string {
  const message = typeof value === "string" ? value
    : value && typeof value === "object" && "message" in value ? String(value.message ?? "") : "";
  return message.trim().slice(0, 1000) || fallback;
}

function incompleteReason(reason?: string): string {
  return reason === "max_output_tokens" ? "length" : reason === "content_filter" ? "content_filter" : "incomplete";
}

export function parseResponses(json: ResponsesJson): LlmChoice {
  if (json.error || json.status === "failed" || json.status === "cancelled")
    throw withModelFailureContext(new Error(errorMessage(json.error)), { phase: "response", attempt: 1 });
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
  if (json.status === "incomplete" && tool_calls.length)
    throw withModelFailureContext(new Error("Modellantwort unvollständig: Werkzeugaufrufe wurden nicht ausgeführt."), { phase: "response", attempt: 1 });
  return {
    role: "assistant",
    content: content || null,
    reasoning: reasoning || undefined,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    ...(json.status === "incomplete" ? { finish_reason: incompleteReason(json.incomplete_details?.reason) }
      : json.status === "completed" ? { finish_reason: tool_calls.length ? "tool_calls" : "stop" } : {}),
    usage: chatUsage(json.usage),
  };
}

export type ResponsesAcc = {
  content: string;
  reasoning: string;
  tools: Map<string, { id: string; name: string; args: string }>;
  completed: LlmChoice | null;
  done: boolean;
  error: string;
  finish: string;
};

export function emptyResponsesAcc(): ResponsesAcc {
  return { content: "", reasoning: "", tools: new Map(), completed: null, done: false, error: "", finish: "" };
}

export function choiceFromAcc(acc: ResponsesAcc): LlmChoice {
  if (["length", "incomplete", "content_filter"].includes(acc.finish) && acc.tools.size)
    throw withModelFailureContext(new Error("Modellantwort unvollständig: Werkzeugaufrufe wurden nicht ausgeführt."), { phase: "stream", attempt: 1 });
  if (acc.completed && (acc.completed.content || acc.completed.reasoning || acc.completed.tool_calls?.length) && acc.done)
    return { ...acc.completed, finish_reason: acc.completed.finish_reason || acc.finish || (acc.completed.tool_calls?.length ? "tool_calls" : "stop") };
  const tool_calls = [...acc.tools.values()].filter((t) => t.name).map((t) => asToolCall(t.id, t.name, t.args));
  return {
    role: "assistant",
    content: acc.content || acc.completed?.content || null,
    reasoning: acc.reasoning || acc.completed?.reasoning,
    tool_calls: ["length", "incomplete", "content_filter"].includes(acc.finish) ? undefined : tool_calls.length ? tool_calls : acc.completed?.tool_calls,
    finish_reason: acc.finish || (acc.done ? tool_calls.length ? "tool_calls" : "stop" : undefined),
    usage: acc.completed?.usage,
  };
}

export function applyResponsesEvent(
  acc: ResponsesAcc,
  j: Record<string, unknown>,
  onDelta?: (text: string, kind?: "text" | "think") => void,
): void {
  const type = String(j.type ?? "");
  if (type === "error" || type === "response.failed") {
    const response = j.response && typeof j.response === "object" ? j.response as ResponsesJson : undefined;
    acc.error = errorMessage(j.error ?? response?.error ?? j.message);
    acc.done = true;
    return;
  }
  if (type === "response.output_text.delta") {
    const s = String(j.delta ?? j.text ?? "");
    if (s) {
      acc.content += s;
      onDelta?.(s, "text");
    }
  }
  if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
    const s = String(j.delta ?? j.text ?? "");
    if (s) {
      acc.reasoning += s;
      onDelta?.(s, "think");
    }
  }
  if (type === "response.function_call_arguments.delta") {
    const id = String(j.call_id ?? j.item_id ?? "call");
    const cur = acc.tools.get(id) ?? { id, name: String(j.name ?? ""), args: "" };
    cur.args += String(j.delta ?? "");
    if (j.name) cur.name = String(j.name);
    acc.tools.set(id, cur);
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
      acc.tools.set(id, {
        id,
        name: String(item.name ?? acc.tools.get(id)?.name ?? ""),
        args: typeof args === "string" ? args : args ? JSON.stringify(args) : acc.tools.get(id)?.args ?? "",
      });
    }
  }
  if ((type === "response.completed" || type === "response.incomplete") && j.response && typeof j.response === "object") {
    const response = j.response as ResponsesJson;
    acc.completed = parseResponses({ ...response, status: type === "response.incomplete" ? "incomplete" : response.status || "completed" });
    acc.finish = acc.completed.finish_reason || "";
  }
  if (type === "response.completed" || type === "response.incomplete") {
    acc.done = true;
    if (!acc.finish) acc.finish = type === "response.incomplete" ? "incomplete" : acc.tools.size ? "tool_calls" : "stop";
  }
}

export function parseResponsesSse(raw: string): LlmChoice {
  try {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return parseResponses(JSON.parse(trimmed) as ResponsesJson);
  }
  const acc = emptyResponsesAcc();
  for (const block of raw.split(/\r?\n\r?\n(?:\r?\n)*/)) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") {
      if (data === "[DONE]") acc.done = true;
      continue;
    }
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw new Error("Modellantwort unterbrochen: ungültiges oder unvollständiges JSON im Antwortstrom.");
    }
    const eventName = block.split(/\r?\n/).find(line => line.startsWith("event:"))?.slice(6).trim();
    if (!j.type && eventName) j.type = eventName;
    applyResponsesEvent(acc, j);
  }
  if (acc.error) throw new Error(acc.error);
  if (!acc.done) throw new Error("Modellantwort unterbrochen: Abschluss fehlt.");
  return choiceFromAcc(acc);
  } catch (error) {
    throw withModelFailureContext(error instanceof Error ? error : new Error(String(error)), { phase: "stream", attempt: 1 });
  }
}
