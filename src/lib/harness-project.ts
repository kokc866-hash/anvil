import type { AfterWrite, HarnessOpts } from "./harness.ts";
import type { GraphEdge, GraphPolicy } from "./harness-graph.ts";
import { graphEdge, graphPrompt } from "./harness-graph.ts";
import { kindOfTool, noteObs, stepHarness, harnessPrompt, startHarness, type HarnessState, type Observation } from "./harness.ts";

export const HARNESS_PATH = ".anvil/harness.json";
export const GRAPH_PATH = ".anvil/graph.json";

export type ProjectHarness = {
  name?: string;
  when?: string;
  runLoop?: boolean;
  graphLoop?: boolean;
  testLoop?: boolean;
  engineLoop?: boolean;
  loopTries?: number;
  maxRounds?: number;
  maxTools?: number;
  afterWrite?: AfterWrite;
  graphSees?: number;
  stopOn?: string[];
};

export type ProjectGraphEdge = {
  when: string;
  edge: GraphEdge;
  tool?: string;
  glob?: string;
};

export type ProjectGraph = {
  name?: string;
  edges?: ProjectGraphEdge[];
};

export function parseHarnessJson(raw: string): ProjectHarness | null {
  try {
    const j = JSON.parse(raw) as ProjectHarness;
    if (!j || typeof j !== "object") return null;
    return j;
  } catch {
    return null;
  }
}

export function parseGraphJson(raw: string): ProjectGraph | null {
  try {
    const j = JSON.parse(raw) as ProjectGraph;
    if (!j || typeof j !== "object") return null;
    return j;
  } catch {
    return null;
  }
}

export function loadProjectHarness(files: Record<string, string>): ProjectHarness | null {
  const raw = files[HARNESS_PATH];
  return raw ? parseHarnessJson(raw) : null;
}

export function loadProjectGraph(files: Record<string, string>): ProjectGraph | null {
  const raw = files[GRAPH_PATH];
  return raw ? parseGraphJson(raw) : null;
}

export function mergeOpts(base: HarnessOpts, proj: ProjectHarness | null): HarnessOpts {
  if (!proj) return base;
  return {
    runLoop: proj.runLoop ?? base.runLoop,
    graphLoop: proj.graphLoop ?? base.graphLoop,
    loopTries: clamp(proj.loopTries ?? base.loopTries, 1, 5),
    maxRounds: proj.maxRounds ?? base.maxRounds,
    maxTools: proj.maxTools ?? base.maxTools,
    afterWrite: proj.afterWrite ?? base.afterWrite,
    graphSees: proj.graphSees ?? base.graphSees,
  };
}

export function guessProjectHarness(files: Record<string, string>): { harness: ProjectHarness; graph: ProjectGraph } {
  const paths = Object.keys(files);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  const engine = has(/project\.godot|\.uproject|ProjectSettings|bevy|Cargo\.toml/i);
  const html = has(/\.html?$/i);
  const py = has(/\.py$/i);
  const js = has(/\.(js|mjs|cjs|ts|tsx)$/i);
  const go = has(/\.go$/i);
  const rust = has(/\.rs$/i) && !engine;
  const tests = has(/(^|\/)tests\/|\.test\.|\.spec\.|pytest|package\.json/i);
  const md = has(/\.md$/i);
  const harness: ProjectHarness = {
    name: engine ? "engine" : html ? "app-preview" : py ? "python" : js ? "app" : "app",
    when: engine ? "Scripts in der Engine prüfen" : html ? "HTML ansehen" : "Nach Write ausführen",
    runLoop: true,
    graphLoop: html && !engine,
    testLoop: tests,
    engineLoop: engine,
    loopTries: 3,
    maxRounds: 24,
    maxTools: 64,
    afterWrite: engine ? "engine" : html ? "preview" : "run",
    stopOn: ["Budget", "User-Stop"],
  };
  const edges: ProjectGraphEdge[] = [];
  const add = (e: ProjectGraphEdge) => {
    if (!edges.some((x) => x.tool === e.tool && x.glob === e.glob && x.edge === e.edge)) edges.push(e);
  };
  if (engine) add({ when: "Engine-Skript", edge: "engine", tool: "engine_run", glob: "*.{gd,cs,cpp,rs}" });
  if (html) {
    add({ when: "HTML Run", edge: "run", tool: "run_file", glob: "*.html" });
    add({ when: "HTML sehen", edge: "preview", tool: "see_run", glob: "*.html" });
  }
  if (md) add({ when: "Doku", edge: "preview", tool: "open_preview", glob: "*.md" });
  if (py) add({ when: "Python", edge: "run", tool: "run_file", glob: "*.py" });
  if (js) add({ when: "JS/TS", edge: "run", tool: "run_file", glob: "*.{js,ts,tsx,mjs}" });
  if (go) add({ when: "Go", edge: "run", tool: "run_file", glob: "*.go" });
  if (rust) add({ when: "Rust", edge: "run", tool: "run_file", glob: "*.rs" });
  if (has(/\.(c|cc|cpp|h|hpp)$/i)) add({ when: "C/C++", edge: "run", tool: "run_file", glob: "*.{c,cc,cpp,h}" });
  if (has(/\.java$/i)) add({ when: "Java", edge: "run", tool: "run_file", glob: "*.java" });
  if (has(/\.cs$/i) && !engine) add({ when: ".NET", edge: "run", tool: "run_file", glob: "*.cs" });
  if (has(/\.php$/i)) add({ when: "PHP", edge: "run", tool: "run_file", glob: "*.php" });
  if (has(/\.rb$/i)) add({ when: "Ruby", edge: "run", tool: "run_file", glob: "*.rb" });
  if (tests) add({ when: "Tests", edge: "test", tool: "shell", glob: "tests/**" });
  if (js || html) add({ when: "Format", edge: "format", tool: "format_file", glob: "*.{js,ts,tsx,json,html,css}" });
  else if (py) add({ when: "Format", edge: "format", tool: "format_file", glob: "*.py" });
  if (!edges.length) add({ when: "Run geöffnete Datei", edge: "run", tool: "run_file", glob: "*" });
  edges.sort((a, b) => a.edge.localeCompare(b.edge) || (a.glob ?? "").localeCompare(b.glob ?? ""));
  return { harness, graph: { name: harness.name, edges } };
}

