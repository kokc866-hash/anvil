import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanProgress } from "./plan-progress.ts";
import { planFromTool } from "./plan.ts";
import { evidenceTargetKey } from "./agent-evidence.ts";

const steps = [
  { text: "Verify FreeCAD connection and available tools", kind: "check" as const, status: "todo" as const },
  { text: "Create timestamped test folder", kind: "edit" as const, status: "todo" as const },
  { text: "Build and save parametric XY stage", kind: "run" as const, status: "todo" as const },
  { text: "Verify baseline geometry", kind: "check" as const, status: "todo" as const },
];
const call = (name = "execute_code", code = "print('probe')") => ({ server: "freecad", name, arguments: { code } });
const update = (p: PlanProgress, step: number, evidence: string) => p.set({ updates: [{ step, status: "ok", evidence: [evidence], reason: "The referenced operation returned the result for this step." }] });

test("successful FreeCAD code can be explicitly attributed to check/edit/run steps without automatic completion", () => {
  for (const name of ["execute_code", "execute_code_headless"]) {
    const p = new PlanProgress(); p.sync(steps);
    const connection = p.record("mcp_call", call(name), { isError: false })!;
    assert.deepEqual(planFromTool("mcp_call", steps, false, call(name), { isError: false }), steps);
    assert.equal(update(p, 1, connection).ok, true);
    const folder = p.record("mcp_call", call(name, "os.makedirs(folder)"), { isError: false })!;
    assert.equal(update(p, 2, folder).ok, true);
    assert.deepEqual(p.plan.map(s => s.status), ["ok", "ok", "todo", "todo"]);
    const build = p.record("mcp_call", call(name, "build_and_save_stage()"), { isError: false })!;
    assert.equal(update(p, 3, build).ok, true);
    assert.equal(p.plan[3].status, "todo", "a build does not automatically certify geometry checks");
  }
});

test("a Blender service step can cite its executed save and check when a named skill is the means", () => {
  const target = "C:/Example/Park/Ergebnis/Arbeitskopie.blend";
  const step = {
    text: `MOSS7-POLITUR-2311. Verfeinere und speichere die vorhandene 3D-Figur Moss-7 optisch mit Blender-MCP und dem Blender-Skill. Die Arbeitskopie ist bereits in Blender geöffnet: ${target}. Prüfe den aktiven Pfad vor dem ersten Eingriff.`,
    kind: "service" as const,
    status: "todo" as const,
  };
  const p = new PlanProgress(); p.sync([step]);
  const reader = p.record("mcp_call", { server: "blender-local", name: "get_scene_info" }, { isError: false })!;
  assert.ok(update(p, 1, reader).error, "a scene read cannot also certify the save and check");

  const executor = { server: "blender-local", name: "execute_blender_code" };
  const saveArgs = { ...executor, arguments: { code: "confirmed_save()" } };
  const saveResult = { isError: false, structuredContent: { result: `Code executed successfully: SAVED ${target}` } };
  const save = p.record("mcp_call", saveArgs, saveResult, true)!;
  const check = p.record("mcp_call", { ...executor, arguments: { code: "verify_saved_file()" } },
    { isError: false, structuredContent: { result: `Code executed successfully: VERIFIED ${target}` } })!;
  assert.deepEqual(planFromTool("mcp_call", [step], false, saveArgs, saveResult), [step]);

  const complete = () => p.set({ updates: [{ step: 1, status: "ok", evidence: [save, check], reason: "Saved and checked the working copy in Blender." }] });
  const result = complete();
  assert.equal(result.ok, true, result.error);
  assert.equal(p.plan[0].status, "ok");
  p.record("mcp_call", { ...executor, arguments: { code: "verify_saved_file()" } }, { isError: true });
  assert.match(complete().error ?? "", /contradicted/);
});

test("authoring the Blender skill itself still requires knowledge evidence", () => {
  for (const text of ["Erstelle einen Blender-Skill.", "Erstelle den Blender-Skill mit skill_write."]) {
    const p = new PlanProgress(); p.sync([{ text, kind: "edit", status: "todo" }]);
    const unrelated = p.record("mcp_call", { server: "blender-local", name: "execute_blender_code" }, { isError: false })!;
    assert.ok(update(p, 1, unrelated).error, text);
    const skill = p.record("skill_write", { name: "blender" }, { ok: true }, true)!;
    assert.equal(update(p, 1, skill).ok, true, text);
  }
});

