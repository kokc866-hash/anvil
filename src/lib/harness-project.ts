import type { AfterWrite, HarnessOpts, HarnessTick, HarnessPhase } from "./harness.ts";
import { effectiveAfterWrite } from "./harness.ts";
import type { GraphEdge, GraphPolicy, GraphContext } from "./harness-graph.ts";
import { graphEdge, graphPrompt } from "./harness-graph.ts";
import { kindOfTool, noteObs, stepHarness, harnessPrompt, startHarness, type HarnessState, type Observation } from "./harness.ts";
import { isTestFile } from "./test-parse.ts";
import { toolResultFailed, toolResultPending } from "./agent-evidence.ts";

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
  id?: string;
  phase?: HarnessPhase;
  condition?: "changed" | "success" | "failure" | "tests-passed" | "manual";
  args?: Record<string, unknown>;
  dependsOn?: string[];
  enabled?: boolean;
  when: string;
  edge: GraphEdge;
  tool?: string;
  glob?: string;
};

export type ProjectGraph = {
  version?: 1;
  recipes?: { id: string; version: number }[];
  name?: string;
  edges?: ProjectGraphEdge[];
};

export const PROJECT_GRAPH_VERSION = 1;
const GRAPH_EDGE_LIMIT = 256;
const GRAPH_EDGES = new Set<string>(["none", "preview", "play", "engine", "test", "run", "format", "lint", "debug", "mcp", "skill", "git"]);
const GRAPH_PHASES = new Set<string>(["plan", "act", "observe", "patch", "see", "engine", "done", "abort"]);
const GRAPH_CONDITIONS = new Set<string>(["changed", "success", "failure", "tests-passed", "manual"]);
const objectRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const safeText = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit && ![...value].some(char => char.charCodeAt(0) < 32);
const graphId = (value: unknown): value is string => safeText(value, 256) && /^[a-zA-Z0-9_.:-]+$/.test(value);

