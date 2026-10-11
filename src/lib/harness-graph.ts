import { effectiveAfterWrite, type Observation, type HarnessOpts, type HarnessPhase } from "./harness.ts";

export type GraphEdge =
  | "none"
  | "preview"
  | "play"
  | "engine"
  | "test"
  | "run"
  | "format"
  | "lint"
  | "debug"
  | "mcp"
  | "skill"
  | "git";

export type GraphPolicy = {
  edge: GraphEdge;
  tool: string | null;
  why: string;
  id?: string;
  args?: Record<string, unknown>;
};

export type ProjectEdge = {
  when: string;
  edge: GraphEdge;
  tool?: string;
  glob?: string;
  id?: string;
  phase?: HarnessPhase;
  condition?: "changed" | "success" | "failure" | "tests-passed" | "manual";
  args?: Record<string, unknown>;
  dependsOn?: string[];
  enabled?: boolean;
};

export type GraphContext = {
  phase?: HarnessPhase;
  /** Only successful prerequisites whose input proofs remain current. */
  completed?: ReadonlySet<string>;
  remainingSees?: number;
  testsPassed?: boolean;
};

export type GraphTool = {
  id: string;
  label: string;
  edge: Exclude<GraphEdge, "none">;
  glob?: string;
  group: string;
  hint: string;
};

/** Beobachtungs-Tools für Graph-Kanten — nicht nur see/play/engine. */
export const GRAPH_TOOLS: GraphTool[] = [
  { id: "run_file", label: "Run", edge: "run", glob: "*.{py,js,ts,go,rs,c,cpp,java,cs,php,rb}", group: "Run", hint: "Datei ausführen" },
  { id: "shell", label: "Shell / Tests", edge: "test", glob: "tests/**", group: "Run", hint: "npm test, pytest, …" },
  { id: "see_run", label: "Frame", edge: "preview", glob: "*.html", group: "Sehen", hint: "HTML-Snapshot" },
  { id: "play", label: "Tasten + Frame", edge: "play", glob: "*.html", group: "Sehen", hint: "Eingabe, dann Bild" },
  { id: "open_preview", label: "Preview", edge: "preview", glob: "*.{html,md}", group: "Sehen", hint: "Vorschau öffnen" },
  { id: "format_file", label: "Format", edge: "format", glob: "*.{js,ts,tsx,json,md,html}", group: "Qualität", hint: "Vor Commit formatieren" },
  { id: "grep", label: "Suche", edge: "lint", glob: "src/**", group: "Qualität", hint: "Treffer prüfen" },
  { id: "debug_start", label: "Debug", edge: "debug", glob: "*.{py,js,ts}", group: "Debug", hint: "Debugger starten" },
  { id: "debug_state", label: "Debug-Stand", edge: "debug", group: "Debug", hint: "Pause, Locals" },
  { id: "engine_run", label: "Engine", edge: "engine", glob: "*.{gd,cs,cpp,rs}", group: "Engine", hint: "Companion play/check" },
  { id: "engine_status", label: "Companion", edge: "engine", group: "Engine", hint: "Ping" },
  { id: "engine_detect", label: "Erkennen", edge: "engine", group: "Engine", hint: "Godot/Unity/…" },
  { id: "mcp_call", label: "MCP-Call", edge: "mcp", group: "Fremd", hint: "Fremdes Tool" },
  { id: "mcp_list", label: "MCP-Liste", edge: "mcp", group: "Fremd", hint: "Server-Tools" },
  { id: "skill_run", label: "Skill", edge: "skill", group: "Agent", hint: "Gespeicherter Ablauf" },
  { id: "git_status", label: "Git-Status", edge: "git", group: "Git", hint: "Dirty / Commits" },
  { id: "git_commit", label: "Commit", edge: "git", group: "Git", hint: "Nach grünem Run" },
];

const TOOL_IDS = new Set(GRAPH_TOOLS.map((t) => t.id));

const EDGE_RANK: Record<string, number> = {
  engine: 0,
  run: 1,
  test: 2,
  preview: 3,
  play: 4,
  debug: 5,
  format: 8,
  lint: 9,
  mcp: 10,
  skill: 11,
  git: 12,
};

