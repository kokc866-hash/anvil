import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanProgress } from "./plan-progress.ts";
import type { PlayAction } from "./preview-input.ts";

const baseline: PlayAction[] = [
  { type: "assert", selector: "#status", text: "Paused" },
  { type: "assert", selector: "#count", text: "0" },
];
const mounted = (p: PlanProgress, path = "index.html") =>
  p.record("run_file", { path }, { ok: true, stage: { kind: "html" } });
const play = (p: PlanProgress, actions: PlayAction[], previewPath: string | null = "index.html") =>
  p.record("play", { actions }, { ok: true, functionalChecks: true, previewPath,
    input: { completed: actions.length, total: actions.length, assertions: actions.filter(action => action.type === "assert").length } });
const close = (p: PlanProgress, evidence: unknown[], step = 1) =>
  p.set({ updates: [{ step, status: "ok", reason: "Actual observed result.", evidence }] }, false);

test("an unclassified browser step can use a current target-bound assertion without a kind or redundant launch ID", () => {
  const p = new PlanProgress();
  const text = "Öffne index.html und verifiziere den Ausgangszustand Paused und Zähler 0.";
  p.sync([{ text, status: "todo" }]);
  p.setInputStamp("original");
  const launch = mounted(p);
  assert.ok(close(p, [launch]).error);
  assert.ok(close(p, [play(p, baseline, null)]).error);
  assert.ok(close(p, [play(p, [baseline[0]])]).error);
  assert.equal(close(p, [play(p, baseline)]).ok, true);
  assert.deepEqual(p.plan, [{ text, status: "ok", kind: "check", completedBy: "agent" }]);
  const restored = new PlanProgress();
  assert.equal(restored.restore(p.snapshot()), true);
  assert.equal(restored.plan[0].status, "ok");
  mounted(p, "other.html");
  assert.ok(close(p, [launch, play(p, baseline, "other.html")]).error, "a launch receipt cannot launder another file's assertions");
  p.setInputStamp("changed");
  assert.equal(p.plan[0].status, "todo");
  assert.ok(close(p, [play(p, baseline)]).error, "an earlier preview cannot observe the edited source");
});

test("a compound click check requires both requested transitions in one preview launch", () => {
  const p = new PlanProgress();
  p.sync([{ text: "Klicke Start/Pause. Prüfe Running. Klicke erneut und prüfe Paused.", status: "todo" }]);
  mounted(p);
  const running: PlayAction[] = [{ type: "click", selector: "#start" }, { type: "assert", selector: "#status", text: "Running" }];
  const paused: PlayAction[] = [{ type: "click", selector: "#start" }, { type: "assert", selector: "#status", text: "Paused" }];
  const first = play(p, running);
  assert.ok(close(p, [play(p, [running[0], running[1], paused[1]])]).error, "one click cannot certify both transitions");
  mounted(p);
  const second = play(p, paused);
  assert.ok(close(p, [first, second]).error, "proof must not be combined across reloads of the same file");
  assert.equal(close(p, [play(p, running), play(p, paused)]).ok, true);
});

test("separate completed play inputs and assertions can establish both transitions in the same preview", () => {
  for (const mode of ["native-preview", "dom-events"]) {
    const p = new PlanProgress();
    p.sync([{ text: "Klicke Start/Pause. Prüfe Running. Klicke erneut und prüfe Paused.", status: "todo" }]);
    p.setInputStamp("original");
    mounted(p);
    const click = (input: Record<string, unknown>, outcome: Record<string, unknown> = {}) =>
      p.record("play", { actions: [{ type: "click", selector: "#start" }] },
        { ok: true, functionalChecks: false, previewPath: "index.html", input: { mode, ...input }, ...outcome });
    const complete = { completed: 1, total: 1, assertions: 0 };
    const assertRunning = () => play(p, [{ type: "assert", selector: "#status", text: "Running" }]);
    const assertPaused = () => play(p, [{ type: "assert", selector: "#status", text: "Paused" }]);

    const first = click(complete);
    const running = assertRunning();
    const partial = click({ ...complete, completed: 0 });
    const paused = assertPaused();
    assert.ok(close(p, [first, running, partial, paused]).error, "a partial input cannot support a transition");
    const failed = click(complete, { error: "event delivery failed" });
    assert.ok(close(p, [first, running, failed, assertPaused()]).error, "a failed input cannot support a transition");
    assert.ok(close(p, [first, running, click({}), assertPaused()]).error, "missing counters do not prove input delivery");
    const second = click(complete);
    assert.ok(close(p, [first, second]).error, "even two inputs need real, matching assertions");
    mounted(p);
    assert.ok(close(p, [first, running, second, assertPaused()]).error, "an assertion cannot use input from before the reload");
    p.setInputStamp("changed");
    mounted(p);
    assert.ok(close(p, [first, running, click(complete), assertPaused()]).error, "a changed input stamp invalidates earlier receipts");
    const checked = [click(complete), assertRunning(), click(complete), assertPaused()];
    assert.equal(close(p, checked).ok, true, mode);
    const restored = new PlanProgress();
    assert.equal(restored.restore(p.snapshot()), true);
    assert.equal(restored.plan[0].status, "ok");
  }
});

test("a repeated counter check needs the same control and output", () => {
  const p = new PlanProgress();
  p.sync([{ text: "Klicke zweimal auf Hinzufügen und prüfe den Zähler nach jedem Klick (1 und 2).", status: "todo" }]);
  mounted(p);
  const check = (secondControl: string, secondOutput: string): PlayAction[] => [
    { type: "click", selector: "#add" }, { type: "assert", selector: "#count", text: "1" },
    { type: "click", selector: secondControl }, { type: "assert", selector: secondOutput, text: "2" },
  ];
  assert.ok(close(p, [play(p, check("#unrelated", "#count"))]).error);
  assert.ok(close(p, [play(p, check("#add", "#unrelated"))]).error);
  assert.equal(close(p, [play(p, check("#add", "#count"))]).ok, true);
});

