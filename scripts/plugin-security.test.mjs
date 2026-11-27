import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createServer } from "vite";
import { zipSync } from "fflate";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function eventually(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(check(), "expected asynchronous state did not arrive");
}

async function fixture(t) {
  const keys = ["window", "document", "localStorage", "fetch", "__pluginFixture", "__importFixture"];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map(), timers = new Set();
  const ls = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.localStorage = ls;
  globalThis.window = Object.assign(new EventTarget(), { localStorage: ls, setTimeout(fn, ms) {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer;
  }, clearTimeout });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  globalThis.fetch = async () => { throw new Error("Real network forbidden in security fixture"); };
  globalThis.__pluginFixture = { calls: 0, builtinCalls: 0, nativeReads: 0, readNative() { this.nativeReads++; return "SYNTHETIC_ONLY"; } };
  globalThis.__importFixture = { target: { cwd: "I:/ARTIFICIAL_A", base: "http://fixture.invalid", handle: null }, disk: [], failure: null, flushGate: null, diskGate: null, archives: new Map() };
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } },
    ssr: { external: ["react", "react-dom", "zustand", "js-yaml"] }, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", plugins: [{
      name: "isolated-plugin-security-boundaries",
      transform(_code, id) {
        const file = id.replaceAll("\\", "/");
        if (file.endsWith("/src/lib/complete.ts")) return `export const stripFence = text => text; export function completeText(){throw new Error('No model calls');}`;
        if (file.endsWith("/src/lib/web-fetch.ts")) return `export function fetchWeb(){throw new Error('No network calls');} export const readWebPage=fetchWeb;`;
        if (file.endsWith("/src/lib/persist-db.ts")) return `export async function saveArchive(name,next){globalThis.__importFixture.archives.set(name,structuredClone(next));} export async function loadArchive(name){const a=globalThis.__importFixture.archives.get(name)||{};return {...a,files:a.files??null,chat:a.chat??null,recovery:a.recovery??null};} export async function removeArchive(name){globalThis.__importFixture.archives.delete(name);}`;
        if (file.endsWith("/src/lib/disk-sync.ts")) return `
          export const captureDiskTarget=()=>({...globalThis.__importFixture.target});
          export async function flushDiskSync(){await globalThis.__importFixture.flushGate;}
          export async function syncRestore(plan,target){
            globalThis.__importFixture.disk.push({plan:structuredClone(plan),target:{...target}});
            await globalThis.__importFixture.diskGate;
            if(globalThis.__importFixture.failure)throw globalThis.__importFixture.failure;
            return [];
          }
          export const prepareRestoreDisk=plan=>plan;
          export const syncWrite=()=>{throw new Error('Untransactional disk write');};
          export const syncRemove=syncWrite, syncMkdir=syncWrite, syncMove=syncWrite;
          export const cancelSyncWrite=()=>{},scheduleSyncWrite=()=>{},noteDiskContents=()=>{};
        `;
      },
    }] });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  await useIde.persist.rehydrate();
  t.after(async () => {
    try { const persistence = await server.ssrLoadModule("/src/lib/persist-storage.ts"); await persistence.flushPersistence(); }
    finally {
      for (const timer of timers) clearTimeout(timer);
      await server.close();
      for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    }
  });
  return { server, useIde, storage };
}

