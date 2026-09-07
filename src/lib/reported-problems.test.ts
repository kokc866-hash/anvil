import assert from "node:assert/strict";
import { test } from "node:test";
import { lintWorkspace } from "./lsp-lint.ts";
import { AgentEvidence } from "./agent-evidence.ts";
import { WriteQueue } from "./write-queue.ts";

test("Python floor division, inline suites, comments and multiline strings do not invent syntax errors", () => {
  const source = `def reset():
    return [(40 // 2, 40 // 2), (10 // 2, 8 // 2)]
if True: reset() # valid inline suite
try:
    reset()
except Exception as exc: # valid comment
    print(exc)
def multi(
    value: int,
):
    return value
doc = '''a triple-quoted string with ' and [ { (
if fake without colon
'''
`;
  assert.deepEqual(lintWorkspace({ "snake.py": source }), []);
  const broken = lintWorkspace({ "snake.py": "if True\n    print([1, 2\n" });
  assert.ok(broken.some((h) => h.message === "Blockkopf ohne Doppelpunkt"));
  assert.ok(broken.some((h) => h.message === "[ nicht geschlossen"));
});

test("a used Java import stays, and an unused import remains a warning", () => {
  assert.deepEqual(lintWorkspace({ "Snake.java": "import java.util.LinkedList;\nclass Snake { private LinkedList<int[]> snake = new LinkedList<>(); }" }), []);
  assert.equal(lintWorkspace({ "Snake.java": "import java.util.LinkedList;\nclass Snake {}" })[0]?.severity, "warning");
});

test("unrelated runs cannot clear failures; changes invalidate earlier success", () => {
  const e = new AgentEvidence();
  e.record("run_file", { path: "snake.ts" }, { ok: false, error: "missing DOM" });
  e.record("shell", { command: "git status" }, { ok: true });
  e.record("run_file", { path: "other.py" }, { ok: true });
  assert.equal(e.status().state, "failed");
  e.changed();
  e.record("run_file", { path: "snake.ts" }, { ok: true });
  assert.equal(e.status().state, "stale");
  e.record("run_file", { path: "other.py" }, { ok: true });
  assert.equal(e.status().state, "passed");
  e.changed();
  assert.equal(e.status().state, "stale");
});

test("a failed write retries explicitly and retains the concrete cause", async () => {
  const q = new WriteQueue(() => {});
  let attempts = 0;
  q.schedule("snake.ts", async () => { if (++attempts === 1) throw new Error("snake.ts: cwd außerhalb des Workspace"); });
  await assert.rejects(q.flush(), /snake.ts: cwd außerhalb/);
  await q.flush();
  assert.equal(attempts, 2);
  await q.flush();
  assert.equal(attempts, 2);
});

test("canceling a failed or in-flight write prevents resurrection and allows closing", async () => {
  const q = new WriteQueue(() => {});
  let release!: () => void;
  q.schedule("a", async () => { await new Promise<void>((r) => { release = r; }); throw new Error("denied"); });
  const pending = q.flush();
  await new Promise((r) => setImmediate(r));
  q.cancel((key) => key === "a"); release();
  await assert.rejects(pending, /denied/);
  await q.flush();
});
