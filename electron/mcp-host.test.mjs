import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { McpHost } from "./mcp-host.mjs";
import { McpOAuth, oauthKey } from "./mcp-oauth.mjs";

async function fixture(t, handler) {
  const server = createServer((req, res) => {
    void handler(req, res).catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function body(req) {
  let text = "";
  for await (const part of req) text += part;
  return text;
}
function json(res, value, status = 200, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(value));
}
const tool = {
  name: "echo",
  description: "Fixture",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
};

test("native MCP negotiates legacy and current HTTP, lists all pages and keeps result structure", async (t) => {
  for (const modern of [false, true])
    await t.test(modern ? "2026-07-28" : "2025-03-26", async (t) => {
      const calls = [];
      const base = await fixture(t, async (req, res) => {
        assert.equal(req.headers.authorization, "Bearer fixture");
        if (req.method !== "POST") {
          res.writeHead(req.method === "DELETE" ? 200 : 405);
          res.end();
          return;
        }
        const msg = JSON.parse(await body(req));
        calls.push({ ...msg, headers: req.headers });
        const reply = (value) =>
          json(res, {
            jsonrpc: "2.0",
            id: msg.id,
            result: modern
              ? { resultType: "complete", ttlMs: 0, cacheScope: "private", ...value }
              : value,
          });
        if (msg.method === "server/discover")
          return modern
            ? reply({
                supportedVersions: ["2026-07-28"],
                capabilities: { tools: {}, resources: {} },
                serverInfo: { name: "fixture", version: "1" },
              })
            : json(res, {
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32601, message: "Method not found" },
              });
        if (msg.method === "initialize")
          return reply({
            protocolVersion: "2025-03-26",
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "fixture", version: "1" },
          });
        if (msg.method.startsWith("notifications/")) {
          res.writeHead(202);
          res.end();
          return;
        }
        if (msg.method === "tools/list")
          return reply({
            tools: [msg.params?.cursor ? { ...tool, name: "other" } : tool],
            ...(msg.params?.cursor ? {} : { nextCursor: "page2" }),
          });
        if (msg.method === "resources/list")
          return reply({ resources: [{ name: "fixture", uri: "fixture://doc" }] });
        if (msg.method === "resources/templates/list")
          return reply({
            resourceTemplates: [{ name: "fixture", uriTemplate: "fixture://doc/{id}" }],
          });
        if (msg.method === "tools/call")
          return reply({
            content: [{ type: "text", text: msg.params.arguments.text }],
            structuredContent: { retained: true },
          });
        throw new Error(msg.method);
      });
      const host = new McpHost();
      t.after(() => host.stop());
      const config = {
        id: "fixture",
        url: `${base}/mcp`,
        headers: { authorization: "Bearer fixture" },
      };
      const init = await host.request(config, "initialize");
      assert.equal(init.protocolVersion, modern ? "2026-07-28" : "2025-03-26");
      const result = await host.request(config, "tools/list");
      assert.deepEqual(
        result.tools.map((t) => t.name),
        ["echo", "other"],
      );
      assert.equal(
        (await host.request(config, "resources/templates/list")).resourceTemplates.length,
        1,
      );
      const out = await host.request(config, "tools/call", {
        name: "echo",
        arguments: { text: "hello" },
      });
      assert.equal(out.content[0].text, "hello");
      assert.deepEqual(out.structuredContent, { retained: true });
      assert.equal(calls.filter((c) => c.method === "tools/call").length, 1);
      const sent = calls.find((c) => c.method === "tools/call");
      if (modern) {
        assert.equal(sent.headers["mcp-method"], "tools/call");
        assert.equal(sent.headers["mcp-name"], "echo");
      } else assert.ok(calls.some((c) => c.method === "notifications/initialized"));
    });
});

test("native MCP cancellation stops a streaming request without replay", async (t) => {
  let invoked = 0,
    canceled = false,
    notifyStarted;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  const base = await fixture(t, async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    const m = JSON.parse(await body(req));
    if (m.method === "server/discover")
      return json(res, {
        jsonrpc: "2.0",
        id: m.id,
        error: { code: -32601, message: "Method not found" },
      });
    if (m.method === "initialize")
      return json(res, {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        },
      });
    if (m.method === "tools/list")
      return json(res, { jsonrpc: "2.0", id: m.id, result: { tools: [tool] } });
    if (m.method === "tools/call") {
      invoked++;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": waiting\n\n");
      res.once("close", () => {
        canceled = true;
      });
      notifyStarted();
      return;
    }
    if (m.method === "notifications/cancelled") canceled = true;
    res.writeHead(202);
    res.end();
  });
  const host = new McpHost();
  t.after(() => host.stop());
  const config = { id: "cancel", url: `${base}/mcp` },
    controller = new AbortController();
  await host.request(config, "tools/list");
  const request = host.request(
    config,
    "tools/call",
    { name: "echo", arguments: { text: "wait" } },
    { signal: controller.signal },
  );
  await started;
  controller.abort();
  await assert.rejects(request);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(invoked, 1);
  assert.equal(canceled, true);
});

