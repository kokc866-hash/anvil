import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlanProgress } from './plan-progress.ts';
import { describe, it } from "node:test";
import { applySetPlan, guessPlan, initialAgentPlan, normalizePlanWho, planAgentMayReplace, planFinish, planFromAsk, planFromTool, planHelperNow, planSeedNow, planStart, visibleAgentPlan } from "./plan.ts";
import type { PlanStep } from "@/store/ide";

describe("plan", () => {
  it("all twelve explicit workshop requirements survive the UI seed, set_plan and recovery", () => {
    const work = readFileSync('fixtures/workshop-task.txt', 'utf8');
    const plan = initialAgentPlan(work, undefined, 'auto', 'de');
    assert.equal(plan.length, 12);
    assert.match(plan[10].text, /Tastaturbedienung/);
    assert.match(plan[11].text, /schmalen Fenstern/);
    const applied = applySetPlan(undefined, plan.map(s => s.text), false)!;
    assert.equal(applied.length, 12);
    const tracker = new PlanProgress(); tracker.sync(applied);
    assert.equal(tracker.snapshot().plan.length, 12);
    const restored = new PlanProgress(); assert.equal(restored.restore(tracker.snapshot()), true);
    assert.deepEqual(restored.plan, applied);
    assert.ok(restored.plan.every(s => s.status === 'todo'));
    assert.equal(initialAgentPlan(work, plan.slice(0, 10)).length, 12, 'a legacy untouched prefix can be upgraded');
    assert.equal(initialAgentPlan(work, plan.slice(0, 10).map((s, i) => i ? s : { ...s, status: 'ok' as const })).length, 10, 'existing progress is preserved');
  });
  it("starts an agent-owned task with a visible unconfirmed checklist even without set_plan", () => {
    const plan = initialAgentPlan("Verbessere das Spiel und ergänze ein Ziel.", undefined, "agent", "de");
    assert.ok(plan.length >= 3);
    assert.ok(plan.some(s => s.kind === "check"));
    assert.ok(plan.every(s => s.status === "todo"));
    assert.equal(planFinish(plan, false, false, true), null, "prose alone cannot certify work");
    assert.ok(applySetPlan(plan, ["Spiel untersuchen", "Ziel ergänzen", "Ziel erreichen prüfen"], false, ["read", "edit", "check"]), "the agent can refine the untouched fallback");
  });
  it("keeps current progress and real prompt lists without mistaking multiline prose for steps", () => {
    const current: PlanStep[] = [{ text: "Spielziel ergänzen", status: "ok", kind: "edit" }, { text: "Level abschließen", status: "todo", kind: "check" }];
    assert.deepEqual(initialAgentPlan("weiter", current, "agent"), current);
    assert.notEqual(initialAgentPlan("weiter", current, "agent"), current);
    const ask = "1. Gegner ergänzen\n2. Levelabschluss prüfen";
    assert.equal(planFromAsk(ask), true);
    assert.deepEqual(initialAgentPlan(ask, undefined, "agent").map(s => s.text), ["Gegner ergänzen", "Levelabschluss prüfen"]);
    assert.equal(planFromAsk("Das Spiel ist blau.\nDer Held springt.\nDer Himmel ist grau."), false);
    assert.deepEqual(initialAgentPlan("", undefined, "agent"), []);
    assert.deepEqual(initialAgentPlan("Prüfe die Funktion.", undefined, "helper"), []);
    const investigation = initialAgentPlan("Analysiere die Ursache, ohne Dateien zu ändern.", undefined, "agent");
    assert.ok(investigation.every(s => s.kind !== "edit"));
    assert.ok(initialAgentPlan("Prüfe die Steuerung.", undefined, "agent").every(s => s.kind !== "edit"));
    assert.ok(initialAgentPlan("Prüfe und behebe den Fehler.", undefined, "agent").some(s => s.kind === "edit"));
    assert.deepEqual(initialAgentPlan("Beschreibe das angehängte Bild.", undefined, "agent"), []);
    for (const prompt of ["Antworte kurz, ohne Werkzeuge, ohne Änderungen und ohne Tests.", "Beantworte nur die Frage.", "Answer the question briefly.", "Please respond with a short summary."]) {
      assert.deepEqual(initialAgentPlan(prompt, undefined, "agent"), [], prompt);
    }
    assert.deepEqual(initialAgentPlan("Read notes.txt. Do not make changes.", undefined, "agent").map(s=>s.kind), ["read","report"]);
    assert.deepEqual(initialAgentPlan("Run node log.cjs once. Do not edit files.", undefined, "agent").map(s=>s.kind), ["run","report"]);
    assert.equal(planHelperNow("helper", true, true), false, "the helper must preserve an explicit user list too");
  });
  it("selects only the current assistant checklist and does not resurrect a finished older task", () => {
    const prior: PlanStep[] = [{text:"Vorheriger Auftrag",status:"ok"}];
    const chat = [{id:"old",role:"assistant",plan:prior},{id:"user",role:"user"},{id:"new",role:"assistant",plan:[]}];
    assert.deepEqual(visibleAgentPlan(chat), []);
    assert.deepEqual(visibleAgentPlan(chat, undefined, "old"), prior);
    assert.deepEqual(visibleAgentPlan(chat, prior, "missing"), prior);
  });
  it("uses the shared task restrictions for observation and expected failures for every seeded owner", () => {
    const observation = "Observe the intentional negative test in FreeCAD. Do not repair, edit or change anything.";
    for (const owner of ["auto", "agent", "anvil"] as const) {
      const plan = initialAgentPlan(observation, undefined, owner, "en");
      assert.ok(plan.length >= 2, owner);
      assert.ok(plan.every(s => s.kind !== "edit" && s.kind !== "check"), `${owner}: observation must not demand a repair or an extra verification loop`);
      assert.ok(plan.every(s => s.status === "todo"));
      const negative = initialAgentPlan("Run negative.js once. It is an intentional negative test. Do not repair, edit or change files.", undefined, owner, "en");
      assert.deepEqual(negative.map(s => s.kind), ["run", "report"]);
      assert.ok(initialAgentPlan("Only inspect the current files; do not modify or repair anything.", undefined, owner).every(s => s.kind !== "edit"));
    }
    assert.ok(initialAgentPlan("Fix the addition function. Do not change unrelated files.", undefined, "agent").some(s => s.kind === "edit"), "a restriction protecting unrelated files does not prohibit the requested change");
    for (const ask of ["Read main.cjs, fix the bug and test it.", "Lies main.cjs, repariere den Fehler und teste ihn.", "Explain the bug, then fix it and test the result.", "Beschreibe den Fehler und implementiere die Korrektur."])
      assert.ok(initialAgentPlan(ask, undefined, "agent").some(s => s.kind === "edit"), ask);
  });
  it("can inspect an empty project with list_files before creating anything", () => {
    const plan = initialAgentPlan("Create a new small game in this empty project.", undefined, "agent", "en");
    assert.equal(plan[0].kind, "read");assert.ok(plan.every(s => s.status === "todo"));
    const started = planStart("list_files", plan)!;assert.equal(started[0].status, "run");
    const inspected = planFromTool("list_files", started, false, {}, { files: [], dirs: [] })!;
    assert.deepEqual(inspected.map(s => s.status), ["ok", "todo", "todo"], "a real empty directory listing is evidence; no nonexistent read_file is required");
  });
  function perform(plan: PlanStep[], name: string, args: Record<string, unknown> = {}, ok = true, extra = {}) {
    const started = planStart(name, plan, args)!;
    return planFromTool(name, started, !ok, args, { ok, ...extra })!;
  }
  it("classified plans advance only for a concrete edit and after their prerequisites", () => {
    let plan = applySetPlan(undefined, ["Badge und Projektdaten prüfen", "scene.gd ändern", "Originalmaße vergleichen", "Godot-Projekt validieren", "Szene zeigen"], false, ["read", "edit", "read", "check", "run"])!;
    plan = perform(plan, "read_file");
    plan = perform(plan, "read_file");
    assert.deepEqual(plan.map(s => s.status), ["ok", "todo", "todo", "todo", "todo"]);
    plan = perform(plan, "edit_file", { path: "scene.gd" });
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
    let plan = ["Projektdateien prüfen", "Rabattursache finden", "cart.mjs ändern", "Tests ausführen", "Browseroberfläche starten"].map(text => ({ text, status: "todo" as const })) as PlanStep[];
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
      assert.notEqual(perform([{ text, status: "todo" }], "edit_file")[0].status, "ok", "one arbitrary write does not certify a descriptive implementation");
    assert.equal(perform([{ text: "Tests ergänzen und ausführen", status: "todo" }], "edit_file")[0].status, "todo");
    assert.notEqual(perform([{ text: "Tests ergänzen und ausführen", status: "todo" }], "shell", { command: "npm test" })[0].status, "ok", "running tests alone does not create the requested tests");
  });
  it("engine discovery is not a check; check and play each complete their own step", () => {
    let plan = ["Projektdateien und Regeln lesen", "scene.gd ändern", "Godot-Projekt prüfen", "Szene starten und Ergebnis berichten"].map(text => ({ text, status: "todo" as const })) as PlanStep[];
    plan = perform(plan, "read_file");
    plan = perform(plan, "edit_file", { path: "scene.gd" });
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
  it("a descriptive implementation stays open and global execution cannot close it", () => {
    let plan: PlanStep[] = [
      { text: "Referenzen und bestehendes UI prüfen", status: "ok" },
      { text: "Layout, Farben und Interaktionen überarbeiten", status: "todo" },
      { text: "Dateien ausführen und Fehler prüfen", status: "todo" },
    ];
    plan = planFromTool("write_file", plan)!;
    assert.notEqual(plan[1]?.status, "ok");
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
    assert.equal(planHelperNow("helper", true, true), false);
    assert.equal(planHelperNow("auto", true, false), false);
    assert.equal(planAgentMayReplace("anvil", false), false);
    assert.equal(planAgentMayReplace("agent", true), false);
    assert.equal(planAgentMayReplace("auto", true), false);
  });
});
