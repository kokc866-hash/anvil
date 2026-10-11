import assert from "node:assert/strict";
import { test } from "node:test";
import { harnessBar, kindOfTool, noteObs, startHarness, stepHarness, type HarnessOpts, type Observation } from "./harness.ts";
import { graphEdge, matchGlob, type ProjectEdge } from "./harness-graph.ts";
import { addEdgeNode, applySettings, compileBoard, connectNodes, defaultBoard, dumpBoard, mergeGraphNodes, parseBoard, rebuildBoardFromGraph, removeWire, toggleWire } from "./harness-board.ts";
import { afterTool, applyHarnessTool, GRAPH_PATH, loadProjectGraph, parseGraphJson, projectHarnessPrompt } from "./harness-project.ts";

const opts: HarnessOpts = { runLoop: true, graphLoop: true, afterWrite: "run", loopTries: 3 };
const settings = { ...opts, afterWrite: "run" as const, maxRounds: 24 };
const obs = (kind: Observation["kind"], ok = true, extra: Partial<Observation> = {}): Observation => ({ kind, name: kind, ok, path: "src/main.py", ...extra });
const run: ProjectEdge = { when: "Python prüfen", edge: "run", tool: "run_file", glob: "*.py" };

test("a disabled tool wire is not an active compiled rule", () => {
  let board = addEdgeNode(defaultBoard(settings), { when: "Format", edge: "format", tool: "format_file", glob: "*.py" });
  const wire = board.wires.find((w) => board.nodes.find((n) => n.id === w.to)?.edge?.tool === "format_file")!;
  board = toggleWire(board, wire.id);
  assert.ok(!compileBoard(board, settings).graph.edges?.some((e) => e.tool === "format_file"));
});

test("settings do not reactivate a manually disabled preview leaf", () => {
  let board = addEdgeNode(defaultBoard(settings), { when: "Bild", edge: "preview", tool: "open_preview", glob: "*.md" });
  const wire = board.wires.find((w) => board.nodes.find((n) => n.id === w.to)?.edge?.tool === "open_preview")!;
  board = toggleWire(board, wire.id);
  assert.equal(applySettings(board, settings).wires.find((w) => w.id === wire.id)?.on, false);
});

test("a disconnected tool stays disconnected after saving and loading", () => {
  let board = addEdgeNode(defaultBoard(settings), { when: "Format", edge: "format", tool: "format_file", glob: "*.py" });
  const wire = board.wires.find((w) => board.nodes.find((n) => n.id === w.to)?.edge?.tool === "format_file")!;
  board = removeWire(board, wire.id);
  const loaded = parseBoard(dumpBoard(board))!;
  assert.ok(!compileBoard(loaded, settings).graph.edges?.some((e) => e.tool === "format_file"));
});

test("a chosen source phase and stable node id survive the graph round trip", () => {
  const board = addEdgeNode(defaultBoard(settings), { when: "Reparatur formatieren", edge: "format", tool: "format_file", glob: "*.py" }, "patch");
  const node = board.nodes.find((n) => n.edge?.tool === "format_file")!;
  const exported = compileBoard(board, settings).graph.edges!.find((e) => e.tool === "format_file")!;
  assert.equal(exported.phase, "patch");
  assert.equal(exported.id, node.id);
  const restored = rebuildBoardFromGraph([exported], settings);
  assert.equal(restored.nodes.find((n) => n.edge?.tool === "format_file")?.id, node.id);
  assert.equal(restored.wires.find((w) => w.to === node.id)?.from, "patch");
});

test("tool connections compile and restore an ordered dependency without cycles", () => {
  let board = addEdgeNode(defaultBoard(settings), { when: "Format", edge: "format", tool: "format_file", glob: "*.py" }, "act");
  board = addEdgeNode(board, { when: "Prüfung", edge: "test", tool: "shell", glob: "*.py" }, "act");
  const first = board.nodes.find((n) => n.edge?.tool === "format_file")!.id;
  const second = board.nodes.find((n) => n.edge?.tool === "shell")!.id;
  board = connectNodes(board, first, second);
  assert.ok(board.wires.some((w) => w.from === first && w.to === second && w.on));
  const exported = compileBoard(board, settings).graph.edges!;
  assert.ok(exported.find((e) => e.id === second)?.dependsOn?.includes(first));
  const restored = rebuildBoardFromGraph(exported.filter((e) => e.id === first || e.id === second), settings);
  assert.ok(restored.wires.some((w) => w.from === first && w.to === second && w.on));
  assert.equal(connectNodes(restored, second, first).wires.length, restored.wires.length);
});

