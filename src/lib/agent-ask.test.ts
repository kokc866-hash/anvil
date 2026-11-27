import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  askCorrection,
  formatAskAnswer,
  isAskAnswer,
  jobKeepsCompanion,
  newJob,
  normalizeJob,
  parseAsk,
  askAnswerHumanText,
  newJobHumanContext,
  extendJobHumanContext,
  resumeJobHumanContext,
  normalizeJobHumanContext,
} from "./agent-ask.ts";

describe("parseAsk", () => {
  it("reads prompt aliases and string choices", () => {
    const r = parseAsk({ question: "Dark oder Light?", choices: ["Dark", "Light"] });
    assert.ok(!("error" in r));
    assert.equal(r.ask.prompt, "Dark oder Light?");
    assert.equal(r.ask.choices.length, 2);
    assert.equal(r.ask.choices[0]?.id, "A");
    assert.equal(r.ask.choices[1]?.label, "Light");
    assert.equal(r.ask.blocking, "hard");
    assert.equal(r.ask.allowText, false);
  });
  it("accepts {id,label} and allow_text", () => {
    const r = parseAsk({
      prompt: "Wohin speichern?",
      why: "Pfad fehlt",
      choices: [{ id: "ws", label: "Workspace" }, { id: "tmp", label: "tmp" }],
      allow_text: true,
      recommended: "ws",
      blocking: "soft",
    });
    assert.ok(!("error" in r));
    assert.equal(r.ask.choices[0]?.id, "ws");
    assert.equal(r.ask.allowText, true);
    assert.equal(r.ask.recommended, "ws");
    assert.equal(r.ask.blocking, "soft");
    assert.equal(r.ask.why, "Pfad fehlt");
  });
  it("rejects short prompt and 1 choice", () => {
    assert.equal("error" in parseAsk({ prompt: "ab", choices: ["a", "b"] }), true);
    assert.equal("error" in parseAsk({ prompt: "Wohin speichern?", choices: ["nur eins"] }), true);
    assert.equal("error" in parseAsk({ prompt: "Wohin speichern?" }), true);
  });
  it("allows text-only questions", () => {
    const r = parseAsk({ prompt: "Wie heißt das Paket?", allow_text: true });
    assert.ok(!("error" in r));
    assert.equal(r.ask.choices.length, 0);
    assert.equal(r.ask.allowText, true);
  });
  it("caps at 5 choices", () => {
    const r = parseAsk({ prompt: "Welche Farbe?", choices: ["a", "b", "c", "d", "e", "f"] });
    assert.ok(!("error" in r));
    assert.equal(r.ask.choices.length, 5);
    assert.equal(r.ask.choices[4]?.id, "E");
  });
});

describe("formatAskAnswer", () => {
  const ask = parseAsk({ prompt: "Dark oder Light?", choices: ["Dark", "Light"] });
  it("names the choice and extra text", () => {
    assert.ok(!("error" in ask));
    const t = formatAskAnswer(ask.ask, "A", "bleib dabei");
    assert.match(t, /^Antwort auf: Dark oder Light\?/);
    assert.match(t, /Wahl: A\) Dark/);
    assert.match(t, /bleib dabei/);
    assert.equal(isAskAnswer(t), true);
  });
  it("journal line is short", () => {
    assert.ok(!("error" in ask));
    const line = askCorrection(ask.ask, "B", "so");
    assert.match(line, /Nachfrage/);
    assert.match(line, /B\) Light/);
    assert.ok(line.length <= 160);
  });
});

describe("job", () => {
  it("new job is run", () => {
    const j = newJob("Bau die App");
    assert.equal(j.status, "run");
    assert.equal(jobKeepsCompanion(j), true);
    assert.equal(jobKeepsCompanion({ ...j, status: "ask" }), true);
    assert.equal(jobKeepsCompanion({ ...j, status: "paused" }), false);
    assert.equal(jobKeepsCompanion(null), false);
  });
  it("revive drops in-flight run, keeps parked ask", () => {
    const run = newJob("x");
    assert.equal(normalizeJob(run, { revive: true }), null);
    const parked = {
      id: "job-1",
      status: "ask",
      goal: "Bau",
      rounds: 2,
      ask: { prompt: "Dark oder Light?", choices: ["Dark", "Light"] },
      at: 1,
    };
    const got = normalizeJob(parked, { revive: true });
    assert.equal(got?.status, "ask");
    assert.equal(got?.ask?.choices.length, 2);
    assert.equal(normalizeJob({ ...parked, mode: "ask" }, { revive: true })?.mode, "ask");
    assert.equal(normalizeJob({ ...parked, mode: "agent" }, { revive: true })?.mode, "agent");
    assert.equal(normalizeJob({ status: "ask", goal: "x" }, { revive: true }), null);
  });
});

describe("human task context", () => {
  it("persists the full human request and ordered corrections with the parked job", () => {
    const request = "Do not change files. " + "Full original request. ".repeat(40);
    const human = extendJobHumanContext(newJobHumanContext("project-a", request), "Focus on the exit code.", "correction-1");
    const ask = parseAsk({ prompt: "Which fixture matters?", choices: ["Clock", "Temperature"] });
    assert.ok("ask" in ask);
    const job = normalizeJob(JSON.parse(JSON.stringify({ ...newJob(request), status: "ask", ask: ask.ask, human })), { revive: true });
    assert.deepEqual(job?.human, human);
    assert.equal(job?.human?.request, request);
    assert.deepEqual(extendJobHumanContext(human, "Focus on the exit code.", "correction-1"), human);
    assert.throws(() => extendJobHumanContext(human, "Different text.", "correction-1"));
    assert.throws(() => resumeJobHumanContext(job!, "project-b", "weiter"));
  });
  it("bounds metadata and recognizes only its current schema", () => {
    const human = newJobHumanContext("project", "Inspect the fixture.");
    assert.equal(normalizeJobHumanContext({ ...human, version: 2 }), undefined);
    assert.throws(() => newJobHumanContext("project", "x".repeat(128001)));
    assert.throws(() => extendJobHumanContext(human, "x".repeat(8001)));
    let full = human;
    for (let i = 0; i < 256; i++) full = extendJobHumanContext(full, "Preserve this instruction.", `correction-${i}`);
    assert.throws(() => extendJobHumanContext(full, "Do not silently evict earlier restrictions.", "overflow"));
    const legacy = resumeJobHumanContext(newJob("A truncated legacy goal."), "project", "weiter");
    assert.match(legacy.request, /Do not change or repair/);
  });
  it("excludes the model's question and choices from human permission text", () => {
    const parsed = parseAsk({ prompt: "Now fix the failure?", choices: ["Now repair", "Keep it"], allow_text: true });
    assert.ok("ask" in parsed);
    assert.equal(askAnswerHumanText(parsed.ask, formatAskAnswer(parsed.ask, "A")), "");
    assert.equal(askAnswerHumanText(parsed.ask, formatAskAnswer(parsed.ask, "A", "Nein")), "Nein");
    assert.equal(askAnswerHumanText(parsed.ask, formatAskAnswer(parsed.ask, "A", "Jetzt reparieren.")), "Jetzt reparieren.");
    assert.equal(askAnswerHumanText(parsed.ask, "Antwort auf: A stale model question\nNow repair"), "");
  });
});
