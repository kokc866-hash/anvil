import assert from "node:assert/strict";
import { test } from "node:test";
import { McpHost, mcpConfig } from "../electron/mcp-host.mjs";

const base = "https://sorceress.games/api/v1";
const config = {
  id: "anvil-service:sorceress-qa",
  service: "sorceress",
  name: "Sorceress",
  url: base,
  transport: "http",
  auth: "bearer",
  enabled: true,
  headers: { authorization: "Bearer sk_sorc_synthetic_test" },
};
const catalog = {
  ok: true,
  tools: [
    {
      id: "ping",
      label: "Ping",
      enabled: true,
      status: "live",
      creditCost: 0,
      params: [{ name: "message", type: "string", required: false }],
    },
    {
      id: "image_generate",
      description: "Generate an image.",
      enabled: true,
      status: "live",
      selfBilled: true,
      costNote: "Cost depends on model.",
      params: [
        { name: "prompt", type: "string", required: true },
        { name: "params", type: "object" },
        { name: "refImages", type: "array" },
      ],
    },
    { id: "disabled_tool", enabled: false, status: "live", params: [] },
  ],
};

test("Sorceress uses REST through the native bridge, preserves async jobs and never replays calls", async (t) => {
  const original = globalThis.fetch,
    calls = [];
  let fail = false,
    failureStatus = 402,
    wait = false;
  globalThis.fetch = async (input, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, config.headers.authorization);
    const url = String(input);
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
    if (wait && url.endsWith("/tools/image_generate"))
      return new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
      );
    if (fail)
      return Response.json(
        { ok: false, error: `test ${config.headers.authorization}` },
        { status: failureStatus },
      );
    if (url === `${base}/tools`) return Response.json(catalog);
    if (url === `${base}/tools/ping`)
      return Response.json({ ok: true, data: { message: "Anvil" } });
    if (url === `${base}/tools/image_generate`)
      return Response.json({
        ok: true,
        data: { jobId: "job-qa", poll: "https://evil.invalid/no" },
      });
    if (url === `${base}/jobs/job-qa`)
      return Response.json({
        ok: true,
        status: "succeeded",
        images: [{ url: "https://example.invalid/qa.png" }],
      });
    throw new Error(`Unexpected REST request ${url}`);
  };
  const host = new McpHost();
  t.after(async () => {
    await host.stop();
    globalThis.fetch = original;
  });
  const init = await host.request(config, "initialize");
  assert.ok(init.capabilities.tools);
  assert.equal(init.capabilities.resources, undefined);
  const offered = (await host.request(config, "tools/list")).tools;
  assert.deepEqual(
    offered.map((tool) => tool.name),
    ["ping", "image_generate", "sorceress_job_get", "sorceress_tool_info"],
  );
  const image = offered.find((tool) => tool.name === "image_generate");
  assert.deepEqual(image.inputSchema.required, ["prompt"]);
  assert.equal(image.inputSchema.properties.params.type, "object");
  assert.deepEqual(image.inputSchema.properties.refImages.items, {});
  assert.match(image.description, /[Cc]redit/);
  const started = await host.request(config, "tools/call", {
    name: "image_generate",
    arguments: { prompt: "synthetic", params: { resolution: "1K" } },
  });
  assert.equal(started.structuredContent.data.jobId, "job-qa");
  assert.equal(started.pending, true, "starting a media job is not evidence of a completed asset");
  assert.match(started.content[0].text, /sorceress_job_get/);
  assert.equal(
    calls.filter((call) => call.url.includes("/jobs/")).length,
    0,
    "no automatic wait or unsafe poll URL",
  );
  const done = await host.request(config, "tools/call", {
    name: "sorceress_job_get",
    arguments: { jobId: "job-qa" },
  });
  assert.equal(done.structuredContent.status, "succeeded");
  assert.equal(done.pending, undefined);
  await assert.rejects(
    host.request(config, "tools/call", { name: "disabled_tool", arguments: {} }),
    /Katalog/,
  );
  await assert.rejects(
    host.request(config, "tools/call", { name: "../keys", arguments: {} }),
    /Katalog|Werkzeug/,
  );
  await assert.rejects(
    host.request(config, "tools/call", {
      name: "sorceress_job_get",
      arguments: { jobId: "../keys" },
    }),
    /kennung/i,
  );
  fail = true;
  await assert.rejects(
    host.request(config, "tools/call", {
      name: "image_generate",
      arguments: { prompt: "synthetic" },
    }),
    (error) => {
      assert.match(error.message, /Guthaben/);
      assert.ok(!error.message.includes("sk_sorc_synthetic_test"));
      return true;
    },
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/tools/image_generate")).length,
    2,
    "failed POST is never replayed",
  );
  fail = false;
  wait = true;
  const abort = new AbortController();
  const pending = host.request(
    config,
    "tools/call",
    { name: "image_generate", arguments: { prompt: "slow" } },
    { signal: abort.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending, /abort/i);
  wait = false;
  fail = true;
  failureStatus = 401;
  await assert.rejects(host.request(config, "tools/list"), /Schlüssel/);
  fail = false;
  globalThis.fetch = async () =>
    new Response("<html>login</html>", { headers: { "content-type": "text/html" } });
  await assert.rejects(host.request(config, "tools/list"), /HTML|JSON/);
});

test("Sorceress credentials are bound to the official API, never a website, proxy or stdio", () => {
  for (const patch of [
    { url: "https://evil.invalid/api/v1" },
    { url: `${base}?redirect=1` },
    { url: "https://sorceress.games/account/api-keys" },
    { transport: "stdio", command: "node" },
    { auth: "oauth" },
  ])
    assert.throws(() => mcpConfig({ ...config, ...patch }), /Sorceress/);
});