test("a confirmed Blender checklist step reuses its selected receipts on sync and restart", () => {
  const step = {
    text: "Speichere mit Blender-MCP und dem Blender-Skill die Figur in moss-7-politur.blend. Prüfe den aktiven Pfad.",
    kind: "service" as const,
    status: "todo" as const,
  };
  const p = new PlanProgress(); p.sync([step]);
  p.setInputStamp("working-copy");
  const discovery = p.record("mcp_list", { server: "blender-local" }, { ok: true })!;
  const savedArgs = { server: "blender-local", name: "execute_blender_code", arguments: { code: "confirmed_save()" } };
  const checkArgs = { ...savedArgs, arguments: { code: "verify_saved_file()" } };
  const saved = p.record("mcp_call", savedArgs, { ok: true })!;
  const checked = p.record("mcp_call", checkArgs, { ok: true })!;
  const complete = (evidence: string[]) => p.set({ updates: [{ step: 1, status: "ok", evidence, reason: "Saved and checked with Blender." }] });
  assert.ok(complete([discovery, saved, checked]).error, "mixed selected rows still do not attest this external path");
  assert.equal(complete([saved, checked]).ok, true);

  const updatedPlan = p.plan;
  const snapshot = p.snapshot();
  const wrongReceipt = structuredClone(snapshot);
  wrongReceipt.mcpCompletions![0].evidenceIds = [discovery];
  assert.equal(new PlanProgress().restore(wrongReceipt), false, "an MCP catalogue cannot be substituted in the persisted selection");
  const changedStep = structuredClone(snapshot);
  changedStep.plan[0].text = "Verifiziere eine andere Blender-Datei.";
  assert.equal(new PlanProgress().restore(changedStep), false, "a stored selection cannot be assigned to a different step");
  const restored = new PlanProgress();
  assert.equal(restored.restore(snapshot), true);
  assert.equal(restored.plan[0].status, "ok", "the unselected MCP catalogue does not invalidate the saved proof");
  p.sync(updatedPlan);
  assert.equal(p.plan[0].status, "ok", "the same proof remains valid after synchronizing the UI checklist");

  const stale = new PlanProgress();
  assert.equal(stale.restore(p.snapshot()), true);
  stale.setInputStamp("new-working-copy");
  assert.equal(stale.plan[0].status, "todo", "the mixed service/check step still requires a current check");
  restored.record("mcp_call", checkArgs, { isError: true });
  restored.sync(updatedPlan);
  assert.equal(restored.plan[0].status, "todo", "a newer matching failure invalidates the selected receipt");
});

test("MCP selection retention preserves whole proofs and keeps an oversized proof open after restart", () => {
  for (const receiptCount of [2, 257]) {
    const p = new PlanProgress();
    p.sync([{ text: "Moss-7 mit Blender-MCP speichern", kind: "service", status: "todo" },
      { text: "Write helper.js", kind: "edit", status: "todo" }]);
    const mcpReceipts = Array.from({ length: receiptCount }, (_, i) => p.record("mcp_call", {
      server: "blender-local", name: "execute_blender_code", arguments: { code: `fixture_${i}()` },
    }, { ok: true })!);
    const fileReceipt = p.record("write_file", { path: "helper.js" }, { ok: true }, true)!;
    for (let i = 0; i < 270; i++) p.record("mcp_list", { server: `fixture-${i}` }, { ok: true });
    assert.equal(p.set({ updates: [{ step: 1, status: "ok", evidence: mcpReceipts, reason: "Saved in Blender." }] }).ok, true);
    assert.equal(update(p, 2, fileReceipt).ok, true);

    const snapshot = p.snapshot();
    const restored = new PlanProgress();
    assert.equal(restored.restore(snapshot), true);
    assert.deepEqual(snapshot.mcpCompletions![0].evidenceIds, receiptCount === 2 ? mcpReceipts : []);
    restored.sync(p.plan);
    assert.deepEqual(restored.plan.map(step => step.status), [receiptCount === 2 ? "ok" : "todo", "ok"]);
  }
});

