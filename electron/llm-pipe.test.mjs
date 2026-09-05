import assert from "node:assert/strict";
import { test } from "node:test";
import { pipeCorsOrigin } from "./llm-pipe-cors.mjs";

test("pipe CORS allows loopback, rejects the public web", () => {
  assert.equal(pipeCorsOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(pipeCorsOrigin("http://localhost:8080"), "http://localhost:8080");
  assert.equal(pipeCorsOrigin("https://evil.example"), "");
  assert.equal(pipeCorsOrigin("file://"), "");
});

import { createServer } from "node:http";
import { once } from "node:events";
import { createLlmPipeServer } from "./llm-pipe.mjs";
import { assertLlmTarget, isLanHost, llmHeaders } from "../scripts/llm-agent.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
test("native pipe exposes its marker and preserves upstream 401 and provider headers", async (t) => {
  let seen;
  const upstream = createServer((req, res) => { seen = req.headers; res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"bad provider key"}'); });
  const target = await listen(upstream);
  const pipe = createLlmPipeServer("test-pipe");
  const base = await listen(pipe);
  t.after(() => { pipe.closeAllConnections(); pipe.close(); upstream.closeAllConnections(); upstream.close(); });
  const preflight = await fetch(`${base}/pipe`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:8080", "Access-Control-Request-Headers": "api-key,anthropic-version,x-api-key" } });
  assert.equal(preflight.status, 204);
  for (const h of ["api-key", "anthropic-version", "x-api-key"]) assert.ok(preflight.headers.get("access-control-allow-headers").split(/,\s*/).includes(h));
  assert.match(preflight.headers.get("access-control-expose-headers"), /x-anvil-lan/);
  const r = await fetch(`${base}/pipe`, { headers: { Origin: "http://127.0.0.1:8080", "x-anvil-pipe": "test-pipe", "x-anvil-target": `${target}/v1/models`, "api-key": "azure-test", "anthropic-version": "2023-06-01", "x-api-key": "anthropic-test", Cookie: "do-not-forward" } });
  assert.equal(r.status, 401); assert.equal(r.headers.get("x-anvil-lan"), "1");
  assert.equal(r.headers.get("x-anvil-pipe-auth"), null);
  assert.equal(seen["api-key"], "azure-test"); assert.equal(seen["anthropic-version"], "2023-06-01");
  assert.equal(seen.cookie, undefined);
  const invalid = await fetch(`${base}/pipe`, { headers: { "x-anvil-target": `${target}/v1/models` } });
  assert.equal(invalid.headers.get("x-anvil-pipe-auth"), "invalid");
});
test("renderer cancellation closes upstream streaming request", async (t) => {
  let ended;
  const closed = new Promise((resolve) => { ended = resolve; });
  const upstream = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: hello\n\n"); res.on("close", ended); });
  const target = await listen(upstream);
  const pipe = createLlmPipeServer("test"); const base = await listen(pipe);
  t.after(() => { pipe.closeAllConnections(); pipe.close(); upstream.closeAllConnections(); upstream.close(); });
  const ctrl = new AbortController();
  const res = await fetch(`${base}/pipe`, { signal: ctrl.signal, headers: { "x-anvil-pipe": "test", "x-anvil-target": target + "/v1/chat/completions" } });
  await res.body.getReader().read(); ctrl.abort();
  await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("upstream still open")), 1500); timer.unref(); })]);
});
test("Custom grants only the explicit endpoint; metadata stays blocked, VPN/private IPv6 work", () => {
  assert.equal(assertLlmTarget("https://inference.example/api/chat/completions", "https://inference.example/api").hostname, "inference.example");
  assert.throws(() => assertLlmTarget("https://inference.example/other", "https://inference.example/api"));
  assert.throws(() => assertLlmTarget("https://other.example/api/models", "https://inference.example/api"));
  for (const base of ["http://169.254.169.254", "http://metadata.google.internal", "http://[::ffff:a9fe:a9fe]"]) assert.throws(() => assertLlmTarget(base + "/v1/models", base + "/v1"));
  assert.ok(isLanHost("100.100.10.20")); assert.ok(isLanHost("host.tailnet.ts.net")); assert.ok(isLanHost("fd00::7"));
  assert.equal(llmHeaders({ "api-key": "secret", "anthropic-version": "2023-06-01", "x-anvil-pipe": "private" })["x-anvil-pipe"], undefined);
});
