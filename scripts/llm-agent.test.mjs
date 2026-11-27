import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { isAbortNoise, isCloudLlmHost, isLanHost, isLlmTargetHost, listenLocal, noTimeout, llmUpstream } from "./llm-agent.mjs";

test("isLanHost", () => {
  assert.equal(isLanHost("192.168.56.40"), true);
  assert.equal(isLanHost("8.8.8.8"), false);
});

test("cloud llm hosts for electron pipe", () => {
  assert.equal(isCloudLlmHost("api.x.ai"), true);
  assert.equal(isCloudLlmHost("api.openai.com"), true);
  assert.equal(isCloudLlmHost("chatgpt.com"), false);
  assert.equal(isCloudLlmHost("8.8.8.8"), false);
  assert.equal(isLlmTargetHost("api.x.ai"), true);
  assert.equal(isLlmTargetHost("192.168.56.40"), true);
  assert.equal(isLlmTargetHost("example.com"), false);
});

test("Qwen allows documented Model Studio and Coding Plan hosts without allowing unrelated Alibaba or lookalike hosts", () => {
  for (const host of ["dashscope-intl.aliyuncs.com", "dashscope.aliyuncs.com", "coding-intl.dashscope.aliyuncs.com", "coding.dashscope.aliyuncs.com", "qa-workspace.eu-central-1.maas.aliyuncs.com", "workspace.ap-southeast-1.maas.aliyuncs.com"]) assert.equal(isCloudLlmHost(host), true, host);
  for (const host of ["anything.aliyuncs.com", "evil.dashscope-intl.aliyuncs.com", "dashscope-intl.aliyuncs.com.evil.example", "workspace.invalid-region.maas.aliyuncs.com", "workspace.eu-central-1.maas.aliyuncs.com.evil.example"]) assert.equal(isCloudLlmHost(host), false, host);
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

test('native foreground model pipe has no socket idle timer across header and body pauses', async t => {
  const server = createServer(async (_req, res) => {
    await new Promise(resolve => setTimeout(resolve, 80));
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('first');
    await new Promise(resolve => setTimeout(resolve, 80)); res.end('last');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const result = await llmUpstream(`http://127.0.0.1:${server.address().port}/v1`);
  assert.equal(result.stream.socket.timeout, 0);
  let text = ''; for await (const part of result.stream) text += part;
  assert.equal(text, 'firstlast');
});
