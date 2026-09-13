import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("service autoconnect waits for hydration, bounds requests, retries and cancels removed services", async (t) => {
  const original = { window: globalThis.window, document: globalThis.document, clock: Date.now };
  let now = 1_000_000, hydrated = false, stop, vite;
  const subscriptions = new Set(), hydration = new Set(), intervals = new Set();
  const states = [], probes = [], deferred = new Map();
  let servers = [];
  const store = {
    getState: () => ({ mcpServers: servers }),
    subscribe: fn => { subscriptions.add(fn); return () => subscriptions.delete(fn); },
    persist: { hasHydrated: () => hydrated, onFinishHydration: fn => { hydration.add(fn); return () => hydration.delete(fn); } },
  };
  const make = (id, enabled = true) => ({ id: `anvil-service:${id}`, service: "custom", url: `https://${id}.invalid/mcp`, transport: "http", auth: "oauth", enabled, allowedTools: ["read"] });
  const update = next => { const previous = servers; servers = next; for (const fn of subscriptions) fn({ mcpServers: servers }, { mcpServers: previous }); };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  globalThis.window = Object.assign(new EventTarget(), {
    setInterval: fn => { intervals.add(fn); return fn; },
    clearInterval: fn => intervals.delete(fn),
  });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Date.now = () => now;
  globalThis.__autoFixture = {
    store,
    status: async (server, signal) => {
      states.push({ server, signal });
      if (server.id.endsWith(":slow")) await new Promise(resolve => deferred.set(server.id, resolve));
      if (server.id.endsWith(":broken")) throw new Error("offline");
      return { authenticated: !server.id.endsWith(":unsigned") };
    },
    refresh: async (list, age, signal) => { probes.push({ list, age, signal }); },
  };
  t.after(async () => {
    stop?.();
    for (const resolve of deferred.values()) resolve();
    await vite?.close();
    Date.now = original.clock;
    for (const key of ["window", "document"]) {
      if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key];
    }
    delete globalThis.__autoFixture;
  });
  vite = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", plugins: [{
    name: "autoconnect-boundaries",
    transform(_code, id) {
      const file = id.replaceAll("\\", "/");
      if (file.endsWith("/src/store/ide.ts")) return "export const useIde = globalThis.__autoFixture.store;";
      if (file.endsWith("/src/lib/mcp.ts")) return "export const hasMcpNative=()=>true; export const mcpAuthStatus=globalThis.__autoFixture.status; export const mcpRefresh=globalThis.__autoFixture.refresh;";
    },
  }] });
  const { startServiceAutoconnect } = await vite.ssrLoadModule("/src/lib/service-autoconnect.ts");
  update([make("slow"), make("broken"), make("unsigned"), make("active"), make("later"), make("disabled", false), { ...make("stdio"), service: undefined, id: "stdio", auth: undefined }]);
  stop = startServiceAutoconnect();
  assert.equal(states.length, 0, "nothing starts before persisted settings finish loading");
  hydrated = true;
  for (const fn of hydration) fn();
  assert.equal(states.length, 4, "only four status checks start concurrently");
  await settle();
  assert.deepEqual(probes.flatMap(p => p.list.map(s => s.id)).sort(), ["anvil-service:active", "anvil-service:later"]);
  assert.equal(states.length, 5, "disabled and non-service connections are untouched");
  const slow = states.find(s => s.server.id.endsWith(":slow"));
  update(servers.filter(s => !s.id.endsWith(":slow")));
  assert.equal(slow.signal.aborted, true, "removal cancels the outstanding local status check");
  deferred.get("anvil-service:slow")();
  await settle();
  assert.equal(probes.length, 2, "late status cannot reconnect a removed service");
  window.dispatchEvent(new Event("focus"));
  await settle();
  assert.equal(states.length, 5, "focus bursts do not retry immediately");
  now += 30_001;
  window.dispatchEvent(new Event("online"));
  await settle();
  assert.equal(states.length, 9, "network recovery retries eligible services without any login flow");
  assert.deepEqual(servers.find(s => s.id.endsWith(":active")).allowedTools, ["read"]);
  now += 5 * 60_000;
  for (const fn of intervals) fn();
  await settle();
  assert.equal(states.length, 13, "periodic refresh retries failures as well as active services");
  update(servers.map(s => ({ ...s, enabled: false })));
  now += 5 * 60_000;
  for (const fn of intervals) fn();
  await settle();
  assert.equal(states.length, 13, "disabled services stay offline");
  stop();
  assert.equal(intervals.size, 0);
  assert.equal(subscriptions.size, 0);
  assert.equal(hydration.size, 0);
});
