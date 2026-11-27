import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentWorkflow, type WorkflowAction } from "./agent-workflow.ts";
import { addEdgeNode, applySettings, compileBoard, defaultBoard, dumpBoard, filesFromBoard, NODE_H, NODE_W, parseBoard, rebuildBoardFromGraph, removeWire, syncBoardFromFiles, toggleWire } from "./harness-board.ts";
import { GRAPH_PATH, parseGraphJson } from "./harness-project.ts";
import { buildWorkflowRecipe, importWorkflowRecipe, recipeTargets, WORKFLOW_RECIPES } from "./workflow-recipes.ts";

const settings = { runLoop: true, graphLoop: true, engineLoop: false, afterWrite: "run" as const, loopTries: 3, maxRounds: 24 };
const code = { "main.py": "print('hello')", "test_main.py": "def test_example(): assert True" };

test("each versioned recipe is a valid graph with typed triggers and known dependencies", () => {
  const fixtures = { "code-tests": code, "html-preview": { "index.html": "<button>Test</button>" }, "engine-check": { "project.godot": "config_version=5", "main.gd": "extends Node" } };
  for (const recipe of WORKFLOW_RECIPES) {
    const result = buildWorkflowRecipe(recipe.id, fixtures[recipe.id]);
    assert.equal(result.graph.version, 1);
    assert.deepEqual(result.graph.recipes, [{ id: recipe.id, version: recipe.version }]);
    assert.ok(parseGraphJson(JSON.stringify(result.graph)));
    assert.ok(result.graph.edges?.every(edge => edge.id && edge.phase && edge.condition));
    assert.ok(!("capabilities" in result.graph) && !("harness" in result.graph));
    assert.ok(!result.graph.edges?.some(edge => /^(?:shell|mcp_call|git_commit|git_push|skill_run)$/.test(edge.tool || "") || edge.args?.cmd || edge.args?.command));
  }
});

test("code recipe binds existing program and tests before the manual review", () => {
  const result = buildWorkflowRecipe("code-tests", code);
  const run = result.graph.edges!.find(edge => edge.edge === "run")!;
  const test = result.graph.edges!.find(edge => edge.edge === "test")!;
  const review = result.graph.edges!.find(edge => edge.edge === "git")!;
  assert.deepEqual(run.args, { path: "main.py" });
  assert.deepEqual(test.args, { path: "test_main.py" });
  assert.equal(test.condition, "success");
  assert.deepEqual(test.dependsOn, [run.id]);
  assert.deepEqual(review.dependsOn, [test.id]);
  assert.equal(review.condition, "manual");
});

test("missing tests remain a disabled setup step rather than a claimed test pass", () => {
  const recipe = buildWorkflowRecipe("code-tests", { "main.py": "print(1)", "package.json": '{"scripts":{"test":"delete-everything"}}' });
  const test = recipe.graph.edges!.find(edge => edge.edge === "test")!;
  assert.equal(test.enabled, false);
  assert.equal(test.condition, "manual");
  assert.ok(recipe.notes.some(note => note.includes("Keine Testdatei")));
  assert.doesNotMatch(JSON.stringify(recipe.graph), /delete-everything/);
});

test("HTML recipe separates a reusable frame from explicit interaction", () => {
  const graph = buildWorkflowRecipe("html-preview", { "index.html": "<button>Test</button>", "app.js": "" }).graph;
  const run = graph.edges!.find(edge => edge.tool === "run_file")!;
  const frame = graph.edges!.find(edge => edge.tool === "see_run")!;
  const play = graph.edges!.find(edge => edge.tool === "play")!;
  assert.deepEqual(run.args, { path: "index.html" });
  assert.equal(frame.condition, "success");
  assert.deepEqual(frame.dependsOn, [run.id]);
  assert.equal(play.condition, "manual");
  assert.deepEqual(play.dependsOn, [frame.id]);
});

test("ambiguous engine projects need explicit selection and never invent a command", () => {
  const files = { "one/project.godot": "", "two/project.godot": "" };
  const ambiguous = buildWorkflowRecipe("engine-check", files);
  assert.ok(ambiguous.graph.edges!.every(edge => edge.enabled === false));
  assert.ok(ambiguous.notes.some(note => note.includes("Mehrere Engine-Projekte")));
  const selected = buildWorkflowRecipe("engine-check", files, "godot:two");
  assert.deepEqual(selected.graph.edges![0].args, { engine: "godot", projectRoot: "two", action: "check" });
  assert.equal(selected.graph.edges![0].enabled, true);
  assert.ok(!selected.graph.edges!.some(edge => edge.args?.cmd));
  assert.equal(selected.graph.edges!.find(edge => edge.args?.action === "play")?.condition, "manual");
});

