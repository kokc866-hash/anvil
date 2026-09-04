import type { Observation, HarnessOpts } from "./harness.ts";

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
};

export type ProjectEdge = {
  when: string;
  edge: GraphEdge;
  tool?: string;
  glob?: string;
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
): GraphPolicy {
  if (!obs) return { edge: "none", tool: null, why: "" };

  if (opts.graphLoop && projectEdges?.length && obs.path) {
    const hit = pickProjectEdge(obs.path, projectEdges, obs.kind);
    if (hit && hit.edge !== "none") {
      if (hit.edge === "engine" && !engineOk) return { edge: "none", tool: null, why: "companion off" };
      const tool = coerceTool(hit.tool, hit.edge);
      return { edge: hit.edge, tool, why: `project graph: ${hit.when} → ${tool}` };
    }
  }

  if (opts.engineLoop && engineOk && (obs.kind === "write" || obs.kind === "edit") && looksEnginePath(obs.path)) {
    return { edge: "engine", tool: "engine_run", why: "engine script changed — companion check/play." };
  }

  if (!opts.graphLoop) return { edge: "none", tool: null, why: "" };

  if (obs.graphical && obs.ok && obs.kind === "run") {
    return { edge: "preview", tool: "see_run", why: "HTML preview — send a frame back to the model." };
  }

  return { edge: "none", tool: null, why: "" };
}

export function pickProjectEdge(path: string, edges: ProjectEdge[], kind?: Observation["kind"]): ProjectEdge | undefined {
  const hits = edges.filter((e) => e.glob && e.edge !== "none" && matchGlob(path, e.glob));
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

/**
 * Minimatch-ish: `*` does not become `includes("")`.
 * `*.py` → any path ending `.py`. `*.{js,ts}` braces. `tests/**` prefix.
 */
export function matchGlob(path: string, glob: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  const g = glob.replace(/\\/g, "/").toLowerCase().trim();
  if (!g) return false;
  if (g === "*" || g === "**" || g === "**/*") return true;
  const brace = g.match(/^(.*)\*\.\{([^}]+)\}$/);
  if (brace) {
    const exts = brace[2].split(",").map((e) => e.trim().replace(/^\./, ""));
    if (!exts.some((e) => p.endsWith("." + e))) return false;
    const prefix = brace[1].replace(/\*\*\//g, "").replace(/\*$/, "").replace(/\/$/, "");
    return !prefix || p.includes(prefix) || p.startsWith(prefix + "/") || p.startsWith(prefix);
  }
  if (g.startsWith("*.") && !g.includes("/")) return p.endsWith(g.slice(1));
  if (g.includes("**/")) {
    const head = g.slice(0, g.indexOf("**/")).replace(/\/$/, "");
    const tail = g.slice(g.indexOf("**/") + 3);
    if (head && !(p === head || p.startsWith(head + "/"))) return false;
    if (!tail || tail === "*") return true;
    if (tail.startsWith("*.")) return p.endsWith(tail.slice(1));
    return p.endsWith("/" + tail) || p === tail || p.endsWith(tail);
  }
  if (g.endsWith("/**")) {
    const head = g.slice(0, -3);
    return p === head || p.startsWith(head + "/");
  }
  if (!g.includes("*")) return p === g || p.endsWith("/" + g) || p.endsWith(g);
  const re = "^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*") + "$";
  try {
    return new RegExp(re).test(p);
  } catch {
    return false;
  }
}

export function looksEnginePath(path?: string): boolean {
  if (!path) return false;
  return /\.(gd|cs|cpp|h|hpp|usf|fs|glsl|wgsl|lua|tscn|unity|prefab)$/i.test(path) || /godot|unity|unreal|bevy|assets\//i.test(path);
}

export function graphPrompt(p: GraphPolicy): string {
  if (p.edge === "none") return p.why ? `Graph: ${p.why}` : "";
  return `Graph edge ${p.edge}: ${p.why} Next tool ${p.tool}.`;
}
