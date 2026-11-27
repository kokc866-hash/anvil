import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentEvidence, verifiedReply } from "./agent-evidence.ts";

const app = {
  "index.html": '<canvas id="game"></canvas><script type="module" src="main.js"></script>',
  "main.js": 'import { Game } from "./game.js"; new Game().start();',
  "game.js": "export class Game { start() {} }",
};
const render = { ok: true, graphical: true, stage: { kind: "html" }, state: { text: "Game", elements: [] } };

test("loading an HTML game records rendering, not tested gameplay", () => {
  const evidence = new AgentEvidence();
  evidence.setInputStamp("v1");
  evidence.record("run_file", { path: "index.html" }, render);
  const result = evidence.status(app);
  assert.equal(result.state, "passed");
  assert.equal(result.scope, "render");
  assert.equal(result.tests, false);
  assert.match(result.limitations?.join(" ") || "", /Interaktion|Funktion/);
  assert.match(evidence.interactionNeeded(app) || "", /index\.html/);
  assert.match(verifiedReply("Everything works.", result), /Prüfumfang:|Nicht geprüft:/);
});

test("a successful Node module cannot certify the surrounding HTML application", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "game.js" }, { ok: true, code: 0, stdout: "" });
  const result = evidence.status(app);
  assert.equal(result.scope, "execution");
  assert.match(result.limitations?.join(" ") || "", /HTML.*nicht.*(?:geladen|gestartet)/);
  assert.match(evidence.interactionNeeded(app) || "", /HTML.*(?:starten|laden)/);
});

test("delivered keys with an observed result prove that interaction only", () => {
  const evidence = new AgentEvidence();
  evidence.setInputStamp("v1");
  evidence.record("run_file", { path: "index.html" }, render);
  evidence.record("play", { keys: ["right", "up"] }, { ok: true, image: "frame" });
  const result = evidence.status(app);
  assert.equal(result.scope, "interaction");
  assert.equal(result.tests, false);
  assert.equal(evidence.interactionNeeded(app), undefined);
  assert.match(result.limitations?.join(" ") || "", /vollständig|gesamten|weitere Funktionen/);
  evidence.setInputStamp("v2");
  assert.equal(evidence.status(app).state, "stale");
  assert.ok(evidence.interactionNeeded(app));
});

test("empty, failed, unobserved or unrelated interactions cannot certify HTML function checks", () => {
  for (const [args, result] of [
    [{ keys: [] }, { ok: true, image: "frame" }],
    [{ keys: ["right"] }, { ok: false, image: "frame" }],
    [{ keys: ["right"] }, { ok: true }],
  ] as const) {
    const evidence = new AgentEvidence();
    evidence.record("run_file", { path: "index.html" }, render);
    evidence.record("play", args, result);
    assert.ok(evidence.interactionNeeded(app));
    assert.notEqual(evidence.status(app).scope, "interaction");
  }
  const evidence = new AgentEvidence();
  evidence.record("play", { keys: ["right"] }, { ok: true, image: "unbound frame" });
  assert.ok(evidence.interactionNeeded(app), "an interaction without a current HTML launch is not attributed to an arbitrary app");
});

test("a native log or screenshot is not HTML render evidence", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "game.js" }, { ok: true, code: 0 });
  evidence.record("see_run", {}, { ok: true, stage: "log", stdout: "Exitcode 0" });
  assert.match(evidence.status(app).limitations?.join(" ") || "", /HTML.*nicht.*(?:geladen|gestartet)/);
});

test("static pages and CLI tests do not require keyboard interactions", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "index.html" }, render);
  assert.equal(evidence.interactionNeeded({ "index.html": "<h1>Documentation</h1>" }), undefined);
  const cli = new AgentEvidence();
  cli.record("shell", { command: "npm test" }, { ok: true, code: 0 });
  assert.equal(cli.interactionNeeded({ "main.js": "console.log('hello')" }), undefined);
  assert.equal(cli.status({ "main.js": "console.log('hello')" }).tests, true);
});

test("functional evidence survives recovery without storing keys, output or raw paths", () => {
  const evidence = new AgentEvidence();
  evidence.setInputStamp("v1");
  evidence.record("run_file", { path: "index.html" }, render);
  evidence.record("play", { keys: ["right"] }, { ok: true, image: "PRIVATE-FRAME", state: { text: "PRIVATE-TEXT" } });
  const snapshot = evidence.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|index\.html|right/);
  const recovered = new AgentEvidence();
  assert.equal(recovered.restore(JSON.parse(JSON.stringify(snapshot))), true);
  assert.equal(recovered.interactionNeeded(app), undefined);
  assert.equal(recovered.status(app).scope, "interaction");
  assert.equal(recovered.restore({ ...snapshot, previewTarget: { unsafe: true } }), false);
});

