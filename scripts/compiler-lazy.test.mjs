import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("compiler remains lazy for empty, Python and CAD workspaces through both entry paths", async (t) => {
  const workers = [], loads = [];
  const previous = new Map(["window", "Worker", "compilerLazyFixture"].map((key) => [key, globalThis[key]]));
  globalThis.compilerLazyFixture = loads;
  globalThis.window = {};
  globalThis.Worker = class {
    constructor() { this.messages = []; this.stopped = false; workers.push(this); }
    postMessage(message) {
      this.messages.push(message);
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, hits: [], checked: ["app.ts"], value: null } }));
    }
    terminate() { this.stopped = true; }
  };
  const server = await createServer({ configFile: false, root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } }, optimizeDeps: { noDiscovery: true, entries: [] },
    ssr: { optimizeDeps: { noDiscovery: true, include: [] } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "lazy-compiler-boundaries", transform(_code, id) {
      if (id.endsWith("/src/store/ide.ts")) return "export const useIde = { getState: () => ({ workspaceEpoch: 1 }) };";
      if (id.endsWith("/src/lib/compiler-engine.ts")) return `
        globalThis.compilerLazyFixture.push('engine');
        export const ensureTs = async () => null;
        export const disposeTs = () => {};
        export const tsChecked = () => [];
        export const tsQuickInfoSync = () => null;
        export const tsDefinitionSync = () => [];
        export const tscWorkspace = async () => [];
        export const tsRename = async () => ({});
      `;
      if (id.endsWith("/src/lib/python-check.ts")) return "export const pythonCheck = async () => [];";
    } }],
  });
  let client;
  t.after(async () => {
    client?.stopCompilerWorker(); await server.close();
    for (const [key, value] of previous) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  });
  const compiler = await server.ssrLoadModule("/src/lib/lsp-compile.ts");
  client = await server.ssrLoadModule("/src/lib/compiler-client.ts");
  const fixtures = [{}, { "app.py": "def ping():\n  return 1\n" }, { "part.scad": "cube([1, 2, 3]);" },
    { "tsconfig.json": "{}", "app.ts": "", "node_modules/vendor/index.js": "export const n = 1;" },
    { "large.ts": "x".repeat(200_000) }];
  for (const files of fixtures) {
    assert.deepEqual(await compiler.tscWorkspace(files), []);
    assert.deepEqual(await compiler.lintDeep(files), { hits: [], checked: Object.keys(files).filter((p) => p.endsWith(".py")) });
    assert.deepEqual(await client.compilerJob("lint", files, []), { hits: [], checked: [], local: [] });
    assert.equal(await compiler.ensureTs(files), null);
  }
  const mixed = { "app.ts": "export const n = 1;", "app.py": "def ping():\n  return 1\n" };
  assert.equal(await compiler.tsQuickInfo(mixed, "app.py", 4), null);
  assert.deepEqual(await compiler.tsDefinition(mixed, "app.py", 4), []);
  assert.deepEqual(await compiler.tsRename(mixed, "app.py", 4, "pong"), {});
  assert.deepEqual(await client.compilerJob("definition", mixed, [], { path: "app.py", offset: 4 }), { value: [] });
  assert.equal(workers.length, 0, "non-TypeScript functions must not create a compiler worker");
  assert.deepEqual(loads, [], "non-TypeScript work must not load compiler-engine or standard libraries");
  assert.deepEqual(await compiler.tscWorkspace(mixed), []);
  assert.equal(workers.length, 1, "a matching source starts the worker on demand");
  await client.compilerJob("lint", {}, []);
  assert.equal(workers[0].stopped, true, "removing the last supported source releases the existing worker");
  delete globalThis.window;
  delete globalThis.Worker;
  for (const files of fixtures) {
    assert.deepEqual(await compiler.tscWorkspace(files), []);
    assert.equal(await compiler.ensureTs(files), null);
  }
  assert.equal(await compiler.tsQuickInfo(mixed, "app.py", 4), null);
  assert.deepEqual(await compiler.tsDefinition(mixed, "app.py", 4), []);
  assert.deepEqual(await compiler.tsRename(mixed, "app.py", 4, "pong"), {});
  assert.deepEqual(loads, [], "the non-worker entry also stays lazy for unsupported sources");
  await compiler.ensureTs(mixed);
  assert.deepEqual(loads, ["engine"], "the local engine loads when TypeScript is explicitly requested");
});
