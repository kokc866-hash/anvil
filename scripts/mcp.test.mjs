import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("MCP catalog lifecycle, scoped calls and cancellation", async (t) => {
  const values = new Map(),
    requests = [],
    events = new Set(),
    timers = new Set();
  let delayed = null,
    delayedReady;
  const globalKeys = ["window", "document", "localStorage", "fetch"];
  const originals = Object.fromEntries(globalKeys.map((k) => [k, globalThis[k]]));
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage,
    setTimeout: (fn, ms) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
      clearTimeout(id);
    },
    anvilNative: {
      mcpRequest: async (r) => {
        requests.push(r);
        if (r.server.id === "delayed" && r.method === "tools/list")
          return new Promise((resolve) => {
            delayed = { id: r.id, resolve };
            delayedReady();
          });
        const reply = (value) => ({ ok: true, value });
        if (r.method === "initialize")
          return reply({
            protocolVersion: "2025-03-26",
            capabilities: r.server.id === "resources" ? { resources: {} } : { tools: {} },
          });
        if (r.method === "tools/list")
          return reply({
            tools: Array.from({ length: 18 }, (_, i) => ({
              name: `tool${i}`,
              inputSchema: {
                type: "object",
                properties: { q: { type: "string" }, n: { type: "integer" } },
                required: ["q"],
                additionalProperties: false,
              },
            })),
          });
        if (r.method === "resources/list")
          return reply({ resources: [{ uri: "test://doc", name: "doc" }] });
        if (r.method === "resources/templates/list")
          return reply({ resourceTemplates: [{ uriTemplate: "test://{id}", name: "template" }] });
        if (r.method === "tools/call")
          return reply({
            content: [{ type: "text", text: "called" }],
            structuredContent: r.params.arguments,
          });
        if (r.method === "resources/read")
          return reply({ contents: [{ uri: r.params.uri, text: "resource text" }] });
        throw new Error(r.method);
      },
      mcpCancel: async (id) => {
        if (delayed?.id === id) delayed.resolve({ ok: false, error: "Canceled" });
      },
      mcpClose: async (id) => {
        if (id === "delayed" && delayed) delayed.resolve({ ok: false, error: "Closed" });
      },
      onMcpEvent: (fn) => {
        events.add(fn);
        return () => events.delete(fn);
      },
    },
  });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  globalThis.fetch = async () =>
    new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => vite.close());
  const { useIde } = await vite.ssrLoadModule("/src/store/ide.ts");
  const { useIntern } = await vite.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const mcp = await vite.ssrLoadModule("/src/lib/mcp.ts");
  const { saveSecrets } = await vite.ssrLoadModule("/src/lib/secrets.ts");
  const a = {
    id: "a",
    name: "Docs",
    url: "http://fixture.invalid/mcp",
    enabled: true,
    context: { project: "not-in-schema", n: "2" },
  };
  const b = {
    id: "resources",
    name: "Resources",
    url: "http://resources.invalid/mcp",
    enabled: true,
  };
  try {
    await t.test(
      "resource-only servers and subset refresh retain independent catalogs",
      async () => {
        useIde.getState().setMcpServers([a, b]);
        await mcp.mcpList([a, b]);
        assert.equal(mcp.mcpSnapshot([a, b]).tools.length, 18);
        assert.equal(mcp.mcpSnapshot([a, b]).resources.length, 2);
        assert.equal(
          requests.some((r) => r.server.id === b.id && r.method === "tools/list"),
          false,
        );
        await mcp.mcpList([a]);
        assert.ok(mcp.mcpSnapshot([a, b]).ready.has(b.id));
        const first = await mcp.mcpCatalogPage([a, b], { limit: 5 });
        assert.equal(first.tools.length, 5);
        assert.ok(first.nextCursor);
        const next = await mcp.mcpCatalogPage([a, b], { limit: 5, cursor: first.nextCursor });
        assert.equal(next.tools[0].name, "tool5");
      },
    );
    await t.test(
      "foreign tools get only valid declared args, never the automatic local cwd",
      async () => {
        await mcp.mcpCall([a, b], a.id, "tool0", { q: "hello" }, undefined, {
          cwd: "C:\\Workspace",
        });
        const call = requests.filter((r) => r.method === "tools/call").at(-1);
        assert.deepEqual(call.params.arguments, { q: "hello", n: 2 });
        const count = requests.filter((r) => r.method === "tools/call").length;
        await assert.rejects(mcp.mcpCall([a], a.id, "tool0", { q: 5 }), /string/);
        assert.equal(requests.filter((r) => r.method === "tools/call").length, count);
      },
    );
    await t.test(
      "disabled/removed servers and late responses cannot remain available",
      async () => {
        const d = { ...a, id: "delayed" };
        useIde.getState().setMcpServers([a, b, d]);
        const started = new Promise((resolve) => {
          delayedReady = resolve;
        });
        const probe = mcp.mcpProbe(d, [a, b, d]);
        await started;
        useIde.getState().setMcpServers([{ ...a, enabled: false }, b]);
        await assert.rejects(probe);
        const snap = mcp.mcpSnapshot(useIde.getState().mcpServers);
        assert.equal(snap.tools.length, 0);
        assert.equal(snap.resources.length, 2);
        assert.equal(mcp.mcpToolsCached().length, 0);
        await assert.rejects(
          mcp.mcpCall(useIde.getState().mcpServers, a.id, "tool0", { q: "x" }),
          /deaktiviert/,
        );
      },
    );
    await t.test(
      "agent resource/output tools route correctly and MCP images carry no Graph instructions",
      async () => {
        const { beginAgent } = await vite.ssrLoadModule("/src/lib/abort.ts");
        const { runAgentLoop } = await vite.ssrLoadModule("/src/lib/agent-core.ts");
        const { cliPrompt } = await vite.ssrLoadModule("/src/lib/cli-protocol.ts");
        beginAgent();
        let round = 0;
        const routed = [],
          histories = [];
        const call = (name, args) => ({
          id: name,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        });
        await runAgentLoop(
          {
            messages: [{ role: "user", content: "Lies die Dokumentation" }],
            files: [],
            runLoop: false,
            afterWrite: "none",
            maxRounds: 3,
            surfaceId: "docs",
            surfaceMode: "exclusive",
          },
          async (messages) => {
            histories.push(structuredClone(messages));
            return round++ === 0
              ? {
                  content: "",
                  tool_calls: [
                    call("mcp_read_resource", { server: "docs", uri: "docs://guide" }),
                    call("mcp_read_output", { id: "result", offset: 10 }),
                  ],
                }
              : { content: "Dokumentation gelesen.", tool_calls: [] };
          },
          {
            mcp: async (action, server, name, args) => {
              routed.push({ action, server, name, args });
              return action === "read"
                ? {
                    text: "resource",
                    structuredContent: { value: 42 },
                    server: "docs",
                    mcpResult: true,
                    mcpImages: ["data:image/png;base64,AAAA"],
                    outputId: "result",
                  }
                : { text: "rest", nextOffset: null };
            },
          },
        );
        assert.deepEqual(routed[0], {
          action: "read",
          server: "docs",
          name: "docs://guide",
          args: undefined,
        });
        assert.equal(routed[1].action, "output");
        assert.equal(routed[1].args.offset, 10);
        const last = histories.at(-1),
          picture = last.find((m) => m.mcpResult);
        assert.ok(picture);
        assert.doesNotMatch(JSON.stringify(picture), /Graph.Frame|Bug →/);
        assert.match(cliPrompt(last, []), /Über diese CLI nur Text/);
        const result = JSON.parse(
          last.find((m) => m.role === "tool" && m.tool_call_id === "mcp_read_resource").content,
        );
        assert.deepEqual(result.structuredContent, { value: 42 });
      },
    );
    await t.test(
      "Companion token is bound to configured LAN endpoint, not arbitrary loopback",
      async () => {
        useIde.setState({ companionUrl: "http://192.168.178.41:7845", workspaceCwd: "" });
        saveSecrets({ companionToken: "fixture-token" });
        const lan = { ...a, id: "lan", url: "http://192.168.178.41:7845/mcp" };
        const local = { ...a, id: "local", url: "http://127.0.0.1:9900/mcp" };
        useIde.getState().setMcpServers([lan, local]);
        await mcp.mcpList([lan, local]);
        assert.equal(
          requests.find((r) => r.server.id === "lan").server.headers["x-anvil-token"],
          "fixture-token",
        );
        assert.equal(
          requests.find((r) => r.server.id === "local").server.headers["x-anvil-token"],
          undefined,
        );
      },
    );
  } finally {
    useIde.getState().setMcpServers([]);
    const { flushPersistence } = await vite.ssrLoadModule("/src/lib/persist-storage.ts");
    await flushPersistence().catch(() => {});
    await vite.close();
    for (const timer of timers) clearTimeout(timer);
    for (const k of globalKeys)
      if (originals[k] === undefined) delete globalThis[k];
      else globalThis[k] = originals[k];
  }
});
