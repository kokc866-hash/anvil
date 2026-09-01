import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { abortAgent, agentGen, beginAgent, explainAbort, explainLlmError, isAbortLike, AgentAbortError } from "./abort.ts";

describe("abort", () => {
  it("maps the chrome empty abort", () => {
    beginAgent();
    const err = new Error("signal is aborted without reason");
    assert.equal(isAbortLike(err), true);
    assert.match(explainAbort(err), /Abgebrochen/);
  });
  it("keeps the reason from abortAgent", () => {
    beginAgent();
    abortAgent("Gestoppt");
    assert.match(explainAbort(new Error("signal is aborted without reason")), /Gestoppt/);
  });
  it("wraps AgentAbortError", () => {
    const err = new AgentAbortError("Zeitüberschreitung nach 480s");
    assert.equal(isAbortLike(err), true);
  });
  it("invalidates generation on abort", () => {
    const g = beginAgent();
    abortAgent("Stop");
    assert.notEqual(agentGen(), g);
  });
  it("maps anthropic billing json", () => {
    const raw =
      'HTTP 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
    assert.match(explainLlmError(new Error(raw)), /Guthaben/);
  });
});