import { compactMessages, COMPACT_MARK, type CompactMode } from "./compact.ts";
import { throwIfAborted, isAbortLike, agentGen, AgentAbortError } from "./abort";
import { ANVIL_SURFACE, surfaceBlockWrite, toolsAllowed, type SurfaceMode } from "./surface";
import { enginePrompt, primaryEngine } from "./engines";
import { afterTool, applyHarnessTool, loadProjectGraph, loadProjectHarness, mergeOpts, projectHarnessPrompt } from "./harness-project";
import { harnessBar, startHarness, effectiveAfterWrite } from "./harness";
import { applyBoardTool, BOARD_PATH, filesFromBoard, parseBoard, settingsFromFiles, syncBoardFromFiles, syncBoardSettings } from "./harness-board";
import { isSecretPath as secretPath, isRefPath, isRefImage, refWriteBlocked, imageStub } from "./ref";
import { skipPath } from "./ws-skip";
import { extractFileBlocks, looksLikeNoTools, looksIncomplete, looksStoppedEarly, jobOpen, harvestTools, parseToolArgs, isToolTemplateEcho, blocksToWriteCalls, decodeWriteEscapes, pickRunPath, skipAutoRunPath, askPickedNone } from "./agent-parse";
import { workspaceIndex, workspaceMap } from "./ws-index";
import { packToolContent, readKey, readWindow } from "./agent-read";
import type { ToolCall } from "./tool-call";
import { stampToolCalls } from "./tool-call";
import { runFailHint, scrubRunError } from "./run-error";
import { applyGitClone, keepAgentTool, pinHistory, type ToolPick } from "./agent-select";
import { journalPrompt, type SessionJournal } from "./session";
import { parseAsk, type JobAsk } from "./agent-ask";

export type AgentFile = { path: string; content: string };

export type AgentMessage = { role: "user" | "assistant"; content: string; images?: string[] };

export type WorkspaceEvent =
  | { op: "write"; path: string; content: string }
  | { op: "delete"; path: string }
  | { op: "mkdir"; path: string }
  | { op: "rename"; from: string; to: string }
  | { op: "commit"; message: string }
  | { op: "preview"; path: string }
  | { op: "board"; open?: boolean };

export type GitInfo = {
  repo: string;
  hasToken: boolean;
  dirty: string[];
  commits: { message: string; at: number }[];
};

export type AgentCommand =
  | { cmd: "fetch"; url: string }
  | { cmd: "format"; path: string }
  | { cmd: "git_clone"; url: string; replace?: boolean }
  | { cmd: "git_push"; message: string }
  | { cmd: "git_status" }
  | { cmd: "git_commit"; message: string }
  | { cmd: "shell"; command: string }
  | { cmd: "debug"; action: string; args: Record<string, unknown> }
  | { cmd: "learn"; action: string; args: Record<string, unknown> }
  | { cmd: "mcp"; action: "list" | "call"; server?: string; name?: string; args?: unknown }
  | { cmd: "engine"; action: "status" | "run"; args?: Record<string, unknown> }
  | { cmd: "run"; path: string }
  | { cmd: "play"; keys: string[]; hold?: number }
  | { cmd: "see" };

export type AgentResult = {
  ok: boolean;
  reply: string;
  files?: AgentFile[];
  runPaths?: string[];
  tools?: string[];
  deleted?: string[];
  applied?: boolean;
  usage?: { prompt: number; completion: number };
  compacted?: boolean;
  error?: string;
  ask?: JobAsk;
  parked?: boolean;
};

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "function" as const,
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: true },
    },
  };
}