test("MCP operations match their actual action instead of the service envelope", () => {
  const p = new PlanProgress(); p.sync(steps);
  const search = p.record("mcp_call", call("search_objects"), { isError: false })!;
  assert.ok(update(p, 2, search).error);
  assert.ok(update(p, 3, search).error);
  assert.ok(update(p, 4, search).error);
  const create = p.record("mcp_call", call("create_object"), { isError: false })!;
  assert.equal(update(p, 2, create).ok, true);
  assert.ok(update(p, 4, create).error);
  const catalog = p.record("mcp_list", { server: "freecad" }, { tools: [] })!;
  assert.ok(update(p, 1, catalog).error, "catalog discovery is not a connection test");
  assert.equal(planFromTool("mcp_call", [steps[1]], false, call("create_object"), { structuredContent: { status: "running" } })![0].status, "todo");
  assert.ok(update(p, 2, p.record("mcp_call", call("delete_object"), { isError: false })!).error, "deletion is not creation");
});

test("failed, incomplete, pending and stale MCP operations cannot complete checks", () => {
  for (const result of [{ isError: true }, { ok: false }, { truncated: true }, { already_executed: true }, { running: true }, { status: "pending" }, { structuredContent: { status: "running" } }, { content: [{ type: "text", text: '{"status":"running","job_id":"job"}' }] }]) {
    const p = new PlanProgress(); p.sync(steps);
    const id = p.record("mcp_call", call("execute_code_async"), result)!;
    assert.ok(update(p, 1, id).error, JSON.stringify(result));
  }
  const p = new PlanProgress(); p.sync(steps); p.setInputStamp("before");
  const id = p.record("mcp_call", call(), { isError: false })!;
  p.setInputStamp("after");
  assert.match(update(p, 1, id).error!, /predates/);
});

test("different scripts on one MCP tool do not contradict each other; identical failed calls do", () => {
  const p = new PlanProgress(); p.sync(steps);
  const args = { ...call(), arguments: { code: "print('connection') # PRIVATE_CODE", timeout: 30 } };
  const first = p.record("mcp_call", args, { isError: false })!;
  p.record("mcp_call", call("execute_code", "build_stage()"), { isError: true });
  assert.equal(update(p, 1, first).ok, true);
  const snapshot = p.snapshot();
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_CODE"), "recovery retains a fingerprint, not source code");
  const restored = new PlanProgress(); assert.equal(restored.restore(snapshot), true);
  assert.equal(update(restored, 1, first).ok, true);
  restored.record("mcp_call", { ...args, arguments: { timeout: 30, code: args.arguments.code } }, { isError: true });
  assert.match(update(restored, 1, first).error!, /contradicted/);
});

test("async submission needs confirmed completion and can be reconciled from its status result", () => {
  const p = new PlanProgress(); p.sync(steps);
  const submitted = p.record("mcp_call", call("execute_code_async"), { isError: false, structuredContent: { job_id: "job" } })!;
  assert.ok(update(p, 1, submitted).error);
  const pending = p.record("mcp_call", call("get_async_status"), { structuredContent: { status: "running" } })!;
  assert.ok(update(p, 1, pending).error);
  const completed = p.record("mcp_call", call("get_async_status"), { structuredContent: { status: "completed", ok: true } })!;
  assert.equal(update(p, 1, completed).ok, true);
  const restored = new PlanProgress(); assert.equal(restored.restore(p.snapshot()), true);
  assert.equal(update(restored, 1, completed).ok, true);
  const failed = p.record("mcp_call", call("get_async_status"), { structuredContent: { status: "completed", ok: false } })!;
  assert.ok(update(p, 1, failed).error);
});

test("legacy MCP snapshots retain conservative contradiction handling when script identity was not saved", () => {
  const p = new PlanProgress(); p.sync(steps);
  const id = p.record("mcp_call", call(), { isError: false })!;
  const snapshot = p.snapshot();
  snapshot.evidence[0].targetKey = evidenceTargetKey(JSON.stringify(snapshot.evidence[0].args));
  const restored = new PlanProgress(); assert.equal(restored.restore(snapshot), true);
  assert.equal(update(restored, 1, id).ok, true);
  restored.record("mcp_call", call("execute_code", "different_code()"), { isError: true });
  assert.match(update(restored, 1, id).error!, /contradicted/);
});
