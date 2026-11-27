import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applySetPlan, initialAgentPlan, isPlanContinuation, requestPlanContext } from "./plan.ts";
import { PlanProgress } from "./plan-progress.ts";

const generic = [
  "Auftrag und Projekt verstehen",
  "Angefragte Änderungen umsetzen",
  "Geänderte Funktionen prüfen",
];
const workshop = readFileSync("fixtures/workshop-task.txt", "utf8");

test("the seeded implementation step names the actual request rather than an unnamed phase", () => {
  const plan = initialAgentPlan("Ergänze im Warenkorb die Rabattberechnung.", undefined, "agent");
  assert.ok(plan.some(s => /Warenkorb.*Rabattberechnung/.test(s.text)));
  assert.ok(plan.every(s => s.status === "todo"));
});

test("a generic untouched legacy seed is replaced by the current explicit requirements", () => {
  const before = generic.map(text => ({ text, status: "todo" as const }));
  const plan = initialAgentPlan(workshop, before, "agent");
  assert.equal(plan.length, 12);
  assert.match(plan[10].text, /Tastaturbedienung/);
  assert.ok(plan.every(s => s.status === "todo"));
  assert.equal(before.length, 3, "the caller's previous list must not be mutated");
});

test("a generic model plan cannot erase a concrete unstarted user checklist", () => {
  const concrete = initialAgentPlan(workshop, undefined, "agent");
  assert.equal(applySetPlan(concrete, generic, false, ["read", "edit", "check"]), null);
  const progress = new PlanProgress();
  progress.sync(concrete);
  const result = progress.set({ steps: generic, kinds: ["read", "edit", "check"] });
  assert.ok(result.error);
  assert.deepEqual(progress.plan, concrete);
});

test("a manual completion and custom concrete list remain authoritative", () => {
  const manual = [{ text: "Die bereits geprüfte Sonderanforderung", status: "ok" as const, completedBy: "user" as const }];
  assert.deepEqual(initialAgentPlan(workshop, manual, "agent"), manual);
  assert.equal(applySetPlan(manual, generic), null);
});

test("refining the unstarted generic seed remains possible", () => {
  const before = generic.map(text => ({ text, status: "todo" as const }));
  const concrete = ["Rabattursache lesen", "Rabattlogik ergänzen", "Rabattgrenzen prüfen"];
  assert.deepEqual(applySetPlan(before, concrete, false)?.map(s => s.text), concrete);
});

test("short continuations reuse the last concrete plan without sharing mutable steps", () => {
  const plan = [
    { text: "Rabattlogik in cart.js ergänzen", kind: "edit" as const, status: "ok" as const, completedBy: "agent" as const },
    { text: "Rabattgrenzen in cart.test.js prüfen", kind: "check" as const, status: "todo" as const },
  ];
  for (const text of ["weiter", "mach weiter", "bitte fortsetzen", "Okay, weiter!", "please continue", "go on"]) {
    assert.equal(isPlanContinuation(text), true, text);
    const context = requestPlanContext(text, [{ role: "user", content: "Ergänze die Rabattlogik." }, { role: "assistant", content: "Noch nicht fertig.", plan }]);
    assert.equal(context.continued, true);
    assert.equal(context.text, "Ergänze die Rabattlogik.");
    assert.deepEqual(context.plan, plan);
    assert.notEqual(context.plan, plan);
    assert.notEqual(context.plan![0], plan[0]);
    assert.equal(context.plan![0].status, "ok");
  }
});

test("an appended continuation and empty response do not hide the actual source task", () => {
  const plan = initialAgentPlan(workshop, undefined, "agent");
  const chat = [
    { role: "user", content: workshop },
    { role: "assistant", content: "Noch offen.", plan, planLocked: true },
    { role: "user", content: "mach weiter" },
    { role: "assistant", content: "", plan: [] },
  ];
  const context = requestPlanContext("mach weiter", chat);
  assert.equal(context.text, workshop.trim());
  assert.equal(context.plan?.length, 12);
  assert.equal(context.locked, true);
  assert.equal(context.continued, true);
});

test("a substantive new task never receives an older goal or checklist", () => {
  const old = initialAgentPlan("Baue ein Tower-Defense-Spiel.", undefined, "agent");
  const chat = [{ role: "user", content: "Baue ein Tower-Defense-Spiel." }, { role: "assistant", content: "Fertig.", plan: old }];
  for (const text of [workshop, "Prüfe nur die Tastatur, ohne Dateien zu ändern.", "Mach weiter mit einem neuen CAD-Projekt.", "Continue and add a new export."]) {
    const context = requestPlanContext(text, chat);
    assert.equal(context.text, text);
    assert.equal(context.continued, false);
    assert.equal(context.plan, undefined);
    assert.equal(context.locked, false);
  }
});

