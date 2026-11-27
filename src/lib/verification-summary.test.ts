import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentEvidence, verifiedReply, automaticRunVerification } from "./agent-evidence.ts";

const files = {
  "index.html": '<button id="create">Create</button><script type="module" src="ui.js"></script>',
  "ui.js": "document.body.dataset.loaded = 'yes';",
  "tests/test.js": "/* business tests */",
  "tests/browser-test.mjs": "/* browser interaction tests */",
};
const render = { ok: true, stage: { kind: "html" }, state: { text: "Planner", elements: [] } };
const nodeOutput = "# tests 28\n# suites 0\n# pass 28\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
const browserOutput = "PASS - create task\nPASS - export\nPASS - import\n# tests 1\n# pass 1\n# fail 0\n# skipped 0\n";
function resumed() {
  const first = new AgentEvidence();
  first.setInputStamp("unchanged-v1");
  first.record("run_file", { path: "index.html" }, render);
  first.record("play", { keys: ["right"] }, { ok: true, state: { text: "Planner" } });
  const next = new AgentEvidence();
  assert.equal(next.restore(first.snapshot()), true);
  next.setInputStamp("unchanged-v1");
  return next;
}

test("fresh named test results lead the resumed completion instead of an inherited key press", () => {
  const evidence = resumed();
  evidence.record("run_file", { path: "tests/test.js" }, { ok: true, code: 0, stdout: nodeOutput });
  evidence.record("run_file", { path: "tests/browser-test.mjs" }, { ok: true, code: 0, stdout: browserOutput });
  evidence.record("run_file", { path: "index.html" }, render);
  const status = evidence.status(files);
  assert.equal(status.state, "passed");
  assert.match(status.detail, /tests\/test\.js.*28/);
  assert.match(status.detail, /tests\/browser-test\.mjs.*1/);
  assert.match(status.detail, /3.*Einzelprüf/);
  assert.match(status.detail, /(?:Übernommen|übernommen|früher|vorher|Vorher|Vorhanden)/);
  assert.match(status.detail, /(?:Aktuell|aktuell|Jetzt|jetzt)/);
  assert.ok(status.detail.indexOf("tests/test.js") < status.detail.indexOf("Vorschaueingabe"));
  const reply = verifiedReply("App checked.", status, true);
  assert.match(reply, /tests\/test\.js.*28/);
  assert.doesNotMatch(status.detail, /^Tasteneingabe zugestellt/);
});

test("individual output checks stay distinct from the framework test count", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "tests/browser-test.mjs" }, { ok: true, code: 0, stdout: browserOutput });
  const status = evidence.status(files);
  assert.match(status.detail, /1.*bestanden/);
  assert.match(status.detail, /3.*Einzelprüf/);
  assert.doesNotMatch(status.detail, /4.*bestanden/);
});

test("a CLI-only final answer includes actual named tests without an HTML limitation", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "tests/test.js" }, { ok: true, code: 0, stdout: nodeOutput });
  const status = evidence.status({ "tests/test.js": "/* tests */" });
  assert.equal(status.limitations, undefined);
  assert.match(verifiedReply("Berechnung geprüft.", status), /tests\/test\.js.*28\/28/);
});

test("saved summaries retain bounded counts but not original output, commands or paths", () => {
  const evidence = new AgentEvidence();
  evidence.setInputStamp("v1");
  evidence.record("run_file", { path: "tests/test.js" }, { ok: true, code: 0, stdout: nodeOutput + "PRIVATE-OUTPUT\n" });
  const snapshot = evidence.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-OUTPUT|tests\/test\.js/);
  const restored = new AgentEvidence();
  assert.equal(restored.restore(JSON.parse(JSON.stringify(snapshot))), true);
  const status = restored.status(files);
  assert.match(status.detail, /tests\/test\.js.*28/);
  assert.match(status.detail, /(?:Übernommen|übernommen|früher|vorher|Vorher|Vorhanden)/);
  assert.doesNotMatch(status.detail, /(?:Aktuell geprüft|Jetzt geprüft)/);
});

test("exit success cannot hide a reported failed framework test", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "tests/test.js" }, { ok: true, code: 0, stdout: "# tests 3\n# pass 2\n# fail 1\n# skipped 0\n" });
  assert.equal(evidence.status(files).state, "failed");
  assert.match(evidence.status(files).detail, /1.*fehlgeschlagen/);
});

test("skipped-only and truncated runs never claim all tests passed", () => {
  const evidence = new AgentEvidence();
  evidence.record("run_file", { path: "tests/test.js" }, { ok: true, code: 0, stdout: "# tests 3\n# pass 0\n# fail 0\n# skipped 3\n" });
  assert.match(evidence.status(files).detail, /0.*bestanden/);
  assert.match(evidence.status(files).detail, /3.*übersprungen/);
  evidence.record("run_file", { path: "tests/test.js" }, { ok: true, code: 0, stdout: nodeOutput, truncated: true });
  assert.notEqual(evidence.status(files).state, "passed");
});

test("legacy snapshots remain readable and make no invented test counts", () => {
  const old = new AgentEvidence();
  old.record("run_file", { path: "tests/test.js" }, { ok: true, code: 0 });
  const snapshot = old.snapshot();
  const restored = new AgentEvidence();
  assert.equal(restored.restore(snapshot), true);
  const status = restored.status(files);
  assert.match(status.detail, /tests\/test\.js/);
  assert.doesNotMatch(status.detail, /\b28\b/);
  assert.match(status.detail, /(?:keine|nicht).*?(?:Anzahl|Zähl|Einzel)/i);
});

test("the legacy automatic-run completion keeps current named tests rather than replacing them", () => {
  const previous = { state: "passed" as const, detail: "Aktuell geprüft: tests/test.js: 28/28 Tests bestanden", tests: true, scope: "tests" as const };
  const result = automaticRunVerification(previous, true, true);
  assert.match(result.detail, /tests\/test\.js.*28/);
  assert.match(result.detail, /Automatischer Run/);
  assert.equal(result.tests, true);
  assert.equal(automaticRunVerification(previous, false, true).state, "failed");
  const changed = automaticRunVerification(previous, true, false);
  assert.equal(changed.state, "stale");
  assert.doesNotMatch(changed.detail, /28\/28/);
});

