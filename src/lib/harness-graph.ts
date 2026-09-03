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

  if (projectEdges?.length && obs.path) {
    const hit = projectEdges.find((e) => e.glob && matchGlob(obs.path!, e.glob));
    if (hit && hit.edge !== "none") {
      if (hit.edge === "engine" && !engineOk) return { edge: "none", tool: null, why: "companion off" };
      const tool = coerceTool(hit.tool, hit.edge);
      return { edge: hit.edge, tool, why: `project graph: ${hit.when} → ${tool}` };
    }
  }

  if (engineOk && (obs.kind === "write" || obs.kind === "edit") && looksEnginePath(obs.path)) {
    return { edge: "engine", tool: "engine_run", why: "engine script changed — companion check/play." };
  }

  if (!opts.graphLoop) return { edge: "none", tool: null, why: "" };

  if (obs.graphical && obs.ok && obs.kind === "run") {
    return { edge: "preview", tool: "see_run", why: "HTML preview — send a frame back to the model." };
  }

  if (obs.kind === "see" && obs.ok) {
    return { edge: "play", tool: "play", why: "Frame ready. Optional play, then patch or done." };
  }

  return { edge: "none", tool: null, why: "" };
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

export function matchGlob(path: string, glob: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  const g = glob.replace(/\\/g, "/").toLowerCase();
  const brace = g.match(/^(.*)\*\.\{([^}]+)\}$/);
  if (brace) {
    const prefix = brace[1].replace(/\*\*\//g, "");
    return brace[2].split(",").some((e) => p.endsWith("." + e.trim()) && (!prefix || p.includes(prefix.replace(/\*$/, ""))));
  }
  if (g.startsWith("*.") && !g.includes("/")) return p.endsWith(g.slice(1));
  if (g.includes("**/")) {
    const tail = g.slice(g.indexOf("**/") + 3);
    if (tail.startsWith("*.")) return p.endsWith(tail.slice(1));
    return p.includes(tail.replace(/\*$/, ""));
  }
  if (g.endsWith("/**")) return p.includes(g.slice(0, -3));
  return p.includes(g.replace(/\*/g, ""));
}

export function looksEnginePath(path?: string): boolean {
  if (!path) return false;
  return /\.(gd|cs|cpp|h|hpp|usf|fs|glsl|wgsl|lua|tscn|unity|prefab)$/i.test(path) || /godot|unity|unreal|bevy|assets\//i.test(path);
}

export function graphPrompt(p: GraphPolicy): string {
  if (p.edge === "none") return p.why ? `Graph: ${p.why}` : "";
  return `Graph edge ${p.edge}: ${p.why} Next tool ${p.tool}.`;
}
