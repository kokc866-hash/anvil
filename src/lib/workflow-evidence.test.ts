import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";
import { AgentEvidence, toolResultFailed } from "./agent-evidence.ts";
import { PlanProgress } from "./plan-progress.ts";

const checkPlan = () => {
  const progress = new PlanProgress();
  progress.sync([{ text: "Tests ausführen", kind: "check", status: "todo" }]);
  return progress;
};
const closeCheck = (progress: PlanProgress, id: string | undefined) => progress.set({
  updates: [{ step: 1, status: "ok", evidence: [id], reason: "The referenced test completed." }],
});

test("execution input stamps retain checks after documentation and invalidate real input changes", () => {
  const progress = checkPlan();
  const evidence = new AgentEvidence();
  progress.setInputStamp("source-v1");
  evidence.setInputStamp("source-v1");
  const id = progress.record("shell", { command: "npm test" }, { ok: true });
  evidence.record("shell", { command: "npm test" }, { ok: true });
  progress.record("write_file", { path: "README.md" }, { ok: true }, true);
  evidence.changed();
  progress.setInputStamp("source-v1");
  evidence.setInputStamp("source-v1");
  assert.equal(closeCheck(progress, id).ok, true);
  assert.equal(evidence.status().state, "passed");
  progress.setInputStamp("source-v2");
  evidence.setInputStamp("source-v2");
  assert.ok(closeCheck(progress, id).error);
  assert.equal(progress.plan[0].status, "todo");
  assert.equal(evidence.status().state, "stale");
});

test("legacy callers keep conservative revision checking", () => {
  const progress = checkPlan();
  const evidence = new AgentEvidence();
  const id = progress.record("shell", { command: "npm test" }, { ok: true });
  evidence.record("shell", { command: "npm test" }, { ok: true });
  progress.record("write_file", { path: "README.md" }, { ok: true }, true);
  evidence.changed();
  assert.ok(closeCheck(progress, id).error);
  assert.equal(evidence.status().state, "stale");
});

test("a stamp cannot retroactively certify unstamped old results", () => {
  const progress = checkPlan();
  const evidence = new AgentEvidence();
  const id = progress.record("shell", { command: "npm test" }, { ok: true });
  evidence.record("shell", { command: "npm test" }, { ok: true });
  progress.setInputStamp("source-v1");
  evidence.setInputStamp("source-v1");
  assert.ok(closeCheck(progress, id).error);
  assert.equal(evidence.status().state, "stale");
});

test("aborted, timed out and MCP error results cannot certify successful checks", () => {
  for (const flags of [{ isError: true }, { aborted: true }, { timedOut: true }, { cancelled: true }, { status: "aborted" }, { code: 1 }]) {
    const progress = checkPlan();
    const evidence = new AgentEvidence();
    const result = { ok: true, ...flags };
    const id = progress.record("shell", { command: "npm test" }, result);
    evidence.record("shell", { command: "npm test" }, result);
    assert.ok(closeCheck(progress, id).error, JSON.stringify(flags));
    assert.equal(evidence.status().state, "failed", JSON.stringify(flags));
  }
});

test("interrupted results cannot certify code or checklist success after recovery", () => {
  for (const interruption of [{ interrupted: true }, { status: "interrupted" }]) {
    const result = { ok: true, code: 0, ...interruption };
    assert.equal(toolResultFailed(result), true);
    assert.equal(toolResultFailed({ ...result, code: 1, exitExpectationMatched: true }), true, "a matching negative exit does not override interruption");
    const progress = checkPlan();
    const evidence = new AgentEvidence();
    progress.setInputStamp("source-v1");
    evidence.setInputStamp("source-v1");
    const id = progress.record("shell", { command: "npm test" }, result);
    evidence.record("shell", { command: "npm test" }, result);
    assert.ok(closeCheck(progress, id).error);
    assert.equal(evidence.status().state, "failed");
    const restoredProgress = new PlanProgress();
    const restoredEvidence = new AgentEvidence();
    assert.equal(restoredProgress.restore(JSON.parse(JSON.stringify(progress.snapshot()))), true);
    assert.equal(restoredEvidence.restore(JSON.parse(JSON.stringify(evidence.snapshot()))), true);
    assert.ok(closeCheck(restoredProgress, id).error);
    assert.equal(restoredEvidence.status().state, "failed");
    restoredEvidence.record("shell", { command: "npm test" }, { ok: true, code: 0 });
    assert.equal(restoredEvidence.status().state, "passed", "a completed correction may replace the interrupted test");
  }
});

test("running and pending tools remain incomplete while explicit engine launches stay launches", () => {
  for (const flags of [{ running: true }, { pending: true }, { status: "running" }]) {
    const progress = checkPlan();
    const evidence = new AgentEvidence();
    const result = { ok: true, ...flags };
    const id = progress.record("shell", { command: "npm test" }, result);
    evidence.record("shell", { command: "npm test" }, result);
    assert.ok(closeCheck(progress, id).error);
    assert.equal(evidence.status().state, "none");
  }
  const progress = new PlanProgress();
  progress.sync([{ text: "Godot-Editor starten", kind: "run", status: "todo" }]);
  const id = progress.record("engine_run", { engine: "godot", action: "editor" }, { ok: true, running: true });
  assert.equal(progress.set({ updates: [{ step: 1, status: "ok", evidence: [id], reason: "Editor started." }] }).ok, true);
});

