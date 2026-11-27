import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanStep } from "@/store/ide";
import { planFromTool, planFinish } from "./plan.ts";
import { PlanProgress } from "./plan-progress.ts";

const step = (text: string, kind: PlanStep["kind"] = "edit"): PlanStep => ({ text, kind, status: "todo" });
const advance = (plan: PlanStep[], name: string, args: Record<string, unknown>, result: Record<string, unknown> = { ok: true }) => planFromTool(name, plan, false, args, result)!;
const close = (progress: PlanProgress, evidence: string[], number = 1) => progress.set({ updates: [{ step: number, status: "ok", evidence, reason: "The referenced confirmed results cover this step." }] });

test("the reported package/model/store sequence cannot complete the separate browser UI", () => {
  let plan = [step("Datenmodell & Geschäftslogik (model.js, store.js) als reine Module implementieren"), step("Beispieldaten und Browser-UI (index.html, ui.js, app.js) implementieren")];
  for (const path of ["anvil-dauertest/package.json", "anvil-dauertest/model.js", "anvil-dauertest/store.js"]) {
    plan = advance(plan, "write_file", { path });
    assert.notEqual(plan[1].status, "ok", path);
    if (path.endsWith("package.json")) assert.notEqual(plan[0].status, "ok", "metadata is not the data model");
  }
});

test("a descriptive implementation is not automatically certified by one arbitrary edit", () => {
  const plan = [step("Tags, Statistik, Hilfe und Sortierung implementieren")];
  assert.notEqual(advance(plan, "edit_file", { path: "unrelated.js" })[0].status, "ok");
  const p = new PlanProgress(); p.sync(plan);
  const id = p.record("edit_file", { path: "app.js" }, { ok: true }, true)!;
  assert.equal(close(p, [id]).ok, true, "explicit attribution with real edit evidence stays available");
});

test("a concrete atomic file action completes only its actual target", () => {
  const plan = [step("Write src/model.js")];
  assert.equal(advance(plan, "write_file", { path: "src/model.js" })[0].status, "ok");
  for (const path of ["model.js", "other/model.js", "src/model.js.bak", "src/not-model.js"]) {
    assert.notEqual(advance(plan, "write_file", { path })[0].status, "ok", path);
  }
});

test("multiple named files need every target, not duplicate writes or substring matches", () => {
  const p = new PlanProgress(); p.sync([step("Create model.js and store.js")]);
  const model = p.record("write_file", { path: "src/model.js" }, { ok: true }, true)!;
  const again = p.record("write_file", { path: "src/model.js" }, { ok: true }, true)!;
  assert.ok(close(p, [model, again]).error);
  const unrelated = p.record("write_file", { path: "src/not-store.js" }, { ok: true }, true)!;
  assert.ok(close(p, [model, unrelated]).error);
  const store = p.record("write_file", { path: "src/store.js" }, { ok: true }, true)!;
  assert.equal(close(p, [model, store]).ok, true);
});

test("reading the missing store cannot substitute for implementing it", () => {
  const p = new PlanProgress(); p.sync([step("Implement model.js and store.js")]);
  const model = p.record("write_file", { path: "model.js" }, { ok: true }, true)!;
  const read = p.record("read_file", { path: "store.js" }, { content: "old store" })!;
  assert.ok(close(p, [model, read]).error);
});

test("mixed read/write clauses require the correct receipt on each file", () => {
  const p = new PlanProgress(); p.sync([step("Read model.js and write store.js")]);
  const wrongRead = p.record("read_file", { path: "store.js" }, { content: "old store" })!;
  const wrongWrite = p.record("write_file", { path: "model.js" }, { ok: true }, true)!;
  assert.ok(close(p, [wrongRead, wrongWrite]).error);
  const read = p.record("read_file", { path: "model.js" }, { content: "model" })!;
  const write = p.record("write_file", { path: "store.js" }, { ok: true }, true)!;
  assert.equal(close(p, [read, write]).ok, true);
});

test("the UI step cannot borrow data-module evidence even through set_plan", () => {
  const p = new PlanProgress(); p.sync([step("Browser-UI (index.html, ui.js, app.js) implementieren")]);
  const ids = ["package.json", "model.js", "store.js"].map(path => p.record("write_file", { path }, { ok: true }, true)!);
  assert.ok(close(p, ids).error);
  const html = p.record("write_file", { path: "index.html" }, { ok: true }, true)!;
  assert.ok(close(p, [...ids, html]).error, "HTML alone does not establish both JS modules");
  const rest = ["ui.js", "app.js"].map(path => p.record("write_file", { path }, { ok: true }, true)!);
  assert.equal(close(p, [html, ...rest]).ok, true);
});

