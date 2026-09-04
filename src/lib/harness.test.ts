import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startHarness } from "./harness.ts";
import { afterTool, applyHarnessTool, guessProjectHarness, mergeHarnessGraph, mergeOpts } from "./harness-project.ts";
import { GRAPH_TOOLS, globScore, matchGlob, pickProjectEdge } from "./harness-graph.ts";
import {
  addEdgeNode,
  applyBoardTool,
  applySettings,
  compileBoard,
  connectNodes,
  defaultBoard,
  rebuildBoardFromGraph,
  resetLayout,
  routeAll,
  syncBoardFromFiles,
  syncBoardSettings,
  toggleWire,
} from "./harness-board.ts";

describe("harness loop", () => {
  const o = { afterWrite: "run" as const, runLoop: true, graphLoop: true, loopTries: 3 };
  it("asks for run after write", () => {
    let h = startHarness(o);
    const w = afterTool(h, "write_file", { path: "src/a.py" }, o);
    assert.ok(w.inject);
  });
  it("does not auto-run when runLoop off", () => {
    const off = { afterWrite: "run" as const, runLoop: false, graphLoop: false, loopTries: 3 };
    const w = afterTool(startHarness(off), "write_file", { path: "src/a.py" }, off);
    assert.equal(w.inject ?? "", "");
  });
  it("patches after failed run", () => {
    let h = startHarness(o);
    h = afterTool(h, "write_file", { path: "src/a.py" }, o).state;
    const w = afterTool(h, "run_file", { path: "src/a.py", ok: false, stderr: "boom" }, o);
    assert.ok(w.inject);
  });
  it("see after graphical run", () => {
    const g = { ...o, afterWrite: "preview" as const };
    let h = startHarness(g);
    h = afterTool(h, "write_file", { path: "index.html" }, g).state;
    const w = afterTool(h, "run_file", { path: "index.html", ok: true, html: "<canvas>" }, g);
    assert.ok(w.inject || w.state);
  });
  it("one see after html even if graphLoop off", () => {
    const g = { afterWrite: "run" as const, runLoop: true, graphLoop: false, loopTries: 3 };
    let h = startHarness(g);
    assert.equal(h.budget.sees, 0);
    h = afterTool(h, "write_file", { path: "index.html" }, g).state;
    const w = afterTool(h, "run_file", { path: "index.html", ok: true, html: "<canvas>" }, g);
    assert.equal(w.inject ?? "", "");
  });
  it("marks done after a plain successful run", () => {
    let h = startHarness(o);
    h = afterTool(h, "write_file", { path: "src/a.py" }, o).state;
    const w = afterTool(h, "run_file", { path: "src/a.py", ok: true, stdout: "ok" }, o);
    assert.equal(w.state.phase, "act");
    assert.equal(w.stop, false);
    assert.equal(w.inject ?? "", "");
  });
  it("skips run hint when run_file is already queued", () => {
    const w = afterTool(startHarness(o), "write_file", { path: "src/a.py" }, { ...o, queued: ["run_file"] });
    assert.equal(w.inject ?? "", "");
  });
});

describe("project harness", () => {
  it("guesses engine", () => {
    const g = guessProjectHarness({ "project.godot": "" });
    assert.ok(g.harness.afterWrite === "engine" || g.graph.edges?.some((e) => e.edge === "engine"));
  });
  it("writes files", () => {
    const out = applyHarnessTool("harness_write", { name: "t", when: "app" }, {});
    assert.ok(out.writes?.[".anvil/harness.json"]);
  });
  it("guesses from html", () => {
    const g = guessProjectHarness({ "index.html": "<canvas>" });
    assert.ok(g.harness);
    assert.ok(g.graph.edges?.some((e) => e.tool === "see_run"));
    assert.ok(g.graph.edges?.some((e) => e.tool === "run_file"));
  });
  it("testLoop only when real test files exist, not every package.json", () => {
    const none = guessProjectHarness({ "package.json": "{}", "index.html": "<p>" });
    assert.equal(none.harness.testLoop, false);
    const yes = guessProjectHarness({ "tests/test_add.py": "def test_add():\n  pass\n" });
    assert.equal(yes.harness.testLoop, true);
  });
  it("graph_write without edges uses sources not append", () => {
    const files = { "index.html": "<p>", "main.py": "print(1)" };
    const a = applyHarnessTool("graph_write", {}, files);
    const b = applyHarnessTool("graph_write", {}, { ...files, ...(a.writes ?? {}) });
    const ga = JSON.parse(a.writes![".anvil/graph.json"] as string) as { edges: { tool?: string }[] };
    const gb = JSON.parse(b.writes![".anvil/graph.json"] as string) as { edges: { tool?: string }[] };
    assert.equal(ga.edges.length, gb.edges.length);
    assert.ok(ga.edges.some((e) => e.tool === "run_file"));
  });
});