test("workspace code requires exact explicit consent, revokes on edits/trust/project changes and preserves builtins", async t => {
  const { server, useIde, storage } = await fixture(t);
  const host = await server.ssrLoadModule("/src/lib/plugins/host.ts");
  const { subscribeConfirm } = await server.ssrLoadModule("/src/lib/confirm.ts");
  const path = "plugins/fixture.js", id = `ws:${path}`;
  const code = `// @desc Fixture\nfunction activate(anvil){globalThis.__pluginFixture.calls++;globalThis.__pluginFixture.api=anvil;globalThis.__pluginFixture.readNative();anvil.command({id:'fixture',title:'Fixture',run(){}});anvil.status('alpha');}`;
  useIde.setState({ files: { [path]: code, "readme.md": "fixture" }, dirs: ["plugins"], workspaceCwd: "I:/ARTIFICIAL_A", companionUrl: "http://fixture.invalid",
    pluginKnown: [id], pluginDisabled: [], pluginConfig: {}, agentBusy: false, pathOperation: null, autoSaveDisk: false, dirty: {}, editBases: {} });
  host.registerBuiltin({ id: "security-fixture-builtin", name: "Builtin fixture", description: "", builtin: true,
    activate(api) { globalThis.__pluginFixture.builtinCalls++; api.command({ id: "builtin-fixture", title: "Builtin fixture", run() {} }); } });
  host.reloadPlugins();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(globalThis.__pluginFixture.calls, 0);
  assert.equal(globalThis.__pluginFixture.nativeReads, 0);
  assert.equal(host.isPluginEnabled(id), false);
  assert.ok(host.listCommands().some(command => command.plugin === "security-fixture-builtin"));
  useIde.setState({ pluginDisabled: [] }); host.reloadPlugins();
  assert.equal(globalThis.__pluginFixture.calls, 0, "legacy or directly toggled flags are not consent");
  let next = true, duringPrompt;
  const prompts = [];
  const off = subscribeConfirm(slot => { if (slot) { prompts.push(slot); queueMicrotask(() => { duringPrompt?.(); slot.resolve(next); }); } });
  t.after(off);
  assert.equal(await host.requestToggleWorkspacePlugin(id), true);
  assert.equal(host.isPluginEnabled(id), true);
  assert.equal(globalThis.__pluginFixture.nativeReads, 1);
  assert.match(prompts[0].body, /Zugangsdaten/);
  assert.match(prompts[0].body, /ohne Sandbox/);
  assert.ok(storage.get("anvil-workspace-plugin-approvals-v1"));
  const originalApi = globalThis.__pluginFixture.api, changed = code.replace("alpha", "bravo");
  assert.equal(changed.length, code.length);
  useIde.setState({ files: { ...useIde.getState().files, [path]: changed } });
  originalApi.status("must not arrive");
  assert.equal(host.isPluginEnabled(id), false, "revoked before the reload runs");
  assert.equal(useIde.getState().pluginStatus, "alpha");
  host.reloadPlugins();
  assert.equal(globalThis.__pluginFixture.calls, 1);
  assert.equal(await host.requestToggleWorkspacePlugin(id), true);
  const restrictedApi = globalThis.__pluginFixture.api;
  assert.deepEqual(restrictedApi.files(), {});
  const trusted = "// @trust\n" + changed;
  useIde.setState({ files: { ...useIde.getState().files, [path]: trusted } });
  host.reloadPlugins();
  assert.equal(host.isPluginEnabled(id), false);
  assert.equal(globalThis.__pluginFixture.calls, 2, "adding @trust never silently activates or upgrades");
  assert.equal(await host.requestToggleWorkspacePlugin(id), true);
  assert.equal(globalThis.__pluginFixture.api.files()["readme.md"], "fixture");
  const trustedApi = globalThis.__pluginFixture.api, promptCount = prompts.length;
  useIde.setState(state => ({ workspaceCwd: "I:/ARTIFICIAL_B", workspaceEpoch: state.workspaceEpoch + 1, files: { [path]: trusted } }));
  host.reloadPlugins(); trustedApi.status("old project");
  assert.equal(host.isPluginEnabled(id), false);
  assert.equal(globalThis.__pluginFixture.calls, 3);
  // Returning to the same path/content restores that project's saved approval asynchronously.
  useIde.setState(state => ({ workspaceCwd: "I:/ARTIFICIAL_A", workspaceEpoch: state.workspaceEpoch + 1, files: { [path]: trusted } }));
  host.reloadPlugins();
  await eventually(() => host.isPluginEnabled(id));
  assert.equal(prompts.length, promptCount);
  assert.equal(globalThis.__pluginFixture.calls, 4);
  trustedApi.status("old handle must stay revoked");
  assert.equal(useIde.getState().pluginStatus, "bravo");
  assert.equal(await host.requestToggleWorkspacePlugin(id), true, "explicit disabling revokes saved consent");
  host.reloadPlugins(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.isPluginEnabled(id), false);
  next = false;
  assert.equal(await host.requestToggleWorkspacePlugin(id), false);
  next = true; duringPrompt = () => useIde.setState(state => ({ files: { ...state.files, [path]: trusted + "\n// changed during dialog" } }));
  assert.equal(await host.requestToggleWorkspacePlugin(id), false);
  assert.equal(host.isPluginEnabled(id), false);
});