const WORK_EDGES = new Set<GraphEdge>(["engine", "run", "test"]);
const SEE_EDGES = new Set<GraphEdge>(["preview", "play"]);

export function graphToolOf(id: string): GraphTool | undefined {
  return GRAPH_TOOLS.find((t) => t.id === id);
}

export function graphEdge(
  obs: Observation | undefined,
  opts: HarnessOpts,
  engineOk: boolean,
  projectEdges?: ProjectEdge[],
  context?: GraphContext,
): GraphPolicy {
  if (!obs) return { edge: "none", tool: null, why: "" };
  if (obs.kind === "read") return { edge: "none", tool: null, why: "" };
  if ((obs.kind === "write" || obs.kind === "edit") && (!obs.ok || effectiveAfterWrite(opts) === "none")) {
    return { edge: "none", tool: null, why: "" };
  }
  const seesLeft = Math.min(opts.graphSees ?? 4, context?.remainingSees ?? Infinity);

  if (opts.graphLoop && projectEdges?.length && obs.path) {
    const candidates = projectEdges.filter((e) => {
      if (e.edge === "engine" && !engineOk) return false;
      if (SEE_EDGES.has(e.edge) && seesLeft <= 0) return false;
      if (obs.image && coerceTool(e.tool, e.edge) === "see_run") return false;
      return true;
    });
    const hit = pickProjectEdge(obs.path, candidates, obs.kind, { ...context, observation: obs });
    if (hit && hit.edge !== "none") {
      const tool = coerceTool(hit.tool, hit.edge);
      return { edge: hit.edge, tool, why: `project graph: ${hit.when} → ${tool}`, ...(hit.id ? { id: hit.id } : {}), ...(hit.args ? { args: hit.args } : {}) };
    }
    if (projectEdges.some((e) => e.glob && matchGlob(obs.path!, e.glob))) {
      // Explicitly blocked/manual/completed project rules must not be bypassed by a generic fallback.
      return { edge: "none", tool: null, why: "" };
    }
  }

  if (opts.engineLoop && engineOk && (obs.kind === "write" || obs.kind === "edit") && looksEnginePath(obs.path)) {
    return { edge: "engine", tool: "engine_run", why: "engine script changed — companion check/play." };
  }

  if (!opts.graphLoop) return { edge: "none", tool: null, why: "" };

  if (obs.graphical && obs.ok && !obs.image && obs.kind === "run" && seesLeft > 0) {
    return { edge: "preview", tool: "see_run", why: "HTML preview — send a frame back to the model." };
  }

  return { edge: "none", tool: null, why: "" };
}

/** Legacy labels are descriptions. Only typed conditions determine execution. */
export function projectEdgeCondition(edge: ProjectEdge): NonNullable<ProjectEdge["condition"]> {
  if (edge.condition) return edge.condition;
  if (edge.phase === "plan" || edge.phase === "abort" || edge.edge === "mcp" || edge.edge === "skill") return "manual";
  if (edge.tool === "git_commit" || edge.phase === "done") return "tests-passed";
  if (edge.phase === "patch" || edge.edge === "debug") return "failure";
  if (edge.tool === "open_preview") return "changed";
  if (SEE_EDGES.has(edge.edge) || edge.edge === "git") return "success";
  return "changed";
}

export function isProjectEdgeReady(edge: ProjectEdge, observation: Observation, context?: GraphContext): boolean {
  if (edge.enabled === false || edge.edge === "none") return false;
  if (edge.id && context?.completed?.has(edge.id)) return false;
  if (edge.phase && context?.phase && edge.phase !== context.phase) return false;
  if (edge.dependsOn?.some((id) => !context?.completed?.has(id))) return false;
  if (observation.kind === "read") return false;
  const check = observation.kind === "run" || observation.kind === "engine" || observation.kind === "test";
  switch (projectEdgeCondition(edge)) {
    case "changed": return observation.ok && (observation.kind === "write" || observation.kind === "edit");
    case "success": return observation.ok && check;
    case "failure": return !observation.ok && check;
    case "tests-passed": return observation.ok && check && Boolean(context?.testsPassed);
    case "manual": return false;
    default: return false;
  }
}