test("disabled prerequisites do not make their dependents active", () => {
  let board = addEdgeNode(defaultBoard(settings), { when: "Format", edge: "format", tool: "format_file", glob: "*.py" }, "act");
  board = addEdgeNode(board, { when: "Test", edge: "test", tool: "shell", glob: "*.py" }, "act");
  const first = board.nodes.find((n) => n.edge?.tool === "format_file")!.id;
  const second = board.nodes.find((n) => n.edge?.tool === "shell")!.id;
  board = connectNodes(board, first, second);
  board = { ...board, nodes: board.nodes.map((n) => n.id === first ? { ...n, edge: { ...n.edge!, enabled: false } } : n) };
  assert.ok(!compileBoard(board, settings).graph.edges?.some((e) => e.id === second));
});

test("read observations do not start a new run for an unchanged file", () => {
  assert.equal(graphEdge(obs("read"), opts, true, [run]).tool, null);
});

test("none after write overrides project run and engine recommendations", () => {
  assert.equal(graphEdge(obs("write"), { ...opts, afterWrite: "none" }, true, [run]).tool, null);
  assert.equal(graphEdge(obs("write", true, { path: "main.gd" }), { ...opts, engineLoop: true, afterWrite: "none" }, true, [{ ...run, edge: "engine", tool: "engine_run", glob: "*.gd" }]).tool, null);
});

test("a failed write does not qualify as a successful change", () => {
  assert.equal(graphEdge(obs("write", false), opts, true, [run]).tool, null);
});

test("zero or exhausted observation budget blocks automatic images and play", () => {
  const edge: ProjectEdge = { when: "Vorschau", edge: "preview", tool: "see_run", glob: "*.html" };
  const frame = obs("run", true, { path: "index.html", graphical: true });
  assert.equal(graphEdge(frame, { ...opts, graphSees: 0 }, true, [edge]).tool, null);
  assert.equal(graphEdge(frame, opts, true, [edge], { remainingSees: 0 }).tool, null);
});

test("an existing frame removes duplicate capture but not a requested interaction", () => {
  const frame = obs("run", true, { path: "index.html", graphical: true, image: true });
  const edge: ProjectEdge = { when: "Vorschau", edge: "preview", tool: "see_run", glob: "*.html" };
  assert.equal(graphEdge(frame, opts, true, [edge]).tool, null);
  assert.equal(graphEdge(frame, opts, true, [{ ...edge, edge: "play", tool: "play" }]).tool, "play");
  const state = noteObs(startHarness(opts), frame);
  assert.equal(state.used.sees, 1);
  assert.equal(stepHarness(state, opts).state.phase, "act");
});

test("a descriptive when label cannot enable a commit before successful tests", () => {
  const commit: ProjectEdge = { when: "nur nach erfolgreichen Tests", edge: "git", tool: "git_commit", glob: "*.py" };
  assert.equal(graphEdge(obs("read"), opts, true, [commit]).tool, null);
  assert.equal(graphEdge(obs("run"), opts, true, [commit]).tool, null);
  assert.equal(graphEdge(obs("test"), opts, true, [commit], { testsPassed: true }).tool, "git_commit");
});

test("manual edges and unknown legacy service actions are never automatic", () => {
  const manual: ProjectEdge = { ...run, condition: "manual" };
  assert.equal(graphEdge(obs("write"), opts, true, [manual]).tool, null);
  assert.equal(graphEdge(obs("write"), opts, true, [{ ...run, edge: "mcp", tool: "mcp_call" }]).tool, null);
  assert.equal(graphEdge(obs("run", true, { path: "index.html", graphical: true }), opts, true, [{ ...manual, edge: "preview", tool: "see_run", glob: "*.html" }]).tool, null);
});

test("typed conditions, phase and current dependency proofs gate selection", () => {
  const edge: ProjectEdge = { ...run, id: "check", phase: "patch", condition: "failure", dependsOn: ["prepare"] };
  const failure = obs("run", false);
  assert.equal(graphEdge(failure, opts, true, [edge], { phase: "act", completed: new Set(["prepare"]) }).tool, null);
  assert.equal(graphEdge(failure, opts, true, [edge], { phase: "patch", completed: new Set() }).tool, null);
  assert.equal(graphEdge(failure, opts, true, [edge], { phase: "patch", completed: new Set(["prepare"]) }).id, "check");
  assert.equal(graphEdge(failure, opts, true, [edge], { phase: "patch", completed: new Set(["prepare", "check"]) }).tool, null);
});