export const AGENT_TOOLS = [
  tool("list_files", "List workspace paths. Optional glob substring, prefix folder, offset for the next page.", {
    glob: { type: "string" },
    prefix: { type: "string" },
    offset: { type: "integer" },
  }),
  tool("read_file", "Read a file. If the result says start_line, continue that path. Never rewrite because a read was long.", {
    path: { type: "string" },
    start_line: { type: "integer" },
    end_line: { type: "integer" },
  }, ["path"]),
  tool("write_file", "Create or overwrite a file. Prefer edit_file/append_file for existing large files. If truncated, append_file — do not rewrite.", {
    path: { type: "string" },
    content: { type: "string" },
  }, ["path", "content"]),
  tool("append_file", "Append text to an existing file (or create). Use when write_file was truncated or to add at the end.", {
    path: { type: "string" },
    content: { type: "string" },
  }, ["path", "content"]),
  tool("edit_file", "Replace exact text. old_string must be unique unless replace_all. Safer than rewriting the whole file.", {
    path: { type: "string" },
    old_string: { type: "string" },
    new_string: { type: "string" },
    replace_all: { type: "boolean" },
  }, ["path", "old_string", "new_string"]),
  tool("delete_file", "Delete a file from the workspace.", { path: { type: "string" } }, ["path"]),
  tool("mkdir", "Create an empty folder.", { path: { type: "string" } }, ["path"]),
  tool("rename", "Rename or move a file or folder.", {
    from: { type: "string" },
    to: { type: "string" },
  }, ["from", "to"]),
  tool("run_file", "Run a workspace file and return the output. HTML/Python/JS execute. Go/Rust/C/C++/Java/C#/PHP/Ruby: compile then run — the result has Compile and Run. After write/edit always run. On failure: patch and run again (max 3).", {
    path: { type: "string" },
  }, ["path"]),
  tool("see_run", "HTML: snapshot the preview. Native/CLI: last Compile/Run log or open OS window — never a fake iframe for .exe.", {}),
  tool("play", "Send keys to the HTML preview, then snapshot. keys: left,right,up,down,ok.", {
    keys: { type: "array", items: { type: "string" } },
    hold_ms: { type: "number" },
  }, ["keys"]),
  tool("format_file", "Format a workspace file (JS/TS/JSON/HTML/Markdown; Go/Rust/C/C++ via Companion).", { path: { type: "string" } }, ["path"]),
  tool("open_preview", "Open live preview for HTML, Markdown, JSON, or last run.", {
    path: { type: "string" },
  }, ["path"]),
  tool("git_status", "Git status of the opened project folder via Companion. Falls back to session dirty list.", {}),
  tool("git_commit", "Real git commit in the opened project folder (Companion). Needs a gekoppelten Ordner.", {
    message: { type: "string" },
  }, ["message"]),
  tool("git_push", "Commit and push the workspace to GitHub. Needs repo + token in settings.", {
    message: { type: "string" },
  }),
  tool("git_clone", "Clone a GitHub repo (owner/repo or URL) into the workspace. Does not wipe other files unless replace is true.", {
    url: { type: "string" },
    replace: { type: "boolean", description: "If true, delete existing workspace files first." },
  }, ["url"]),
  tool("shell", "Run a limited command: python <file>, node <file>, npm test, pytest [-q] [-k name], python -m pytest, go test, cargo test, dotnet test.", {
    command: { type: "string" },
  }, ["command"]),
  tool("fetch_url", "Fetch a public https page as text. Not localhost.", { url: { type: "string" } }, ["url"]),
  tool("debug_start", "Start debugger on a Python/JS/TS file. Pauses on entry or breakpoints.", {
    path: { type: "string" },
    pause_on_entry: { type: "boolean" },
  }),
  tool("debug_continue", "Continue from current debug pause.", {}),
  tool("debug_step", "Step to the next line.", {}),
  tool("debug_stop", "Stop the debugger.", {}),
  tool("debug_breakpoint", "Toggle or set a breakpoint.", {
    path: { type: "string" },
    line: { type: "number" },
    on: { type: "boolean" },
  }, ["path", "line"]),
  tool("debug_eval", "Evaluate an expression in the paused frame.", { expr: { type: "string" } }, ["expr"]),
  tool("debug_state", "Current debugger state: paused, line, locals, stack, breakpoints.", {}),
  tool("debug_watch", "Watch an expression; updated on each pause.", { expr: { type: "string" } }, ["expr"]),
  tool("memory_list", "Learned user/project facts and skills. Facts in Gelerntes have [id] for memory_forget.", {}),
  tool("memory_add", "Save a durable preference, project fact, or lesson. Call after the user corrects you.", {
    kind: { type: "string", description: "user | project | lesson" },
    text: { type: "string" },
  }, ["text"]),
  tool("memory_forget", "Delete a learned fact. id from Gelerntes [id], or the fact text.", { id: { type: "string" } }, ["id"]),
  tool("skill_list", "List skills the agent wrote (reusable workflows).", {}),
  tool("skill_write", "Create or update a skill. Use after a reusable multi-step workflow succeeded.", {
    name: { type: "string" },
    when: { type: "string", description: "When to use this skill" },
    body: { type: "string", description: "Concrete steps" },
    kind: { type: "string", description: "guide or plugin" },
  }, ["name", "when", "body"]),
  tool("skill_read", "Read a skill body.", { name: { type: "string" } }, ["name"]),
  tool("skill_run", "Activate a skill and follow its body now with tools.", { name: { type: "string" } }, ["name"]),
  tool("skill_debug", "Validate a skill (or all). Returns issues to fix with skill_write/skill_patch.", {
    name: { type: "string" },
  }),
  tool("skill_patch", "Update when/body of an existing skill after debug.", {
    name: { type: "string" },
    when: { type: "string" },
    body: { type: "string" },
  }, ["name"]),
  tool("skill_outcome", "Report whether the last skill helped: ok, fail, reject.", {
    kind: { type: "string" },
  }, ["kind"]),
  tool("set_plan", "Visible checklist. Call once at start with 3-7 short steps in the user's language.", {
    steps: { type: "array", items: { type: "string" } },
  }, ["steps"]),
  tool("ask_user", "Ask the user a question with 2–5 options. Use when a choice, missing fact, or risky write needs a decision. Do not guess. After the answer, continue the same job.", {
    prompt: { type: "string" },
    why: { type: "string" },
    choices: { type: "array", items: { type: ["string", "object"] } },
    allow_text: { type: "boolean" },
    recommended: { type: "string" },
    blocking: { type: "string", description: "hard | soft" },
  }, ["prompt"]),
  tool("mcp_list", "List tools from configured MCP HTTP servers.", {}),
  tool("mcp_call", "Call a tool on a configured MCP server.", {
    server: { type: "string" },
    name: { type: "string" },
    arguments: { type: "object", additionalProperties: true },
  }, ["server", "name"]),
  tool("engine_detect", "Detect Godot/Unity/Unreal/Bevy/… in the workspace. Games run in those engines, not inside Anvil.", {}),
  tool("engine_status", "Ping the local engine companion (HTTP). Returns binaries if running.", {}),
  tool("engine_run", "Run play/check/editor on the detected engine via companion. action: play|check|editor|test or cmd.", {
    action: { type: "string" },
    cmd: { type: "string" },
    timeoutMs: { type: "number" },
  }),
  tool("harness_read", "Read .anvil/harness.json and .anvil/graph.json (project run/graph loop).", {}),
  tool("harness_write", "Optional. Persist a custom after-write loop. Defaults already run. Never use this to enable run_file — call run_file.", {
    name: { type: "string" },
    when: { type: "string" },
    afterWrite: { type: "string", description: "run | engine | preview | none" },
    loopTries: { type: "number" },
    maxRounds: { type: "number" },
    graphLoop: { type: "boolean" },
    runLoop: { type: "boolean" },
    testLoop: { type: "boolean" },
    engineLoop: { type: "boolean" },
  }, ["name"]),
  tool("graph_write", "Rebuild .anvil/graph.json from the workspace (HTML/Python/tests/engine). Pass edges only to replace the whole graph, never append. fromSources:true ignores old edges.", {
    name: { type: "string" },
    fromSources: { type: "boolean" },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          when: { type: "string" },
          edge: { type: "string" },
          tool: { type: "string" },
          glob: { type: "string" },
        },
      },
    },
  }),
  tool("board_read", "Read the harness Tafel (.anvil/board.json): phases, wires, graph nodes.", {}),
  tool("board_open", "Open the Tafel in the UI.", {}),
  tool("board_reset", "Reset the Tafel to the factory layout (Plan→Arbeit→Run→Fertig, Vorschau/Patch/Engine).", {}),
  tool("board_write", "Rebuild or edit the Tafel. fromSources:true builds nodes from the workspace. reset, add, from+to, or full json. Tafel stays open.", {
    reset: { type: "boolean" },
    fromSources: { type: "boolean" },
    rebuild: { type: "boolean" },
    from: { type: "string" },
    to: { type: "string" },
    tool: { type: "string" },
    edge: { type: "string" },
    glob: { type: "string" },
    when: { type: "string" },
    remove: { type: "string" },
    add: { type: "object", additionalProperties: true },
    connect: { type: "object", additionalProperties: true },
    board: { type: "object", additionalProperties: true },
    json: { type: "string" },
    nodes: { type: "array", items: { type: "object", additionalProperties: true } },
    wires: { type: "array", items: { type: "object", additionalProperties: true } },
  }),
  tool("grep", "Search workspace files. Returns path:line:content. glob limits the folder. Up to 80 hits.", {
    query: { type: "string" },
    glob: { type: "string" },
  }, ["query"]),
];

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
  "ask_user",
  "shell",
]);

export const CORE_TOOLS = AGENT_TOOLS.filter((t) => CORE_NAMES.has(t.function.name));

export function pickAgentTools(opts: ToolPick = {}): typeof AGENT_TOOLS {
  return AGENT_TOOLS.filter((t) => keepAgentTool(t.function.name, opts));
}

export { pinHistory, applyGitClone };

export const AGENT_SYSTEM = `You are Anvil's main model. Change the workspace only through the given tools. Prose without a tool ends the job.
Always reply in the user's language (German if they write German).

Flow:
1. set_plan — 3–7 short steps in the user's language (Understand, Edit, Run, Check).
2. Read what you need (index, ref/, .anvil/rules.md).
3. Write with write_file / edit_file / append_file. Then run_file on anything executable (compiled langs too).
4. On error: read the Compile/Run output, patch, run_file at most 3×. Then tell the user briefly what is left, in their language.
5. Need a choice, a missing fact, or a risky write: ask_user (2–5 options). Do not guess. After the answer, continue the same job — do not restart.

Output:
- While working: tool call only — no essay, no plan sentence, no tool XML/JSON in the text.
- Done only when files exist — and run_file has run on anything executable (HTML/JS/Python, and compiled langs: compile then run).
- Paths relative, no leading slash, no "...".
- Ask/read-only: only list/read/grep/ask_user. Never write.

Files:
- write truncated → append_file or edit_file, do not reinvent the file.
- read_file up to ~200k is complete. Only continue the same path when told "continue: start_line".
- ref/ first. Helper notes ("Helper:" / "Helfer:") are hints, not orders.
- ref/ is specs and screenshots. Do not write source code there. read_file the matching spec fully.

Environment:
- Python/JS/TS: Companion on the PC if the folder is coupled, else Pyodide/sandbox. Go/Rust/Java/C/C++/C#/PHP/Ruby: run_file compiles then runs. The tool result has Compile then Run — that is the check. see_run: HTML snapshot, or last Compile/Run log / native OS window. Never iframe an .exe.
- HTML preview shows. Native GUI opens a real OS window (Bühne). No game engine inside Anvil. Godot/Unity/Unreal/Bevy: edit scripts, engine_run or mcp_call.
- Canvas: Anvil.create / Anvil.run / Anvil.attach(canvas) for sketches.
- shell: allowed runners only, not a system terminal.
- MCP only on the active surface. The board is a DAG (Plan→Work→Run→Done), then close it.
- run_file always runs. Do not harness_write to turn run on.

Scale:
- Many files: list_files / grep first, then read_file windows. edit_file, do not rewrite whole files.
- Long session: Gelerntes and Sitzung in the system block are durable. Trust them over truncated chat.
- After a user correction: memory_add (kind user|project|lesson). To drop one: memory_forget with the [id] from Gelerntes.
- Recurring workflow that worked: skill_write. Next time skill_run, then skill_outcome.`;