test("Space and text-only observations count without attributing them to another HTML app", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "index.html" }, render);
  evidence.record("play", { keys: [" "] }, { ok: true, state: { text: "Jumped", elements: [] } });
  assert.equal(evidence.status(app).scope, "interaction");
  const other = { "other.html": app["index.html"] };
  assert.equal(evidence.status(other).scope, "execution");
  assert.ok(evidence.interactionNeeded(other));
});

test("seeing a frame again never stands in for a function test", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "index.html" }, render);
  evidence.record("see_run", {}, { ok: true, image: "new frame" });
  assert.equal(evidence.status(app).scope, "render");
  assert.ok(evidence.interactionNeeded(app));
});

test("a current HTML check supersedes stale successful module startup without hiding failed or stale tests", () => {
  const evidence = new AgentEvidence();
  evidence.setInputStamp("v1");
  evidence.record("run_file", { path: "game.js" }, { ok: true, code: 0 });
  evidence.setInputStamp("v2");
  evidence.record("run_file", { path: "index.html" }, render);
  assert.equal(evidence.status(app).state, "passed");
  assert.equal(evidence.status(app).scope, "render");
  const failed = new AgentEvidence();
  failed.setInputStamp("v1");
  failed.record("run_file", { path: "game.js" }, { ok: false, code: 1 });
  failed.setInputStamp("v2");
  failed.record("run_file", { path: "index.html" }, render);
  assert.equal(failed.status(app).state, "failed");
  const tests = new AgentEvidence();
  tests.setInputStamp("v1");
  tests.record("run_file", { path: "game.test.js" }, { ok: true, code: 0 });
  tests.setInputStamp("v2");
  tests.record("run_file", { path: "index.html" }, render);
  assert.equal(tests.status(app).state, "stale");
});

test("an observed deliberate failing program can complete the observation task without certifying its execution", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "negative.js" }, { ok: false, code: 7, stderr: "EXPECTED_FAILURE" });
  assert.equal(evidence.canObserveFailure(), true);
  const verification = { ...evidence.status(), observedFailure: true };
  assert.equal(verification.state, "failed");
  assert.notEqual(verification.tests, true);
  const reply = verifiedReply("Exit 7 was observed. Files were not changed.", verification);
  assert.doesNotMatch(reply, /Nicht abgeschlossen|erfolgreich/);
  assert.match(reply, /Fehler beobachtet.*Ausführung blieb fehlgeschlagen/);
  const recovered = new AgentEvidence();
  assert.equal(recovered.restore(evidence.snapshot()), true);
  assert.equal(recovered.canObserveFailure(), true);
});

test("failure observation excludes missing exits, interruptions, pending work and unrelated failures", () => {
  for (const invalid of [
    { ok: false, error: "shape is invalid" },
    { ok: false, code: 1, aborted: true },
    { ok: false, code: 1, timedOut: true },
    { ok: false, code: 1, running: true },
    { ok: false, code: 1, error: "fetch failed" },
  ]) {
    const evidence = new AgentEvidence();
    evidence.record("run_file", { path: "negative.js" }, invalid);
    assert.equal(evidence.canObserveFailure(), false, JSON.stringify(invalid));
  }
  for (const failure of ["write_file", "memory_add", "mcp_call"]) {
    const evidence = new AgentEvidence();
    evidence.record("run_file", { path: "negative.js" }, { ok: false, code: 7 });
    evidence.record(failure, { path: "note.txt" }, { ok: false, error: "unrelated failure" });
    assert.equal(evidence.canObserveFailure(), false, failure);
    const recovered = new AgentEvidence();
    assert.equal(recovered.restore(evidence.snapshot()), true);
    assert.equal(recovered.canObserveFailure(), false, `${failure} recovery`);
  }
  const pending = new AgentEvidence();
  pending.record("run_file", { path: "negative.js" }, { ok: false, code: 7 });
  pending.record("run_file", { path: "other.js" }, { ok: true, running: true });
  assert.equal(pending.canObserveFailure(), false);
});
