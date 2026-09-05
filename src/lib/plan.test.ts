import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySetPlan, guessPlan, normalizePlanWho, planAgentMayReplace, planFinish, planFromAsk, planFromTool, planHelperNow, planSeedNow, planStart } from "./plan.ts";
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
  it("überarbeiten matches write, round end closes leftover todos", () => {
    let plan: PlanStep[] = [
      { text: "Referenzen und bestehendes UI prüfen", status: "ok" },
      { text: "Layout, Farben und Interaktionen überarbeiten", status: "todo" },
      { text: "Dateien ausführen und Fehler prüfen", status: "todo" },
    ];
    plan = planFromTool("write_file", plan)!;
    assert.equal(plan[1]?.status, "ok");
    plan = planFinish(plan, false, true)!;
    assert.equal(plan.every((s) => s.status === "ok"), true);
  });
  it("unproved finish leaves leftover todos", () => {
    const left = planFinish(
      [
        { text: "Ändern", status: "ok" },
        { text: "Run", status: "todo" },
      ],
      false,
      false,
    );
    assert.equal(left, null);
  });
  it("failed finish only errors the running step", () => {
    const plan = planFinish(
      [
        { text: "A", status: "ok" },
        { text: "B", status: "run" },
        { text: "C", status: "todo" },
      ],
      true,
    )!;
    assert.equal(plan[1]?.status, "err");
    assert.equal(plan[2]?.status, "todo");
  });
  it("english guess and mcp advances MCP step", () => {
    const g = guessPlan("open the ziva surface", "en");
    assert.ok(g.some((s) => s.text === "MCP"));
    let plan = guessPlan("call mcp tools", "de");
    plan = planStart("mcp_call", plan)!;
    const mcp = plan.find((s) => /mcp/i.test(s.text))!;
    assert.equal(mcp.status, "run");
    plan = planFromTool("mcp_call", plan)!;
    assert.equal(plan.find((s) => /mcp/i.test(s.text))?.status, "ok");
  });
  it("keeps the prompt plan against set_plan", () => {
    const ask = "1. Write files\n2. Run Python\n3. Run C++\n4. Open HTML";
    assert.equal(planFromAsk(ask), true);
    const cur = guessPlan(ask, "en");
    assert.ok(cur.length >= 3);
    assert.equal(applySetPlan(cur, ["Verstehen", "Ändern", "Run", "Prüfen"], true), null);
    assert.equal(applySetPlan(cur, ["A", "B", "C"], false)?.[0]?.text, "A");
  });
  it("set_plan does not wipe progress", () => {
    const cur: PlanStep[] = [
      { text: "Write", status: "ok" },
      { text: "Run", status: "todo" },
    ];
    assert.equal(applySetPlan(cur, ["Neu", "Plan", "Hier"]), null);
  });
  it("planWho auto/anvil/helper/agent", () => {
    assert.equal(normalizePlanWho("nope"), "auto");
    assert.equal(planSeedNow("anvil"), true);
    assert.equal(planSeedNow("agent"), false);
    assert.equal(planHelperNow("helper", true, true), true);
    assert.equal(planHelperNow("auto", true, false), false);
    assert.equal(planAgentMayReplace("anvil", false), false);
    assert.equal(planAgentMayReplace("agent", true), true);
    assert.equal(planAgentMayReplace("auto", true), false);
  });
});