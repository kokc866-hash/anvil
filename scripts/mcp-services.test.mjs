import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("external service permissions, stale callers, logout and persistence use the shared MCP bridge", async (t) => {
  const values = new Map(),
    calls = [],
    events = new Set(),
    timers = new Set();
  const original = Object.fromEntries(
    ["window", "document", "localStorage", "fetch", "__serviceArchive"].map((k) => [
      k,
      globalThis[k],
    ]),
  );
  globalThis.__serviceArchive = new Map();
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  let authenticated = false,
    rejectLogout = false,
    failCatalog = false,
    onLogout;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage,
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout,
    anvilNative: {
      mcpRequest: async (r) => {
        calls.push(r);
        const reply = (value) => ({ ok: true, value });
        if (r.method === "oauth/login") {
          authenticated = true;
          return reply({ authenticated });
        }
        if (r.method === "oauth/status") return reply({ authenticated });
        if (r.method === "oauth/logout") {
          if (rejectLogout) return { ok: false, error: "vault unavailable" };
          onLogout?.();
          authenticated = false;
          return reply({ authenticated });
        }
        if (r.method === "initialize")
          return reply({
            protocolVersion: "2025-03-26",
            capabilities: { tools: {}, resources: {} },
          });
        if (r.method === "tools/list" && failCatalog)
          return { ok: false, error: "catalog unavailable" };
        if (r.method === "tools/list")
          return reply({
            tools: [
              {
                name: "read_note",
                inputSchema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                  required: ["id"],
                },
              },
              { name: "update_note", inputSchema: { type: "object" } },
              { name: "future_tool", inputSchema: { type: "object" } },
            ],
          });
        if (r.method === "resources/list")
          return reply({ resources: [{ name: "Notes", uri: "fixture://notes" }] });
        if (r.method === "resources/templates/list") return reply({ resourceTemplates: [] });
        if (r.method === "resources/read")
          return reply({ contents: [{ uri: "fixture://notes", text: "A real-shaped resource" }] });
        if (r.method === "tools/call")
          return reply({ content: [{ type: "text", text: `Note ${r.params.arguments.id}` }] });
        throw new Error(`Unexpected ${r.method}`);
      },
      mcpClose: async () => {},
      mcpCancel: async () => {},
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
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    plugins: [
      {
        name: "service-test-archive",
        transform(code, id) {
          if (id.replaceAll("\\", "/").endsWith("/src/lib/persist-db.ts"))
            return `export async function saveArchive(name,next){globalThis.__serviceArchive.set(name,structuredClone(next));} export async function loadArchive(name){const a=globalThis.__serviceArchive.get(name)||{};return {...a,files:a.files??null,chat:a.chat??null,recovery:a.recovery??null};} export async function removeArchive(name){globalThis.__serviceArchive.delete(name);}`;
        },
      },
    ],
  });
  t.after(async () => {
    await vite.close();
    for (const timer of timers) clearTimeout(timer);
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const { useIde } = await vite.ssrLoadModule("/src/store/ide.ts");
  const { useIntern } = await vite.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const services = await vite.ssrLoadModule("/src/lib/mcp-services.ts");
  const ids = new Set();
  for (const provider of services.SERVICE_PROVIDERS) {
    assert.ok(!ids.has(provider.id), `duplicate provider ${provider.id}`);
    ids.add(provider.id);
    assert.equal(new URL(provider.url).href, provider.url, `canonical URL: ${provider.id}`);
    assert.equal(new URL(provider.url).protocol, "https:");
    assert.equal(new URL(provider.source).protocol, "https:");
    assert.ok(provider.category && provider.description);
    if (provider.setupRequired) {
      assert.throws(() => services.createService(provider.id), { message: provider.setupRequired });
    } else {
      const draft = services.createService(provider.id);
      assert.equal(draft.url, provider.url);
      assert.equal(draft.enabled, false);
      assert.deepEqual(draft.allowedTools, []);
    }
  }
  assert.ok(ids.size >= 40, "broad service catalog");
  assert.equal(calls.length, 0, "browsing and preparing providers never contacts accounts");
  const mcp = await vite.ssrLoadModule("/src/lib/mcp.ts");
  const { flushPersistence } = await vite.ssrLoadModule("/src/lib/persist-storage.ts");
  const unrelated = { id: "keep", name: "Existing MCP", url: "", enabled: false };
  const s = services.createService("notion");
  const live = () => useIde.getState().mcpServers.find((x) => x.id === s.id);
  useIde.getState().setMcpServers([unrelated, s]);
  assert.equal(s.enabled, false);
  assert.deepEqual(s.allowedTools, []);
  assert.equal(calls.length, 0);
  assert.throws(
    () => services.createService("custom", "Bad", "http://external.invalid/mcp"),
    /HTTPS/,
  );
  assert.throws(
    () => services.createService("custom", "Bad", "https://token@example.invalid/mcp"),
    /Zugangsdaten/,
  );
  assert.throws(
    () => services.updateService(s.id, { url: "https://evil.invalid/mcp" }),
    /Dienstadresse/,
  );
  services.updateService(s.id, { enabled: true });
  assert.equal((await mcp.mcpLogin(live())).authenticated, true);
  await mcp.mcpProbe(live(), useIde.getState().mcpServers);
  assert.equal(mcp.mcpServiceCatalog(live()).tools.length, 3);
  assert.equal(mcp.mcpSnapshot([live()]).tools.length, 0);
  failCatalog = true;
  await assert.rejects(() => mcp.mcpProbe(live(), [live()]), /catalog unavailable/);
  assert.equal(
    mcp.mcpServiceCatalog(live()).ready,
    false,
    "failed refresh cannot leave a ready catalog",
  );
  failCatalog = false;
  await mcp.mcpProbe(live(), [live()]);
  const oldToken = calls.findLast((c) => c.method === "initialize").server.connectionToken;
  await assert.rejects(
    () => mcp.mcpReadResource([live()], s.id, "fixture://notes"),
    /nicht freigegeben/,
  );
  services.updateService(s.id, { allowedTools: ["read_note"] });
  assert.equal(mcp.mcpServiceCatalog(live()).tools.length, 3, "selection retains offered catalog");
  await mcp.mcpProbe(live(), [live()]);
  const token = calls.findLast((c) => c.method === "initialize").server.connectionToken;
  assert.notEqual(token, oldToken);
  for (const fn of events) fn({ server: s.id, kind: "closed", connectionToken: oldToken });
  assert.equal(
    mcp.mcpServiceCatalog(live()).ready,
    true,
    "old session event must not poison replacement",
  );
  for (const fn of events) fn({ server: s.id, kind: "closed", connectionToken: token });
  assert.equal(
    mcp.mcpServiceCatalog(live()).ready,
    false,
    "current native close invalidates readiness",
  );
  await mcp.mcpProbe(live(), [live()]);
  assert.deepEqual(
    mcp.mcpSnapshot([live()]).tools.map((t) => t.name),
    ["read_note"],
  );
  const selected = live();
  assert.match((await mcp.mcpCall([selected], s.id, "read_note", { id: "42" })).text, /Note 42/);
  await assert.rejects(
    () => mcp.mcpCall([selected], s.id, "update_note", {}),
    /nicht im aktuellen Katalog/,
  );
  await assert.rejects(() => mcp.mcpCall([selected], s.id, "read_note", {}), /id/);
  services.updateService(s.id, { allowedTools: [] });
  await assert.rejects(() => mcp.mcpCall([selected], s.id, "read_note", { id: "stale" }));
  assert.equal(
    calls.filter((c) => c.method === "tools/call").length,
    1,
    "revoked or unknown tool never dispatched",
  );
  services.updateService(s.id, { allowedTools: ["read_note"], allowResources: true });
  await mcp.mcpReadResource([live()], s.id, "fixture://notes");
  services.updateService(s.id, { enabled: false });
  await assert.rejects(
    () => mcp.mcpCall([selected], s.id, "read_note", { id: "disabled" }),
    /deaktiviert/,
  );
  assert.equal((await mcp.mcpAuthStatus(live())).authenticated, true, "disable preserves account");
  services.updateService(s.id, { enabled: true });
  await flushPersistence();
  await useIde.persist.rehydrate();
  assert.deepEqual(live().allowedTools, ["read_note"]);
  rejectLogout = true;
  await assert.rejects(() => services.disconnectService(s.id, true), /vault unavailable/);
  assert.ok(live(), "failed vault erase must remain visible for retry");
  assert.equal(live().enabled, false);
  rejectLogout = false;
  await services.disconnectService(s.id);
  assert.equal((await mcp.mcpAuthStatus(live())).authenticated, false);
  assert.deepEqual(live().allowedTools, []);
  const replacement = { ...live(), service: "custom", url: "https://replacement.invalid/mcp" };
  onLogout = () => useIde.getState().setMcpServers([unrelated, replacement]);
  await assert.rejects(() => services.disconnectService(s.id, true), /ersetzt/);
  assert.equal(live().url, replacement.url, "late removal preserves replacement connection");
  onLogout = undefined;
  await services.disconnectService(s.id, true);
  await useIde.persist.rehydrate();
  assert.deepEqual(useIde.getState().mcpServers, [unrelated]);
  await assert.rejects(
    () => mcp.mcpCall([selected], s.id, "read_note", { id: "removed" }),
    /entfernt|deaktiviert/,
  );
});
