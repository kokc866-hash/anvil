import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySetPlan, guessPlan, normalizePlanWho, planAgentMayReplace, planFinish, planFromAsk, planFromTool, planHelperNow, planSeedNow, planStart } from "./plan.ts";
import type { PlanStep } from "@/store/ide";

describe("plan", () => {
  function perform(plan: PlanStep[], name: string, args: Record<string, unknown> = {}, ok = true, extra = {}) {
    const started = planStart(name, plan, args)!;
    return planFromTool(name, started, !ok, args, { ok, ...extra })!;
  }
  it("classified plans advance independently of wording and only after their prerequisites", () => {
    let plan = applySetPlan(undefined, ["Badge und Projektdaten prüfen", "Grünes Abzeichen", "Originalmaße vergleichen", "Godot-Projekt validieren", "Szene zeigen"], false, ["read", "edit", "read", "check", "run"])!;
    plan = perform(plan, "read_file");
    plan = perform(plan, "read_file");
    assert.deepEqual(plan.map(s => s.status), ["ok", "todo", "todo", "todo", "todo"]);
    plan = perform(plan, "edit_file");
    plan = perform(plan, "read_file");
    plan = perform(plan, "engine_run", { action: "check" });
    plan = perform(plan, "engine_run", { action: "play" });
    assert.ok(plan.every(s => s.status === "ok"));
    const bad = applySetPlan(undefined, ["A", "B"], false, ["read", "invented"]);
    assert.ok(bad?.every(s => s.kind === undefined));
  });
  it("engine discovery completes its explicit step without consuming the import check", () => {
    let plan = applySetPlan(undefined, ["Godot-Projekt und Verbindung erkennen", "Godot-Importprüfung ausführen", "Szene starten"], false, ["check", "check", "run"])!;
    plan = perform(plan, "engine_detect");
    assert.deepEqual(plan.map(s => s.status), ["ok", "todo", "todo"]);
    plan = perform(plan, "engine_run", { action: "check" });
    plan = perform(plan, "engine_run", { action: "play" });
    assert.ok(plan.every(s => s.status === "ok"));
  });
  it("follows the real discount repair steps without marking everything on final prose", () => {
    let plan = ["Projektdateien prüfen", "Rabattursache finden", "Korrektur umsetzen", "Tests ausführen", "Browseroberfläche starten"].map(text => ({ text, status: "todo" as const })) as PlanStep[];
    plan = perform(plan, "read_file", { path: "cart.mjs" });
    plan = perform(plan, "read_file", { path: "cart.test.mjs" });
    plan = perform(plan, "edit_file", { path: "cart.mjs" });
    assert.deepEqual(plan.map(s => s.status), ["ok", "ok", "ok", "todo", "todo"]);
    plan = perform(plan, "shell", { command: "npm test" });
    plan = perform(plan, "run_file", { path: "index.html" });
    assert.ok(plan.every(s => s.status === "ok"));
  });
  it("does not certify test or service mutations from unrelated successful commands", () => {
    assert.equal(perform([{ text: "Tests ausführen", status: "todo" }], "shell", { command: "echo test" })[0].status, "todo");
    assert.equal(perform([{ text: "Dienst-Datensatz löschen", status: "todo" }], "mcp_call", { name: "notion-search" })[0].status, "todo");
    for (const text of ["Rundungen anpassen", "Bestehende Funktion erweitern", "Versandlogik gezielt ergänzen", "Oberfläche und Tests anpassen"])
      assert.equal(perform([{ text, status: "todo" }], "edit_file")[0].status, "ok");
    assert.equal(perform([{ text: "Tests ergänzen und ausführen", status: "todo" }], "edit_file")[0].status, "todo");
    assert.equal(perform([{ text: "Tests ergänzen und ausführen", status: "todo" }], "shell", { command: "npm test" })[0].status, "ok");
  });
  it("engine discovery is not a check; check and play each complete their own step", () => {
    let plan = ["Projektdateien und Regeln lesen", "Szene und Badge gezielt anpassen", "Godot-Projekt prüfen", "Szene starten und Ergebnis berichten"].map(text => ({ text, status: "todo" as const })) as PlanStep[];
    plan = perform(plan, "read_file");
    plan = perform(plan, "edit_file");
    plan = perform(plan, "engine_detect");
    assert.equal(plan[2].status, "todo");
    plan = perform(plan, "engine_run", { action: "check" }, false);
    assert.equal(plan[2].status, "err");
    plan = perform(plan, "engine_run", { action: "check" }, true, { running: true });
    assert.notEqual(plan[2].status, "ok");
    plan = perform(plan, "engine_run", { action: "check" });
    assert.equal(plan[2].status, "ok");
    assert.equal(plan[3].status, "todo");
    plan = perform(plan, "engine_run", { action: "play" });
    assert.ok(plan.every(s => s.status === "ok"));
  });
  it("a service catalogue does not prove access; actual fetch/search and delivered summary do", () => {
    let plan = ["Verbindung prüfen", "Nach Anvil suchen", "Ergebnis zusammenfassen"].map(text => ({ text, status: "todo" as const })) as PlanStep[];
    plan = perform(plan, "mcp_list");
    assert.ok(plan.every(s => s.status === "todo"));
    plan = perform(plan, "mcp_call", { name: "notion-fetch" });
    plan = perform(plan, "mcp_call", { name: "notion-search" });
    assert.deepEqual(plan.map(s => s.status), ["ok", "ok", "todo"]);
    plan = planFinish(plan, false, false, true)!;
    assert.ok(plan.every(s => s.status === "ok"));
    assert.equal(planFinish([{ text: "Alles überprüfen", status: "todo" }], false, true, true), null);
  });
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
  it("überarbeiten matches write, run evidence never closes unrelated todos", () => {
    let plan: PlanStep[] = [
      { text: "Referenzen und bestehendes UI prüfen", status: "ok" },
      { text: "Layout, Farben und Interaktionen überarbeiten", status: "todo" },
      { text: "Dateien ausführen und Fehler prüfen", status: "todo" },
    ];
    plan = planFromTool("write_file", plan)!;
    assert.equal(plan[1]?.status, "ok");
    assert.equal(planFinish(plan, false, true), null);
    assert.equal(plan[2]?.status, "todo");
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
  it("classifies a script run and separates Git status from a real commit", () => {
    let plan: PlanStep[] = [{text:'Node ausführen',kind:'run',status:'todo'},{text:'Git-Status prüfen',kind:'read',status:'todo'},{text:'Commit erstellen',kind:'service',status:'todo'}];
    plan=planFromTool('shell',plan,false,{command:'node verified.cjs'},{ok:true})!;
    assert.equal(plan[0].status,'ok');
    plan=planFromTool('git_status',plan,false,{}, {ok:true})!;
    assert.equal(plan[1].status,'ok');assert.equal(plan[2].status,'todo');
    plan=planFromTool('git_commit',plan,true,{}, {ok:false})!;
    assert.equal(plan[2].status,'err');
    plan=planStart('git_commit',plan)!;
    plan=planFromTool('git_commit',plan,false,{}, {ok:true})!;
    assert.equal(plan[2].status,'ok');
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
