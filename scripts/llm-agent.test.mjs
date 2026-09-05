import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { isAbortNoise, isCloudLlmHost, isLanHost, isLlmTargetHost, listenLocal, noTimeout } from "./llm-agent.mjs";

test("isLanHost", () => {
  assert.equal(isLanHost("192.168.178.41"), true);
  assert.equal(isLanHost("8.8.8.8"), false);
});

test("cloud llm hosts for electron pipe", () => {
  assert.equal(isCloudLlmHost("api.x.ai"), true);
  assert.equal(isCloudLlmHost("api.openai.com"), true);
  assert.equal(isCloudLlmHost("chatgpt.com"), false);
  assert.equal(isCloudLlmHost("8.8.8.8"), false);
  assert.equal(isLlmTargetHost("api.x.ai"), true);
  assert.equal(isLlmTargetHost("192.168.178.41"), true);
  assert.equal(isLlmTargetHost("example.com"), false);
});

test("noTimeout", () => {
  const s = createServer();
  noTimeout(s);
  assert.equal(s.timeout, 0);
  assert.equal(s.requestTimeout, 0);
  s.close();
});

test("listenLocal skips busy port", async () => {
  const a = createServer();
  const p = await listenLocal(a, "127.0.0.1", 17901);
  const b = createServer();
  const q = await listenLocal(b, "127.0.0.1", p);
  assert.ok(q !== p);
  a.close();
  b.close();
});

test("isAbortNoise", () => {
  assert.equal(isAbortNoise(new Error("aborted")), true);
  const reset = new Error("read");
  reset.code = "ECONNRESET";
  assert.equal(isAbortNoise(reset), true);
  assert.equal(isAbortNoise(new Error("ECONNREFUSED")), false);
  const abort = new Error("The operation was aborted");
  abort.name = "AbortError";
  abort.code = "ABORT_ERR";
  const cause = new Error("Premature close");
  cause.code = "ERR_STREAM_PREMATURE_CLOSE";
  abort.cause = cause;
  assert.equal(isAbortNoise(abort), true);
  assert.equal(isAbortNoise(cause), true);
});
