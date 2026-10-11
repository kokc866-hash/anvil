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