export function dumpHarness(h: ProjectHarness): string {
  return `${JSON.stringify(h, null, 2)}\n`;
}

export function dumpGraph(g: ProjectGraph): string {
  return `${JSON.stringify(g, null, 2)}\n`;
}

export function projectHarnessPrompt(h: ProjectHarness | null, g: ProjectGraph | null): string {
  if (!h && !g) {
    return "No .anvil/harness.json. Repeated run/test/engine: harness_write + graph_write once. Else defaults.";
  }
  const lines = ["Project harness (.anvil):"];
  if (h) {
    lines.push(`- ${h.name ?? "harness"}: afterWrite=${h.afterWrite ?? "run"}, tries=${h.loopTries ?? 3}`);
    if (h.when) lines.push(`- when: ${h.when}`);
  }
  if (g?.edges?.length) {
    for (const e of g.edges.slice(0, 8)) lines.push(`- edge ${e.edge}${e.glob ? ` (${e.glob})` : ""} → ${e.tool ?? e.edge}`);
  }
  lines.push("Follow the file. Do not rewrite it every round.");
  return lines.join("\n");
}

export function applyHarnessTool(
  name: string,
  args: Record<string, unknown>,
  files: Record<string, string>,
): { result: unknown; writes?: Record<string, string> } {
  if (name === "harness_read") {
    return { result: { harness: loadProjectHarness(files), graph: loadProjectGraph(files), paths: [HARNESS_PATH, GRAPH_PATH] } };
  }
  if (name === "harness_write") {
    const prev = loadProjectHarness(files) ?? {};
    const guessed = !args.afterWrite && !prev.afterWrite ? guessProjectHarness(files).harness : prev;
    const next: ProjectHarness = {
      ...guessed,
      ...prev,
      name: String(args.name ?? prev.name ?? guessed.name ?? "app"),
      when: args.when != null ? String(args.when) : prev.when ?? guessed.when,
      afterWrite: (String(args.afterWrite ?? prev.afterWrite ?? guessed.afterWrite ?? "run") as ProjectHarness["afterWrite"]),
      loopTries: num(args.loopTries, prev.loopTries ?? guessed.loopTries ?? 3),
      graphLoop: args.graphLoop != null ? Boolean(args.graphLoop) : prev.graphLoop ?? guessed.graphLoop,
      runLoop: true,
    };
    return { result: { ok: true, path: HARNESS_PATH, harness: next }, writes: { [HARNESS_PATH]: dumpHarness(next) } };
  }
  if (name === "graph_write") {
    const guessed = guessProjectHarness(files);
    const given = Array.isArray(args.edges) ? (args.edges as ProjectGraph["edges"]) : null;
    const fromSources = args.fromSources === true || !given?.length;
    const edges = fromSources ? guessed.graph.edges : given;
    const next: ProjectGraph = { name: String(args.name ?? guessed.graph.name ?? "app"), edges };
    return { result: { ok: true, path: GRAPH_PATH, fromSources, graph: next }, writes: { [GRAPH_PATH]: dumpGraph(next) } };
  }
  return { result: { error: `unknown ${name}` } };
}

export type WireOpts = HarnessOpts & { engineOk?: boolean; edges?: ProjectGraphEdge[] };

export function afterTool(
  state: HarnessState,
  name: string,
  result: Record<string, unknown>,
  opts: WireOpts,
): { state: HarnessState; stop: boolean; inject: string; graph: GraphPolicy } {
  const err = "error" in result && result.error;
  const obs: Observation = {
    kind: kindOfTool(name),
    name,
    ok: !err && result.ok !== false,
    path: typeof result.path === "string" ? result.path : undefined,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    stderr: typeof result.stderr === "string" ? result.stderr : typeof result.error === "string" ? result.error : undefined,
    image: Boolean(result.image || result.frame),
    graphical: Boolean(result.graphical || result.html || result.frame),
  };
  let next = noteObs(state, obs);
  const tick = stepHarness(next, opts);
  next = tick.state;
  const g = graphEdge(obs, opts, Boolean(opts.engineOk), opts.edges);
  const inject = [harnessPrompt(tick), graphPrompt(g)].filter(Boolean).join("\n");
  return { state: next, stop: tick.stop, inject, graph: g };
}

export { startHarness };

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function num(v: unknown, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