test("VSIX/drop commits capture project and file revision, avoid overwrite and announce only saved state", async t => {
  const { server, useIde } = await fixture(t);
  const imports = await server.ssrLoadModule("/src/lib/plugins/import.ts");
  const { importDropped } = await server.ssrLoadModule("/src/lib/dnd.ts");
  const state = () => useIde.setState({ files: { "keep.txt": "keep" }, dirs: [], workspaceCwd: "I:/ARTIFICIAL_A", agentBusy: false,
    pathOperation: null, dirty: {}, editBases: {}, pendingDiffs: [], openPaths: [], activePath: null });
  state();
  let snapshot = imports.captureImportTarget();
  useIde.setState(s => ({ workspaceEpoch: s.workspaceEpoch + 1, files: { "keep.txt": "B" } }));
  globalThis.__importFixture.target = { ...globalThis.__importFixture.target, cwd: "I:/ARTIFICIAL_B" };
  await assert.rejects(imports.commitImportedFiles(snapshot, { "new.txt": "new" }), /inzwischen/);
  assert.equal(globalThis.__importFixture.disk.length, 0);
  globalThis.__importFixture.target.cwd = "I:/ARTIFICIAL_A";
  state(); snapshot = imports.captureImportTarget();
  useIde.setState(s => ({ files: { ...s.files, "keep.txt": "edited" } }));
  await assert.rejects(imports.commitImportedFiles(snapshot, { "new.txt": "new" }), /inzwischen/);
  state(); snapshot = imports.captureImportTarget();
  await assert.rejects(imports.commitImportedFiles(snapshot, { "KEEP.txt": "overwrite" }), /nicht überschrieben/);
  useIde.setState({ agentBusy: true });
  await assert.rejects(imports.commitImportedFiles(snapshot, { "new.txt": "new" }), /bearbeitet/);
  state(); snapshot = imports.captureImportTarget();
  globalThis.__importFixture.failure = new Error("synthetic disk failure");
  await assert.rejects(imports.commitImportedFiles(snapshot, { "new.txt": "new" }), /synthetic disk failure/);
  assert.deepEqual(useIde.getState().files, { "keep.txt": "keep" });
  assert.equal(useIde.getState().pathOperation, null);
  globalThis.__importFixture.failure = null;
  const diskGate = deferred(); globalThis.__importFixture.diskGate = diskGate.promise;
  snapshot = imports.captureImportTarget();
  const saved = imports.commitImportedFiles(snapshot, { "new.txt": "new" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal("new.txt" in useIde.getState().files, false, "no optimistic success before disk save");
  diskGate.resolve(); assert.equal(await saved, 1);
  assert.equal(useIde.getState().files["new.txt"], "new");
  assert.equal(useIde.getState().dirty["new.txt"], undefined);
  assert.equal(globalThis.__importFixture.disk.at(-1).plan.files[0].expected, null, "add-only on disk, not just memory");
  globalThis.__importFixture.diskGate = null;
  state();
  const fileGate = deferred(), delayed = { name: "fixture.vsix", size: 30, arrayBuffer: () => fileGate.promise };
  const dropping = importDropped([delayed]);
  useIde.setState(s => ({ workspaceEpoch: s.workspaceEpoch + 1, files: { "keep.txt": "B" } }));
  globalThis.__importFixture.target.cwd = "I:/ARTIFICIAL_B";
  fileGate.resolve(new ArrayBuffer(30));
  const before = globalThis.__importFixture.disk.length;
  assert.equal(await dropping, 0);
  assert.equal(globalThis.__importFixture.disk.length, before);
  assert.deepEqual(useIde.getState().files, { "keep.txt": "B" });
  state(); globalThis.__importFixture.target.cwd = "I:/ARTIFICIAL_A";
  const packed = zipSync({ "extension/package.json": new TextEncoder().encode('{"name":"fixture","contributes":{"snippets":[]}}'), "extension/out/extension.js": new TextEncoder().encode("throw new Error('never execute')") });
  const archive = { name: "fixture.vsix", size: packed.length, arrayBuffer: async () => Uint8Array.from(packed).buffer };
  assert.equal(await importDropped([archive]), 1);
  assert.ok(useIde.getState().files["plugins/fixture/package.json"]);
  assert.equal("plugins/fixture/out/extension.js" in useIde.getState().files, false);
  const lastDisk = globalThis.__importFixture.disk.length;
  assert.equal(await importDropped([archive]), 0, "existing pack is never overwritten by default");
  assert.equal(globalThis.__importFixture.disk.length, lastDisk);
});
