const CORE_NAMES = new Set([
  "list_files",
  "read_file",
  "write_file",
  "append_file",
  "edit_file",
  "delete_file",
  "mkdir",
  "rename",
  "grep",
  "run_file",
  "set_plan",
  "shell",
]);

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

type ToolLike = { function: { name: string } };

/** Never drop tools. First 400 → keep only write/read/run. Second 400 → still that set. */
export function shrinkTools<T extends ToolLike>(current: T[] | null | undefined): T[] | null {
  if (!current?.length) return current ?? null;
  if (current.every((t) => CORE_NAMES.has(t.function.name)) && current.length <= CORE_NAMES.size) return current;
  const next = current.filter((t) => CORE_NAMES.has(t.function.name));
  return next.length ? next : current;
}

export function stripPayload(payload: Record<string, unknown>, body = "") {
  for (const k of STRIP_ON_400) delete payload[k];
  if (/tool_choice/i.test(body)) delete payload.tool_choice;
  if (/max_completion_tokens/i.test(body) && payload.max_tokens != null) {
    payload.max_completion_tokens = payload.max_tokens;
    delete payload.max_tokens;
  } else if (/\bmax_tokens\b/i.test(body) && payload.max_completion_tokens != null) {
    payload.max_tokens = payload.max_completion_tokens;
    delete payload.max_completion_tokens;
  }
}

export function stillHasTools(useTools: boolean, tools: unknown): boolean {
  return !useTools || (Array.isArray(tools) && tools.length > 0);
}