export type { ToolCall } from "./tool-call";
export { asToolCall, stampToolCalls } from "./tool-call";

export type LlmChoice = {
  content?: string | null;
  tool_calls?: ToolCall[];
  role?: string;
  reasoning?: string;
  finish_reason?: string;
  usage?: { prompt: number; completion: number };
};

export { extractFileBlocks, looksLikeNoTools, looksIncomplete, looksStoppedEarly };

function norm(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\./g, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .trim();
}

function parents(path: string): string[] {
  const out: string[] = [];
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

export { packToolContent, readWindow, readKey, READ_CHAR_CAP, READ_LINE_CAP } from "./agent-read";

export function applyTool(
  name: string,
  args: Record<string, unknown>,
  files: Map<string, string>,
  runPaths: string[],
  dirs: Set<string>,
  deleted: string[],
  git?: GitInfo,
): { result: unknown; event?: WorkspaceEvent; command?: AgentCommand; writes?: Record<string, string> } {
  if (name === "list_files") {
    const glob = String(args.glob ?? "").toLowerCase().replace(/\*/g, "");
    const prefix = norm(String(args.prefix ?? ""));
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    const all = [...files.keys(), ...dirs].filter((p) => !secretPath(p) && (!skipPath(p) || isRefPath(p))).sort();
    let list = glob ? all.filter((p) => p.toLowerCase().includes(glob)) : all;
    if (prefix) list = list.filter((p) => p === prefix || p.startsWith(`${prefix}/`));
    const filesOut = list.filter((p) => files.has(p));
    const dirsOut = list.filter((p) => dirs.has(p) && !files.has(p));
    const filePage = filesOut.slice(offset, offset + 800);
    const dirPage = dirsOut.slice(0, 200);
    const truncated = filesOut.length > offset + 800 || dirsOut.length > 200;
    return {
      result: {
        files: filePage,
        dirs: dirPage,
        truncated,
        total: filesOut.length + dirsOut.length,
        offset,
        next: filesOut.length > offset + 800 ? offset + 800 : undefined,
      },
    };
  }
  if (name === "read_file") {
    const path = norm(String(args.path ?? ""));
    if (!files.has(path)) return { result: { error: `not found: ${path}` } };
    if (secretPath(path)) return { result: { error: `secret: ${path}`, path } };
    const src = files.get(path) ?? "";
    if (isRefImage(src) || src.startsWith("data:image/") || /^\s*\[image /i.test(src)) {
      return {
        result: {
          path,
          content: imageStub(path, src),
          start_line: 1,
          end_line: 1,
          total_lines: 1,
          truncated: false,
        },
      };
    }
    const win = readWindow(src, Number(args.start_line) || 1, Number(args.end_line) || 0);
    return {
      result: {
        path,
        content: win.body,
        start_line: win.from,
        end_line: win.to,
        total_lines: win.total,
        truncated: win.truncated,
      },
    };
  }
  if (name === "write_file") {
    const path = norm(String(args.path ?? ""));
    if (!path) return { result: { error: "empty path" } };
    if (secretPath(path)) return { result: { error: `secret: ${path}`, path } };
    const content = decodeWriteEscapes(String(args.content ?? ""));
    const blocked = refWriteBlocked(path, content, files.has(path));
    if (blocked) return { result: { error: blocked, path } };
    const cut = Boolean(args.truncated);
    if (!content.trim()) {
      return {
        result: {
          error: "write empty or aborted. File unchanged. append_file or edit_file, do not start over.",
          path,
        },
      };
    }
    const prev = files.get(path);
    if (cut && prev && content.length < prev.length) {
      return {
        result: {
          error: "write aborted — output truncated. File unchanged. append_file or edit_file.",
          path,
          had: prev.length,
          got: content.length,
        },
      };
    }
    files.set(path, content);
    for (const d of parents(path)) dirs.add(d);
    if (path === BOARD_PATH) {
      const parsed = parseBoard(content);
      if (parsed) {
        const pack = filesFromBoard(parsed, settingsFromFiles(Object.fromEntries(files)));
        for (const [p, c] of Object.entries(pack)) {
          files.set(p, c);
          for (const d of parents(p)) dirs.add(d);
        }
        return { result: { ok: true, path, bytes: content.length }, writes: pack, event: { op: "board", open: true } };
      }
    }
    if (path === ".anvil/harness.json") {
      const pack = syncBoardSettings(Object.fromEntries(files));
      for (const [p, c] of Object.entries(pack)) {
        files.set(p, c);
        for (const d of parents(p)) dirs.add(d);
      }
      return { result: { ok: true, path, bytes: content.length }, writes: pack };
    }
    if (path === ".anvil/graph.json") {
      const pack = syncBoardFromFiles(Object.fromEntries(files));
      for (const [p, c] of Object.entries(pack)) {
        files.set(p, c);
        for (const d of parents(p)) dirs.add(d);
      }
      return { result: { ok: true, path, bytes: content.length }, writes: pack };
    }
    return {
      result: {
        ok: true,
        path,
        bytes: content.length,
        truncated: cut || undefined,
        hint: cut ? "truncated — append_file at the end, do not rewrite the file" : undefined,
      },
      event: { op: "write", path, content },
    };
  }
  if (name === "append_file") {
    const path = norm(String(args.path ?? ""));
    if (!path) return { result: { error: "empty path" } };
    if (secretPath(path)) return { result: { error: `secret: ${path}`, path } };
    const chunk = decodeWriteEscapes(String(args.content ?? ""));
    if (!chunk) return { result: { error: "empty content", path } };
    const blocked = refWriteBlocked(path, chunk, files.has(path));
    if (blocked) return { result: { error: blocked, path } };
    const content = (files.get(path) ?? "") + chunk;
    files.set(path, content);
    for (const d of parents(path)) dirs.add(d);
    return {
      result: { ok: true, path, bytes: content.length, appended: chunk.length },
      event: { op: "write", path, content },
    };
  }
  if (name === "edit_file") {
    const path = norm(String(args.path ?? ""));
    if (secretPath(path)) return { result: { error: `secret: ${path}`, path } };
    const old = decodeWriteEscapes(String(args.old_string ?? ""));
    const next = decodeWriteEscapes(String(args.new_string ?? ""));
    const all = Boolean(args.replace_all);
    const cur = files.get(path);
    if (cur == null) return { result: { error: `not found: ${path}` } };
    if (!old) return { result: { error: "old_string empty" } };
    if (!cur.includes(old)) {
      const needle = old.trim().slice(0, 40);
      const near: string[] = [];
      if (needle.length >= 8) {
        const lines = cur.split("\n");
        for (let i = 0; i < lines.length && near.length < 4; i++) {
          if (lines[i].includes(needle.slice(0, 16))) near.push(`${i + 1}: ${lines[i].trim().slice(0, 140)}`);
        }
      }
      return { result: { error: "old_string not found", hint: "use a shorter unique snippet", near } };
    }
    if (!all && cur.split(old).length > 2) return { result: { error: "old_string not unique, set replace_all" } };
    const content = all ? cur.split(old).join(next) : cur.replace(old, next);
    files.set(path, content);
    return { result: { ok: true, path }, event: { op: "write", path, content } };
  }
  if (name === "delete_file") {
    const path = norm(String(args.path ?? ""));
    if (secretPath(path)) return { result: { error: `secret: ${path}`, path } };
    const ok = files.delete(path);
    if (ok) deleted.push(path);
    return { result: { ok, path }, event: ok ? { op: "delete", path } : undefined };
  }
  if (name === "mkdir") {
    const path = norm(String(args.path ?? ""));
    if (!path) return { result: { error: "empty path" } };
    dirs.add(path);
    for (const d of parents(path)) dirs.add(d);
    return { result: { ok: true, path }, event: { op: "mkdir", path } };
  }
  if (name === "rename") {
    const from = norm(String(args.from ?? ""));
    const to = norm(String(args.to ?? ""));
    if (!from || !to) return { result: { error: "from/to required" } };
    if (secretPath(from) || secretPath(to)) return { result: { error: `secret: ${from}`, path: from } };
    if (files.has(from)) {
      const content = files.get(from) ?? "";
      files.delete(from);
      files.set(to, content);
      deleted.push(from);
      for (const d of parents(to)) dirs.add(d);
      return { result: { ok: true, from, to }, event: { op: "rename", from, to } };
    }
    const kids = [...files.keys()].filter((p) => p === from || p.startsWith(`${from}/`));
    if (!kids.length && !dirs.has(from)) return { result: { error: `not found: ${from}` } };
    if (kids.some((p) => secretPath(p) || secretPath(to + p.slice(from.length)))) {
      return { result: { error: `secret: ${from}`, path: from } };
    }
    for (const p of kids) {
      const content = files.get(p) ?? "";
      files.delete(p);
      const np = to + p.slice(from.length);
      files.set(np, content);
      deleted.push(p);
    }
    for (const d of [...dirs]) {
      if (d === from || d.startsWith(`${from}/`)) {
        dirs.delete(d);
        dirs.add(to + d.slice(from.length));
      }
    }
    dirs.add(to);
    return { result: { ok: true, from, to, files: kids.length }, event: { op: "rename", from, to } };
  }
  if (name === "run_file") {
    const path = norm(String(args.path ?? ""));
    if (!files.has(path)) return { result: { error: `not found: ${path}` } };
    runPaths.push(path);
    return { result: { running: path }, command: { cmd: "run", path } };
  }
  if (name === "see_run") {
    return { result: { seeing: true }, command: { cmd: "see" } };
  }
  if (name === "play") {
    const keys = Array.isArray(args.keys) ? args.keys.map((k) => String(k)) : String(args.keys ?? "").split(/[,\s]+/);
    const hold = Number(args.hold_ms ?? args.hold ?? 90);
    return { result: { playing: keys }, command: { cmd: "play", keys, hold: Number.isFinite(hold) ? hold : 90 } };
  }
  if (name === "format_file") {
    const path = norm(String(args.path ?? ""));
    if (!files.has(path)) return { result: { error: `not found: ${path}` } };
    return { result: { formatting: path }, command: { cmd: "format", path } };
  }
  if (name === "open_preview") {
    const p = norm(String(args.path ?? "")) || [...files.keys()][0] || "";
    if (p && !files.has(p)) return { result: { error: `not found: ${p}` } };
    return { result: { preview: p }, event: { op: "preview", path: p } };
  }
  if (name === "git_status") {
    return { result: { checking: true }, command: { cmd: "git_status" } };
  }
  if (name === "git_commit") {
    const message = String(args.message ?? "").trim() || "Update";
    return { result: { committing: true, message }, command: { cmd: "git_commit", message } };
  }
  if (name === "git_push") {
    const message = String(args.message ?? "").trim() || "Anvil commit";
    return { result: { pushing: true, message }, command: { cmd: "git_push", message } };
  }
  if (name === "git_clone") {
    const url = String(args.url ?? "").trim();
    if (!url) return { result: { error: "url required" } };
    return { result: { cloning: url, replace: Boolean(args.replace) }, command: { cmd: "git_clone", url, replace: Boolean(args.replace) } };
  }
  if (name === "shell") {
    const command = String(args.command ?? "").trim();
    if (!command) return { result: { error: "command required" } };
    return { result: { running: command }, command: { cmd: "shell", command } };
  }
  if (name === "fetch_url") return { result: { fetch: String(args.url ?? "") }, command: { cmd: "fetch", url: String(args.url ?? "") } };
  if (name.startsWith("debug_")) {
    const action = name.slice("debug_".length);
    return { result: { debugging: action }, command: { cmd: "debug", action, args } };
  }
  if (name.startsWith("memory_") || name.startsWith("skill_")) {
    const action = name.startsWith("memory_")
      ? name === "memory_list"
        ? "list"
        : name.slice("memory_".length)
      : name === "skill_list"
        ? "skills"
        : name.slice("skill_".length);
    return { result: { learning: action }, command: { cmd: "learn", action, args } };
  }
  if (name === "grep") {
    const raw = String(args.query ?? "");
    const glob = String(args.glob ?? "").toLowerCase().replace(/\*/g, "");
    if (!raw) return { result: { error: "empty query" } };
    let re: RegExp | null = null;
    try {
      re = new RegExp(raw, "i");
    } catch {
      re = null;
    }
    const q = raw.toLowerCase();
    const hits: string[] = [];
    let scanned = 0;
    for (const [path, content] of files) {
      if (secretPath(path) || (skipPath(path) && !isRefPath(path)) || isRefImage(content) || content.startsWith("data:image/") || content.length > 400_000) continue;
      if (glob && !path.toLowerCase().includes(glob)) continue;
      scanned += 1;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const ok = re ? re.test(lines[i]) : lines[i].toLowerCase().includes(q);
        if (!ok) continue;
        hits.push(`${path}:${i + 1}:${lines[i].trim().slice(0, 160)}`);
        if (hits.length >= 80) return { result: { matches: hits, truncated: true, scanned } };
      }
    }
    return { result: { matches: hits, truncated: false, scanned } };
  }
  if (name === "set_plan") {
    const raw = args.steps;
    const steps = Array.isArray(raw)
      ? raw.map((s) => String(s).trim()).filter(Boolean)
      : String(raw ?? "")
          .split("\n")
          .map((s) => s.replace(/^\d+[.)]\s*/, "").trim())
          .filter(Boolean);
    return { result: { ok: true, steps: steps.slice(0, 10) } };
  }
  if (name === "ask_user") {
    const parsed = parseAsk(args);
    if ("error" in parsed) return { result: { error: parsed.error } };
    return { result: { ok: true, ask: parsed.ask, parked: true } };
  }
  if (name === "mcp_list") return { result: {}, command: { cmd: "mcp", action: "list" } };
  if (name === "mcp_call") {
    return {
      result: {},
      command: {
        cmd: "mcp",
        action: "call",
        server: String(args.server ?? ""),
        name: String(args.name ?? ""),
        args: args.arguments ?? {},
      },
    };
  }
  if (name === "engine_detect") {
    return { result: { detect: true }, command: { cmd: "engine", action: "status", args: { detect: true } } };
  }
  if (name === "engine_status") return { result: {}, command: { cmd: "engine", action: "status", args } };
  if (name === "engine_run") return { result: {}, command: { cmd: "engine", action: "run", args } };
  if (name === "harness_read" || name === "harness_write" || name === "graph_write") {
    const rec = Object.fromEntries(files);
    const { result, writes } = applyHarnessTool(name, args, rec);
    const pack =
      writes && name === "harness_write"
        ? syncBoardSettings({ ...rec, ...writes })
        : writes && name === "graph_write"
          ? syncBoardFromFiles({ ...rec, ...writes })
          : writes;
    if (pack) {
      for (const [path, content] of Object.entries(pack)) {
        files.set(path, content);
        for (const d of parents(path)) dirs.add(d);
      }
      return { result, writes: pack };
    }
    return { result };
  }
  if (name === "board_open" || name === "board_read" || name === "board_write" || name === "board_reset") {
    if (name === "board_open") {
      return { result: { ok: true, open: true }, event: { op: "board", open: true } };
    }
    const rec = Object.fromEntries(files);
    const { result, writes } = applyBoardTool(name, args, rec);
    if (writes) {
      for (const [path, content] of Object.entries(writes)) {
        files.set(path, content);
        for (const d of parents(path)) dirs.add(d);
      }
    }
    return {
      result,
      writes,
      event: name === "board_read" ? undefined : { op: "board" as const, open: true },
    };
  }
  return { result: { error: `unknown tool ${name}` } };
}

