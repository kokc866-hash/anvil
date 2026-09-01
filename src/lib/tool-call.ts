export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export function asToolCall(id: string, name: string, args?: string): ToolCall {
  return { id, type: "function", function: { name, arguments: args || "{}" } };
}

export function stampToolCalls(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  return messages.map((m) => {
    const tcs = m.tool_calls;
    if (!Array.isArray(tcs) || !tcs.length) return m;
    return {
      ...m,
      tool_calls: tcs.map((raw, i) => {
        const tc = raw as Partial<ToolCall> & { name?: string; arguments?: string };
        const fn = tc.function ?? { name: String(tc.name ?? ""), arguments: String(tc.arguments ?? "{}") };
        return asToolCall(String(tc.id || `call_${i}`), fn.name, fn.arguments);
      }),
    };
  });
}