test("unsupported engine checks remain disabled while Unity uses its real test action", () => {
  const unreal = buildWorkflowRecipe("engine-check", { "game.uproject": "{}" });
  assert.equal(unreal.graph.edges![0].enabled, false);
  assert.ok(unreal.notes.some(note => note.includes("keine sichere Standardprüfung")));
  const unity = buildWorkflowRecipe("engine-check", { "ProjectSettings/ProjectVersion.txt": "m_EditorVersion: 6000", "Assets/Game.cs": "" });
  assert.deepEqual(unity.graph.edges![0].args, { engine: "unity", projectRoot: "", action: "test" });
  assert.equal(unity.graph.edges![0].enabled, true);
});

test("unknown or outside-workspace targets cannot become an automatic action", () => {
  const recipe = buildWorkflowRecipe("html-preview", { "index.html": "", "../secret.html": "", "C:/secret.html": "" }, "../secret.html");
  assert.ok(recipe.graph.edges!.every(edge => edge.enabled === false));
  assert.deepEqual(recipeTargets("html-preview", { "index.html": "", "../secret.html": "", "C:/secret.html": "", "\\\\server\\secret.html": "" }), [{ id: "index.html", label: "index.html" }]);
});

test("recipe imports preserve the existing spine, settings, disconnected and disabled rules", () => {
  const off = { ...settings, runLoop: false, graphLoop: false, engineLoop: false, afterWrite: "none" as const };
  let board = importWorkflowRecipe(applySettings(defaultBoard(off), off), buildWorkflowRecipe("code-tests", code));
  const dependency = board.wires.find(wire => wire.from.startsWith("recipe:") && wire.to.endsWith(":review"))!;
  board = toggleWire(board, dependency.id);
  const testWire = board.wires.find(wire => wire.from === "observe" && wire.to.includes(":test:"))!;
  board = removeWire(board, testWire.id);
  const before = structuredClone(board.wires);
  const next = importWorkflowRecipe(board, buildWorkflowRecipe("html-preview", { "index.html": "" }));
  for (const wire of before) assert.deepEqual(next.wires.find(candidate => candidate.id === wire.id), wire);
  assert.ok(!next.wires.some(wire => wire.id === testWire.id));
  const compiled = compileBoard(next, off);
  assert.equal(compiled.harness.runLoop, false);
  assert.equal(compiled.harness.graphLoop, false);
  assert.equal(compiled.harness.engineLoop, false);
  assert.equal(compiled.harness.afterWrite, "none");
});

test("multiple recipe imports avoid all existing and new rectangles without moving disconnected or disabled nodes", () => {
  const off = { ...settings, runLoop: false, graphLoop: false, engineLoop: false, afterWrite: "none" as const };
  let board = addEdgeNode(applySettings(defaultBoard(off), off), { id: "disabled-old", when: "Ausgeschaltet", edge: "run", tool: "run_file", phase: "observe", enabled: false });
  board = addEdgeNode(board, { id: "disconnected-old", when: "Getrennt", edge: "preview", tool: "see_run", phase: "see" });
  const disconnected = board.wires.find(wire => wire.to === "disconnected-old")!;
  board = removeWire(board, disconnected.id);
  board = { ...board, nodes: board.nodes.map(node => node.id === "disabled-old" ? { ...node, x: 448, y: 320 } : node.id === "disconnected-old" ? { ...node, x: 470, y: 402 } : node) };
  const initial = structuredClone(board);
  const initialHarness = compileBoard(board, off).harness;
  const fixtures = { ...code, "index.html": "<p>Test</p>", "project.godot": "config_version=5", "main.gd": "extends Node" };
  const overlaps = (first: { x: number; y: number }, second: { x: number; y: number }) => first.x < second.x + NODE_W && first.x + NODE_W > second.x && first.y < second.y + NODE_H && first.y + NODE_H > second.y;
  for (const recipe of WORKFLOW_RECIPES) {
    const before = structuredClone(board);
    board = importWorkflowRecipe(board, buildWorkflowRecipe(recipe.id, fixtures));
    const newNodes = board.nodes.filter(node => !before.nodes.some(existing => existing.id === node.id));
    for (const node of newNodes) for (const other of board.nodes) {
      if (node.id !== other.id) assert.equal(overlaps(node, other), false, `${node.id} overlaps ${other.id}`);
    }
    for (const node of before.nodes) assert.deepEqual(board.nodes.find(candidate => candidate.id === node.id), node);
    for (const wire of before.wires) assert.deepEqual(board.wires.find(candidate => candidate.id === wire.id), wire);
    assert.deepEqual(board.cam, before.cam);
    assert.deepEqual(compileBoard(board, off).harness, initialHarness);
  }
  assert.ok(!board.wires.some(wire => wire.id === disconnected.id));
  assert.equal(board.wires.find(wire => wire.to === "disabled-old")?.on, false);
  for (const node of initial.nodes) assert.deepEqual(board.nodes.find(candidate => candidate.id === node.id), node);
  const beforeRepeat = board.nodes;
  board = importWorkflowRecipe(board, buildWorkflowRecipe("html-preview", fixtures));
  assert.deepEqual(board.nodes, beforeRepeat);
});

