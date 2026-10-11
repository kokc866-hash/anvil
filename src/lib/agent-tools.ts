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
  tool("select_tools", "List available tools with names:[]; choose up to 6 names for the next request. Does not execute them.", { names: { type: "array", items: { type: "string" }, maxItems: 6 } }, ["names"]),
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
  tool("write_file", "Create a new file. Replacing an existing file requires overwrite_reason explaining why the task needs a whole-file replacement. For partial changes, use edit_file and preserve unrelated content, including asset dimensions and geometry. If truncated, append_file — do not rewrite.", {
    path: { type: "string" },
    content: { type: "string" },
    overwrite_reason: { type: "string", description: "Required only when changing an existing file in full: why the user's task needs replacement instead of a focused edit. Not needed for new files or identical content." },
  }, ["path", "content"]),
  tool("append_file", "Append text to an existing file (or create). Use when write_file was truncated or to add at the end.", {
    path: { type: "string" },
    content: { type: "string" },
  }, ["path", "content"]),
  tool("edit_file", "Make a focused change to an existing file. Read it first, then replace the smallest exact unique snippet; preserve unrelated content and asset properties. old_string must be unique unless replace_all is needed for the requested change.", {
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
  tool("run_file", "Run an executable workspace entry: HTML/Python/JS/TS/Go/Rust/C/C++/Java/C#/PHP/Ruby. Native languages compile then run. Never run Markdown, JSON, headers, ref/ or .anvil/ files. After source edits, run the program entry. On failure inspect stderr and exit code before changing source.", {
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
    expected_exit_code: { type: "integer", description: "Optional explicit expected process exit code (0..255) for a requested negative test. Requires a runner returning an actual exit code. Never use to hide an unexpected failure; prefer assertions in a test script when unsupported." },
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
  tool("skill_list", "List available Anvil, project and imported skills. Skills are instructions, not additional tool permissions.", {}),
  tool("skill_write", "Create or update a skill. Use after a reusable multi-step workflow succeeded. Default scope: current project.", {
    scope: { type: "string", enum: ["user", "project"] },
    name: { type: "string" },
    when: { type: "string", description: "When to use this skill" },
    body: { type: "string", description: "Concrete steps" },
    kind: { type: "string", description: "guide or plugin" },
  }, ["name", "when", "body"]),
  tool("skill_read", "Read a skill body. For a bundled reference, pass its exact relative resource path from resources. Read only references needed for the task.", { name: { type: "string" }, resource: { type: "string" } }, ["name"]),
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
  tool("set_plan", "Create checklist with steps/kinds; update status with updates and evidence IDs. Reconcile before final answer. Use 3-7 steps in the user's language, kinds read/edit/run/check/service/report. Keep checking and launching separate. Updates preserve existing steps, including locked user checklists. Completion needs matching successful tool evidence from the current checklist context.", {
    criteria: { type: "array", minItems: 1, maxItems: 64, description: "Define binding acceptance criteria BEFORE changes or execution. Use JSON numbers for counts and booleans for existence, not quoted strings. A completed checklist does not pass these checks. Executed checkers must emit anvil_acceptance.observations containing criterion, actual, artifact (real report file in the owning project) and sha256 (computed SHA-256 of its saved bytes). No invented digests or placeholder labels. Existing criteria cannot be removed or relaxed.", items: { type: "object", properties: {
      id: { type: "string" }, label: { type: "string" }, required: { type: "boolean", default: true },
      operator: { type: "string", enum: ["eq", "lte", "gte"] }, expected: { type: ["number", "boolean", "string"], description: "Exact JSON type is binding: 1 is a number, true is boolean; quoted values are text." },
      tolerance: { type: "number", minimum: 0, description: "Absolute tolerance, numeric eq only." }, unit: { type: "string" },
    }, required: ["id", "label", "operator", "expected"] } },
    criteria_change_reason: { type: "string", description: "Required for an amendment proposal. The proposal is recorded visibly; original limits remain binding for this task." },
    steps: { type: "array", items: { type: "string" } },
    kinds: { type: "array", items: { type: "string", enum: ["read", "edit", "run", "check", "service", "report"] } },
    updates: { type: "array", maxItems: 10, items: { type: "object", properties: {
      step: { type: "integer", description: "Existing 1-based step number." },
      status: { type: "string", enum: ["todo", "run", "ok", "err"] },
      kind: { type: "string", enum: ["read", "edit", "run", "check", "service", "report"] },
      evidence: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
    }, required: ["step", "status", "reason"] } },
  }),
  tool("ask_user", "Ask the user a question with 2–5 options. Use when a choice, missing fact, or risky write needs a decision. Do not guess. After the answer, continue the same job.", {
    prompt: { type: "string" },
    why: { type: "string" },
    choices: { type: "array", items: { type: ["string", "object"] } },
    allow_text: { type: "boolean" },
    recommended: { type: "string" },
    blocking: { type: "string", description: "hard | soft" },
  }, ["prompt"]),
  tool("mcp_list", "Discover configured MCP servers, tools with argument schemas, and resources. Use query/server and next_cursor to narrow or continue a large catalog.", {
    server: { type: "string" }, query: { type: "string" }, cursor: { type: "string" }, limit: { type: "number" },
  }),
  tool("mcp_call", "Call a tool on a configured MCP server.", {
    server: { type: "string" },
    name: { type: "string" },
    arguments: { type: "object", additionalProperties: true },
  }, ["server", "name"]),
  tool("mcp_read_resource", "Read an MCP resource URI from a configured server, including concrete URIs from resource templates.", {
    server: { type: "string" }, uri: { type: "string" },
  }, ["server", "uri"]),
  tool("mcp_read_output", "Read a retained large MCP result in character pages. Continue with next_offset; never repeat the external action just to read its output.", {
    id: { type: "string" }, offset: { type: "number" }, limit: { type: "number" },
  }, ["id"]),
  tool("engine_detect", "Detect Godot/Unity/Unreal/Bevy/… in the workspace. Games run in those engines, not inside Anvil.", {}),
  tool("engine_status", "Ping the local engine companion (HTTP). Returns binaries if running.", {}),
  tool("engine_run", "Run an explicitly supported engine action in a saved project via companion. Use engine_detect first. Multiple projects require engine + projectRoot. A running editor is not a passed test. action: play|check|editor|test or cmd.", {
    action: { type: "string" },
    engine: { type: "string", description: "Engine id from engine_detect, e.g. unity, unreal, godot." },
    projectRoot: { type: "string", description: "Exact relative root from engine_detect; empty string for workspace root." },
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
  tool("graph_write", "Rebuild .anvil/graph.json from workspace sources, or replace the whole graph with edges (an empty array clears it). fromSources:true ignores old edges. when is a description only; phase, condition and dependsOn are typed metadata. Never grants tools or enables automatic execution. Preserve recipe id/version when using a versioned recipe.", {
    name: { type: "string" },
    version: { type: "integer", enum: [1] },
    recipes: {
      type: "array", maxItems: 64,
      items: { type: "object", properties: { id: { type: "string" }, version: { type: "integer", minimum: 1 } }, required: ["id", "version"], additionalProperties: false },
    },
    fromSources: { type: "boolean" },
    edges: {
      type: "array", maxItems: 256,
      items: {
        type: "object",
        properties: {
          when: { type: "string" },
          edge: { type: "string" },
          tool: { type: "string" },
          glob: { type: "string" },
          id: { type: "string", description: "Unique stable node id." },
          phase: { type: "string", enum: ["plan", "act", "observe", "patch", "see", "engine", "done", "abort"] },
          condition: { type: "string", enum: ["changed", "success", "failure", "tests-passed", "manual"] },
          args: { type: "object", additionalProperties: true },
          dependsOn: { type: "array", items: { type: "string" }, uniqueItems: true, description: "Existing node ids whose current results must be confirmed; cycles are rejected." },
          enabled: { type: "boolean" },
        },
        required: ["when", "edge"],
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


export const AGENT_TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.function.name));
