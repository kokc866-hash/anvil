export type SelectFile = { path: string; content: string };
export type SelectMsg = { role: "user" | "assistant"; content: string; images?: string[] };

export type ToolPick = {
  observeOnly?: boolean;
  mcp?: boolean;
  engine?: boolean;
  skills?: boolean;
  debug?: boolean;
  git?: boolean;
  board?: boolean;
};

const OBSERVE_NAMES = new Set([
  "list_files",
  "read_file",
  "grep",
  "memory_list",
  "harness_read",
  "board_read",
  "mcp_list",
  "skill_list",
  "skill_read",
  "engine_detect",
  "engine_status",
  "debug_state",
  "git_status",
  "see_run",
  "ask_user",
]);

const ALWAYS_TOOLS = new Set([
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
  "ask_user",
  "shell",
  "see_run",
  "play",
  "format_file",
  "open_preview",
  "fetch_url",
  "memory_list",
  "memory_add",
  "memory_forget",
  "skill_list",
  "skill_read",
  "skill_write",
  "skill_run",
]);

export function keepAgentTool(name: string, opts: ToolPick = {}): boolean {
  if (opts.observeOnly) return OBSERVE_NAMES.has(name);
  if (ALWAYS_TOOLS.has(name)) return true;
  if (name.startsWith("mcp_")) return Boolean(opts.mcp);
  if (name.startsWith("engine_")) return Boolean(opts.engine);
  if (name.startsWith("skill_")) return Boolean(opts.skills);
  if (name.startsWith("debug_")) return Boolean(opts.debug);
  if (name.startsWith("git_")) return Boolean(opts.git);
  if (name.startsWith("harness_") || name === "graph_write" || name.startsWith("board_")) return opts.board !== false;
  return true;
}

export function pinHistory<T extends SelectMsg>(messages: T[], keep = 64): T[] {
  const tail = messages.slice(-keep);
  const first = messages.find((m) => m.role === "user");
  if (first && !tail.includes(first)) return [first, ...tail];
  return tail;
}

function parents(path: string): string[] {
  const out: string[] = [];
  let cur = path.replace(/\\/g, "/").replace(/\/+$/, "");
  while (cur.includes("/")) {
    cur = cur.slice(0, cur.lastIndexOf("/"));
    if (cur) out.push(cur);
  }
  return out;
}

export function applyGitClone(
  files: Map<string, string>,
  dirs: Set<string>,
  deleted: string[],
  incoming: SelectFile[],
  replace: boolean,
): string[] {
  const wiped: string[] = [];
  if (replace) {
    for (const p of [...files.keys()]) {
      files.delete(p);
      deleted.push(p);
      wiped.push(p);
    }
  }
  for (const f of incoming) {
    files.set(f.path, f.content);
    for (const d of parents(f.path)) dirs.add(d);
  }
  return wiped;
}