test("only completed current tests suppress automatic testing", async (t) => {
  // Substitute only the UI state seam: no persisted profile or native runner is
  // exercised here. Test discovery and the scheduling decision remain real.
  const storeId = "\0workflow-evidence-store";
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, plugins: [{
    name: "workflow-evidence-store",
    enforce: "pre",
    resolveId(id) { if (id === "@/store/ide" || /\/src\/store\/ide(?:\.ts)?$/.test(id.replaceAll("\\", "/"))) return storeId; },
    load(id) { if (id === storeId) return "let state = { testLoop: false, testsRunning: false }; export const useIde = { getState: () => state, setState: next => { state = { ...state, ...next }; } };"; },
  }], optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  t.after(() => server.close());
  const { useIde } = await server.ssrLoadModule(storeId);
  const { shouldTestAfterRound } = await server.ssrLoadModule("/src/lib/test-loop.ts");
  const saved = useIde.getState();
  t.after(() => useIde.setState(saved));
  useIde.setState({ testLoop: true, testsRunning: false });
  const files = { "main.py": "value = 2", "test_main.py": "def test_value(): assert True" };
  const changes = [{ path: "main.py", before: "value = 1", after: files["main.py"] }];
  const oldSteps = [{ id: "old", name: "shell npm test", detail: "passed before the edit", status: "ok" }];
  assert.equal(shouldTestAfterRound(changes, files, oldSteps), true);
  assert.equal(shouldTestAfterRound(changes, files, oldSteps, { state: "passed", detail: "Only a program launch." }), true);
  assert.equal(shouldTestAfterRound(changes, files, oldSteps, { state: "stale", tests: true, detail: "old" }), true);
  assert.equal(shouldTestAfterRound(changes, files, oldSteps, { state: "passed", tests: true, detail: "Tests current." }), false);
  assert.equal(shouldTestAfterRound(changes, files, oldSteps, { state: "failed", observedFailure: true, detail: "Expected failure observed." }), false, "a deliberately observed failing test is not automatically run again");
  assert.equal(shouldTestAfterRound([{ path: "README.md", before: "old", after: "new" }], files, oldSteps), false);
  assert.equal(shouldTestAfterRound([{ path: "removed.py", before: "value = 1", after: null }], files, oldSteps), true);
  assert.equal(shouldTestAfterRound([{ path: "data.md", before: "old", after: null }], { ...files, "main.py": "print(open('data.md').read())" }, oldSteps), true);
});

test("durable evidence snapshots preserve identities and fresh verification after restart", () => {
  const progress = checkPlan();
  const evidence = new AgentEvidence();
  progress.setInputStamp("source-v1");
  evidence.setInputStamp("source-v1");
  const id = progress.record("shell", { command: "npm test" }, { ok: true });
  evidence.record("shell", { command: "npm test" }, { ok: true });
  assert.equal(closeCheck(progress, id).ok, true);
  const restoredProgress = new PlanProgress();
  const restoredEvidence = new AgentEvidence();
  assert.equal(restoredProgress.restore(JSON.parse(JSON.stringify(progress.snapshot()))), true);
  assert.equal(restoredEvidence.restore(JSON.parse(JSON.stringify(evidence.snapshot()))), true);
  assert.equal(closeCheck(restoredProgress, id).ok, true);
  assert.equal(restoredEvidence.status().state, "passed");
  assert.equal(restoredEvidence.status().tests, true);
  assert.notEqual(restoredProgress.record("read_file", { path: "main.py" }, { ok: true }), id);
  restoredProgress.setInputStamp("source-v2");
  restoredEvidence.setInputStamp("source-v2");
  assert.equal(restoredProgress.plan[0].status, "todo");
  assert.equal(restoredEvidence.status().state, "stale");
});

test("snapshots omit full command arguments, output, file contents and credential fields", () => {
  const progress = checkPlan();
  const evidence = new AgentEvidence();
  const command = "node --test tests.mjs --token SECRET-COMMAND";
  const result = { ok: false, error: "SECRET-ERROR", stderr: "SECRET-OUTPUT", authorization: "SECRET-AUTH" };
  progress.record("shell", { command, token: "SECRET-TOKEN" }, result);
  progress.record("write_file", { path: "main.py", content: "SECRET-FILE" }, { ok: true }, true);
  evidence.record("shell", { command }, result);
  const snapshots = JSON.stringify([progress.snapshot(), evidence.snapshot()]);
  assert.doesNotMatch(snapshots, /SECRET-|authorization|stderr|content|--token/);
  const restored = new AgentEvidence();
  assert.equal(restored.restore(evidence.snapshot()), true);
  assert.equal(restored.status().state, "failed");
  restored.record("shell", { command }, { ok: true });
  assert.equal(restored.status().state, "passed", "same target can clear its restored failure");
});