test("merging graph nodes preserves distinct ids and dependencies for the same tool", () => {
  const first: ProjectEdge = { id: "format-one", when: "Erste Datei", edge: "format", tool: "format_file", glob: "*.py" };
  const second: ProjectEdge = { ...first, id: "format-two", when: "Zweite Prüfung", dependsOn: [first.id!] };
  const board = mergeGraphNodes(defaultBoard(settings), [first, second]);
  assert.equal(board.nodes.filter((n) => n.edge?.tool === "format_file").length, 2);
  assert.ok(board.wires.some((w) => w.from === first.id && w.to === second.id));
  assert.equal(mergeGraphNodes(board, [first, second]).nodes.length, board.nodes.length);
});

test("an explicitly disabled graph edge is not selected", () => {
  assert.equal(graphEdge(obs("write"), opts, true, [{ ...run, enabled: false }]).tool, null);
});

test("glob matching respects directory segments and basename patterns", () => {
  assert.equal(matchGlob("src/main.ts", "src/*.{js,ts}"), true);
  assert.equal(matchGlob("not-src/main.ts", "src/*.{js,ts}"), false);
  assert.equal(matchGlob("src/deep/main.ts", "src/*.{js,ts}"), false);
  assert.equal(matchGlob("src/deep/main.ts", "src/**/*.{js,ts}"), true);
  assert.equal(matchGlob("src/main.ts", "src/**/*.{js,ts}"), true);
  assert.equal(matchGlob("not-main.ts", "main.ts"), false);
  assert.equal(matchGlob("src/main.py", "*.py"), true);
  assert.equal(matchGlob("source/test/a.py", "test/**"), false);
});

test("successful runs do not consume later correction attempts", () => {
  let state = startHarness(opts);
  state = noteObs(state, obs("run"));
  state = noteObs(state, obs("run"));
  state = noteObs(state, obs("run", false));
  assert.equal(state.used.runs, 3);
  assert.equal(state.used.patches, 0);
  assert.equal(stepHarness(state, opts).state.phase, "patch");
  assert.match(harnessBar(state), /Run 3 · Korrekturen 0\/3/);
  assert.doesNotMatch(harnessBar(state), /Run 3\/3/);
});

test("engine discovery and status are reads, not successful verification runs", () => {
  assert.equal(kindOfTool("engine_status"), "read");
  assert.equal(kindOfTool("engine_detect"), "read");
  assert.equal(kindOfTool("engine_run"), "engine");
  let state = noteObs(startHarness(opts), obs("engine", false, { name: "engine_run" }));
  state = noteObs(state, obs(kindOfTool("engine_status"), true, { name: "engine_status" }));
  state = noteObs(state, obs("edit"));
  assert.equal(state.used.runs, 1);
  assert.equal(state.used.patches, 1);
});

test("one correction across several files consumes one attempt", () => {
  let state = noteObs(startHarness(opts), obs("run", false));
  state = noteObs(state, obs("read"));
  state = noteObs(state, obs("edit"));
  state = noteObs(state, obs("write", true, { path: "src/second.py" }));
  state = noteObs(state, obs("edit", true, { path: "src/third.py" }));
  assert.equal(state.used.patches, 1);
  state = noteObs(state, obs("run", false));
  state = noteObs(state, obs("edit"));
  assert.equal(state.used.patches, 2);
});

test("failed saves do not consume attempts and a final batch still gets verified", () => {
  const once = { ...opts, loopTries: 1 };
  let state = noteObs(startHarness(once), obs("run", false));
  state = noteObs(state, obs("write", false));
  assert.equal(state.used.patches, 0);
  state = noteObs(state, obs("write"));
  assert.equal(state.used.patches, 1);
  assert.equal(stepHarness(state, once).state.phase, "observe");
  state = noteObs(state, obs("run", false));
  assert.equal(stepHarness(state, once).state.reason, "automatic repair attempts used");
});

test("correction batches remain valid beyond the short observation history", () => {
  let state = noteObs(startHarness(opts), obs("run", false));
  for (let i = 0; i < 25; i++) state = noteObs(state, obs("read"));
  state = noteObs(state, obs("edit"));
  assert.equal(state.used.patches, 1);
  for (let i = 0; i < 25; i++) state = noteObs(state, obs("read"));
  state = noteObs(state, obs("edit"));
  assert.equal(state.used.patches, 1);
});

test("valid legacy graph JSON retains its descriptions without inventing conditions", () => {
  const legacy = { name: "Python", edges: [{ when: "Nach dem Speichern prüfen", edge: "run", tool: "run_file", glob: "*.py" }] };
  assert.deepEqual(parseGraphJson(JSON.stringify(legacy)), legacy);
  assert.equal(parseGraphJson("{}")?.edges, undefined);
});

