import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { openLlmPipe } from "./llm-agent.mjs";

test("openLlmPipe flushes headers before the first token", () => {
  const dest = new PassThrough();
  const headers = {};
  let flushed = false;
  dest.statusCode = 0;
  dest.setHeader = (k, v) => {
    headers[k] = v;
  };
  dest.flushHeaders = () => {
    flushed = true;
  };
  const src = new PassThrough();
  openLlmPipe(dest, {
    status: 200,
    headers: { get: (k) => (k === "content-type" ? "text/event-stream" : null) },
    stream: src,
  });
  assert.equal(dest.statusCode, 200);
  assert.equal(headers["content-type"], "text/event-stream");
  assert.equal(headers["X-Accel-Buffering"], "no");
  assert.equal(flushed, true);
  src.end();
});