test("malformed or oversized snapshots are rejected atomically", () => {
  const progress = checkPlan();
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "main.py" }, { ok: true });
  for (const invalid of [null, {}, { version: 99 }, { ...progress.snapshot(), revision: -1 }, { ...progress.snapshot(), evidence: Array(10000).fill({}) }]) {
    assert.equal(progress.restore(invalid), false);
    assert.equal(progress.plan[0].text, "Tests ausführen");
  }
  for (const invalid of [null, {}, { version: 99 }, { ...evidence.snapshot(), revision: -1 }, { ...evidence.snapshot(), runs: Array(10000).fill({}) }]) {
    assert.equal(evidence.restore(invalid), false);
    assert.equal(evidence.status().state, "passed");
  }
});

test("large jobs retain bounded snapshots and never reuse restored evidence IDs", () => {
  const progress = checkPlan();
  for (let i = 0; i < 400; i++) progress.record("read_file", { path: `part-${i}.py` }, { content: "not persisted" });
  const saved = progress.snapshot();
  assert.ok(saved.evidence.length <= 256);
  const restored = new PlanProgress();
  assert.equal(restored.restore(saved), true);
  const next = restored.record("read_file", { path: "new.py" }, { ok: true });
  assert.ok(!saved.evidence.some((row) => row.id === next));
});

test("successful declared negative exit expectations prove only the negative case", () => {
  const evidence = new AgentEvidence();
  evidence.record("shell", { command: "node negative.cjs", expected_exit_code: 1 }, { ok: true, code: 1, expectedExitCode: 1, exitExpectationMatched: true });
  assert.equal(evidence.status().state, "none");
  evidence.record("shell", { command: "node negative.cjs", expected_exit_code: 1 }, { ok: false, code: 2, expectedExitCode: 1, exitExpectationMatched: false });
  assert.equal(evidence.status().state, "failed");
});

test("bounded recovery cannot drop an old failure and present the remaining success as verified", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "first.py" }, { ok: false, error: "first failure" });
  for (let i = 0; i < 300; i++) evidence.record("run_file", { path: `other-${i}.py` }, { ok: true });
  const restored = new AgentEvidence();
  assert.equal(restored.restore(evidence.snapshot()), true);
  assert.notEqual(restored.status().state, "passed");
});

test("a --test argument passed to an ordinary Node application does not prove the test runner ran", () => {
  const ordinary = new AgentEvidence();
  ordinary.record("shell", { command: "node app.mjs --test" }, { ok: true });
  assert.equal(ordinary.status().tests, false);
  const actual = new AgentEvidence();
  actual.record("shell", { command: '"C:\\Program Files\\nodejs\\node.exe" --experimental-strip-types --test test.mjs' }, { ok: true });
  assert.equal(actual.status().tests, true);
  const progress = checkPlan();
  const id = progress.record("shell", { command: "node --test tests.mjs" }, { ok: true });
  assert.equal(closeCheck(progress, id).ok, true);
  const restored = new PlanProgress();
  assert.equal(restored.restore(progress.snapshot()), true);
  assert.equal(closeCheck(restored, id).ok, true);
});

test("failed knowledge mutations block completion without discarding current code proof", () => {
  for (const [name, args] of [
    ["skill_write", { name: "example", body: "Instruction" }],
    ["skill_patch", { name: "example", body: "Instruction" }],
    ["memory_add", { kind: "project", text: "Use the test command" }],
    ["memory_forget", { id: "fact-example" }],
    ["skill_outcome", { name: "example", kind: "ok" }],
  ] as const) {
    const evidence = new AgentEvidence();
    evidence.setInputStamp("source-v1");
    evidence.record("shell", { command: "npm test" }, { ok: true });
    evidence.record(name, args, { error: "Requested save was only partially acknowledged" });
    assert.equal(evidence.status().state, "failed", name);
    assert.match(evidence.status().detail, /partially acknowledged/);
    evidence.record(name, { ...args, name: "different", id: "different", text: "Other memory" }, { ok: true });
    assert.equal(evidence.status().state, "failed", "unrelated success cannot resolve the requested save");
    const restored = new AgentEvidence();
    assert.equal(restored.restore(evidence.snapshot()), true);
    assert.equal(restored.status().state, "failed");
    restored.record(name, args, { ok: true });
    assert.equal(restored.status().state, "passed", "same requested target can resolve the failure without rerunning unchanged code");
    assert.equal(restored.status().tests, true);
  }
});

test("a successful skill documentation change retains current code tests", () => {
  const evidence = new AgentEvidence();
  evidence.setInputStamp("source-v1");
  evidence.record("shell", { command: "npm test" }, { ok: true });
  evidence.changed();
  evidence.record("skill_write", { name: "guide", body: "Inspect then verify" }, { ok: true });
  evidence.setInputStamp("source-v1");
  assert.equal(evidence.status().state, "passed");
  assert.equal(evidence.status().tests, true);
});