test("continuation never searches across an intervening different conversation", () => {
  const plan = initialAgentPlan(workshop, undefined, "agent");
  const context = requestPlanContext("weiter", [
    { role: "user", content: workshop },
    { role: "assistant", content: "Offene Aufgaben.", plan },
    { role: "user", content: "Erkläre nur das Bild." },
    { role: "assistant", content: "Das Bild zeigt einen Baum." },
  ]);
  assert.equal(context.continued, false);
  assert.equal(context.plan, undefined);
  assert.equal(context.text, "weiter");
});

test("consecutive continuations retain their own latest task and ignore earlier goals", () => {
  const concrete = initialAgentPlan(workshop, undefined, "agent");
  const context = requestPlanContext("mach weiter", [
    { role: "user", content: "Baue ein Tower-Defense-Spiel." },
    { role: "assistant", content: "Spiel erstellt.", plan: initialAgentPlan("Baue ein Tower-Defense-Spiel.") },
    { role: "user", content: workshop },
    { role: "assistant", content: "Plan.", plan: concrete, planLocked: true },
    { role: "user", content: "weiter" },
    { role: "assistant", content: "Noch nicht abgeschlossen.", plan: concrete, planLocked: true },
  ]);
  assert.equal(context.text, workshop.trim());
  assert.deepEqual(context.plan, concrete);
  assert.equal(context.locked, true);
});

test("legacy phase-level completions do not certify individual recovered requirements", () => {
  const phases = generic.map(text => ({ text, status: "ok" as const, completedBy: "agent" as const }));
  const context = requestPlanContext("weiter", [{ role: "user", content: workshop }, { role: "assistant", content: "Fertig.", plan: phases }]);
  assert.equal(context.plan?.length, 12);
  assert.ok(context.plan?.every(s => s.status === "todo" && s.completedBy === undefined));
  assert.equal(context.locked, true);
  assert.ok(phases.every(s => s.status === "ok"), "legacy snapshot itself stays untouched");
});

test("locked and manually acknowledged lists stay unchanged even when generic", () => {
  for (const manual of [false, true]) {
    const phases = generic.map(text => ({ text, status: "ok" as const, completedBy: manual ? "user" as const : "agent" as const }));
    const context = requestPlanContext("weiter", [{ role: "user", content: workshop }, { role: "assistant", content: "Fertig.", plan: phases, planLocked: !manual }]);
    assert.deepEqual(context.plan, phases);
  }
});

test("preserved checklist status still needs real current evidence after recovery", () => {
  const before = [
    { text: "cart.js ändern", status: "todo" as const, kind: "edit" as const },
    { text: "cart.test.js prüfen", status: "todo" as const, kind: "check" as const },
  ];
  const tracker = new PlanProgress();
  tracker.sync(before);
  tracker.setInputStamp("version-one");
  const edit = tracker.record("edit_file", { path: "cart.js" }, { ok: true }, true)!;
  assert.equal(tracker.set({ updates: [{ step: 1, status: "ok", kind: "edit", reason: "Datei gespeichert.", evidence: [edit] }] }).ok, true);
  const failed = tracker.record("run_file", { path: "cart.test.js" }, { ok: false, code: 1 })!;
  assert.ok(tracker.set({ updates: [{ step: 2, status: "ok", kind: "check", reason: "Nicht belegt", evidence: [failed] }] }).error);
  const context = requestPlanContext("weiter", [{ role: "user", content: "Ändere cart.js und prüfe cart.test.js." }, { role: "assistant", content: "Test fehlgeschlagen.", plan: tracker.plan }]);
  const restored = new PlanProgress();
  assert.equal(restored.restore(tracker.snapshot()), true);
  restored.sync(context.plan);
  assert.deepEqual(restored.plan.map(s => s.status), ["ok", "todo"]);
  const pass = restored.record("run_file", { path: "cart.test.js" }, { ok: true, code: 0 })!;
  assert.equal(restored.set({ updates: [{ step: 2, status: "ok", kind: "check", reason: "Aktuelle Tests bestanden.", evidence: [pass] }] }).ok, true);
  restored.setInputStamp("version-two");
  assert.deepEqual(restored.plan.map(s => s.status), ["ok", "todo"]);
});