/** Project files define workflow metadata, never capabilities or executable conditions. */
export function validateProjectGraph(value: unknown): { graph: ProjectGraph; error?: never } | { graph?: never; error: string } {
  const invalid = (detail: string) => ({ error: `Ungültiger Projektablauf: ${detail}` });
  if (!objectRecord(value)) return invalid("Ein JSON-Objekt wird benötigt.");
  if (value.version !== undefined && value.version !== PROJECT_GRAPH_VERSION) return invalid("Diese Graphversion wird nicht unterstützt.");
  if (value.name !== undefined && !safeText(value.name, 256)) return invalid("Der Name muss ein kurzer Text sein.");
  if (value.edges !== undefined && (!Array.isArray(value.edges) || value.edges.length > GRAPH_EDGE_LIMIT)) return invalid(`Regeln müssen eine Liste mit höchstens ${GRAPH_EDGE_LIMIT} Einträgen sein.`);
  const graph: ProjectGraph = { ...(value.version === 1 ? { version: 1 } : {}), ...(typeof value.name === "string" ? { name: value.name } : {}) };
  if (value.recipes !== undefined) {
    if (!Array.isArray(value.recipes) || value.recipes.length > 64) return invalid("Vorlagenkennungen müssen eine Liste sein.");
    const ids = new Set<string>();
    const recipes: NonNullable<ProjectGraph["recipes"]> = [];
    for (const recipe of value.recipes) {
      if (!objectRecord(recipe) || !graphId(recipe.id) || !Number.isSafeInteger(recipe.version) || Number(recipe.version) < 1 || Number(recipe.version) > 1_000_000 || ids.has(recipe.id)) return invalid("Vorlagen benötigen eine eindeutige Kennung und eine positive Versionsnummer.");
      ids.add(recipe.id);
      recipes.push({ id: recipe.id, version: recipe.version as number });
    }
    graph.recipes = recipes;
  }
  if (value.edges === undefined) return { graph };
  const edges: ProjectGraphEdge[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of (value.edges as unknown[]).entries()) {
    const at = `Regel ${index + 1}`;
    if (!objectRecord(raw)) return invalid(`${at} muss ein Objekt sein.`);
    if (!safeText(raw.when, 2048) || typeof raw.edge !== "string" || !GRAPH_EDGES.has(raw.edge)) return invalid(`${at} benötigt eine Beschreibung und einen gültigen Werkzeugtyp.`);
    if (raw.id !== undefined && (!graphId(raw.id) || ids.has(raw.id))) return invalid(`${at} benötigt eine eindeutige Kennung.`);
    if (typeof raw.id === "string") ids.add(raw.id);
    if (raw.phase !== undefined && (typeof raw.phase !== "string" || !GRAPH_PHASES.has(raw.phase))) return invalid(`${at} enthält eine unbekannte Phase.`);
    if (raw.condition !== undefined && (typeof raw.condition !== "string" || !GRAPH_CONDITIONS.has(raw.condition))) return invalid(`${at} enthält eine unbekannte Bedingung.`);
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") return invalid(`${at}: „enabled“ muss wahr oder falsch sein.`);
    if (raw.tool !== undefined && (!safeText(raw.tool, 128) || !/^[a-z_][a-z0-9_]*$/.test(raw.tool))) return invalid(`${at} enthält keinen gültigen Werkzeugnamen.`);
    if (raw.glob !== undefined && !safeText(raw.glob, 2048)) return invalid(`${at} enthält kein gültiges Dateimuster.`);
    if (raw.dependsOn !== undefined && (!Array.isArray(raw.dependsOn) || raw.dependsOn.length > GRAPH_EDGE_LIMIT || raw.dependsOn.some(id => !graphId(id)) || new Set(raw.dependsOn).size !== raw.dependsOn.length || !raw.id)) return invalid(`${at} enthält ungültige Abhängigkeiten.`);
    if (raw.args !== undefined && (!objectRecord(raw.args) || !jsonArguments(raw.args))) return invalid(`${at} enthält ungültige Werkzeugargumente.`);
    // Copy only the contract: incidental project fields cannot become runtime settings.
    edges.push({
      when: raw.when, edge: raw.edge as GraphEdge,
      ...(typeof raw.id === "string" ? { id: raw.id } : {}),
      ...(typeof raw.phase === "string" ? { phase: raw.phase as HarnessPhase } : {}),
      ...(typeof raw.condition === "string" ? { condition: raw.condition as ProjectGraphEdge["condition"] } : {}),
      ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
      ...(typeof raw.tool === "string" ? { tool: raw.tool } : {}),
      ...(typeof raw.glob === "string" ? { glob: raw.glob } : {}),
      ...(Array.isArray(raw.dependsOn) ? { dependsOn: [...raw.dependsOn] as string[] } : {}),
      ...(objectRecord(raw.args) ? { args: JSON.parse(JSON.stringify(raw.args)) as Record<string, unknown> } : {}),
    });
  }
  const byId = new Map(edges.filter(e => e.id).map(e => [e.id!, e]));
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const acyclic = (id: string): boolean => {
    if (complete.has(id)) return true;
    if (visiting.has(id)) return false;
    const edge = byId.get(id);
    if (!edge) return false;
    visiting.add(id);
    if (edge.dependsOn?.some(dependency => !acyclic(dependency))) return false;
    visiting.delete(id);
    complete.add(id);
    return true;
  };
  if (edges.some(e => e.id && !acyclic(e.id))) return invalid("Abhängigkeiten verweisen auf fehlende Regeln oder bilden einen Kreis.");
  graph.edges = edges;
  return { graph };
}