test("rebuilding all recipe lanes separates observe and see nodes sharing the same column", () => {
  const fixtures = { ...code, "index.html": "<p>Test</p>", "project.godot": "config_version=5", "main.gd": "extends Node" };
  const edges = WORKFLOW_RECIPES.flatMap(recipe => buildWorkflowRecipe(recipe.id, fixtures).graph.edges ?? []);
  const board = rebuildBoardFromGraph(edges, { ...settings, engineLoop: true });
  for (const node of board.nodes) for (const other of board.nodes) {
    if (node.id !== other.id) {
      const overlapping = node.x < other.x + NODE_W && node.x + NODE_W > other.x && node.y < other.y + NODE_H && node.y + NODE_H > other.y;
      assert.equal(overlapping, false, `${node.id} overlaps ${other.id}`);
    }
  }
});

test("recipe ids, versions and ordered links survive board and graph saves", () => {
  const recipe = buildWorkflowRecipe("code-tests", code);
  const board = importWorkflowRecipe(applySettings(defaultBoard(settings), settings), recipe);
  const loaded = parseBoard(dumpBoard(board))!;
  const compiled = compileBoard(loaded, settings).graph;
  assert.equal(compiled.version, 1);
  assert.deepEqual(compiled.recipes, [{ id: "code-tests", version: 1 }]);
  const test = compiled.edges!.find(edge => edge.id === recipe.graph.edges!.find(edge => edge.edge === "test")!.id)!;
  assert.deepEqual(test.dependsOn, [recipe.graph.edges![0].id]);
  assert.ok(parseGraphJson(JSON.stringify(compiled)));
  const synchronized = syncBoardFromFiles(filesFromBoard(board, settings));
  assert.deepEqual(parseGraphJson(synchronized[GRAPH_PATH])?.recipes, compiled.recipes);
  const twice = importWorkflowRecipe(board, recipe);
  assert.equal(twice.nodes.length, board.nodes.length);
  assert.equal(twice.wires.length, board.wires.length);
});

test("recipes cannot bypass unavailable capabilities or the none-after-write setting", async () => {
  const graph = buildWorkflowRecipe("code-tests", code).graph;
  const noTools = new AgentWorkflow(code, settings, []);
  await noTools.update(code, settings, graph.edges);
  noTools.confirmedChanges(["main.py"]);
  assert.equal(await noTools.next(true), undefined);
  const off = { ...settings, runLoop: false, graphLoop: false, afterWrite: "none" as const };
  const noAutomatic = new AgentWorkflow(code, off, ["run_file", "git_status", "shell", "mcp_call"]);
  await noAutomatic.update(code, off, graph.edges);
  noAutomatic.confirmedChanges(["main.py"]);
  assert.equal(await noAutomatic.next(true), undefined);
});

