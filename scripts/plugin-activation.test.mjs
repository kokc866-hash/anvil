import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createServer } from "vite";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function fixture(t) {
  const keys = ["window", "document", "localStorage", "fetch", "__activationFixture"];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map(), timers = new Set();
  const ls = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.localStorage = ls;
  globalThis.window = Object.assign(new EventTarget(), { localStorage: ls, setTimeout(fn, ms) {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer;
  }, clearTimeout });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  globalThis.fetch = async () => { throw new Error("Real network forbidden in activation fixture"); };
  const state = globalThis.__activationFixture = {
    calls: { model: 0, fetch: 0, fallback: 0, run: 0, healthy: 0, failed: 0 },
    gate: deferred(), model: deferred(), network: deferred(), archives: new Map(), apis: [], fail: true,
  };
  const server = await createServer({
    configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } },
    ssr: { external: ["react", "react-dom", "zustand", "js-yaml"] }, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", plugins: [{
      name: "isolated-plugin-activation-boundaries",
      transform(_code, id) {
        const file = id.replaceAll("\\", "/");
        if (file.endsWith("/src/lib/complete.ts")) return `export const stripFence = text => text; export function completeText(){globalThis.__activationFixture.calls.model++;return globalThis.__activationFixture.model.promise;}`;
        if (file.endsWith("/src/lib/web-fetch.ts")) return `export function fetchWeb(){globalThis.__activationFixture.calls.fetch++;return globalThis.__activationFixture.network.promise;} export async function readWebPage(){globalThis.__activationFixture.calls.fallback++;return {ok:true,text:'fallback'};}`;
        if (file.endsWith("/src/lib/persist-db.ts")) return `export async function saveArchive(name,next){globalThis.__activationFixture.archives.set(name,structuredClone(next));} export async function loadArchive(name){const a=globalThis.__activationFixture.archives.get(name)||{};return {...a,files:a.files??null,chat:a.chat??null,recovery:a.recovery??null};} export async function removeArchive(name){globalThis.__activationFixture.archives.delete(name);}`;
      },
    }],
  });
  t.after(async () => {
    try {
      const { flushDiskSync } = await server.ssrLoadModule("/src/lib/disk-sync.ts");
      const { flushPersistence } = await server.ssrLoadModule("/src/lib/persist-storage.ts");
      await flushDiskSync();
      await flushPersistence();
    } finally {
      await server.close();
      for (const timer of timers) clearTimeout(timer);
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  await useIde.persist.rehydrate();
  const { useIntern } = await server.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  useIde.setState({
    files: { "keep.txt": "keep" }, dirs: [], workspaceCwd: "", agentBusy: false, pathOperation: null,
    pluginKnown: [], pluginDisabled: [], pluginConfig: {}, pluginProblems: [], pluginStatus: "",
    autoSaveDisk: false, dirty: {}, editBases: {}, pendingDiffs: [],
  });
  const host = await server.ssrLoadModule("/src/lib/plugins/host.ts");
  const { emitPlugin } = await server.ssrLoadModule("/src/lib/plugins/events.ts");
  window.addEventListener("anvil-run", () => state.calls.run++);
  return { server, useIde, host, emitPlugin, state };
}

test("failed builtin activation removes its commands and hooks and restores commands it replaced", async t => {
  const { host, emitPlugin, state, useIde } = await fixture(t);
  host.registerBuiltin({ id: "healthy", name: "Healthy", description: "", builtin: true, activate(api) {
    state.healthyApi = api;
    api.command({ id: "fixture.shared", title: "Original", run() { state.calls.healthy++; } });
    api.command({ id: "fixture.healthy", title: "Healthy", run() {} });
    api.on("change", () => state.calls.healthy++);
  } });
  host.registerBuiltin({ id: "failed", name: "Failed", description: "", builtin: true, activate(api) {
    api.command({ id: "leaked", title: "Leaked", run() {} });
    api.command({ id: "fixture.shared", title: "First replacement", run() { state.calls.failed++; } });
    api.command({ id: "fixture.shared", title: "Second replacement", run() { state.calls.failed++; } });
    api.on("change", () => state.calls.failed++);
    throw new Error("synthetic activation failure");
  } });
  host.reloadPlugins();
  assert.match(useIde.getState().notice, /synthetic activation failure/);
  emitPlugin("change");
  assert.deepEqual({ calls: state.calls, commands: host.listCommands().map(command => [command.id, command.title]) }, {
    calls: { model: 0, fetch: 0, fallback: 0, run: 0, healthy: 1, failed: 0 },
    commands: [["fixture.shared", "Original"], ["fixture.healthy", "Healthy"]],
  }, "failed activation must roll back commands and hooks without replacing another plugin's command");
  await host.listCommands().find(command => command.id === "fixture.shared").run();
  assert.equal(state.calls.healthy, 2);
  state.healthyApi.status("healthy still active");
  assert.equal(useIde.getState().pluginStatus, "healthy still active");
});

test("failed activation revokes captured APIs and pending model/network results before delayed continuations", async t => {
  const { host, emitPlugin, state, useIde } = await fixture(t);
  host.registerBuiltin({ id: "delayed-failure", name: "Delayed failure", description: "", builtin: true, activate(api) {
    state.api = api;
    state.pendingModel = api.complete("fixture only");
    state.pendingNetwork = api.fetch("https://fixture.invalid");
    state.delayed = state.gate.promise.then(() => {
      api.write("keep.txt", "stale mutation");
      api.command({ id: "late", title: "Late", run() {} });
      api.on("change", () => state.calls.failed++);
      api.config.set("late", true);
      api.status("late");
      api.run();
    });
    throw new Error("synthetic delayed failure");
  } });
  host.reloadPlugins();
  state.gate.resolve();
  state.model.resolve("late model result");
  state.network.reject(new Error("late first transport failure"));
  await state.delayed;
  assert.equal(await state.pendingModel, "", "failed activation must discard pending model results");
  assert.deepEqual(await state.pendingNetwork, { ok: false, text: "Plugin nicht mehr aktiv" });
  assert.equal(await state.api.complete("must not dispatch"), "");
  assert.deepEqual(await state.api.fetch("https://must-not-dispatch.invalid"), { ok: false, text: "Plugin nicht mehr aktiv" });
  emitPlugin("change");
  assert.deepEqual(useIde.getState().files, { "keep.txt": "keep" });
  assert.deepEqual(useIde.getState().pluginConfig, {});
  assert.equal(useIde.getState().pluginStatus, "");
  assert.equal(host.listCommands().length, 0);
  assert.deepEqual(state.api.files(), {});
  assert.equal(state.api.read("keep.txt"), undefined);
  assert.deepEqual(state.calls, { model: 1, fetch: 1, fallback: 0, run: 0, healthy: 0, failed: 0 });
});

test("approved workspace activation can retry after rollback while its failed API stays revoked", async t => {
  const { host, emitPlugin, state, useIde, server } = await fixture(t);
  const file = "plugins/activation-fixture.js", id = `ws:${file}`;
  const code = `// @trust\nfunction activate(api) {
    const fixture = globalThis.__activationFixture;
    fixture.apis.push(api);
    api.command({id:'fixture.workspace',title:'Workspace',run(){fixture.calls.healthy++;}});
    api.on('change',()=>fixture.calls.healthy++);
    if(fixture.fail)throw new Error('synthetic workspace failure');
  }`;
  useIde.setState({ files: { [file]: code, "keep.txt": "keep" }, dirs: ["plugins"], pluginKnown: [id] });
  host.reloadPlugins();
  assert.equal(state.apis.length, 0, "fixture code needs existing explicit approval");
  const { subscribeConfirm } = await server.ssrLoadModule("/src/lib/confirm.ts");
  const off = subscribeConfirm(slot => { if (slot) queueMicrotask(() => slot.resolve(true)); });
  try { assert.equal(await host.requestToggleWorkspacePlugin(id), true); } finally { off(); }
  const stale = state.apis.at(-1);
  assert.equal(host.isPluginEnabled(id), true, "startup failure does not change the trust grant");
  emitPlugin("change");
  assert.equal(state.calls.healthy, 0);
  assert.equal(host.listCommands().some(command => command.plugin === id), false);
  state.fail = false;
  host.reloadPlugins();
  const fresh = state.apis.at(-1);
  assert.notEqual(fresh, stale);
  stale.command({ id: "stale", title: "Stale", run() {} });
  stale.on("change", () => state.calls.failed++);
  stale.status("stale");
  fresh.status("fresh");
  assert.equal(useIde.getState().pluginStatus, "fresh");
  assert.deepEqual(host.listCommands().map(command => command.id), ["fixture.workspace"]);
  emitPlugin("change");
  await host.listCommands()[0].run();
  assert.equal(state.calls.healthy, 2);
  assert.equal(state.calls.failed, 0);
});
