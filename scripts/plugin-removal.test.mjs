import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { restoreRel } from "../companion/restore.mjs";

test("workspace plugin removal is durable, scoped, cancellable and conflict checked", async (t) => {
  const globals = new Map(
    ["window", "document", "localStorage", "fetch", "__pluginArchive", "__pluginEvents"].map(
      (k) => [k, globalThis[k]],
    ),
  );
  const values = new Map();
  globalThis.__pluginArchive = new Map();
  globalThis.__pluginEvents = 0;
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout, clearTimeout });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    plugins: [
      {
        name: "plugin-test-archive",
        transform(code, id) {
          if (id.replaceAll("\\", "/").endsWith("/src/lib/persist-db.ts"))
            return `export async function saveArchive(name,next){globalThis.__pluginArchive.set(name,structuredClone(next));} export async function loadArchive(name){const a=globalThis.__pluginArchive.get(name)||{};return {...a,files:a.files??null,chat:a.chat??null,recovery:a.recovery??null};} export async function removeArchive(name){globalThis.__pluginArchive.delete(name);}`;
        },
      },
    ],
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  await useIde.persist.rehydrate();
  const sync = await server.ssrLoadModule("/src/lib/disk-sync.ts");
  const persist = await server.ssrLoadModule("/src/lib/persist-storage.ts");
  const { removeWorkspacePlugin, requestRemoveWorkspacePlugin } = await server.ssrLoadModule(
    "/src/lib/plugins/remove.ts",
  );
  const host = await server.ssrLoadModule("/src/lib/plugins/host.ts");
  const { emitPlugin } = await server.ssrLoadModule("/src/lib/plugins/events.ts");
  const { subscribeConfirm } = await server.ssrLoadModule("/src/lib/confirm.ts");
  const cwd = mkdtempSync(path.resolve("data/plugin-remove-"));
  mkdirSync(path.join(cwd, "plugins"));
  const file = "plugins/mein-plugin.js",
    id = `ws:${file}`;
  const code =
    '// @desc Removal fixture\nfunction activate(anvil) { anvil.command({id:"hello",title:"Fixture hello",run(){}}); anvil.on("change",()=>globalThis.__pluginEvents++); }';
  writeFileSync(path.join(cwd, file), code);
  writeFileSync(path.join(cwd, "plugins/keep.js"), "// Keep this file");
  let switchDuringRemove = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith("/v1/workspace")) return Response.json({ ok: true });
    if (String(url).endsWith("/v1/restore")) {
      try {
        const result = restoreRel(cwd, JSON.parse(opts.body));
        if (switchDuringRemove)
          useIde.setState((s) => ({
            workspaceEpoch: s.workspaceEpoch + 1,
            workspaceCwd: path.join(cwd, "other"),
            files: { [file]: "other project" },
            pluginConfig: { [`${id}.setting`]: "other project setting" },
          }));
        return Response.json(result);
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { status: 400 });
      }
    }
    throw Error(`Unexpected request ${url}`);
  };
  t.after(async () => {
    await sync.flushDiskSync().catch(() => {});
    await persist.flushPersistence();
    await new Promise((r) => setImmediate(r));
    await server.close();
    for (const [k, v] of globals) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  });
  useIde.setState({
    workspaceCwd: cwd,
    files: { [file]: code, "plugins/keep.js": "// Keep this file" },
    dirs: ["plugins"],
    activePath: file,
    openPaths: [file],
    dirty: {},
    editBases: {},
    pathOperation: null,
    agentBusy: false,
    autoSaveDisk: false,
    pluginConfig: { [`${id}.setting`]: "remove", "builtin.setting": "keep" },
    pluginProblems: [{ path: file, line: 1, text: "test", source: id }],
    locale: "de",
  });
  sync.noteDiskContents(useIde.getState().files);
  host.reloadPlugins();
  assert.ok(host.listCommands().some((c) => c.plugin === id));
  emitPlugin("change");
  assert.equal(globalThis.__pluginEvents, 1);
  const off = subscribeConfirm((slot) => {
    if (slot) queueMicrotask(() => slot.resolve(false));
  });
  assert.equal(await requestRemoveWorkspacePlugin(file), false);
  off();
  assert.equal(existsSync(path.join(cwd, file)), true);
  assert.equal(await removeWorkspacePlugin("../outside.js", code), false);
  assert.equal(await removeWorkspacePlugin(file, "stale content"), false);
  writeFileSync(path.join(cwd, file), "external change");
  assert.equal(
    await removeWorkspacePlugin(file, code),
    false,
    "external disk edit must reject deletion",
  );
  assert.equal(readFileSync(path.join(cwd, file), "utf8"), "external change");
  assert.equal(useIde.getState().files[file], code);
  assert.equal(useIde.getState().pathOperation, null);
  writeFileSync(path.join(cwd, file), code);
  assert.equal(await removeWorkspacePlugin(file, code), true, useIde.getState().notice);
  assert.equal(existsSync(path.join(cwd, file)), false);
  assert.equal(readFileSync(path.join(cwd, "plugins/keep.js"), "utf8"), "// Keep this file");
  assert.equal(file in useIde.getState().files, false);
  assert.equal(useIde.getState().openPaths.includes(file), false);
  assert.equal(useIde.getState().pluginKnown.includes(id), false);
  assert.equal(useIde.getState().pluginProblems.length, 0);
  assert.deepEqual(useIde.getState().pluginConfig, { "builtin.setting": "keep" });
  assert.equal(
    host.listPlugins().some((p) => p.id === id),
    false,
  );
  assert.equal(
    host.listCommands().some((c) => c.plugin === id),
    false,
  );
  emitPlugin("change");
  assert.equal(globalThis.__pluginEvents, 1, "removed event hook must not fire");
  await useIde.persist.rehydrate();
  host.reloadPlugins();
  assert.equal(
    file in useIde.getState().files,
    false,
    "rehydration must not resurrect the removed file",
  );
  assert.equal(
    host.listCommands().some((c) => c.plugin === id),
    false,
  );
  writeFileSync(path.join(cwd, file), code);
  const neighbor = "plugins/mein-plugin.js.other.js";
  useIde.setState({
    files: { [file]: code, [neighbor]: "// Neighbor plugin" },
    pluginConfig: { [`${id}.setting`]: "remove", [`ws:${neighbor}.setting`]: "keep neighbor" },
    dirty: {},
    editBases: {},
  });
  sync.noteDiskContents(useIde.getState().files);
  assert.equal(await removeWorkspacePlugin(file, code), true);
  assert.deepEqual(useIde.getState().pluginConfig, { [`ws:${neighbor}.setting`]: "keep neighbor" });
  writeFileSync(path.join(cwd, file), code);
  useIde.setState({ files: { [file]: code }, dirty: {}, editBases: {} });
  sync.noteDiskContents(useIde.getState().files);
  switchDuringRemove = true;
  assert.equal(await removeWorkspacePlugin(file, code), false);
  assert.equal(existsSync(path.join(cwd, file)), false, "old project deletion was completed");
  assert.equal(
    useIde.getState().files[file],
    "other project",
    "new project must not be changed after disk await",
  );
  assert.deepEqual(useIde.getState().pluginConfig, { [`${id}.setting`]: "other project setting" });
});
