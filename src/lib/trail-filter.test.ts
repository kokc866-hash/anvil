import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterTrailSteps, hasTrailMsg, shortTrail, stepLabel, stepPath, type TrailStep } from "./trail-filter.ts";

function step(p: Partial<TrailStep> & { name: string }): TrailStep {
  return { id: p.id ?? p.name, detail: p.detail ?? "", status: p.status ?? "ok", ...p };
}

describe("trail-filter", () => {
  it("hides set_plan, keeps mcp_list", () => {
    const out = filterTrailSteps([
      step({ name: "set_plan", detail: "a b c" }),
      step({ name: "mcp_list", detail: "tools" }),
      step({ name: "write_file", path: "a.ts", detail: "a.ts" }),
    ]);
    assert.equal(out.some((s) => s.name === "set_plan"), false);
    assert.ok(out.some((s) => s.name === "mcp_list"));
  });
  it("folds reads and keeps paths", () => {
    const out = filterTrailSteps([
      step({ name: "read_file", detail: "src/a.ts" }),
      step({ name: "read_file", detail: "src/b.ts" }),
      step({ name: "read_file", detail: "src/c.ts" }),
    ]);
    assert.equal(out.length, 1);
    assert.match(out[0]?.detail ?? "", /3×/);
    assert.match(out[0]?.detail ?? "", /a\.ts/);
  });
  it("keeps running steps and extracts path", () => {
    const out = filterTrailSteps([step({ name: "read_file", status: "run", detail: "app/main.py" })]);
    assert.equal(out[0]?.status, "run");
    assert.equal(stepPath(out[0]!), "app/main.py");
  });
  it("labels follow locale", () => {
    assert.equal(stepLabel("write_file", "de"), "Schreiben");
    assert.equal(stepLabel("write_file", "en"), "Write");
  });
  it("hasTrailMsg and shortTrail", () => {
    assert.equal(hasTrailMsg({}), false);
    assert.ok(hasTrailMsg({ lastRun: { ok: true } }));
    assert.equal(shortTrail("x".repeat(90)).endsWith("…"), true);
  });
});