test("writing and executing tests require both actions and current successful execution", () => {
  const p = new PlanProgress(); p.sync([step("Write cart.test.js and run the tests", "check")]);
  const edit = p.record("write_file", { path: "cart.test.js" }, { ok: true }, true)!;
  assert.ok(close(p, [edit]).error);
  const run = p.record("shell", { command: "node --test cart.test.js" }, { ok: true, code: 0 })!;
  assert.ok(close(p, [run]).error, "a passing pre-existing test does not prove the requested file was written");
  assert.equal(close(p, [edit, run]).ok, true);
  p.record("edit_file", { path: "cart.test.js" }, { ok: true }, true);
  assert.ok(close(p, [edit, run]).error, "a previous test no longer covers changed execution inputs");
});

test("a different passing test cannot certify the named test file", () => {
  const p = new PlanProgress(); p.sync([step("Write cart.test.js and run the tests", "check")]);
  const edit = p.record("write_file", { path: "cart.test.js" }, { ok: true }, true)!;
  const wrong = p.record("shell", { command: "node --test unrelated.test.js" }, { ok: true, code: 0 })!;
  assert.ok(close(p, [edit, wrong]).error);
});

test("long recovery records retain the receipts for every completed named file", () => {
  const p = new PlanProgress(); p.sync([step("Implement model.js and store.js")]);
  const ids = ["model.js", "store.js"].map(path => p.record("write_file", { path }, { ok: true }, true)!);
  assert.equal(close(p, ids).ok, true);
  for (let i = 0; i < 400; i++) p.record("write_file", { path: `scratch-${i}.js` }, { ok: true }, true);
  const restored = new PlanProgress();
  assert.equal(restored.restore(p.snapshot()), true);
  assert.equal(restored.plan[0].status, "ok");
});

test("a named test retains its classified command target through recovery without retaining command arguments", () => {
  const p = new PlanProgress(); p.sync([step("Run cart.test.js", "check")]);
  const id = p.record("shell", { command: "node --test cart.test.js --token=private-example" }, { ok: true, code: 0 })!;
  assert.equal(close(p, [id]).ok, true);
  const saved = p.snapshot();
  assert.ok(!JSON.stringify(saved).includes("private-example"));
  const restored = new PlanProgress(); assert.equal(restored.restore(saved), true);
  assert.equal(restored.plan[0].status, "ok");
});

for (const result of [{}, { ok: false }, { ok: true, code: 1 }, { ok: true, running: true }, { ok: true, pending: true }, { ok: true, status: "cancelled" }, { ok: true, truncated: true }, { ok: true, already_executed: true }]) {
  test(`an incomplete or failed write cannot check a concrete step: ${JSON.stringify(result)}`, () => {
    const plan = [step("Write model.js")];
    assert.notEqual(advance(plan, "write_file", { path: "model.js" }, result)[0].status, "ok");
    const p = new PlanProgress(); p.sync(plan);
    const id = p.record("write_file", { path: "model.js" }, result)!;
    assert.ok(close(p, [id]).error);
  });
}

test("a conflicting later result cannot be bypassed using an earlier evidence ID", () => {
  const p = new PlanProgress(); p.sync([step("Write model.js and store.js")]);
  const first = p.record("write_file", { path: "model.js" }, { ok: true }, true)!;
  const second = p.record("write_file", { path: "store.js" }, { ok: true }, true)!;
  p.record("write_file", { path: "store.js" }, { ok: false });
  assert.ok(close(p, [first, second]).error);
});

test("delete, rename and format receipts cannot masquerade as an implementation", () => {
  const plan = [step("Implement the data model in model.js")];
  for (const [name, args] of [["delete_file", { path: "model.js" }], ["rename", { from: "old.js", to: "model.js" }], ["format_file", { path: "model.js" }]] as const) {
    const p = new PlanProgress(); p.sync(plan);
    const id = p.record(name, args, { ok: true }, true)!;
    assert.ok(close(p, [id]).error, name);
  }
});

test("renaming needs the correct source and destination", () => {
  const p = new PlanProgress(); p.sync([step("Rename old.js to new.js")]);
  const wrong = p.record("rename", { from: "other.js", to: "new.js" }, { ok: true }, true)!;
  assert.ok(close(p, [wrong]).error);
  const right = p.record("rename", { from: "old.js", to: "new.js" }, { ok: true }, true)!;
  assert.equal(close(p, [right]).ok, true);
});

test("two unrelated renames cannot synthesize a source/destination pair", () => {
  const p = new PlanProgress(); p.sync([step("Rename old.js to new.js")]);
  const a = p.record("rename", { from: "old.js", to: "other.js" }, { ok: true }, true)!;
  const b = p.record("rename", { from: "different.js", to: "new.js" }, { ok: true }, true)!;
  assert.ok(close(p, [a, b]).error);
});

test("quoted paths and Windows separators still bind to the actual file", () => {
  const p = new PlanProgress(); p.sync([step('Write "src/my model.js" and `src/store.js`')]);
  const a = p.record("write_file", { path: "src\\my model.js" }, { ok: true }, true)!;
  const b = p.record("write_file", { path: "src/store.js" }, { ok: true }, true)!;
  assert.equal(close(p, [a, b]).ok, true);
});

