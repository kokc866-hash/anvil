import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

test("workspace destinations remain exclusive across selection and restore", async (t) => {
  const values = new Map(), records = new Map(), writes = [];
  const oldFetch = globalThis.fetch, oldIdb = globalThis.indexedDB;
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout, clearTimeout });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith("/v1/file")) writes.push(JSON.parse(opts.body));
    else assert.ok(String(url).endsWith("/v1/workspace"), `unexpected request: ${url}`);
    return new Response(JSON.stringify({ ok: true }));
  };
  let switching = true;
  globalThis.fixturePrepareSwitch = async () => switching;
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", plugins: [{
    name: "workspace-switch-choice",
    transform(code, id) {
      if (id.endsWith("/src/lib/save.ts")) return "export const prepareWorkspaceSwitch = () => globalThis.fixturePrepareSwitch();";
    },
  }] });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { useIntern } = await server.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const disk = await server.ssrLoadModule("/src/lib/disk.ts");
  const sync = await server.ssrLoadModule("/src/lib/disk-sync.ts");
  const browser = { name: "browser project" }, backup = { name: "backup" };
  window.showDirectoryPicker = async () => browser;
  t.after(async () => {
    await sync.flushDiskSync().catch(() => {});
    const { flushPersistence } = await server.ssrLoadModule("/src/lib/persist-storage.ts");
    await flushPersistence().catch(() => {});
    await server.close();
    globalThis.fetch = oldFetch;
    if (oldIdb === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = oldIdb;
    delete globalThis.fixturePrepareSwitch;
    delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
  });

  useIde.setState({ workspaceCwd: "", files: {}, dirty: {}, editBases: {}, pendingDiffs: [], autoSaveDisk: false });
  await disk.pickLocation("workspace");
  assert.equal(sync.captureDiskTarget().handle, browser);
  useIde.getState().setWorkspaceCwd("C:\\native-project");
  assert.equal(disk.diskWorkspaceHandle(), null, "native selection detaches the browser handle synchronously");
  useIde.setState({ files: { "new.txt": "new content" }, dirty: { "new.txt": true }, editBases: { "new.txt": null } });
  await sync.syncWrite("new.txt", "new content");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].cwd, "C:\\native-project");
  assert.equal(writes[0].expected, null, "new files must not overwrite unseen files");
  assert.equal(useIde.getState().dirty["new.txt"], undefined);

  switching = false;
  await assert.rejects(disk.pickLocation("workspace"), /Projektwechsel abgebrochen/);
  assert.equal(useIde.getState().workspaceCwd, "C:\\native-project");
  assert.equal(disk.diskWorkspaceHandle(), null);
  switching = true;
  await disk.pickLocation("workspace");
  assert.equal(useIde.getState().workspaceCwd, "");
  assert.equal(disk.diskWorkspaceHandle(), browser);

  // Reproduce legacy state: a persisted native cwd plus an old IndexedDB handle.
  records.set("workspace", { handle: browser, name: browser.name });
  records.set("backup", { handle: backup, name: backup.name });
  globalThis.indexedDB = { open(name) {
    const request = {};
    queueMicrotask(() => {
      if (name !== "anvil-disk") { request.error = new Error("unavailable fixture database"); request.onerror?.(); return; }
      request.result = { close() {}, transaction() {
        const tx = { objectStore: () => ({
          get(key) { const req = {}; queueMicrotask(() => { req.result = records.get(key); req.onsuccess?.(); }); return req; },
          put(value, key) { records.set(key, value); },
          delete(key) { records.delete(key); },
        }) };
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      } };
      request.onsuccess?.();
    });
    return request;
  } };
  useIde.setState({ workspaceCwd: "C:\\native-project" });
  const names = await disk.restoreLocations();
  assert.equal(names.workspace, "");
  assert.equal(names.backup, "backup");
  assert.equal(disk.diskWorkspaceHandle(), null);
  assert.equal(records.has("workspace"), false);
  assert.equal(disk.hasLocation("backup"), true);
  assert.equal(sync.captureDiskTarget().cwd, "C:\\native-project");
});
