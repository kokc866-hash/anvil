import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("current run results belong to their project and use seconds", async (t) => {
  const keys = ["window", "document", "localStorage", "fetch", "__resultRun", "__engineJob", "__replRun"];
  const before = new Map(keys.map(key => [key, globalThis[key]]));
  const values = new Map();
  const timers = new Set();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; }, clearTimeout, location: { origin: "http://127.0.0.1:9999", protocol: "http:", hostname: "127.0.0.1", pathname: "/" } });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  globalThis.fetch = async () => { throw new Error("Unexpected network call in project result test"); };
  // Substitute external execution only. Store, result parsing, engine selection
  // and the exact production agent-tool adapter remain real.
  const server = await createServer({
    configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{
      name: "project-result-execution-boundaries",
      resolveId(id) { if (id.startsWith("virtual:result-")) return "\0" + id; },
      load(id) {
        if (id === "\0virtual:result-run") return "export const runFile = (...args) => globalThis.__resultRun(...args);";
        if (id === "\0virtual:result-companion") return "export const companionRun = async () => globalThis.__engineJob; export const companionPing = async () => ({ ok:true });";
        if (id === "\0virtual:result-life") return "export const withCompanion = fn => fn();";
        if (id === "\0virtual:result-save") return "export const saveNow = async () => true;";
        if (id === "\0virtual:result-repl") return "export const evalSnippet = (...args) => globalThis.__replRun(...args); export const runAgentShell = (...args) => globalThis.__replRun(...args);";
      },
      transform(code, id) {
        const file = id.replaceAll("\\", "/");
        if (file.endsWith("/src/lib/run-tests.ts")) return code.replace('from "./run-client"', 'from "virtual:result-run"');
        if (file.endsWith("/src/lib/run-repl.ts")) return code.replace('from "./run-client"', 'from "virtual:result-repl"').replace('import { parseTestCommand, runAgentShell } from "./agent-shell";', 'import { parseTestCommand } from "./agent-shell"; import { runAgentShell } from "virtual:result-repl";');
        if (file.endsWith("/src/lib/agent-client.ts")) return code.replace("function clientTools(", "export function clientTools(")
          .replaceAll('"./companion-life"', '"virtual:result-life"').replaceAll('import("./companion")', 'import("virtual:result-companion")').replaceAll('import("./save")', 'import("virtual:result-save")');
      },
    }],
  });
  t.after(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const timer of timers) clearTimeout(timer);
    await server.close();
    for (const [key, value] of before) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { runTestFiles } = await server.ssrLoadModule("/src/lib/run-tests.ts");
  const initial = useIde.getState();
  const oldFiles = { "cart.test.mjs": "import { test } from 'node:test'; test('total', () => {});" };
  const oldHit = { path: "cart.test.mjs", line: 1, name: "total", ok: true, text: "passed" };
  const output = { ok: true, stdout: "ok 1 - total", stderr: "", duration: 0.8799, label: "tests" };
  const history = [{ id: "old-message", role: "assistant", content: "Previous verified result", lastRun: output }];
  const reset = (overrides = {}) => useIde.setState({ ...initial, autoSaveDisk: false, files: oldFiles, workspaceCwd: "I:/fixture/shop", workspaceEpoch: 10, output: [output], testResults: { "cart.test.mjs:total": oldHit }, testsRunning: false, chat: history, ...overrides });

  await t.test("native project switch clears current results, leaving the chat evidence intact", () => {
    reset();
    useIde.getState().setWorkspaceCwd("I:/fixture/godot");
    assert.deepEqual(useIde.getState().testResults, {});
    assert.deepEqual(useIde.getState().output, []);
    assert.deepEqual(useIde.getState().chat, history);
  });
  await t.test("reselecting the same native directory preserves its results", () => {
    reset(); useIde.getState().setWorkspaceCwd("I:/fixture/shop");
    assert.deepEqual(Object.values(useIde.getState().testResults), [oldHit]);
    assert.deepEqual(useIde.getState().output, [output]);
  });
  await t.test("replacing browser/imported files clears results even for identical relative filenames", () => {
    reset({ workspaceCwd: "" });
    useIde.getState().applyFiles({ ...oldFiles }, []);
    assert.deepEqual(useIde.getState().testResults, {});
    assert.deepEqual(useIde.getState().output, []);
  });
  await t.test("background disk refresh preserves current results", () => {
    reset(); useIde.getState().applyFiles({ ...oldFiles }, [], { keepDirty: true });
    assert.deepEqual(Object.values(useIde.getState().testResults), [oldHit]);
    assert.deepEqual(useIde.getState().output, [output]);
  });
  await t.test("creating a fresh project clears current results", () => {
    reset(); useIde.getState().resetWorkspace();
    assert.deepEqual(useIde.getState().testResults, {});
    assert.deepEqual(useIde.getState().output, []);
    assert.equal(useIde.getState().testsRunning, false);
  });
  await t.test("a test finishing after a switch cannot publish into the next project or stop its tests", async () => {
    reset({ output: [], testResults: {} });
    let finish;
    globalThis.__resultRun = () => new Promise(resolve => { finish = resolve; });
    const pending = runTestFiles(["cart.test.mjs"]);
    assert.equal(typeof finish, "function");
    useIde.getState().setWorkspaceCwd("I:/fixture/godot");
    useIde.getState().applyFiles({ "project.godot": "config_version=5" });
    useIde.getState().setTestsRunning(true);
    finish(output);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.stderr, /Projekt.*gewechselt/);
    assert.deepEqual(useIde.getState().testResults, {});
    assert.deepEqual(useIde.getState().output, []);
    assert.equal(useIde.getState().testsRunning, true);
  });
  await t.test("late execution errors also leave the new project untouched", async () => {
    reset({ output: [], testResults: {} });
    let fail;
    globalThis.__resultRun = () => new Promise((_resolve, reject) => { fail = reject; });
    const pending = runTestFiles(["cart.test.mjs"]);
    useIde.getState().resetWorkspace();
    useIde.getState().setTestsRunning(true);
    fail(new Error("Old project's runner failed"));
    assert.equal((await pending).ok, false);
    assert.deepEqual(useIde.getState().testResults, {});
    assert.deepEqual(useIde.getState().output, []);
    assert.equal(useIde.getState().testsRunning, true);
  });
  await t.test("automatic round tests never attach the previous project's outcome to a new chat", async () => {
    reset({ output: [], testResults: {} });
    const { testAfterRound } = await server.ssrLoadModule("/src/lib/test-loop.ts");
    let finish;
    globalThis.__resultRun = () => new Promise(resolve => { finish = resolve; });
    const pending = testAfterRound();
    useIde.getState().resetWorkspace();
    const nextChat = [{ id: "new-message", role: "assistant", content: "New project" }];
    useIde.setState({ chat: nextChat });
    finish(output);
    await pending;
    assert.deepEqual(useIde.getState().chat, nextChat);
  });
  await t.test("unchanged-project tests publish parsed results and preserve seconds", async () => {
    reset({ output: [], testResults: {} });
    globalThis.__resultRun = async () => output;
    const result = await runTestFiles(["cart.test.mjs"]);
    assert.equal(result.ok, true);
    assert.equal(Object.values(useIde.getState().testResults)[0].ok, true);
    assert.equal(useIde.getState().testsRunning, false);
    assert.equal(useIde.getState().output.length, 1);
  });
  await t.test("the engine tool converts companion milliseconds only for the output display", async () => {
    reset({ files: { "project.godot": "config_version=5" }, output: [], testResults: {} });
    globalThis.__engineJob = { ok: true, code: 0, stdout: "Import passed", stderr: "", duration: 1937, cmd: "godot --headless" };
    const { clientTools } = await server.ssrLoadModule("/src/lib/agent-client.ts");
    const result = await clientTools({}).engine("run", { action: "check", engine: "godot" });
    assert.equal(useIde.getState().output[0].duration, 1.937);
    assert.equal(result.duration, 1937, "external companion result contract remains milliseconds");
    useIde.getState().pushOutput({ ...output, label: "cart.test.mjs" });
    assert.equal(useIde.getState().output.at(-1).duration, 0.8799);
  });
  await t.test("all console execution branches discard replies after a project switch", async () => {
    const { runReplCommand } = await server.ssrLoadModule("/src/lib/run-repl.ts");
    for (const code of ["npm test", "node cart.test.mjs", "1 + 1"]) {
      reset({ output: [], testResults: {} });
      let finish;
      globalThis.__replRun = () => new Promise(resolve => { finish = resolve; });
      const tabs = [];
      const pending = runReplCommand(code, tab => tabs.push(tab));
      assert.equal(typeof finish, "function");
      assert.deepEqual(tabs, [code === "npm test" ? "test" : "out"]);
      useIde.getState().resetWorkspace();
      finish({ ...output, ok: false, stderr: "old project error" });
      await pending;
      assert.deepEqual(useIde.getState().output, [], code);
    }
  });
  await t.test("console replies still appear in the project that submitted them", async () => {
    const { runReplCommand } = await server.ssrLoadModule("/src/lib/run-repl.ts");
    for (const code of ["npm test", "node cart.test.mjs", "1 + 1"]) {
      reset({ output: [], testResults: {} });
      globalThis.__replRun = async () => ({ ...output, ok: false, stderr: "current project error" });
      await runReplCommand(code, () => {});
      assert.equal(useIde.getState().output.length, 1, code);
      assert.equal(useIde.getState().output[0].stderr, "current project error");
    }
  });
});
