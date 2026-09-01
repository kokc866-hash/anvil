import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guessPlan, planFromTool, planStart } from "./plan.ts";
import type { PlanStep } from "@/store/ide";

describe("plan", () => {
  it("does not check Prüfen while Verstehen is still running", () => {
    let plan = guessPlan("mach das spiel bunt");
    plan = planStart("read_file", plan)!;
    plan = planFromTool("run_file", plan)!;
    plan = planFromTool("see_run", plan)!;
    const verstehen = plan.find((s) => /versteh/i.test(s.text))!;
    const pruefen = plan.find((s) => /prüf/i.test(s.text))!;
    assert.equal(verstehen.status, "run");
    assert.notEqual(pruefen.status, "ok");
  });
  it("run_file completes Run, not Prüfen", () => {
    let plan: PlanStep[] = [
      { text: "Verstehen", status: "ok" },
      { text: "Ändern", status: "ok" },
      { text: "Run", status: "todo" },
      { text: "Prüfen", status: "todo" },
    ];
    plan = planStart("run_file", plan)!;
    assert.equal(plan[2]?.status, "run");
    plan = planFromTool("run_file", plan)!;
    assert.equal(plan[2]?.status, "ok");
    assert.equal(plan[3]?.status, "todo");
  });
  it("failed run marks Run err, leaves Prüfen", () => {
    let plan: PlanStep[] = [
      { text: "Verstehen", status: "ok" },
      { text: "Ändern", status: "ok" },
      { text: "Run", status: "run" },
      { text: "Prüfen", status: "todo" },
    ];
    plan = planFromTool("run_file", plan, true)!;
    assert.equal(plan[2]?.status, "err");
    assert.equal(plan[3]?.status, "todo");
  });
});