function jsonArguments(value: unknown): boolean {
  let left = 4096;
  const active = new Set<object>();
  const visit = (part: unknown, depth: number): boolean => {
    if (--left < 0 || depth > 16) return false;
    if (part === null || typeof part === "boolean") return true;
    if (typeof part === "number") return Number.isFinite(part);
    if (typeof part === "string") return part.length <= 65536;
    if (typeof part !== "object" || (!Array.isArray(part) && !objectRecord(part)) || active.has(part)) return false;
    active.add(part);
    const ok = Array.isArray(part) ? part.every(item => visit(item, depth + 1)) : Object.entries(part).every(([key, item]) => !["__proto__", "prototype", "constructor"].includes(key) && key.length <= 256 && visit(item, depth + 1));
    active.delete(part);
    return ok;
  };
  return visit(value, 0);
}

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
    if (raw.length > 2_000_000) return null;
    return validateProjectGraph(JSON.parse(raw)).graph ?? null;
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
  const engineLoop = base.engineLoop ?? proj?.engineLoop;
  const runLoop = base.runLoop ?? proj?.runLoop ?? false;
  const graphLoop = base.graphLoop ?? proj?.graphLoop ?? false;
  const raw: HarnessOpts = {
    runLoop,
    graphLoop,
    testLoop: base.testLoop ?? proj?.testLoop,
    engineLoop,
    loopTries: clamp(proj?.loopTries ?? base.loopTries, 1, 5),
    maxRounds: base.maxRounds ?? proj?.maxRounds,
    autoContinueRounds: base.autoContinueRounds,
    maxTools: base.maxTools ?? proj?.maxTools,
    afterWrite: base.afterWrite ?? proj?.afterWrite ?? (engineLoop ? "engine" : undefined),
    graphSees: base.graphSees ?? proj?.graphSees,
    stopOn: proj?.stopOn ?? base.stopOn,
  };
  return { ...raw, afterWrite: effectiveAfterWrite(raw) };
}

function isEngineProject(files: Record<string, string>): boolean {
  const paths = Object.keys(files);
  if (paths.some((p) => /project\.godot|\.uproject|ProjectSettings/i.test(p))) return true;
  if (paths.some((p) => /(^|\/)(bevy|godot|unity|unreal)(\/|$)/i.test(p))) return true;
  const cargoKey = paths.find((p) => /(^|\/)Cargo\.toml$/i.test(p));
  if (cargoKey && /\bbevy\b/i.test(files[cargoKey] ?? "")) return true;
  return false;
}

