import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("MCP package uses existing client, filters upstream additions and can be removed", async (t) => {
  const values = new Map(),
    requests = [],
    timers = new Set();
  const originals = Object.fromEntries(
    ["window", "document", "localStorage", "fetch"].map((key) => [key, globalThis[key]]),
  );
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  let toolError = false;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage,
    setTimeout: (fn, ms) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout,
    anvilNative: {
      mcpRequest: async (request) => {
        requests.push(request);
        const reply = (value) => ({ ok: true, value });
        if (request.method === "initialize")
          return reply({
            protocolVersion: "2025-03-26",
            capabilities: { tools: {}, resources: {} },
          });
        if (request.method === "tools/list")
          return reply({
            tools: [
              {
                name: "get_file_contents",
                inputSchema: {
                  type: "object",
                  properties: {
                    owner: { type: "string" },
                    repo: { type: "string" },
                    path: { type: "string" },
                  },
                  required: ["owner", "repo"],
                  additionalProperties: false,
                },
              },
              { name: "delete_file", inputSchema: { type: "object" } },
              { name: "new_read_tool", inputSchema: { type: "object" } },
            ],
          });
        if (request.method === "tools/call")
          return reply({
            isError: toolError,
            content: [{ type: "text", text: toolError ? "Access denied" : "# GitHub MCP Server" }],
          });
        throw new Error(`Unexpected RPC: ${request.method}`);
      },
      mcpClose: async () => {},
      mcpCancel: async () => {},
      onMcpEvent: () => () => {},
    },
  });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  globalThis.fetch = async () =>
    new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  t.after(async () => {
    await vite.close();
    for (const timer of timers) clearTimeout(timer);
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const { useIde } = await vite.ssrLoadModule("/src/store/ide.ts");
  const { useIntern } = await vite.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const mcp = await vite.ssrLoadModule("/src/lib/mcp.ts");
  const pkg = await vite.ssrLoadModule("/src/lib/mcp-packages.ts");
  const { saveSecrets, loadSecrets } = await vite.ssrLoadModule("/src/lib/secrets.ts");
  const server = pkg.createGithubReadPackage();
  useIde.getState().setMcpServers([server]);
  assert.equal(requests.length, 0);
  await assert.rejects(() => mcp.mcpProbe(server, [server]), /deaktiviert/);
  saveSecrets({
    keys: {
      [`mcp:${server.id}`]: "fixture-token",
      [`mcp-target:${server.id}`]: server.url,
      "unrelated-key": "keep",
    },
  });
  const enabled = { ...server, enabled: true };
  useIde.getState().setMcpServers([enabled]);
  await mcp.mcpProbe(enabled, [enabled]);
  assert.deepEqual(
    mcp.mcpSnapshot([enabled]).tools.map((tool) => tool.name),
    ["get_file_contents"],
  );
  assert.deepEqual(mcp.mcpSnapshot([enabled]).resources, []);
  const result = await mcp.mcpCall(
    [enabled],
    enabled.id,
    "get_file_contents",
    pkg.GITHUB_READ_PACKAGE.probe,
  );
  pkg.assertMcpPackageProbeResult(result);
  assert.deepEqual(requests.find((r) => r.method === "tools/call").params.arguments, {
    owner: "github",
    repo: "github-mcp-server",
    path: "README.md",
  });
  await assert.rejects(
    () => mcp.mcpCall([enabled], enabled.id, "delete_file", {}),
    /nicht im aktuellen Katalog/,
  );
  await assert.rejects(
    () => mcp.mcpReadResource([enabled], enabled.id, "github://private"),
    /nicht freigegeben/,
  );
  toolError = true;
  const failed = await mcp.mcpCall(
    [enabled],
    enabled.id,
    "get_file_contents",
    pkg.GITHUB_READ_PACKAGE.probe,
  );
  assert.throws(() => pkg.assertMcpPackageProbeResult(failed), /fehlgeschlagen/);
  const changed = { ...enabled, url: "https://example.invalid/mcp" };
  const before = requests.length;
  await assert.rejects(() => mcp.mcpProbe(changed, [changed]), /verändert/);
  assert.equal(requests.length, before, "changed endpoint receives neither request nor token");
  useIde.getState().setMcpServers([]);
  assert.equal(mcp.mcpSnapshot([]).tools.length, 0);
  await assert.rejects(() => mcp.mcpCall([], enabled.id, "get_file_contents", {}));
  assert.equal(loadSecrets().keys["unrelated-key"], "keep");
  assert.ok(
    requests.every(
      (r) =>
        !r.method.startsWith("resources/") &&
        (r.method !== "tools/call" || r.params.name === "get_file_contents"),
    ),
  );
});