function lastUserOf(messages: AgentMessage[]): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

export async function runAgentLoop(
  data: {
    messages: AgentMessage[];
    files: AgentFile[];
    dirs?: string[];
    git?: GitInfo;
    context?: number;
    compact?: CompactMode;
    runLoop?: boolean;
    graphLoop?: boolean;
    testLoop?: boolean;
    engineLoop?: boolean;
    loopTries?: number;
    engineOk?: boolean;
    afterWrite?: "run" | "engine" | "preview" | "none";
    maxRounds?: number;
    graphSees?: number;
    mcpCatalog?: string;
    surfaceId?: string;
    surfaceMode?: SurfaceMode;
    journal?: SessionJournal;
    memory?: string;
    prefer?: string[];
    locale?: "de" | "en";
    observeOnly?: boolean;
  },
  complete: (messages: Record<string, unknown>[], useTools: boolean | "required", onDelta?: (s: string, kind?: "text" | "think") => void) => Promise<LlmChoice>,
  opts?: {
    fetchUrl?: (url: string) => Promise<string>;
    onDelta?: (s: string, kind?: "text" | "think") => void;
    onWorkspace?: (ev: WorkspaceEvent) => void | Promise<void>;
    onTool?: (info: { name: string; args: Record<string, unknown>; result: unknown }) => void;
    onToolStart?: (info: { name: string; args: Record<string, unknown> }) => void;
    formatFile?: (path: string, content: string) => Promise<string>;
    gitClone?: (url: string) => Promise<AgentFile[]>;
    gitPush?: (message: string, files: Record<string, string>) => Promise<{ sha: string; repo: string }>;
    gitStatus?: () => Promise<unknown>;
    gitCommit?: (message: string) => Promise<unknown>;
    shell?: (command: string, files: Record<string, string>) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
    debug?: (action: string, args: Record<string, unknown>) => Promise<unknown>;
    learn?: (action: string, args: Record<string, unknown>) => Promise<unknown>;
    summarize?: (blob: string) => Promise<string>;
    mcp?: (action: "list" | "call", server?: string, name?: string, args?: unknown) => Promise<unknown>;
    engine?: (action: "status" | "run", args?: Record<string, unknown>) => Promise<unknown>;
    runFile?: (path: string, files: Record<string, string>) => Promise<unknown>;
    play?: (keys: string[], hold?: number) => Promise<unknown>;
    see?: () => Promise<unknown>;
    onHarness?: (bar: string) => void;
  },
): Promise<AgentResult> {
  const files = new Map(data.files.map((f) => [f.path, f.content]));
  const dirs = new Set<string>(data.dirs ?? []);
  for (const p of files.keys()) for (const d of parents(p)) dirs.add(d);
  const runPaths: string[] = [];
  const used: string[] = [];
  const deleted: string[] = [];
  let usage = { prompt: 0, completion: 0 };
  let compacted = false;
  const fileMap = Object.fromEntries(files);
  const prefer = [...new Set((data.prefer ?? []).filter((p) => p in fileMap))];
  const map = workspaceMap(fileMap, prefer);
  const index = workspaceIndex(fileMap, prefer.length ? 48 : 64, prefer);
  const hit = primaryEngine(fileMap, [...dirs]);
  const extra = enginePrompt(hit);
  let projH = loadProjectHarness(fileMap);
  let projG = loadProjectGraph(fileMap);
  let hopts = mergeOpts(
    {
      runLoop: data.runLoop ?? false,
      graphLoop: data.graphLoop ?? false,
      testLoop: data.testLoop,
      engineLoop: data.engineLoop,
      loopTries: data.loopTries ?? 3,
      afterWrite: data.afterWrite,
      maxRounds: data.maxRounds,
      graphSees: data.graphSees,
    },
    projH,
  );
  let harness = startHarness(hopts);
  const harnessNote = projectHarnessPrompt(projH, projG, { runLoop: hopts.runLoop, graphLoop: hopts.graphLoop });
  const mcpNote = data.mcpCatalog?.trim() ?? "";
  const sysParts = [
    AGENT_SYSTEM,
    `Workspace:\n${map}${index ? `\n\nFokus-Index:\n${index}` : ""}`,
    extra,
    harnessNote,
    mcpNote,
    journalPrompt(data.journal),
    data.memory?.trim() ?? "",
  ].filter((s): s is string => Boolean(s && String(s).trim()));
  let messages: Record<string, unknown>[] = [
    { role: "system", content: sysParts.join("\n\n") },
    ...pinHistory(data.messages).map((m) => {
      if (m.images?.length) {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content.slice(0, m === lastUserOf(data.messages) ? 16000 : 8000) },
            ...m.images.slice(0, 4).map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        };
      }
      return { role: m.role, content: m.content.slice(0, m === lastUserOf(data.messages) ? 16000 : 8000) };
    }),
  ];

  const pack = async () => {
    const next = compactMessages(messages, data.context ?? 32768, data.compact ?? "auto");
    if (next.compacted) {
      messages = next.messages;
      compacted = true;
      const mark = messages.find((m) => String(m.content ?? "").startsWith(COMPACT_MARK));
      if (mark && opts?.summarize) {
        try {
          const sum = await opts.summarize(String(mark.content));
          if (sum.trim()) mark.content = `${COMPACT_MARK}, summary):\n${sum}`;
        } catch {
          /* keep truncated */
        }
      }
    }
  };
  await pack();

  const packResult = (reply: string, extra: Partial<AgentResult> = {}): AgentResult => ({
    ok: true,
    files: [...files.entries()].map(([path, content]) => ({ path, content })),
    runPaths: [...new Set(runPaths)],
    tools: used,
    deleted: [...new Set(deleted)],
    applied: Boolean(opts?.onWorkspace),
    usage,
    compacted,
    ...extra,
    reply,
  });

  let nudged = 0;
  let emptyHits = 0;
  let stopAfter = false;
  let lastRead = "";
  let lastReadN = 0;
  let lastFail = "";
  const cap = Math.min(128, Math.max(8, hopts.maxRounds ?? data.maxRounds ?? 24));
  const loopGen = agentGen();
  const de = data.locale !== "en";
  const say = (a: string, b: string) => (de ? a : b);
  const observeOnly = Boolean(data.observeOnly);
  const observeTool = (n: string) =>
    /^(read_file|list_files|grep|harness_read|board_read|mcp_list|skill_list|skill_read|engine_detect|engine_status|debug_state|git_status|memory_list|see_run|ask_user)$/.test(n);
  const mutateTool = (n: string) =>
    /^(write_file|append_file|edit_file|delete_file|rename|mkdir|git_clone|harness_write|graph_write|board_write|board_reset)$/.test(n);
  let allow: string[] = [];
  let strictAllow = false;
  for (let round = 0; round < cap; round++) {
    if (agentGen() !== loopGen) throw new AgentAbortError("replaced");
    throwIfAborted();
    harness = { ...harness, used: { ...harness.used, rounds: round + 1 } };
    opts?.onHarness?.(harnessBar(harness));
    await pack();
    let choice: LlmChoice;
    try {
      choice = await complete(messages, true, opts?.onDelta);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      if (isAbortLike(err) || /Gestoppt|replaced|Neustart/i.test(msg)) throw err;
      throwIfAborted();
      if (nudged < 2 && /stall|leer|hang|network|Failed to fetch|ECONNRESET/i.test(msg)) {
        nudged += 1;
        messages.push({
          role: "user",
          content: say(
            "Verbindung weg. Nicht von vorn. Nächstes Tool: write_file, append_file, edit_file oder read_file.",
            "Connection dropped. Do not start over. Next tool: write_file, append_file, edit_file, or read_file.",
          ),
        });
        continue;
      }
      throw err;
    }
    if (choice.usage) {
      usage = {
        prompt: usage.prompt + choice.usage.prompt,
        completion: usage.completion + choice.usage.completion,
      };
    }
    if (choice.tool_calls?.length) {
      choice.tool_calls = stampToolCalls([{ tool_calls: choice.tool_calls }])[0]?.tool_calls as ToolCall[];
    }
    messages.push(choice as Record<string, unknown>);
    const harvested = harvestTools(`${choice.content || ""}\n${choice.reasoning || ""}`);
    let toolCalls = (choice.tool_calls?.length ? choice.tool_calls : harvested) ?? [];
    if (harvested.length && !choice.tool_calls?.length) {
      void import("./model-caps").then((m) => m.noteHarvest());
    }
    if (choice.tool_calls?.length) {
      void import("./model-caps").then((m) => m.noteToolSuccess(true));
    }
    if (!toolCalls.length) {
      const text = choice.content?.trim() || "";
      if (isToolTemplateEcho(text) || isToolTemplateEcho(choice.reasoning || "")) {
        return packResult(say("Das Modell hat das Tool-Schema nachgeschrieben statt ein Tool aufzurufen. Bei Qwen + llama.cpp: Denken auf aus, nochmal senden.", "The model echoed the tool schema instead of calling a tool. For Qwen + llama.cpp: turn thinking off and send again."));
      }
      const blocks = observeOnly ? [] : extractFileBlocks(text);
      if (blocks.length) {
        toolCalls = blocksToWriteCalls(blocks, round);
      }
    }
    if (!toolCalls.length) {
      const text = choice.content?.trim() || "";
      const ask = String(data.messages.filter((m) => m.role === "user").at(-1)?.content ?? "");
      const open = observeOnly ? false : jobOpen({ ask, used, text });
      const wrote = used.some((n) => /write_file|append_file|edit_file/.test(n));
      const ran = used.some((n) => /run_file|engine_run/.test(n));
      const tiny = text.length < 24 && !(choice.reasoning || "").trim();
      const thinkOnly = text.length < 80 && (choice.reasoning || "").length > 80;
      if (tiny || thinkOnly) emptyHits += 1;
      else emptyHits = 0;
      if (observeOnly) {
        if ((tiny || thinkOnly) && nudged < 2 && round + 1 < cap) {
          nudged += 1;
          messages.push({
            role: "user",
            content: say("Nur lesen. read_file oder grep, dann kurz erklären.", "Read-only. Call read_file or grep, then explain briefly."),
          });
          continue;
        }
        return packResult(text || say("Fertig.", "Done."));
      }
      const must = open || looksStoppedEarly(choice) || looksLikeNoTools(text) || emptyHits === 1;
      if (emptyHits >= 2) {
        return packResult(text || say("Modell hat ohne Tool aufgehört.", "Model stopped without a tool."));
      }
      if (must && askPickedNone(ask)) {
        return packResult(text || say("Fertig.", "Done."));
      }
      if (must && nudged < 3 && round + 1 < cap) {
        nudged += 1;
        const runAt = pickRunPath(files.keys());
        messages.push({
          role: "user",
          content: !wrote
            ? say("Kein Text ohne Tool. Jetzt write_file oder edit_file.", "No prose without a tool. Now write_file or edit_file.")
            : !ran
              ? say(
                  `Dateien liegen. Jetzt run_file({"path":"${runAt || "main.cpp"}"}). Kein harness_write.`,
                  `Files are in place. Now run_file({"path":"${runAt || "main.cpp"}"}). No harness_write.`,
                )
              : say("Auftrag offen. Nächstes Tool, kein Plansatz.", "Job still open. Next tool, no plan sentence."),
        });
        continue;
      }
      return packResult(text || say("Fertig.", "Done."));
    }
    if (!observeOnly && toolCalls.length) {
      const names = toolCalls.map((c) => c.function.name);
      const wroteNow = names.some((n) => /write_file|append_file|edit_file/.test(n));
      const ranNow = names.some((n) => /run_file|engine_run/.test(n));
      const mode = effectiveAfterWrite(hopts);
      if (wroteNow && !ranNow && hopts.runLoop && mode === "run") {
        const written: string[] = [];
        for (const tc of toolCalls) {
          if (!/write_file|append_file|edit_file/.test(tc.function.name)) continue;
          try {
            const p = String(parseToolArgs(tc.function.arguments || "{}").args.path ?? "");
            if (p && !skipAutoRunPath(p)) written.push(p);
          } catch {
            /* */
          }
        }
        const hint = written.at(-1) || "";
        const path = hint ? pickRunPath([...files.keys(), ...written], hint) : "";
        if (path) {
          toolCalls = [
            ...toolCalls,
            {
              id: `call_auto_run_${round}`,
              type: "function",
              function: { name: "run_file", arguments: JSON.stringify({ path }) },
            },
          ];
        }
      }
    }
    const lastAsst = messages.at(-1);
    if (lastAsst && lastAsst.role === "assistant") lastAsst.tool_calls = toolCalls;
    let batchFail = false;
    for (let ti = 0; ti < toolCalls.length; ti++) {
      const tc = toolCalls[ti];
      let args: Record<string, unknown> = {};
      let argsCut = false;
      try {
        const parsed = parseToolArgs(tc.function.arguments || "{}");
        args = parsed.args;
        argsCut = parsed.truncated;
      } catch {
        args = {};
        argsCut = true;
      }
      if (argsCut) args.truncated = true;
      used.push(tc.function.name);
      opts?.onToolStart?.({ name: tc.function.name, args });
      const blocked =
        (observeOnly && mutateTool(tc.function.name)
          ? say(`Ask-Modus: kein ${tc.function.name}. Nur lesen.`, `Ask mode: no ${tc.function.name}. Read only.`)
          : null) ||
        surfaceBlockWrite(data.surfaceId || ANVIL_SURFACE, data.surfaceMode || "exclusive", tc.function.name) ||
        (!toolsAllowed(data.surfaceId || ANVIL_SURFACE, data.surfaceMode || "exclusive", tc.function.name)
          ? say(`Aktive Fläche ist MCP. Kein ${tc.function.name}. Nutze mcp_call oder Brücke.`, `Active surface is MCP. No ${tc.function.name}. Use mcp_call or a bridge.`)
          : null);
      const denied =
        !blocked &&
        strictAllow &&
        allow.length > 0 &&
        !allow.includes(tc.function.name) &&
        !observeTool(tc.function.name) &&
        tc.function.name !== "set_plan" &&
        tc.function.name !== "ask_user" &&
        !tc.function.name.startsWith("mcp_");
      let result: unknown;
      let event: WorkspaceEvent | undefined;
      let command: AgentCommand | undefined;
      let writes: Record<string, string> | undefined;
      if (blocked) {
        result = { error: blocked };
      } else if (batchFail && mutateTool(tc.function.name)) {
        result = { error: say("Vorheriges Tool fehlgeschlagen — Rest übersprungen.", "Previous tool failed — remaining writes skipped.") };
      } else if (denied) {
        result = { error: `Harness budget: only ${allow.join(", ")}` };
      } else if (tc.function.name === "read_file") {
        const p = String(args.path || "");
        const key = readKey(p, Number(args.start_line) || 1);
        if (p && key === lastRead) lastReadN += 1;
        else {
          lastRead = key;
          lastReadN = 1;
        }
        if (lastReadN >= 3) {
          result = { error: say(`"${p}" schon ${lastReadN}× in diesem Fenster gelesen. start_line weitersetzen oder write_file / edit_file.`, `"${p}" already read at this window ${lastReadN}×. Continue with a new start_line, or write_file / edit_file.`) };
        } else {
          const applied = applyTool(tc.function.name, args, files, runPaths, dirs, deleted, data.git);
          result = applied.result;
          event = applied.event;
          command = applied.command;
          writes = applied.writes;
        }
      } else {
        lastRead = "";
        lastReadN = 0;
        const applied = applyTool(tc.function.name, args, files, runPaths, dirs, deleted, data.git);
        result = applied.result;
        event = applied.event;
        command = applied.command;
        writes = applied.writes;
      }
      let frame: string | undefined;
      if (command) {
        try {
          result = await runCommand(command, files, dirs, deleted, opts);
          if (result && typeof result === "object" && result !== null && "image" in result) {
            const img = (result as { image?: unknown }).image;
            if (typeof img === "string" && img.startsWith("data:image")) frame = img;
            const copy = { ...(result as Record<string, unknown>) };
            delete copy.image;
            if (frame) copy.frame = "canvas";
            result = copy;
          }
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
      } else if (result && typeof result === "object" && "fetch" in result && opts?.fetchUrl) {
        try {
          result = { text: await opts.fetchUrl(String((result as { fetch: string }).fetch)) };
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (writes && opts?.onWorkspace) {
        for (const [path, content] of Object.entries(writes)) {
          try {
            await opts.onWorkspace({ op: "write", path, content });
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err), result };
          }
        }
      }
      if (event && opts?.onWorkspace && event.op !== "write") {
        try {
          await opts.onWorkspace(event);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err), result };
        }
      } else if (event && !writes && opts?.onWorkspace) {
        try {
          await opts.onWorkspace(event);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err), result };
        }
      }
      opts?.onTool?.({ name: tc.function.name, args, result: frame ? { ...(result as object), image: frame } : result });
      const rec = result && typeof result === "object" ? { ...(result as Record<string, unknown>) } : {};
      if (args.path && rec.path == null) rec.path = String(args.path);
      if (tc.function.name === "shell" && args.command && rec.command == null) rec.command = String(args.command);
      if (mutateTool(tc.function.name) && (rec.error || rec.ok === false)) batchFail = true;
      const w = afterTool(harness, tc.function.name, rec, {
        ...hopts,
        engineOk: data.engineOk ?? Boolean(hit),
        edges: projG?.edges,
        queued: toolCalls.slice(ti + 1).map((c) => c.function.name),
      });
      harness = w.state;
      allow = w.allow;
      strictAllow = Boolean(w.strict);
      opts?.onHarness?.(harnessBar(harness));
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: packToolContent(tc.function.name, result),
      });
      if (tc.function.name === "ask_user" && rec.ok && rec.ask && typeof rec.ask === "object") {
        const ask = rec.ask as JobAsk;
        return packResult([ask.prompt, ask.why].filter(Boolean).join("\n"), { ask, parked: true });
      }
      if (rec.truncated && (tc.function.name === "write_file" || tc.function.name === "append_file")) {
        messages.push({
          role: "user",
          content: say(
            `write ${String(rec.path ?? args.path ?? "")} abgeschnitten. Jetzt append_file mit dem Rest — Datei nicht neu erfinden.`,
            `write ${String(rec.path ?? args.path ?? "")} truncated. Now append_file with the rest — do not rewrite the file.`,
          ),
        });
      }
      if (tc.function.name === "skill_run" && rec.body) {
        messages.push({
          role: "user",
          content: say(
            `SKILL ${String(rec.skill ?? args.name ?? "")}:\n${String(rec.body)}\nDiese Schritte jetzt mit Tools. Ende mit skill_outcome ok oder fail.`,
            `SKILL ${String(rec.skill ?? args.name ?? "")}:\n${String(rec.body)}\nFollow these steps with tools now. End with skill_outcome ok or fail.`,
          ),
        });
      }
      if ((tc.function.name === "skill_write" || tc.function.name === "skill_debug" || tc.function.name === "skill_patch") && Array.isArray(rec.issues) && rec.issues.length) {
        messages.push({
          role: "user",
          content: `Skill debug: ${rec.issues.join("; ")}. Fix with skill_patch/skill_write.`,
        });
      }
      if (w.inject) {
        const prev = messages.at(-1);
        if (!(prev?.role === "user" && prev.content === w.inject)) messages.push({ role: "user", content: w.inject });
      }
      if (/^(run_file|engine_run|shell)$/.test(tc.function.name)) {
        const bad = rec.ok === false || Boolean(rec.error) || (typeof rec.stderr === "string" && rec.stderr.trim() && rec.ok !== true);
        if (bad) {
          const nextFail = String(rec.error || rec.stderr || rec.stdout || "");
          const same = lastFail && scrubRunError(lastFail).slice(0, 180) === scrubRunError(nextFail).slice(0, 180);
          lastFail = nextFail;
          if (round + 1 < cap && !w.inject) {
            messages.push({
              role: "user",
              content: same
                ? say(
                    "Gleicher Run-Fehler zum zweiten Mal. Anderen Patch oder ask_user — denselben Befehl nicht nochmal.",
                    "Same run error twice. Different patch or ask_user — do not rerun the same command.",
                  )
                : runFailHint(lastFail, [...files.keys()]),
            });
          }
        } else {
          lastFail = "";
        }
      }
      if (w.stop) stopAfter = true;
      if (tc.function.name === "harness_write" || tc.function.name === "graph_write" || tc.function.name.startsWith("board_")) {
        const recFiles = Object.fromEntries(files);
        projH = loadProjectHarness(recFiles);
        projG = loadProjectGraph(recFiles);
        hopts = mergeOpts(
          {
            runLoop: data.runLoop ?? false,
            graphLoop: data.graphLoop ?? false,
            testLoop: data.testLoop,
            engineLoop: data.engineLoop,
            loopTries: data.loopTries ?? 3,
            afterWrite: data.afterWrite,
            maxRounds: data.maxRounds,
            graphSees: data.graphSees,
          },
          projH,
        );
      }
      if (frame) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: say("Graph-Frame nach Run/Play. Kurz sagen, was du siehst. Bug → patchen und run_file/play.", "Graph frame after run/play. Say briefly what you see. Bug → patch and run_file/play again.") },
            { type: "image_url", image_url: { url: frame } },
          ],
        });
        pruneGraphFrames(messages, 2);
      }
    }
    if (stopAfter) {
      const last = await complete(messages, true, opts?.onDelta);
      if (last.usage) {
        usage = {
          prompt: usage.prompt + last.usage.prompt,
          completion: usage.completion + last.usage.completion,
        };
      }
      const extra = extractFileBlocks(last.content ?? "");
      for (const b of extra) {
        files.set(b.path, b.content);
        if (opts?.onWorkspace) await opts.onWorkspace({ op: "write", path: b.path, content: b.content });
      }
      return packResult(last.content?.trim() || "Änderungen übernommen.");
    }
  }

  void import("./intern").then((m) => m.note("agent", lastFail ? "Runden-Limit nach Fehler" : "Maximale Tool-Runden erreicht"));
  const clean = lastFail ? scrubRunError(lastFail) : "";
  return packResult(
    lastFail
      ? `Runden-Limit. Letzter Fehler:\n${clean}\nNoch einmal senden — fehlende Datei anlegen oder den Bundler anpassen. Nicht von vorn.`
      : "Runden-Limit. Auftrag nicht zu Ende. Noch einmal senden, nicht von vorn.",
    { ok: !lastFail, error: lastFail ? clean : "Runden-Limit" },
  );
}