export function guessProjectHarness(files: Record<string, string>): { harness: ProjectHarness; graph: ProjectGraph } {
  const paths = Object.keys(files);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  const engine = isEngineProject(files);
  const html = has(/\.html?$/i);
  const py = has(/\.py$/i);
  const js = has(/\.(js|mjs|cjs|ts|tsx)$/i);
  const go = has(/\.go$/i);
  const rust = has(/\.rs$/i) && !engine;
  const tests = paths.some((p) => isTestFile(p));
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

export function projectHarnessPrompt(h: ProjectHarness | null, g: ProjectGraph | null, flags?: { runLoop?: boolean; graphLoop?: boolean }): string {
  const run = flags?.runLoop;
  const graph = flags?.graphLoop;
  if (run === false && graph === false) {
    return "Run loop and graph are off. Do not call run_file or see_run unless the user asked. Do not harness_write to turn them on.";
  }
  if (!h && !g) {
    if (run === false) return "Run loop is off. Do not auto-run after write. Call run_file only if the user asked.";
    return "No .anvil/harness.json. Call run_file only when the run loop is on or the user asked. Do not harness_write to enable it.";
  }
  const lines = ["Project harness (.anvil):"];
  if (h) {
    lines.push(`- ${h.name ?? "harness"}: afterWrite=${h.afterWrite ?? "run"}, tries=${h.loopTries ?? 3}`);
    if (h.testLoop) lines.push("- testLoop on");
    if (h.engineLoop) lines.push("- engineLoop on");
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
      runLoop: args.runLoop != null ? Boolean(args.runLoop) : prev.runLoop ?? guessed.runLoop ?? true,
      testLoop: args.testLoop != null ? Boolean(args.testLoop) : prev.testLoop ?? guessed.testLoop,
      engineLoop: args.engineLoop != null ? Boolean(args.engineLoop) : prev.engineLoop ?? guessed.engineLoop,
      maxRounds: num(args.maxRounds, prev.maxRounds ?? guessed.maxRounds ?? 24),
    };
    return { result: { ok: true, path: HARNESS_PATH, harness: next }, writes: { [HARNESS_PATH]: dumpHarness(next) } };
  }
  if (name === "graph_write") {
    const guessed = guessProjectHarness(files);
    if (args.fromSources !== undefined && typeof args.fromSources !== "boolean") return { result: { ok: false, error: "„fromSources“ muss wahr oder falsch sein." } };
    const fromSources = args.fromSources === true || args.edges === undefined;
    const checked = validateProjectGraph({
      version: args.version === undefined ? PROJECT_GRAPH_VERSION : args.version,
      name: args.name === undefined ? guessed.graph.name ?? "app" : args.name,
      edges: fromSources ? guessed.graph.edges : args.edges,
      ...(args.recipes !== undefined ? { recipes: args.recipes } : {}),
    });
    if (!checked.graph) return { result: { ok: false, error: checked.error } };
    const next = checked.graph;
    return { result: { ok: true, path: GRAPH_PATH, fromSources, graph: next }, writes: { [GRAPH_PATH]: dumpGraph(next) } };
  }
  return { result: { error: `unknown ${name}` } };
}

export type WireOpts = HarnessOpts & { engineOk?: boolean; edges?: ProjectGraphEdge[]; queued?: string[]; context?: GraphContext };

export function afterTool(
  state: HarnessState,
  name: string,
  result: Record<string, unknown>,
  opts: WireOpts,
): { state: HarnessState; stop: boolean; inject: string; graph: GraphPolicy; allow: string[]; strict?: boolean } {
  const err = toolResultFailed(result) || Boolean(result.interrupted);
  const queued = !err && (toolResultPending(result) || Boolean(result.queued));
  const obs: Observation = {
    kind: queued ? "other" : kindOfTool(name, result),
    name,
    ok: queued ? true : !err && result.ok !== false,
    path: typeof result.path === "string" ? result.path : undefined,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    stderr: typeof result.stderr === "string" ? result.stderr : typeof result.error === "string" ? result.error : undefined,
    image: !queued && Boolean(result.image || result.frame),
    graphical: !queued && Boolean(result.graphical || result.html || result.frame),
  };
  let next = noteObs(state, obs);
  const tick = stepHarness(next, opts);
  next = tick.state;
  const g = graphEdge(obs, opts, Boolean(opts.engineOk), opts.edges, opts.context);
  const coming = new Set((opts.queued ?? []).filter(Boolean));
  if (coming.size && (coming.has(g.tool || "") || (tick.allow.length && tick.allow.some((t) => coming.has(t))))) {
    return { state: next, stop: tick.stop, inject: "", graph: { edge: "none", tool: null, why: "" }, allow: tick.allow, strict: tick.strict };
  }
  const inject = mergeHarnessGraph(tick, g);
  return { state: next, stop: tick.stop, inject, graph: g, allow: tick.allow, strict: tick.strict };
}

export function mergeHarnessGraph(tick: HarnessTick, g: GraphPolicy): string {
  const h = harnessPrompt(tick);
  if (!g.tool || g.edge === "none") return h;
  if (tick.allow.length && !tick.allow.includes(g.tool)) return h;
  if (h && g.tool && /Allowed:/.test(h) && !h.includes(g.tool)) return h;
  return [h, graphPrompt(g)].filter(Boolean).join("\n");
}

export { startHarness };

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function num(v: unknown, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