test("restore reopens the old false UI completion and retains matching confirmed modules", () => {
  const p = new PlanProgress(); p.sync([step("Implement model.js and store.js"), step("Implement index.html and ui.js")]);
  p.record("write_file", { path: "model.js" }, { ok: true }, true);
  p.record("write_file", { path: "store.js" }, { ok: true }, true);
  const snapshot = p.snapshot(); snapshot.plan.forEach(step => { step.status = "ok"; });
  const restored = new PlanProgress(); assert.equal(restored.restore(snapshot), true);
  assert.deepEqual(restored.plan.map(step => step.status), ["ok", "todo"]);
  restored.sync(snapshot.plan);
  assert.deepEqual(restored.plan.map(step => step.status), ["ok", "todo"], "reattaching the old UI cannot overwrite revalidation");
});

test("old named completions without any receipts reopen rather than inventing evidence", () => {
  const p = new PlanProgress();
  const snapshot = p.snapshot();
  snapshot.plan = [{ ...step("Create index.html and app.js"), status: "ok" }];
  assert.equal(p.restore(snapshot), true);
  assert.equal(p.plan[0].status, "todo");
});

test("a final answer cannot pretend a named report file has been saved", () => {
  const plan = [step("Write TESTBERICHT.md", "report")];
  assert.notEqual((planFinish(plan, false, true, true) || plan)[0].status, "ok");
  const p = new PlanProgress(); p.sync(plan);
  assert.equal(p.hasOpenWork(), true);
  const unrelated = p.record("write_file", { path: "README.md" }, { ok: true }, true)!;
  assert.ok(close(p, [unrelated]).error);
  const report = p.record("write_file", { path: "TESTBERICHT.md" }, { ok: true }, true)!;
  assert.equal(close(p, [report]).ok, true);
  assert.equal(planFinish([step("Ergebnis zusammenfassen", "report")], false, false, true)![0].status, "ok");
});

test("a report update can close a saved report with its check evidence in one call", () => {
  const text = "Schreibe Ergebnis/PRUEFUNG.md mit den geprüften Dateien. Wenn ein Werkzeugbefehl abgelehnt wird, prüfe die Ursache und verwende ein passendes Werkzeug.";
  const p = new PlanProgress();
  p.sync([{ text, status: "todo" }]);
  p.setInputStamp("verified-project-state");
  const write = p.record("write_file", { path: "Ergebnis/PRUEFUNG.md" }, { ok: true }, true)!;
  const otherFile = p.record("write_file", { path: "anderes/PRUEFUNG.md" }, { ok: true }, true)!;
  const pending = p.record("mcp_call", { name: "execute_blender_code", arguments: { code: "fixture-pending" } }, { pending: true })!;
  const check = p.record("mcp_call", { name: "execute_blender_code", arguments: { code: "fixture-check" } }, { isError: false })!;
  const update = (evidence: string[]) => p.set({ updates: [{ step: 1, kind: "report", status: "ok", reason: "The saved report and the check are evidenced.", evidence }] }, false);

  for (const evidence of [[write], [check], [write, pending], [otherFile, check]]) {
    assert.ok(update(evidence).error);
    assert.equal(p.plan[0].status, "todo");
  }
  assert.equal(update([write, check]).ok, true);
  assert.equal(p.hasOpenWork(), false);
  assert.equal(update([write, check]).ok, true, "the same confirmed update is idempotent");
  const completed = p.snapshot();
  const recovered = new PlanProgress();
  assert.equal(recovered.restore(completed), true);
  assert.equal(recovered.hasOpenWork(), false);
  recovered.setInputStamp("modified-project-state");
  recovered.record("mcp_call", { name: "execute_blender_code", arguments: { code: "unrelated-action" } }, { isError: false });
  recovered.sync(completed.plan);
  assert.equal(recovered.hasOpenWork(), true);
});

test("compound report steps with real checks stay open on an answer alone", () => {
  const plan = [step("Prüfe die Eingabe und berichte das Ergebnis", "report")];
  const p = new PlanProgress(); p.sync(plan);
  assert.equal(p.hasOpenWork(), true);
  assert.notEqual((planFinish(plan, false, true, true) || plan)[0].status, "ok");

  const check = p.record("mcp_call", { name: "execute_blender_code" }, { isError: false })!;
  assert.equal(close(p, [check]).ok, true);
  assert.equal(p.hasOpenWork(), false);
});

test("a global success flag cannot complete an unrelated running verification", () => {
  const plan: PlanStep[] = [{ ...step("Check other.test.js", "check"), status: "run" }];
  assert.notEqual((planFinish(plan, false, true, true) || plan)[0].status, "ok");
});
