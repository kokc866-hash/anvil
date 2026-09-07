import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSettingsWrites } from "./project-settings.ts";
import { defaultBoard, type BoardSettings } from "./harness-board.ts";
import { guessProjectHarness } from "./harness-project.ts";

const settings: BoardSettings = { runLoop: true, graphLoop: true, testLoop: false, engineLoop: false, loopTries: 3, maxRounds: 24, afterWrite: "run" };

test("saving settings preserves custom project data, graph and board bytes", () => {
  const board = defaultBoard(settings);
  board.cam = { x: 123, y: 456, z: 1.7 }; board.nodes[0].x = 999;
  board.wires.push({ id: "my-wire", from: "plan", to: "engine", kind: "flow", on: false });
  const files = {
    ".anvil/harness.json": JSON.stringify({ ...settings, maxTools: 11, stopOn: ["custom-stop"], idea: "keep this" }),
    ".anvil/graph.json": '{ "name": "custom graph", "edges": [], "idea": "keep graph" }',
    ".anvil/board.json": JSON.stringify({ ...board, notes: "keep board" }),
  };
  const writes = projectSettingsWrites(files, { ...settings, testLoop: true });
  const after = { ...files, ...writes };
  assert.equal(after[".anvil/graph.json"], files[".anvil/graph.json"]);
  assert.equal(after[".anvil/board.json"], files[".anvil/board.json"]);
  const harness = JSON.parse(after[".anvil/harness.json"]);
  assert.equal(harness.testLoop, true); assert.equal(harness.maxTools, 11);
  assert.deepEqual(harness.stopOn, ["custom-stop"]); assert.equal(harness.idea, "keep this");
});

test("accepting a suggestion adds missing tools while preserving custom nodes and wires", () => {
  const board = defaultBoard(settings); board.nodes[0].x = 999;
  board.wires.push({ id: "custom", from: "plan", to: "engine", kind: "flow", on: false });
  const files = { "main.py": "print(1)", ".anvil/harness.json": '{"maxTools":11}', ".anvil/graph.json": '{"edges":[],"idea":"keep"}', ".anvil/board.json": JSON.stringify(board) };
  const suggestion = guessProjectHarness(files);
  const writes = projectSettingsWrites(files, settings, suggestion);
  const after = JSON.parse(writes[".anvil/board.json"]);
  assert.deepEqual(after.nodes.slice(0, board.nodes.length), board.nodes);
  assert.deepEqual(after.wires.slice(0, board.wires.length), board.wires);
  assert.deepEqual(after.cam, board.cam);
  assert.ok(after.nodes.some((n: { edge?: { tool: string } }) => n.edge?.tool === "run_file"));
  assert.equal(JSON.parse(writes[".anvil/harness.json"]).maxTools, 11);
  const repeated = projectSettingsWrites({ ...files, ...writes }, settings, suggestion);
  assert.equal(repeated[".anvil/board.json"], undefined);
  assert.equal(repeated[".anvil/graph.json"], undefined);
});

test("invalid project files are reported instead of overwritten", () => {
  for (const file of ["harness", "graph", "board"]) {
    assert.throws(() => projectSettingsWrites({ [`.anvil/${file}.json`]: "{ broken" }, settings), /ungültig/);
  }
  assert.throws(() => projectSettingsWrites({ ".anvil/graph.json": '{"edges":[null]}' }, settings), /ungültig/);
});

test("new projects still receive a usable harness, graph and board", () => {
  const writes = projectSettingsWrites({ "main.py": "print(1)" }, settings);
  assert.equal(JSON.parse(writes[".anvil/harness.json"]).afterWrite, "run");
  assert.ok(JSON.parse(writes[".anvil/graph.json"]).edges.some((e: { tool: string }) => e.tool === "run_file"));
  assert.ok(JSON.parse(writes[".anvil/board.json"]).nodes.length > 0);
});
