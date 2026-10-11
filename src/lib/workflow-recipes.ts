import { evidenceTargetKey } from "./agent-evidence.ts";
import { detectEngines } from "./engines.ts";
import { mergeGraphNodes, type Board } from "./harness-board.ts";
import { PROJECT_GRAPH_VERSION, type ProjectGraph, type ProjectGraphEdge } from "./harness-project.ts";
import { isExecutablePath, selectRunTarget } from "./run-target.ts";
import { fileHasInlineTests, isTestFile } from "./test-parse.ts";

export type WorkflowRecipeId = "code-tests" | "html-preview" | "engine-check";
export type WorkflowRecipe = {
  id: WorkflowRecipeId;
  version: number;
  label: string;
  description: string;
  requires: string;
};
export type RecipeTarget = { id: string; label: string };
export type RecipeGraph = { recipe: WorkflowRecipe; graph: ProjectGraph; notes: string[] };

/** Versioned metadata only: importing a recipe does not enable a loop or grant a tool. */
export const WORKFLOW_RECIPES: readonly WorkflowRecipe[] = [
  { id: "code-tests", version: 1, label: "Code und Tests", description: "Programm ausführen, vorhandene Tests prüfen und Änderungen ansehen.", requires: "Automatische Ausführung und benötigte Werkzeuge müssen bereits freigegeben sein." },
  { id: "html-preview", version: 1, label: "HTML-Vorschau", description: "HTML laden, eine Aufnahme prüfen und anschließend gezielt bedienen.", requires: "Vorschau und Bilder benötigen die entsprechende Freigabe. Bedienung bleibt ein ausdrücklicher Schritt." },
  { id: "engine-check", version: 1, label: "Engine-Prüfung", description: "Ein ausgewähltes Engine-Projekt prüfen und danach die Szene gezielt testen.", requires: "Engine-Prüfungen benötigen eine eingerichtete Engine und bereits freigegebene Werkzeuge." },
];

const CODE_GLOB = "*.{py,js,jsx,ts,tsx,mjs,cjs,go,rs,c,cc,cpp,cxx,java,cs,php,rb}";
const SOURCE_SKIP = /(^|\/)(?:\.anvil|\.git|node_modules|ref|vendor|dist|build|target|coverage|__pycache__)(?:\/|$)/i;

function projectPaths(files: Record<string, string>): string[] {
  return Object.keys(files).filter(path => !SOURCE_SKIP.test(path) && !/^[/\\]/.test(path) && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes("..")).sort();
}

export function recipeTargets(id: WorkflowRecipeId, files: Record<string, string>): RecipeTarget[] {
  if (id === "engine-check") return detectEngines(files).map(hit => ({ id: `${hit.id}:${hit.root}`, label: `${hit.label} · ${hit.root || "Projektordner"}` }));
  const paths = projectPaths(files).filter(path => id === "html-preview" ? /\.html?$/i.test(path) : isExecutablePath(path) && !/\.html?$/i.test(path) && !isTestFile(path));
  const preferred = selectRunTarget(paths);
  return [...new Set([preferred, ...paths].filter(Boolean))].map(path => ({ id: path, label: path }));
}

