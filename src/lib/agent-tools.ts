import { MAX_PLAN_STEPS } from './plan-limits.ts';

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
  tool("select_tools", "Find and load permitted native tools, MCP schemas or skills for a task. Use query and scope; names loads exact native names. Discovery executes nothing. Results are paginated; skill bodies require skill_read.", {
    names: { type: "array", items: { type: "string" }, maxItems: 6 }, query: {type:'string'},
    scope:{type:'string',enum:['all','tools','mcp','skills']},server:{type:'string'},cursor:{type:'string'},limit:{type:'integer'},
    refresh:{type:'boolean',description:'Refresh only the queried MCP connections when the cached catalog is stale or changed.'},
  }),
  tool("list_files", "List workspace paths, including native program results on disk. Optional glob substring, prefix folder, offset for the next page.", {
    glob: { type: "string" },
    prefix: { type: "string" },
    offset: { type: "integer" },
  }),
  tool("read_file", "Read a file. If the result says start_line, continue that path. Never rewrite because a read was long.", {
    path: { type: "string" },
    start_line: { type: "integer" },
    end_line: { type: "integer" },
  }, ["path"]),
  tool("verify_file", "Verify a saved file in the local workspace on disk. Returns SHA-256, size and PNG dimensions. Use for file evidence after an export or render; optional width and height test exact PNG dimensions. Does not execute or change the file.", {
    path: { type: "string", maxLength: 511 },
    width: { type: "integer", minimum: 1, maximum: 2147483647 },
    height: { type: "integer", minimum: 1, maximum: 2147483647 },
  }, ["path"]),
  tool("review_read_baseline", "Read an immutable comparison-baseline window for the explicitly bound review. This is separate from read_file on the current file, including deleted files. Continue all windows before claiming baseline coverage. Available only for a known review request.", {
    path: { type: "string", maxLength: 1024 },
    start_line: { type: "integer", minimum: 1 },
    end_line: { type: "integer", minimum: 1 },
  }, ["path"]),
  tool("review_submit", "Record a partial review report for the explicitly bound review. Native read evidence verifies exact content and complete windows; model-supplied evidence cannot certify coverage. Missing files remain open. Metadata only: no source writes, automatic approval, test result or task-completion gate.", {
    reviewId: { type: "string", maxLength: 128 },
    files: { type: "array", maxItems: 500, items: { type: "object", additionalProperties: false, required: ["path", "status"], properties: {
      path: { type: "string", maxLength: 1024 }, status: { type: "string", enum: ["reviewed", "skipped"] },
      reason: { type: "string", maxLength: 1200 }, findings: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["line", "title", "detail"], properties: {
        line: { type: "integer", minimum: 1, maximum: 2000000 }, title: { type: "string", maxLength: 240 }, detail: { type: "string", maxLength: 3000 },
      } } },
    } } },
  }, ["reviewId", "files"]),
  tool("read_tool_output", "Read the complete retained JSON of a large tool result from this task. Follow nextOffset until null. Handles expire after the task or eviction; never repeat an external action just to retrieve its output.", {
    output_id: { type: "string" },
    offset: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 256, maximum: 24000 },
  }, ["output_id"]),
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
  tool("play", "Interact with the current HTML preview and observe the result. For a function test, derive the expected result from the task BEFORE acting, then combine an input with an assert action for that result. run_file/see_run return controls in elements and status/counter/table outputs in observations, with actual selectors and current values. Current values alone do not define a test expectation. Use keys for sequential shortcuts (Space, s, u, r, Delete, Tab, Enter, arrows); semantic left/right/up/down/ok follow input settings. Or use actions for mouse, text and assertions. Selectors must match one visible enabled element; x/y are CSS pixels from the preview viewport top-left, never desktop coordinates. keys run first, then actions. assert supports expected text/value/count/checked/visible. A delivered input alone is not a passed function test. No OS/engine control, clipboard shortcuts or file pickers.", {
    keys: { type: "array", items: { type: "string" }, maxItems:32 },
    hold_ms: { type: "number", minimum:0, maximum:1000, description:'Hold each keys entry, default 90 ms.' },
    actions: {type:'array',maxItems:32,description:'1–32 total keys/actions, at most 10 seconds of holds/waits. Stops at first failure; never automatically replays.',items:{type:'object',required:['type'],additionalProperties:false,properties:{
      type:{type:'string',enum:['key','click','move','drag','scroll','type','assert','wait']},
      selector:{type:'string',description:'CSS selector in the preview. Mouse: center of the element; key/type: focus this element. assert: expected target.'},
      x:{type:'number'},y:{type:'number'},
      key:{type:'string'},modifiers:{type:'array',items:{type:'string',enum:['Control','Shift','Alt','Meta']}},hold_ms:{type:'number',minimum:0,maximum:1000},
      button:{type:'string',enum:['left','middle','right']},count:{type:'integer',description:'click: 1 or 2. assert: expected matching element count.'},
      to_selector:{type:'string',description:'drag destination in the same viewport; alternatively to_x/to_y.'},to_x:{type:'number'},to_y:{type:'number'},duration_ms:{type:'number',minimum:0,maximum:1000},
      delta_x:{type:'number'},delta_y:{type:'number',description:'scroll: positive moves down, negative up.'},
      text:{type:'string',description:'type: insert explicit text (max 4000 chars). assert: exact trimmed visible text.'},
      value:{type:'string',description:'assert: exact field value.'},checked:{type:'boolean'},visible:{type:'boolean'},
      timeout_ms:{type:'number',minimum:0,maximum:3000,description:'assert: wait up to this duration for the expectation.'},
      ms:{type:'number',minimum:0,maximum:1000,description:'wait duration.'},
    }}},
  }),
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
  tool("shell", "Run a limited project command: python <file>, node <file>, node --test <project-test-file>, npm test, pytest [-q] [-k name], python -m pytest, go test, cargo test, dotnet test. Node test paths must be existing local snapshot files; no arbitrary runtime flags. Use read_file for file contents, never cat/head. Pipes, redirection and command chaining are unsupported.", {
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
  tool("skill_outcome", "Optionally record the agent's report about the last applied skill: ok, fail, reject. This is not independent task verification and does not change instructions or permissions.", {
    kind: { type: "string" },
  }, ["kind"]),
  tool("set_plan", "Create a checklist with steps/kinds or update its existing numbered steps. Preserve locked steps and every explicit user requirement. In new steps use the full workspace-relative file paths for outputs in a folder named by the user. For each completed step attach current evidence IDs that prove its own result. For an unclassified test use kind check. If an update is refused, address its specific cause once or leave it open and perform the next distinct test. Reconcile before the final answer.", {
    steps: { type: "array", maxItems: MAX_PLAN_STEPS, items: { type: "string" } },
    kinds: { type: "array", maxItems: MAX_PLAN_STEPS, items: { type: "string", enum: ["read", "edit", "run", "check", "service", "report"] } },
    updates: { type: "array", maxItems: 10, items: { type: "object", properties: {
      step: { type: "integer", description: "Existing 1-based step number." },
      status: { type: "string", enum: ["todo", "run", "ok", "err"] },
      kind: { type: "string", enum: ["read", "edit", "run", "check", "service", "report"], description: "Existing step type or the type of an unclassified step. Use check for testing a function or asserting a preview result." },
      evidence: { type: "array", items: { type: "string" }, description: "Actual plan_evidence_id values for this step only. An expected rejection needs the exact observed test result." },
      reason: { type: "string", description: "What the tool verified, or the concrete blocker if still open." },
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