async function executeQueuedFixtures(flow: AgentWorkflow, result: (action: WorkflowAction) => Record<string, unknown>, sees = 4) {
  const executed: WorkflowAction[] = [];
  for (let index = 0; index < 10; index++) {
    const action = await flow.next(true, sees);
    if (!action) return executed;
    executed.push(action);
    const operation = await flow.begin(action.name, action.args, action.id);
    assert.equal(operation.error, undefined);
    flow.finish(operation.id, action.name, action.args, result(action));
  }
  assert.fail("Fixture queue did not finish within ten concrete checks.");
}

test("the real queue runs code and its tests once before leaving manual review to the user", async () => {
  const recipe = buildWorkflowRecipe("code-tests", code);
  const flow = new AgentWorkflow(code, settings, ["run_file", "git_status"]);
  await flow.update(code, settings, recipe.graph.edges);
  flow.confirmedChanges(["main.py"]);
  const executed = await executeQueuedFixtures(flow, () => ({ ok: true, code: 0 }));
  assert.deepEqual(executed.map(action => [action.name, action.args.path]), [["run_file", "main.py"], ["run_file", "test_main.py"]]);
  for (const edge of recipe.graph.edges!.filter(edge => edge.condition !== "manual")) assert.ok(flow.completed.has(edge.id!));
  assert.ok(!flow.completed.has(recipe.graph.edges!.find(edge => edge.condition === "manual")!.id!));
});

test("an HTML recipe reuses its run frame after a JS change instead of capturing the JS target", async () => {
  const files = { "index.html": "<button>Test</button>", "app.js": "window.test = true" };
  const recipe = buildWorkflowRecipe("html-preview", files);
  const options = { ...settings, runLoop: false, afterWrite: "preview" as const };
  const flow = new AgentWorkflow(files, options, ["run_file", "see_run", "play"]);
  await flow.update(files, options, recipe.graph.edges);
  flow.confirmedChanges(["app.js"]);
  const executed = await executeQueuedFixtures(flow, () => ({ ok: true, code: 0, graphical: true, image: "fixture-frame" }));
  assert.deepEqual(executed.map(action => [action.name, action.args.path]), [["run_file", "index.html"]]);
  assert.ok(flow.completed.has(recipe.graph.edges!.find(edge => edge.tool === "see_run")!.id!));
});

test("an HTML recipe takes one missing frame and never starts its manual interaction", async () => {
  const files = { "index.html": "<button>Test</button>", "styles.css": "button { color: red }" };
  const recipe = buildWorkflowRecipe("html-preview", files);
  const options = { ...settings, runLoop: false, afterWrite: "preview" as const };
  const flow = new AgentWorkflow(files, options, ["run_file", "see_run", "play"]);
  await flow.update(files, options, recipe.graph.edges);
  flow.confirmedChanges(["styles.css"]);
  const executed = await executeQueuedFixtures(flow, action => action.name === "run_file" ? { ok: true, code: 0, graphical: true } : { ok: true, image: "fixture-frame" });
  assert.deepEqual(executed.map(action => action.name), ["run_file", "see_run"]);
});

test("an HTML recipe respects exhausted image budget in the real queue", async () => {
  const files = { "index.html": "<p>Test</p>" };
  const recipe = buildWorkflowRecipe("html-preview", files);
  const options = { ...settings, runLoop: false, afterWrite: "preview" as const, graphSees: 0 };
  const flow = new AgentWorkflow(files, options, ["run_file", "see_run", "play"]);
  await flow.update(files, options, recipe.graph.edges);
  flow.confirmedChanges(["index.html"]);
  const executed = await executeQueuedFixtures(flow, () => ({ ok: true, code: 0, graphical: true }), 0);
  assert.deepEqual(executed.map(action => action.name), ["run_file"]);
});

test("an engine recipe sends only its concrete selected check to the real queue", async () => {
  const files = { "one/project.godot": "", "one/main.gd": "", "two/project.godot": "", "two/main.gd": "" };
  const recipe = buildWorkflowRecipe("engine-check", files, "godot:two");
  const options = { ...settings, runLoop: false, engineLoop: true, afterWrite: "engine" as const };
  const flow = new AgentWorkflow(files, options, ["engine_run"]);
  await flow.update(files, options, recipe.graph.edges);
  flow.confirmedChanges(["two/main.gd"]);
  const executed = await executeQueuedFixtures(flow, () => ({ ok: true, code: 0 }));
  assert.deepEqual(executed.map(action => [action.name, action.args]), [["engine_run", { engine: "godot", projectRoot: "two", action: "check" }]]);
});
