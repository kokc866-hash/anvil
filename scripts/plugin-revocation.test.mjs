import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

test("removal revokes retained plugin APIs and delayed command/model/network continuations", async (t) => {
  const keys = [
    "window",
    "document",
    "localStorage",
    "fetch",
    "__revokedApi",
    "__pluginGate",
    "__pluginModel",
    "__pluginFetch",
    "__pluginCalls",
    "__pluginArchive",
  ];
  const originals = new Map(keys.map((key) => [key, globalThis[key]]));
  const storage = new Map(),
    timers = new Set();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
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
  });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  globalThis.fetch = async () => {
    throw new Error("Unexpected network request");
  };
  globalThis.__pluginArchive = new Map();
  globalThis.__pluginCalls = { model: 0, fetch: 0, run: 0, callback: 0 };
  let releaseCommand, releaseModel, releaseFetch;
  globalThis.__pluginGate = new Promise((resolve) => {
    releaseCommand = resolve;
  });
  globalThis.__pluginModel = new Promise((resolve) => {
    releaseModel = resolve;
  });
  globalThis.__pluginFetch = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    plugins: [
      {
        name: "plugin-revocation-boundaries",
        transform(_code, id) {
          const file = id.replaceAll("\\", "/");
          if (file.endsWith("/src/lib/complete.ts"))
            return `export function completeText(){globalThis.__pluginCalls.model++;return globalThis.__pluginModel;} export const stripFence = text => text;`;
          if (file.endsWith("/src/lib/web-fetch.ts"))
            return `export function fetchWeb(){globalThis.__pluginCalls.fetch++;return globalThis.__pluginFetch;} export const readWebPage = fetchWeb;`;
          if (file.endsWith("/src/lib/persist-db.ts"))
            return `export async function saveArchive(name,next){globalThis.__pluginArchive.set(name,structuredClone(next));} export async function loadArchive(name){const a=globalThis.__pluginArchive.get(name)||{};return {...a,files:a.files??null,chat:a.chat??null,recovery:a.recovery??null};} export async function removeArchive(name){globalThis.__pluginArchive.delete(name);}`;
        },
      },
    ],
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  await useIde.persist.rehydrate();
  const { useIntern } = await server.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const host = await server.ssrLoadModule("/src/lib/plugins/host.ts");
  const { removeWorkspacePlugin } = await server.ssrLoadModule("/src/lib/plugins/remove.ts");
  const { emitPlugin } = await server.ssrLoadModule("/src/lib/plugins/events.ts");
  const { flushDiskSync } = await server.ssrLoadModule("/src/lib/disk-sync.ts");
  const { flushPersistence } = await server.ssrLoadModule("/src/lib/persist-storage.ts");
  t.after(async () => {
    await flushDiskSync();
    await flushPersistence();
    await server.close();
    for (const timer of timers) clearTimeout(timer);
    for (const [key, value] of originals) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const file = "plugins/mein-plugin.js",
    id = `ws:${file}`;
  const code = `// @trust\nfunction activate(anvil) {
    globalThis.__revokedApi = anvil;
    anvil.command({id:'delayed',title:'Delayed command',async run(){
      globalThis.__pluginCalls.callback++;
      await globalThis.__pluginGate;
      anvil.write('plugins/mein-plugin.js','// resurrected');
      anvil.command({id:'late',title:'Late command',run(){}});
      anvil.on('change',()=>globalThis.__pluginCalls.callback++);
      anvil.status('stale');anvil.config.set('stale',true);anvil.run();anvil.agent('stale');
    }});
  }`;
  useIde.setState({
    files: { [file]: code, "keep.txt": "keep" },
    dirs: ["plugins"],
    workspaceCwd: "",
    pathOperation: null,
    agentBusy: false,
    pluginKnown: [id],
    pluginDisabled: [],
    autoSaveDisk: false,
    pluginConfig: {},
    pluginStatus: "",
    pendingDiffs: [],
    dirty: {},
    editBases: {},
  });
  window.addEventListener("anvil-run", () => globalThis.__pluginCalls.run++);
  host.reloadPlugins();
  const stale = globalThis.__revokedApi,
    oldCommand = host.listCommands().find((command) => command.plugin === id);
  stale.config.set("live", true);
  stale.status("live");
  assert.equal(
    useIde.getState().pluginConfig[`${id}.live`],
    true,
    "initial live activation is usable",
  );
  const running = oldCommand.run(),
    model = stale.complete("fixture only"),
    network = stale.fetch("https://fixture.invalid");
  assert.equal(await removeWorkspacePlugin(file, code), true);
  const afterRemoval = useIde.getState();
  releaseCommand();
  releaseModel("late model result");
  releaseFetch({ ok: true, text: "late network result" });
  await running;
  assert.equal(await model, "");
  assert.deepEqual(await network, { ok: false, text: "Plugin nicht mehr aktiv" });
  await oldCommand.run();
  stale.write(file, code);
  stale.remove("keep.txt");
  stale.mkdir("bad");
  stale.notify("bad");
  stale.open("keep.txt");
  stale.problems([{ path: "keep.txt", line: 1, text: "bad" }]);
  stale.config.set("late", true);
  stale.on("change", () => {
    globalThis.__pluginCalls.callback++;
  });
  assert.equal(await stale.complete("do not dispatch"), "");
  await stale.fetch("https://must-not-be-called.invalid");
  emitPlugin("change");
  assert.deepEqual(useIde.getState().files, { "keep.txt": "keep" });
  assert.deepEqual(useIde.getState().pluginConfig, {});
  assert.equal(useIde.getState().notice, afterRemoval.notice);
  assert.equal(useIde.getState().pluginStatus, "");
  assert.equal(useIde.getState().pluginProblems.length, 0);
  assert.equal(
    host.listCommands().some((command) => command.plugin === id),
    false,
  );
  assert.deepEqual(globalThis.__pluginCalls, { model: 1, fetch: 1, run: 0, callback: 1 });
  await useIde.persist.rehydrate();
  host.reloadPlugins();
  assert.equal(file in useIde.getState().files, false);
  // A new activation gets fresh rights; old references never regain them.
  useIde.setState({
    files: { [file]: code, "keep.txt": "keep" },
    pluginKnown: [id],
    pluginDisabled: [],
  });
  host.reloadPlugins();
  const fresh = globalThis.__revokedApi;
  stale.status("bad");
  fresh.status("fresh");
  assert.equal(useIde.getState().pluginStatus, "fresh");
  let rejectFetch;
  globalThis.__pluginFetch = new Promise((_resolve, reject) => {
    rejectFetch = reject;
  });
  const pendingFetch = fresh.fetch("https://fixture.invalid/late-failure");
  host.reloadPlugins();
  rejectFetch(new Error("First transport failed after removal/reload"));
  assert.deepEqual(await pendingFetch, { ok: false, text: "Plugin nicht mehr aktiv" });
  assert.equal(
    globalThis.__pluginCalls.fetch,
    2,
    "revoked request must not start a fallback transport",
  );
  const current = globalThis.__revokedApi;
  useIde.setState({ pluginDisabled: [id] });
  current.status("disabled mutation");
  assert.equal(useIde.getState().pluginStatus, "fresh");
});