test("the read-only fixture receipts prove only their exact keyboard, input and checkbox cases", () => {
  const p = new PlanProgress();
  p.sync([
    { text: "Tastaturkürzel prüfen.", status: "todo" },
    { text: "Ersetze den Namen im Eingabefeld durch QA-Nov19 und prüfe den Wert. Aktiviere die Checkbox und prüfe checked.", status: "todo" },
    { text: "Drücke Delete und prüfe, ob das löschbare Element #item fehlt.", status: "todo" },
  ]);
  mounted(p);
  const before = play(p, baseline);
  for (const i of [1, 2, 3]) assert.ok(close(p, [before], i).error, String(i));
  const key = play(p, [{ type: "key", key: "Delete" }, { type: "assert", selector: "#item", count: 0 }]);
  assert.equal(close(p, [key], 1).ok, true);
  assert.ok(close(p, [play(p, [{ type: "key", key: "Delete" }, { type: "assert", selector: "#item", visible: false }])], 3).error);
  assert.equal(close(p, [key], 3).ok, true);
  const checkbox: PlayAction[] = [{ type: "click", selector: "#agree" }, { type: "assert", selector: "#agree", checked: true }];
  const name: PlayAction[] = [{ type: "type", selector: "#name", text: "QA-Nov19" }, { type: "assert", selector: "#name", value: "QA-Nov19" }];
  assert.ok(close(p, [play(p, checkbox)], 2).error);
  assert.ok(close(p, [play(p, [...name.slice(0, 1), { type: "assert", selector: "#name", value: "qa-nov19" }, ...checkbox])], 2).error);
  assert.equal(close(p, [play(p, [...name, ...checkbox])], 2).ok, true);
  assert.ok(!JSON.stringify(p.snapshot().evidence).includes("QA-Nov19"));
});

test("only the exact proven no-effect missing target is eligible for an expected rejection check", () => {
  const p = new PlanProgress();
  p.sync([{ text: "Prüfe einen Klick auf das absichtlich nicht vorhandene Ziel #missing. Erwartet wird eine Ablehnung ohne Zustandsänderung.", status: "todo" }]);
  mounted(p);
  const negative = (selector: string, nativeProof: string | undefined, definitelyNotExecuted = true) =>
    p.record("play", { actions: [{ type: "click", selector }] }, { ok: false, rejected: true, definitelyNotExecuted, previewPath: "index.html", previewMissingTarget: nativeProof });
  for (const evidence of [play(p, baseline), negative("#missing", undefined), negative("#other", "#missing"), negative("#missing", "#missing", false)])
    assert.ok(close(p, [evidence]).error);
  assert.equal(close(p, [negative("#missing", "#missing")]).ok, true);
  const restored = new PlanProgress();
  assert.equal(restored.restore(p.snapshot()), true);
  assert.equal(restored.plan[0].status, "ok");
});

test("a mixed checklist update retains independent proof and reports the still-open test in either order", () => {
  for (const invalidFirst of [true, false]) {
    const p = new PlanProgress();
    const initial = [
      { text: "Öffne index.html und verifiziere den Ausgangszustand Paused und Zähler 0.", status: "todo" as const },
      { text: "Lies main.js.", kind: "read" as const, status: "todo" as const },
    ];
    p.sync(initial);
    const missing = { step: 1, status: "ok", reason: "HTML loaded.", evidence: [mounted(p)] };
    const proven = { step: 2, status: "ok", reason: "Source read.", evidence: [p.record("read_file", { path: "main.js" }, { ok: true })] };
    const args = { updates: invalidFirst ? [missing, proven] : [proven, missing] };
    const mixed = p.set(args, false);
    assert.equal(mixed.ok, true);
    assert.equal(mixed.error, undefined);
    assert.deepEqual(mixed.applied_steps, [2]);
    assert.equal(mixed.rejected_updates?.[0].step, 1);
    assert.match(mixed.rejected_updates?.[0].error ?? "", /successful play call/);
    assert.match(mixed.checklist_context ?? "", /1\. \[todo\]/);
    assert.match(mixed.recovery ?? "", /Leave applied steps/);
    assert.deepEqual(mixed.plan, [initial[0], { ...initial[1], status: "ok", completedBy: "agent" }]);
    assert.equal(p.hasOpenWork(), true);
    assert.ok(p.set(args, false).error, "repeating a valid no-op alongside the same invalid completion is still a rejection");
    assert.equal(close(p, [play(p, baseline)]).ok, true);
    assert.deepEqual(p.plan.map(step => step.status), ["ok", "ok"]);
  }
});

test("malformed or duplicate checklist targets reject the whole batch before any change", () => {
  const p = new PlanProgress();
  p.sync([
    { text: "Lies main.js.", kind: "read", status: "todo" },
    { text: "Lies util.js.", kind: "read", status: "todo" },
  ]);
  const proven = { step: 1, status: "ok", reason: "Source read.", evidence: [p.record("read_file", { path: "main.js" }, { ok: true })] };
  const pending = { step: 2, status: "run", reason: "Reading next." };
  for (const malformed of [null, { ...pending, step: "2" }, { ...pending, step: 3 }, { ...pending, status: "done" },
    { ...pending, reason: "" }, { ...pending, kind: "other" }, { ...pending, step: 1 }]) {
    assert.ok(p.set({ updates: [proven, malformed] }, false).error);
    assert.deepEqual(p.plan.map(step => step.status), ["todo", "todo"]);
  }
});