test("malformed graph JSON is rejected before public consumers can crash", () => {
  const invalid = [
    null, [], { edges: {} }, { edges: [null] }, { edges: ["run"] },
    { edges: [{ ...run, edge: "executeAnything" }] }, { edges: [{ ...run, edge: { toString: null } }] },
    { edges: [{ ...run, when: 42 }] }, { edges: [{ ...run, tool: {} }] },
    { edges: [{ ...run, phase: "unknown" }] }, { edges: [{ ...run, condition: "eval" }] },
    { edges: [{ ...run, enabled: "yes" }] }, { edges: [{ ...run, args: [] }] },
    { edges: [{ ...run, dependsOn: "first" }] }, { edges: [{ ...run, dependsOn: [42] }] },
    { edges: [{ ...run, id: "second", dependsOn: ["missing"] }] },
    { edges: [{ ...run, id: "same" }, { ...run, id: "same" }] },
    { edges: [{ ...run, id: "same", dependsOn: ["same"] }] },
    { edges: [{ ...run, id: "a", dependsOn: ["b"] }, { ...run, id: "b", dependsOn: ["a"] }] },
    { edges: [{ ...run, id: "a" }, { ...run, id: "b", dependsOn: ["a", "a"] }] },
    { version: 2, edges: [run] }, { recipes: [{ id: "code-tests", version: "1" }], edges: [run] },
  ];
  for (const value of invalid) {
    const files = { [GRAPH_PATH]: JSON.stringify(value) };
    assert.equal(loadProjectGraph(files), null, JSON.stringify(value));
    assert.doesNotThrow(() => projectHarnessPrompt(null, loadProjectGraph(files)));
  }
});

test("graph_write rejects invalid explicit rules atomically and preserves the old file", () => {
  const files = { "main.py": "print(1)", [GRAPH_PATH]: JSON.stringify({ edges: [run] }) };
  for (const edges of [null, {}, [null], [{ ...run, edge: { toString: null } }], [{ ...run, dependsOn: "x" }], [{ ...run, id: "a", dependsOn: ["a"] }]]) {
    const output = applyHarnessTool("graph_write", { edges }, files);
    assert.equal(output.writes, undefined);
    assert.match(JSON.stringify(output.result), /"ok":false/);
    assert.match(JSON.stringify(output.result), /error/);
    assert.deepEqual(loadProjectGraph(files)?.edges, [run]);
  }
  const cleared = applyHarnessTool("graph_write", { edges: [] }, files);
  assert.deepEqual(parseGraphJson(cleared.writes![GRAPH_PATH])?.edges, []);
  for (const metadata of [{ name: null }, { name: 42 }, { version: null }, { version: "1" }, { fromSources: "true" }, { recipes: {} }]) {
    const output = applyHarnessTool("graph_write", { edges: [], ...metadata }, files);
    assert.equal(output.writes, undefined);
    assert.match(JSON.stringify(output.result), /"ok":false/);
  }
});

test("graph_write persists validated schema and recipe identities without grants", () => {
  const graph = { version: 1, recipes: [{ id: "code-tests", version: 1 }], edges: [{ ...run, id: "check" }] };
  const output = applyHarnessTool("graph_write", { ...graph, runLoop: true, capabilities: ["shell"] }, {});
  const saved = parseGraphJson(output.writes![GRAPH_PATH])!;
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.recipes, graph.recipes);
  assert.ok(!("runLoop" in saved) && !("capabilities" in saved));
});

test("pending runs never become successful checks or preview observations", () => {
  for (const pending of [{ pending: true }, { running: true }, { status: "pending" }, { status: "waiting" }, { queued: "index.html" }]) {
    const state = afterTool(startHarness(opts), "write_file", { ok: true, path: "index.html" }, opts).state;
    const next = afterTool(state, "run_file", { ok: true, path: "index.html", graphical: true, image: "test", ...pending }, opts);
    assert.equal(next.state.used.runs, 0);
    assert.equal(next.state.used.sees, 0);
    assert.equal(next.graph.tool, null);
    assert.equal(next.state.last?.kind, "other");
  }
});

test("isError and aborted runs preserve failure even when ok and code claim success", () => {
  for (const failure of [{ isError: true }, { aborted: true }, { interrupted: true }, { cancelled: true }, { status: "failed" }, { code: 1 }]) {
    const next = afterTool(startHarness(opts), "run_file", { path: "main.py", ok: true, code: 0, ...failure }, opts);
    assert.equal(next.state.last?.ok, false);
    assert.equal(next.state.phase, "patch");
    assert.equal(next.graph.tool, null);
  }
});