function pruneGraphFrames(messages: Record<string, unknown>[], keep: number) {
  const idx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "user") continue;
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    const text = c.find((p) => p && typeof p === "object" && (p as { type?: string }).type === "text") as { text?: string } | undefined;
    if (String(text?.text ?? "").startsWith("Graph-Frame")) idx.push(i);
  }
  const drop = idx.slice(0, Math.max(0, idx.length - keep));
  for (let i = drop.length - 1; i >= 0; i--) messages.splice(drop[i], 1);
}

async function runCommand(
  command: AgentCommand,
  files: Map<string, string>,
  dirs: Set<string>,
  deleted: string[],
  opts?: {
    fetchUrl?: (url: string) => Promise<string>;
    onWorkspace?: (ev: WorkspaceEvent) => void | Promise<void>;
    formatFile?: (path: string, content: string) => Promise<string>;
    gitClone?: (url: string) => Promise<AgentFile[]>;
    gitPush?: (message: string, files: Record<string, string>) => Promise<{ sha: string; repo: string }>;
    gitStatus?: () => Promise<unknown>;
    gitCommit?: (message: string) => Promise<unknown>;
    shell?: (command: string, files: Record<string, string>) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
    debug?: (action: string, args: Record<string, unknown>) => Promise<unknown>;
    learn?: (action: string, args: Record<string, unknown>) => Promise<unknown>;
    mcp?: (action: "list" | "call", server?: string, name?: string, args?: unknown) => Promise<unknown>;
    engine?: (action: "status" | "run", args?: Record<string, unknown>) => Promise<unknown>;
    runFile?: (path: string, files: Record<string, string>) => Promise<unknown>;
    play?: (keys: string[], hold?: number) => Promise<unknown>;
    see?: () => Promise<unknown>;
  },
): Promise<unknown> {
  throwIfAborted();
  if (command.cmd === "fetch") {
    if (!opts?.fetchUrl) return { error: "fetch not available" };
    return { text: (await opts.fetchUrl(command.url)).slice(0, 8000) };
  }
  if (command.cmd === "format") {
    const cur = files.get(command.path);
    if (cur == null) return { error: `not found: ${command.path}` };
    if (!opts?.formatFile) return { error: "format not available" };
    const content = await opts.formatFile(command.path, cur);
    files.set(command.path, content);
    if (opts.onWorkspace) await opts.onWorkspace({ op: "write", path: command.path, content });
    return { ok: true, path: command.path };
  }
  if (command.cmd === "git_status") {
    if (!opts?.gitStatus) return { error: "git not available" };
    return await opts.gitStatus();
  }
  if (command.cmd === "git_commit") {
    if (!opts?.gitCommit) return { error: "git not available" };
    const r = await opts.gitCommit(command.message);
    if (r && typeof r === "object" && (r as { ok?: boolean }).ok !== false && opts.onWorkspace) {
      await opts.onWorkspace({ op: "commit", message: command.message });
    }
    return r;
  }
  if (command.cmd === "git_clone") {
    if (!opts?.gitClone) return { error: "clone not available" };
    const incoming = await opts.gitClone(command.url);
    const wiped = applyGitClone(files, dirs, deleted, incoming, Boolean(command.replace));
    if (opts.onWorkspace) {
      for (const p of wiped) await opts.onWorkspace({ op: "delete", path: p });
      for (const f of incoming) await opts.onWorkspace({ op: "write", path: f.path, content: f.content });
    }
    return { ok: true, files: incoming.length, replaced: Boolean(command.replace), kept: files.size - incoming.length };
  }
  if (command.cmd === "git_push") {
    if (!opts?.gitPush) return { error: "push not available" };
    const map = Object.fromEntries(files);
    const r = await opts.gitPush(command.message, map);
    const rec = r && typeof r === "object" ? (r as { sha?: string; error?: string }) : null;
    if (rec?.sha && !rec.error && opts.onWorkspace) {
      await opts.onWorkspace({ op: "commit", message: command.message });
    }
    return r;
  }
  if (command.cmd === "shell") {
    if (!opts?.shell) return { error: "shell not available" };
    return await opts.shell(command.command, Object.fromEntries(files)).then((r) =>
      r && typeof r === "object" ? { ...r, command: command.command } : r,
    );
  }
  if (command.cmd === "debug") {
    if (!opts?.debug) return { error: "debug not available (local model / browser agent)" };
    return await opts.debug(command.action, command.args);
  }
  if (command.cmd === "learn") {
    if (!opts?.learn) return { error: "learn not available" };
    return await opts.learn(command.action, command.args);
  }
  if (command.cmd === "mcp") {
    if (!opts?.mcp) return { error: "Kein MCP-Server in Einstellungen." };
    const r = await opts.mcp(command.action, command.server, command.name, command.args);
    if (r && typeof r === "object" && (r as { isError?: boolean }).isError) {
      return { error: String((r as { text?: string }).text || "MCP-Toolfehler") };
    }
    return r ?? { ok: true };
  }
  if (command.cmd === "engine") {
    if (!opts?.engine) return { error: "engine companion not wired" };
    return await opts.engine(command.action, command.args);
  }
  if (command.cmd === "run") {
    if (!opts?.runFile) return { error: "run not available" };
    return await opts.runFile(command.path, Object.fromEntries(files));
  }
  if (command.cmd === "play") {
    if (!opts?.play) return { error: "play not available" };
    return await opts.play(command.keys, command.hold);
  }
  if (command.cmd === "see") {
    if (!opts?.see) return { error: "see_run not available" };
    return await opts.see();
  }
  return { error: "unknown command" };
}
