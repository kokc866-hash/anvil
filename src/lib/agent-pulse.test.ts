import assert from "node:assert/strict";
import { test } from "node:test";
import { pulseKind } from "./agent-pulse.ts";

test("pulseKind idle", () => {
  assert.equal(pulseKind({ busy: false }), null);
});

test("pulseKind maps tools and think", () => {
  assert.equal(pulseKind({ busy: true }), "wait");
  assert.equal(pulseKind({ busy: true, thinking: "hmm" }), "think");
  assert.equal(pulseKind({ busy: true, thinking: "hmm", content: "hi" }), "write");
  assert.equal(pulseKind({ busy: true, steps: [{ name: "read_file", status: "run" }] }), "read");
  assert.equal(pulseKind({ busy: true, steps: [{ name: "write_file", status: "run" }] }), "edit");
  assert.equal(pulseKind({ busy: true, steps: [{ name: "run_file", status: "run" }] }), "run");
  assert.equal(pulseKind({ busy: true, steps: [{ name: "grep", status: "run" }] }), "search");
  assert.equal(pulseKind({ busy: true, steps: [{ name: "mcp_call", status: "run" }] }), "tool");
});
