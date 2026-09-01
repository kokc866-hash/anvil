import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, fromPairs, hasCycle, isArborescence, topoSort, wouldCycle } from "./graph-theory.ts";
import { connectNodes, defaultBoard, rebuildBoardFromGraph } from "./harness-board.ts";

test("path has no cycle and topo order", () => {
  const g = fromPairs(["a", "b", "c"], [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ]);
  assert.equal(hasCycle(g), false);
  assert.deepEqual(topoSort(g), ["a", "b", "c"]);
  assert.equal(classify(g, "a"), "path");
});

test("back edge is a cycle", () => {
  const g = fromPairs(["a", "b"], [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
  ]);
  assert.equal(hasCycle(g), true);
  assert.equal(topoSort(g), null);
  assert.equal(classify(g, "a"), "cyclic");
});

test("tree from root is arborescence", () => {
  const g = fromPairs(["p", "a", "b"], [
    { from: "p", to: "a" },
    { from: "p", to: "b" },
  ]);
  assert.equal(isArborescence(g, "p"), true);
  assert.equal(classify(g, "p"), "tree");
});

test("wouldCycle detects closing a loop", () => {
  const g = fromPairs(["a", "b", "c"], [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ]);
  assert.equal(wouldCycle(g, "c", "a"), true);
  assert.equal(wouldCycle(g, "a", "c"), false);
});

test("board refuses reverse wire", () => {
  const s = { runLoop: true, graphLoop: true, afterWrite: "run" as const, loopTries: 3, maxRounds: 12 };
  const b = defaultBoard(s);
  const next = connectNodes(b, "done", "plan");
  assert.equal(next.wires.length, b.wires.length);
});

test("structured board is tree or dag not cyclic", () => {
  const s = { runLoop: true, graphLoop: true, afterWrite: "run" as const, loopTries: 3, maxRounds: 12 };
  const b = rebuildBoardFromGraph(
    [
      { when: "py", edge: "run", tool: "run_file", glob: "*.py" },
      { when: "html", edge: "preview", tool: "see_run", glob: "*.html" },
    ],
    s,
  );
  const kind = classify(
    fromPairs(
      b.nodes.map((n) => n.id),
      b.wires.filter((w) => w.on).map((w) => ({ from: w.from, to: w.to })),
    ),
    "plan",
  );
  assert.ok(kind === "tree" || kind === "dag" || kind === "path", kind);
});
