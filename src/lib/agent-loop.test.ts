import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyGitClone, keepAgentTool, pinHistory } from "./agent-select.ts";
import { blocksToWriteCalls, harvestTools } from "./agent-parse.ts";

describe("keepAgentTool", () => {
  it("ask mode is read-only", () => {
    assert.equal(keepAgentTool("read_file", { observeOnly: true }), true);
    assert.equal(keepAgentTool("grep", { observeOnly: true }), true);
    assert.equal(keepAgentTool("write_file", { observeOnly: true }), false);
    assert.equal(keepAgentTool("ask_user", { observeOnly: true }), true);
    assert.equal(keepAgentTool("mcp_call", { observeOnly: true }), false);
  });
  it("drops engine/debug/git unless asked", () => {
    assert.equal(keepAgentTool("write_file", {}), true);
    assert.equal(keepAgentTool("ask_user", {}), true);
    assert.equal(keepAgentTool("engine_run", {}), false);
    assert.equal(keepAgentTool("debug_start", {}), false);
    assert.equal(keepAgentTool("git_clone", {}), false);
    assert.equal(keepAgentTool("engine_run", { engine: true }), true);
    assert.equal(keepAgentTool("debug_start", { debug: true }), true);
    assert.equal(keepAgentTool("git_clone", { git: true }), true);
    assert.equal(keepAgentTool("mcp_call", { mcp: true }), true);
    assert.equal(keepAgentTool("skill_run", { skills: true }), true);
  });
});

describe("pinHistory", () => {
  it("keeps the first user message when tail would drop it", () => {
    const msgs = [
      { role: "user" as const, content: "BUILD THE APP" },
      ...Array.from({ length: 70 }, (_, i) => ({ role: (i % 2 ? "user" : "assistant") as "user" | "assistant", content: `m${i}` })),
    ];
    const pinned = pinHistory(msgs, 8);
    assert.equal(pinned[0]?.content, "BUILD THE APP");
    assert.ok(pinned.length <= 9);
  });
});

describe("applyGitClone", () => {
  it("merges without wiping unless replace", () => {
    const files = new Map<string, string>([["keep.ts", "x"], ["old.ts", "y"]]);
    const dirs = new Set<string>();
    const deleted: string[] = [];
    const incoming = [{ path: "src/a.ts", content: "a" }, { path: "old.ts", content: "z" }];
    const wiped = applyGitClone(files, dirs, deleted, incoming, false);
    assert.equal(wiped.length, 0);
    assert.equal(files.get("keep.ts"), "x");
    assert.equal(files.get("old.ts"), "z");
    assert.equal(files.get("src/a.ts"), "a");
  });
  it("replace wipes first", () => {
    const files = new Map<string, string>([["keep.ts", "x"]]);
    const dirs = new Set<string>();
    const deleted: string[] = [];
    applyGitClone(files, dirs, deleted, [{ path: "n.ts", content: "n" }], true);
    assert.equal(files.get("keep.ts"), undefined);
    assert.equal(files.get("n.ts"), "n");
    assert.ok(deleted.includes("keep.ts"));
  });
});

describe("harvest extras", () => {
  it("picks debug and git from prose", () => {
    const h = harvestTools(`<tool_call>\n{"name":"debug_start","arguments":{"path":"a.py"}}\n</tool_call>`);
    assert.equal(h[0]?.function.name, "debug_start");
    const g = harvestTools(`<tool_call>\n{"name":"git_status","arguments":{}}\n</tool_call>`);
    assert.equal(g[0]?.function.name, "git_status");
  });
  it("turns fences into write_file calls", () => {
    const calls = blocksToWriteCalls([{ path: "a.ts", content: "x" }]);
    assert.equal(calls[0]?.function.name, "write_file");
    assert.match(calls[0]?.function.arguments ?? "", /a\.ts/);
  });
});
