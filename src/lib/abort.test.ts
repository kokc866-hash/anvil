import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  abortAgent,
  agentGen,
  beginAgent,
  cloudStopMs,
  explainAbort,
  explainLlmError,
  hardStopMs,
  isAbortLike,
  isLocalLlm,
  localSseStall,
  shouldRetryLocalLlm,
  streamIdleMs,
  SSE_FIRST_LOCAL_MS,
  SSE_FIRST_MS,
  SSE_IDLE_LOCAL_MS,
  SSE_IDLE_MS,
  AgentAbortError,
} from "./abort.ts";

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
  it("slider 0 is no cloud time lock", () => {
    assert.equal(hardStopMs(0), 0);
    assert.equal(cloudStopMs(0), 0);
    assert.equal(cloudStopMs(5), 5 * 60_000);
    assert.equal(streamIdleMs(false, 0), SSE_FIRST_MS);
    assert.equal(streamIdleMs(true, 0), SSE_IDLE_MS);
    assert.equal(streamIdleMs(false, 1), SSE_FIRST_MS);
    assert.equal(streamIdleMs(true, 1), 60_000);
    assert.equal(streamIdleMs(false, 0, true), 600_000);
    assert.equal(streamIdleMs(true, 0, true), 180_000);
    assert.equal(isLocalLlm("ollama"), true);
    assert.equal(isLocalLlm("openai"), false);
  });
  it("local first-byte is 10 min, cloud 25s; slider 0 does not shrink", () => {
    assert.equal(streamIdleMs(false, 0, false), 25_000);
    assert.equal(streamIdleMs(false, 0, true), 600_000);
    assert.equal(streamIdleMs(true, 0, true), SSE_IDLE_LOCAL_MS);
    assert.equal(streamIdleMs(false, 0, true), SSE_FIRST_LOCAL_MS);
    assert.equal(hardStopMs(0), 0);
  });
  it("isLocalLlm is local runtimes plus custom, not cloud/abo", () => {
    assert.equal(isLocalLlm("ollama"), true);
    assert.equal(isLocalLlm("lmstudio"), true);
    assert.equal(isLocalLlm("custom"), true);
    assert.equal(isLocalLlm("openai"), false);
    assert.equal(isLocalLlm("azure"), false);
    assert.equal(isLocalLlm("anthropic"), false);
    assert.equal(isLocalLlm("codex"), false);
    assert.equal(isLocalLlm("grok"), false);
    assert.equal(isLocalLlm("groq"), false);
    assert.equal(isLocalLlm("openrouter"), false);
    assert.equal(isLocalLlm("xai"), false);
    assert.equal(isLocalLlm("google"), false);
  });
  it("custom stall is LAN only", () => {
    assert.equal(localSseStall("ollama", "https://api.openai.com"), true);
    assert.equal(localSseStall("custom", "http://127.0.0.1:11434"), true);
    assert.equal(localSseStall("custom", "http://192.168.178.41:11434"), true);
    assert.equal(localSseStall("custom", "https://api.openai.com/v1"), false);
    assert.equal(localSseStall("openai", "https://api.openai.com"), false);
  });
  it("does not retry StreamStallError or empty local streams", () => {
    const stall = new Error("Kein Token — Verbindung weg. Nochmal senden.");
    stall.name = "StreamStallError";
    assert.equal(shouldRetryLocalLlm(stall), false);
    assert.equal(shouldRetryLocalLlm(new Error("Leere Antwort")), false);
    assert.equal(shouldRetryLocalLlm(new Error("Leerer Stream — Modell hat abgebrochen")), false);
    assert.equal(shouldRetryLocalLlm(new Error("Failed to fetch")), true);
    assert.equal(shouldRetryLocalLlm(new Error("ECONNRESET")), true);
    assert.equal(shouldRetryLocalLlm(new Error("HTTP 502")), true);
  });
});
