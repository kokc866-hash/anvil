import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifiedReply, type Verification } from "./agent-evidence.ts";

// Exercise the native boundary at runtime without making the renderer's
// checkJs graph recursively adopt all native compiler and generated modules.
const { AgentJobHost } = await import(new URL("../../electron/agent-job-host.mjs", import.meta.url).href);

function fixture() {
  mkdirSync("artifacts", { recursive: true });
  const root = mkdtempSync(resolve("artifacts", "verification-host-"));
  const child = new EventEmitter() as EventEmitter & { send(message: unknown): void; kill(): void };
  child.send = () => {};
  child.kill = () => {};
  const snapshotPath = join(root, "state.json");
  const host = new AgentJobHost({ snapshotPath, runtime: { begin() {}, close() {}, finish() {}, execute: async () => ({ ok: false, code: 7, stderr: "EXPECTED_FAILURE" }) }, launch: () => child });
  host.start({ project: root, execution: true, files: { "negative.cjs": "process.exit(7)" }, messages: [{ role: "user", content: "Observe the deliberate error; do not change files." }], model: { model: "synthetic-worker" } });
  child.emit("message", { type: "ready" });
  return { host, child, snapshotPath };
}

test("HTML verification scope and limitations survive host IPC, persistence and rehydration", async () => {
  const f = fixture();
  try {
    const verification: Verification = { state: "passed", detail: "HTML-Oberfläche geladen.", tests: false, scope: "render", limitations: ["Interaktionen sind noch nicht geprüft."] };
    f.child.emit("message", { type: "result", result: { ok: true, reply: "Page loaded.", verification } });
    assert.deepEqual(f.host.state.verification, verification);
    assert.deepEqual(JSON.parse(readFileSync(f.snapshotPath, "utf8")).verification, verification);
    const restored = new AgentJobHost({ snapshotPath: f.snapshotPath, runtime: undefined, launch() { assert.fail("No worker replay"); } });
    try {
      assert.deepEqual(restored.state.verification, verification);
      assert.match(verifiedReply("Page loaded.", restored.state.verification), /Nicht geprüft: Interaktionen/);
    } finally { await restored.close(); }
  } finally { await f.host.close(); }
});

test("completed observation task retains a failed execution and its honest reply after app recovery", async () => {
  const f = fixture();
  try {
    f.child.emit("message", { type: "operation", id: 1, operation: { kind: "run", path: "negative.cjs" } });
    await f.host.operation;
    assert.equal(f.host.state.lastRun.code, 7);
    assert.equal(f.host.state.lastRun.ok, false);
    const verification: Verification = { state: "failed", detail: "negative.cjs: EXPECTED_FAILURE", tests: false, scope: "execution", observedFailure: true };
    f.child.emit("message", { type: "result", result: { ok: true, reply: "The requested exit 7 was observed.", verification } });
    assert.equal(f.host.state.status, "done", "task completion stays separate from the program's exit");
    assert.deepEqual(f.host.state.verification, verification);
    const restored = new AgentJobHost({ snapshotPath: f.snapshotPath, runtime: undefined, launch() { assert.fail("No worker replay"); } });
    try {
      assert.equal(restored.state.status, "done");
      assert.equal(restored.state.lastRun.ok, false);
      assert.equal(restored.state.lastRun.code, 7);
      assert.deepEqual(restored.state.verification, verification);
      const reply = verifiedReply("The requested exit 7 was observed.", restored.state.verification);
      assert.match(reply, /Fehler beobachtet; die Ausführung blieb fehlgeschlagen/);
      assert.doesNotMatch(reply, /Nicht abgeschlossen|erfolgreich/);
    } finally { await restored.close(); }
  } finally { await f.host.close(); }
});

test("host bounds verification fields and never accepts an observed-failure flag for a passed run", async () => {
  const f = fixture();
  try {
    f.child.emit("message", { type: "result", result: { ok: true, verification: { state: "passed", detail: "d".repeat(20000), scope: "invented", tests: "yes", limitations: [...Array(20).fill("x".repeat(3000)), { secret: "must not cross" }], observedFailure: true, secret: "must not cross" } } });
    const verification = f.host.state.verification;
    assert.equal(verification.state, "passed");
    assert.equal(verification.detail.length, 16000);
    assert.equal(verification.scope, undefined);
    assert.equal(verification.tests, undefined);
    assert.equal(verification.observedFailure, undefined);
    assert.ok(verification.limitations.length <= 8);
    assert.ok(verification.limitations.every((value: string) => value.length <= 2000));
    assert.doesNotMatch(JSON.stringify(verification), /secret|must not cross/);
  } finally { await f.host.close(); }
});

test("saved verification metadata is validated again on recovery", async () => {
  const f = fixture();
  try {
    f.child.emit("message", { type: "result", result: { ok: true } });
    const base = JSON.parse(readFileSync(f.snapshotPath, "utf8"));
    for (const verification of [
      { state: "imaginary", detail: "Invalid" },
      { state: "passed", detail: "Valid state", scope: { unsafe: true }, limitations: [42, "bounded"], observedFailure: true },
    ]) {
      const savedPath = f.snapshotPath.replace(/state\.json$/, `saved-${verification.state}.json`);
      writeFileSync(savedPath, JSON.stringify({ ...base, verification }));
      const restored = new AgentJobHost({ snapshotPath: savedPath, runtime: undefined, launch() { assert.fail("No worker replay"); } });
      try {
        if (verification.state === "imaginary") assert.equal(restored.state.verification, undefined);
        else assert.deepEqual(restored.state.verification, { state: "passed", detail: "Valid state", limitations: ["bounded"] });
      } finally { await restored.close(); }
    }
  } finally { await f.host.close(); }
});