describe("board", () => {
  const s = { runLoop: true, graphLoop: true, afterWrite: "run" as const, loopTries: 3, maxRounds: 12 };
  it("compiles fail wire to runLoop", () => {
    const b = defaultBoard(s);
    const c = compileBoard(b, s);
    assert.equal(c.harness.runLoop, true);
    assert.equal(c.harness.graphLoop, true);
  });
  it("has a full tool catalog", () => {
    assert.ok(GRAPH_TOOLS.length >= 12);
    assert.ok(GRAPH_TOOLS.some((t) => t.id === "format_file"));
    assert.ok(GRAPH_TOOLS.some((t) => t.id === "mcp_call"));
  });
  it("engine wire adds engine edge", () => {
    const b = defaultBoard({ ...s, afterWrite: "engine", graphLoop: false });
    const c = compileBoard(b, s);
    assert.ok(c.graph.edges?.some((e) => e.tool === "engine_run"));
    assert.ok(c.graph.edges?.some((e) => e.tool === "see_run"));
    assert.ok(c.graph.edges?.some((e) => e.tool === "run_file"));
    assert.equal(c.harness.afterWrite, "run");
    assert.equal(c.harness.runLoop, true);
    assert.equal(c.harness.graphLoop, true);
  });
  it("pairs fail wires", () => {
    const b = toggleWire(defaultBoard(s), "obs-patch");
    assert.equal(b.wires.find((w) => w.id === "obs-patch")?.on, false);
    assert.equal(b.wires.filter((w) => w.kind === "fail" && w.on).length, 0);
  });
  it("does not draw return wires", () => {
    const ids = defaultBoard(s).wires.map((w) => w.id);
    assert.ok(!ids.includes("see-obs"));
    assert.ok(!ids.includes("patch-act"));
  });
  it("new graph node has a wire", () => {
    const b = addEdgeNode(defaultBoard(s), { when: "html", edge: "preview", tool: "see_run", glob: "*.html" });
    assert.ok(b.nodes.some((n) => n.kind === "edge"));
    assert.ok(b.wires.some((w) => w.to.startsWith("e-")));
    assert.equal(b.wires.find((w) => w.to.startsWith("e-"))?.from, "see");
  });
  it("skill hangs on act not run", () => {
    const b = addEdgeNode(defaultBoard(s), { when: "skill", edge: "skill", tool: "skill_run", glob: "*" });
    assert.equal(b.wires.find((w) => w.to.startsWith("e-"))?.from, "act");
  });
  it("connects two nodes", () => {
    const b = connectNodes(defaultBoard(s), "act", "see");
    const w = b.wires.find((x) => x.from === "act" && x.to === "see");
    assert.ok(w);
    assert.equal(w?.kind, "see");
  });
  it("gives parallel wires different rails", () => {
    const r = routeAll(defaultBoard(s));
    const see = r.get("obs-see")?.d ?? "";
    const patch = r.get("obs-patch")?.d ?? "";
    const eng = r.get("obs-eng")?.d ?? "";
    assert.notEqual(see, patch);
    assert.notEqual(patch, eng);
    assert.notEqual(see, eng);
  });
  it("resetLayout is factory default", () => {
    let b = addEdgeNode(defaultBoard(s), { when: "x", edge: "skill", tool: "skill_run", glob: "*" });
    b = resetLayout(b, s);
    assert.equal(b.nodes.filter((n) => n.kind === "edge").length, 0);
    assert.ok(b.wires.some((w) => w.id === "plan-act"));
  });
  it("board_write add and connect", () => {
    const files = applyBoardTool("board_reset", {}, {}).writes ?? {};
    const add = applyBoardTool("board_write", { tool: "skill_run", edge: "skill", glob: "*" }, files);
    assert.ok(add.writes?.[".anvil/board.json"]);
    assert.match(JSON.stringify(add.result), /skill_run/);
    const conn = applyBoardTool("board_write", { from: "act", to: "see" }, add.writes ?? files);
    assert.match(JSON.stringify(conn.result), /"from":"act"/);
  });
  it("rebuilds board from sources instead of appending", () => {
    const files = {
      "index.html": "<p>",
      ".anvil/graph.json": JSON.stringify({ name: "old", edges: [{ when: "x", edge: "skill", tool: "skill_run", glob: "*" }] }),
    };
    const out = applyBoardTool("board_write", { fromSources: true }, files);
    const json = JSON.stringify(out.result);
    assert.match(json, /see_run|run_file/);
    assert.doesNotMatch(json, /skill_run/);
    const rebuilt = rebuildBoardFromGraph([{ when: "html", edge: "preview", tool: "see_run", glob: "*.html" }], s);
    assert.equal(rebuilt.nodes.filter((n) => n.kind === "edge").length, 1);
  });
  it("sync replaces stale graph nodes", () => {
    const files = {
      ".anvil/graph.json": JSON.stringify({
        edges: [{ when: "py", edge: "run", tool: "run_file", glob: "*.py" }],
      }),
      ".anvil/board.json": JSON.stringify(
        addEdgeNode(defaultBoard(s), { when: "old", edge: "skill", tool: "skill_run", glob: "*" }),
      ),
    };
    const next = syncBoardFromFiles(files);
    assert.match(next[".anvil/board.json"] ?? "", /run_file/);
    assert.doesNotMatch(next[".anvil/board.json"] ?? "", /skill_run/);
  });
  it("pipeline is a tree not a net", () => {
    const b = rebuildBoardFromGraph(
      [
        { when: "html", edge: "preview", tool: "see_run", glob: "*.html" },
        { when: "py", edge: "run", tool: "run_file", glob: "*.py" },
        { when: "fmt", edge: "format", tool: "format_file", glob: "*.js" },
        { when: "html", edge: "preview", tool: "see_run", glob: "*.html" },
      ],
      s,
    );
    const tools = b.nodes.filter((n) => n.kind === "edge");
    assert.equal(tools.length, 3);
    for (const n of tools) {
      const ins = b.wires.filter((w) => w.to === n.id);
      assert.equal(ins.length, 1, n.label);
      const parent = b.nodes.find((x) => x.id === ins[0].from);
      assert.equal(parent?.kind, "phase");
      assert.equal(n.x, parent?.x);
    }
    assert.ok(
      !b.wires.some((w) => {
        const a = b.nodes.find((n) => n.id === w.from);
        const c = b.nodes.find((n) => n.id === w.to);
        return a?.kind === "edge" && c?.kind === "edge";
      }),
    );
    assert.ok(!b.wires.some((w) => w.from === "see" && w.to === "observe"));
  });
  it("engine wire follows engineLoop", () => {
    let b = defaultBoard(s);
    b = { ...b, wires: b.wires.map((w) => (w.kind === "engine" ? { ...w, on: true } : w)) };
    const c = compileBoard(b, s);
    assert.equal(c.harness.engineLoop, true);
    const keep = applySettings(b, { ...s, afterWrite: "run", engineLoop: true });
    assert.equal(keep.wires.find((w) => w.kind === "engine")?.on, true);
    const off = applySettings(b, { ...s, afterWrite: "run", engineLoop: false });
    assert.equal(off.wires.find((w) => w.kind === "engine")?.on, false);
  });
  it("toggling patch spine does not kill test leaves", () => {
    let b = addEdgeNode(defaultBoard(s), { when: "t", edge: "test", tool: "shell", glob: "tests/**" });
    const leaf = b.wires.find((w) => w.to.startsWith("e-"));
    assert.ok(leaf);
    b = toggleWire(b, "obs-patch");
    assert.equal(b.wires.find((w) => w.id === "obs-patch")?.on, false);
    assert.equal(b.wires.find((w) => w.id === leaf!.id)?.on, true);
  });
  it("compileBoard keeps testLoop from settings", () => {
    const c = compileBoard(defaultBoard({ ...s, testLoop: true }), { ...s, testLoop: true });
    assert.equal(c.harness.testLoop, true);
    assert.equal(c.harness.afterWrite, "run");
  });
  it("harness settings sync keeps extra nodes", () => {
    const files = applyBoardTool("board_write", { tool: "skill_run", edge: "skill", glob: "*" }, applyBoardTool("board_reset", {}, {}).writes ?? {}).writes ?? {};
    const next = syncBoardSettings({
      ...files,
      ".anvil/harness.json": JSON.stringify({ name: "t", runLoop: true, testLoop: true, afterWrite: "run" }),
    });
    assert.match(next[".anvil/board.json"] ?? "", /skill_run/);
  });
});