/** Binds only known workspace paths; package scripts and project text never become commands. */
export function buildWorkflowRecipe(id: WorkflowRecipeId, files: Record<string, string>, target?: string): RecipeGraph {
  const recipe = WORKFLOW_RECIPES.find(candidate => candidate.id === id);
  if (!recipe) throw new Error("Unbekannte Ablaufvorlage.");
  const targets = recipeTargets(id, files);
  const selected = target === undefined ? targets.length === 1 ? targets[0] : id === "engine-check" ? undefined : targets[0] : targets.find(candidate => candidate.id === target);
  const prefix = `recipe:${recipe.id}:v${recipe.version}:${evidenceTargetKey(selected?.id || "unconfigured")}`;
  const edges: ProjectGraphEdge[] = [];
  const notes: string[] = [];
  const add = (key: string, edge: Omit<ProjectGraphEdge, "id">) => { const id = `${prefix}:${key}`; edges.push({ ...edge, id }); return id; };

  if (id === "code-tests") {
    const path = selected?.id;
    const execution = add("run", { when: path ? `Programm prüfen: ${path}` : "Ausführbare Datei auswählen", edge: "run", tool: "run_file", phase: "observe", condition: "changed", glob: CODE_GLOB, enabled: Boolean(path), ...(path ? { args: { path } } : {}) });
    if (!path) notes.push("Keine ausführbare Programmdatei gefunden. Zuerst eine Datei anlegen oder auswählen.");
    const tests = projectPaths(files).filter(test => isTestFile(test) || fileHasInlineTests(test, files[test]));
    const checked: string[] = [];
    for (const test of tests.slice(0, 24)) checked.push(add(`test:${evidenceTargetKey(test)}`, { when: `Tests prüfen: ${test}`, edge: "test", tool: "run_file", phase: "observe", condition: "success", glob: CODE_GLOB, args: { path: test }, dependsOn: [execution], enabled: Boolean(path) }));
    if (!tests.length) {
      notes.push("Keine Testdatei gefunden. Tests zuerst anlegen; die Vorlage behauptet keine Testabnahme.");
      add("tests-missing", { when: "Testdatei anlegen und prüfen", edge: "test", tool: "run_file", phase: "observe", condition: "manual", glob: CODE_GLOB, enabled: false, dependsOn: [execution] });
    }
    if (tests.length > 24) notes.push(`${tests.length} Testdateien gefunden. Diese Vorlage ergänzt die ersten 24; weitere Tests über die bestehende Testprüfung ausführen.`);
    add("review", { when: "Änderungen anschließend ansehen", edge: "git", tool: "git_status", phase: "done", condition: "manual", glob: CODE_GLOB, dependsOn: checked.length ? checked : [execution] });
  } else if (id === "html-preview") {
    const path = selected?.id;
    const execution = add("run", { when: path ? `HTML laden: ${path}` : "HTML-Datei auswählen", edge: "run", tool: "run_file", phase: "observe", condition: "changed", glob: "*.{html,htm,css,js,mjs,ts,tsx,jsx}", enabled: Boolean(path), ...(path ? { args: { path } } : {}) });
    const frame = add("frame", { when: "Vorschau aufnehmen und prüfen", edge: "preview", tool: "see_run", phase: "see", condition: "success", glob: "*.{html,htm,css,js,mjs,ts,tsx,jsx}", dependsOn: [execution], enabled: Boolean(path) });
    add("interaction", { when: "Bedienung gezielt testen", edge: "play", tool: "play", phase: "see", condition: "manual", glob: "*.{html,htm}", dependsOn: [frame], enabled: Boolean(path) });
    notes.push("Eine Aufnahme aus dem Run-Ergebnis wird wiederverwendet. Ein Bild allein bestätigt keine Bedienfunktion.");
    if (!path) notes.push("Keine HTML-Datei gefunden. Zuerst eine HTML-Datei anlegen oder auswählen.");
  } else {
    const hit = selected ? detectEngines(files).find(candidate => `${candidate.id}:${candidate.root}` === selected.id) : undefined;
    const action = hit?.cmds.check ? "check" : hit?.cmds.test ? "test" : undefined;
    const check = add("check", { when: hit && action ? `${hit.label}: ${action === "test" ? "Tests ausführen" : "Projekt prüfen"}` : "Engine-Prüfung einrichten", edge: "engine", tool: "engine_run", phase: "engine", condition: "changed", glob: "**/*", enabled: Boolean(hit && action), args: { ...(hit ? { engine: hit.id, projectRoot: hit.root } : {}), action: action || "check" } });
    if (hit?.cmds.check && hit.cmds.test) add("tests", { when: `${hit.label}: Tests ausführen`, edge: "engine", tool: "engine_run", phase: "engine", condition: "success", glob: "**/*", enabled: true, args: { engine: hit.id, projectRoot: hit.root, action: "test" }, dependsOn: [check] });
    if (hit?.cmds.play) add("interaction", { when: "Szene gezielt starten und bedienen", edge: "engine", tool: "engine_run", phase: "engine", condition: "manual", glob: "**/*", args: { engine: hit.id, projectRoot: hit.root, action: "play" }, dependsOn: [check] });
    if (!hit) notes.push(targets.length > 1 ? "Mehrere Engine-Projekte gefunden. Vor dem Import ein Ziel auswählen." : "Kein eindeutiges Engine-Projekt gefunden. Projektmanifest und Engine-Verbindung prüfen.");
    else if (!action) notes.push(`${hit.label} bietet hier keine sichere Standardprüfung. Eine eingerichtete Engine-Erweiterung verwenden.`);
    else if (action === "check") notes.push("Projektprüfung und Import bestätigen keine Spielfunktion. Die Szene anschließend gezielt bedienen.");
  }
  return { recipe, graph: { version: PROJECT_GRAPH_VERSION, name: recipe.label, recipes: [{ id: recipe.id, version: recipe.version }], edges }, notes };
}

/** Adding metadata cannot activate the phase spine or revive existing disabled rules. */
export function importWorkflowRecipe(board: Board, recipe: RecipeGraph): Board {
  const next = mergeGraphNodes(board, recipe.graph.edges ?? []);
  const labels = new Map((recipe.graph.edges ?? []).map(edge => [edge.id, edge.when]));
  return {
    ...next,
    nodes: next.nodes.map(node => labels.has(node.id) && !board.nodes.some(existing => existing.id === node.id) ? { ...node, label: labels.get(node.id)! } : node),
    graph: { version: PROJECT_GRAPH_VERSION, recipes: [...(board.graph?.recipes ?? []).filter(existing => existing.id !== recipe.recipe.id), { id: recipe.recipe.id, version: recipe.recipe.version }] },
  };
}