export function pickProjectEdge(path: string, edges: ProjectEdge[], kind?: Observation["kind"], context?: GraphContext & { observation?: Observation }): ProjectEdge | undefined {
  const observation = context?.observation ?? (kind ? { kind, name: kind, ok: true, path } : undefined);
  const hits = edges.filter((e) => e.enabled !== false && e.glob && e.edge !== "none" && matchGlob(path, e.glob) && (!observation || isProjectEdgeReady(e, observation, context)));
  if (!hits.length) return undefined;
  let pool = hits;
  if (kind === "write" || kind === "edit") {
    const work = hits.filter((e) => WORK_EDGES.has(e.edge));
    if (work.length) pool = work;
  } else if (kind === "run" || kind === "engine" || kind === "test") {
    const see = hits.filter((e) => SEE_EDGES.has(e.edge));
    if (see.length) pool = see;
  }
  pool.sort(
    (a, b) =>
      (EDGE_RANK[a.edge] ?? 20) - (EDGE_RANK[b.edge] ?? 20) || globScore(b.glob ?? "") - globScore(a.glob ?? ""),
  );
  return pool[0];
}

function coerceTool(tool: string | undefined, edge: GraphEdge): string | null {
  if (tool && TOOL_IDS.has(tool)) return tool;
  if (tool && /^[a-z_]+$/.test(tool)) return tool;
  const def: Partial<Record<GraphEdge, string>> = {
    engine: "engine_run",
    play: "play",
    preview: "see_run",
    test: "shell",
    run: "run_file",
    format: "format_file",
    lint: "grep",
    debug: "debug_start",
    mcp: "mcp_call",
    skill: "skill_run",
    git: "git_status",
  };
  return def[edge] ?? null;
}

/** Specificity: longer literal, fewer stars. Catch-all `*` scores 0. */
export function globScore(glob: string): number {
  const g = glob.trim();
  if (!g || g === "*" || g === "**" || g === "**/*") return 0;
  const wild = (g.match(/\*/g) || []).length;
  return Math.max(1, g.replace(/\*/g, "").length * 2 - wild * 4);
}

/** Basename patterns match at any depth; patterns containing a slash are root-relative. */
export function matchGlob(path: string, glob: string): boolean {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const g = glob.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase().trim();
  if (!g || g.length > 2048) return false;
  if (g === "*" || g === "**" || g === "**/*") return true;
  const patterns = [g];
  // Bounded expansion also handles a directory brace without turning it into a substring match.
  for (let i = 0; i < patterns.length; i++) {
    const brace = patterns[i].match(/\{([^{}]+)\}/);
    if (!brace) continue;
    const options = brace[1].split(",").map((part) => part.trim());
    if (patterns.length + options.length > 64 || options.some((part) => !part)) return false;
    patterns.splice(i, 1, ...options.map((part) => patterns[i].replace(brace[0], part)));
    i -= 1;
  }
  return patterns.some((pattern) => {
    const target = pattern.includes("/") ? p : p.slice(p.lastIndexOf("/") + 1);
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
        re += "(?:[^/]+/)*";
        i += 2;
      } else if (char === "/" && pattern.slice(i) === "/**") {
        re += "(?:/.*)?";
        break;
      } else if (char === "*" && pattern[i + 1] === "*") {
        re += ".*";
        i += 1;
      } else if (char === "*") re += "[^/]*";
      else if (char === "?") re += "[^/]";
      else re += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`).test(target);
  });
}

export function looksEnginePath(path?: string): boolean {
  if (!path) return false;
  return /\.(gd|cs|cpp|h|hpp|usf|fs|glsl|wgsl|lua|tscn|unity|prefab)$/i.test(path) || /godot|unity|unreal|bevy|assets\//i.test(path);
}

export function graphPrompt(p: GraphPolicy): string {
  if (p.edge === "none") return p.why ? `Graph: ${p.why}` : "";
  return `Graph edge ${p.edge}: ${p.why} Next tool ${p.tool}.`;
}