describe("tafel holes", () => {
  const o = { afterWrite: "run" as const, runLoop: true, graphLoop: true, loopTries: 3 };
  const s = { runLoop: true, graphLoop: true, afterWrite: "run" as const, loopTries: 3, maxRounds: 12 };
  it("Cargo.toml alone is not an engine", () => {
    const cli = guessProjectHarness({ "Cargo.toml": "[package]\nname='x'\n", "src/main.rs": "fn main(){}" });
    assert.equal(cli.harness.engineLoop, false);
    assert.equal(cli.harness.afterWrite, "run");
    assert.ok(cli.graph.edges?.some((e) => e.tool === "run_file" && (e.glob ?? "").includes("rs")));
    const bevy = guessProjectHarness({ "Cargo.toml": "[dependencies]\nbevy = '0.13'\n", "src/main.rs": "" });
    assert.equal(bevy.harness.engineLoop, true);
  });
  it("star glob is catch-all with lowest score", () => {
    assert.equal(matchGlob("src/a.py", "*"), true);
    assert.equal(matchGlob("src/a.py", "*.py"), true);
    assert.equal(matchGlob("src/a.py", "*.js"), false);
    assert.equal(matchGlob("tests/foo.py", "tests/**"), true);
    assert.equal(matchGlob("src/a.py", "tests/**"), false);
    assert.ok(globScore("*.py") > globScore("*"));
  });
  it("run beats format on write", () => {
    const hit = pickProjectEdge(
      "src/app.ts",
      [
        { when: "fmt", edge: "format", tool: "format_file", glob: "*.{js,ts,tsx,json,html,css}" },
        { when: "js", edge: "run", tool: "run_file", glob: "*.{js,ts,tsx,mjs}" },
      ],
      "write",
    );
    assert.equal(hit?.tool, "run_file");
  });
  it("after write injects run not format", () => {
    const edges = guessProjectHarness({ "app.ts": "export {}" }).graph.edges ?? [];
    const w = afterTool(startHarness(o), "write_file", { path: "app.ts" }, { ...o, edges });
    assert.match(w.inject, /run_file/);
    assert.doesNotMatch(w.inject, /format_file/);
  });
  it("queued run is not a green proof", () => {
    let h = startHarness(o);
    h = afterTool(h, "write_file", { path: "a.py" }, o).state;
    const w = afterTool(h, "run_file", { path: "a.py", queued: "a.py", hint: "later" }, o);
    assert.notEqual(w.state.phase, "done");
  });
  it("counts patch after read between fail and edit", () => {
    let h = startHarness(o);
    h = afterTool(h, "write_file", { path: "a.py" }, o).state;
    h = afterTool(h, "run_file", { path: "a.py", ok: false, stderr: "x" }, o).state;
    h = afterTool(h, "read_file", { path: "a.py" }, o).state;
    const w = afterTool(h, "edit_file", { path: "a.py" }, o);
    assert.ok(w.state.used.patches >= 1);
  });
  it("harness_write can turn runLoop off", () => {
    const out = applyHarnessTool("harness_write", { name: "t", runLoop: false }, {});
    const h = JSON.parse(out.writes![".anvil/harness.json"] as string) as { runLoop: boolean };
    assert.equal(h.runLoop, false);
  });
  it("UI loop/graph off beats project harness.json", () => {
    const merged = mergeOpts(
      { runLoop: false, graphLoop: false, loopTries: 3, afterWrite: "run" },
      { runLoop: true, graphLoop: true, afterWrite: "run", loopTries: 3 },
    );
    assert.equal(merged.runLoop, false);
    assert.equal(merged.graphLoop, false);
    assert.equal(merged.afterWrite, "none");
  });
  it("drops graph when it contradicts allow list", () => {
    const tick = {
      state: startHarness(o),
      allow: ["run_file"],
      hint: "run_file this round.",
      stop: false,
    };
    const text = mergeHarnessGraph(tick, { edge: "format", tool: "format_file", why: "fmt" });
    assert.doesNotMatch(text, /format_file/);
    assert.match(text, /run_file/);
  });
  it("two edge nodes get distinct ids", () => {
    let b = defaultBoard(s);
    b = addEdgeNode(b, { when: "a", edge: "run", tool: "run_file", glob: "*.py" });
    b = addEdgeNode(b, { when: "b", edge: "run", tool: "run_file", glob: "*.js" });
    const ids = b.nodes.filter((n) => n.kind === "edge").map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