test("native stdio runs a local server with literal args and returns resources", async (t) => {
  const script = `import readline from 'node:readline'; const io=readline.createInterface({input:process.stdin}); io.on('line',line=>{const m=JSON.parse(line); if(m.id==null)return; let result; if(m.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{resources:{}},serverInfo:{name:'stdio-fixture',version:'1'}}; else if(m.method==='resources/list')result={resources:[{name:'local',uri:'fixture://local'}]}; else if(m.method==='resources/read')result={contents:[{uri:m.params.uri,text:process.env.MCP_TEST+' '+process.argv[1]}]}; const reply=result?{result}:{error:{code:-32601,message:'Method not found'}}; process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...reply})+'\\n');});`;
  const host = new McpHost();
  t.after(() => host.stop());
  const config = {
    id: "stdio",
    transport: "stdio",
    command: process.execPath,
    args: ["--input-type=module", "-e", script, "literal $value & text"],
    env: { MCP_TEST: "fixture" },
  };
  assert.equal((await host.request(config, "resources/list")).resources.length, 1);
  assert.equal(
    (await host.request(config, "resources/read", { uri: "fixture://local" })).contents[0].text,
    "fixture literal $value & text",
  );
});

test("OAuth completes PKCE, rejects wrong callback state and binds tokens to target and issuer", async (t) => {
  let base,
    challenge = "",
    tokenExchanges = 0;
  const records = {};
  base = await fixture(t, async (req, res) => {
    const url = new URL(req.url, base);
    if (url.pathname.includes(".well-known/oauth-protected-resource"))
      return json(res, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (url.pathname.includes(".well-known/oauth-authorization-server"))
      return json(res, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname === "/register") {
      const metadata = JSON.parse(await body(req));
      return json(res, { ...metadata, client_id: "fixture-client" }, 201);
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(await body(req));
      assert.equal(form.get("code"), "fixture-code");
      assert.equal(
        createHash("sha256").update(form.get("code_verifier")).digest("base64url"),
        challenge,
      );
      tokenExchanges++;
      return json(res, {
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url.pathname === "/mcp") {
      if (req.headers.authorization !== "Bearer fixture-access")
        return json(res, {}, 401, {
          "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        });
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const msg = JSON.parse(await body(req));
      if (msg.method === "server/discover")
        return json(res, {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "Method not found" },
        });
      if (msg.method === "initialize")
        return json(res, {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "oauth-fixture", version: "1" },
          },
        });
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const oauth = new McpOAuth({
    read: async (key) => records[key],
    write: async (key, value) => {
      if (value) records[key] = value;
      else delete records[key];
    },
    open: async (raw) => {
      const url = new URL(raw);
      assert.equal(url.origin, base);
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      challenge = url.searchParams.get("code_challenge");
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      redirect.searchParams.set("state", "wrong");
      redirect.searchParams.set("code", "fixture-code");
      redirect.searchParams.set("iss", base);
      assert.equal((await fetch(redirect)).status, 400);
      redirect.searchParams.set("state", url.searchParams.get("state"));
      assert.equal((await fetch(redirect)).status, 200);
    },
  });
  const config = { id: "oauth", auth: "oauth", url: `${base}/mcp` };
  assert.equal((await oauth.login(config)).authenticated, true);
  assert.equal(tokenExchanges, 1);
  const provider = await oauth.provider(config);
  assert.equal((await provider.tokens({ issuer: base })).access_token, "fixture-access");
  assert.equal(await provider.tokens({ issuer: "https://other.invalid" }), undefined);
  assert.notEqual(oauthKey(config), oauthKey({ ...config, url: `${base}/other` }));
  const host = new McpHost({ oauth });
  t.after(() => host.stop());
  await host.request(config, "initialize");
  await oauth.logout(config);
  assert.equal(await (await oauth.provider(config)).tokens(), undefined);
});
