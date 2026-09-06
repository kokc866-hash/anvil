import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

test("manual Run survives agent Stop, keeps the custom URL, and returns native errors", async (t) => {
  const values = new Map();
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage: globalThis.localStorage, setTimeout, clearTimeout });
  globalThis.document = new EventTarget();
  const server = await createServer({ configFile: false, cacheDir: "node_modules/.vite-run-client-tests", root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await server.close();
    delete globalThis.localStorage; delete globalThis.window; delete globalThis.document;
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { abortAgent } = await server.ssrLoadModule("/src/lib/abort.ts");
  const { runFile } = await server.ssrLoadModule("/src/lib/run-client.ts");
  const { runFromEditor } = await server.ssrLoadModule("/src/lib/editor-run.ts");
  const { applyTool } = await server.ssrLoadModule("/src/lib/agent-core.ts");
  await server.ssrLoadModule("/src/lib/intern.ts");
  useIde.setState({ companionUrl: "http://192.168.1.9:8811", agentBusy: false, workspaceCwd: "", netCompiler: true });
  abortAgent("previous run stopped");
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    assert.equal(opts.signal.aborted, false);
    const body = JSON.parse(opts.body);
    assert.equal(body.entry, "snake.py");
    assert.equal(body.asTest, true);
    return Response.json({ ok: false, code: 7, stdout: "before", stderr: "Exitcode 7", duration: 4, cmd: "python snake.py", stage: { kind: "log", out: "I:\\Anvil\\runs\\snake\\out" } });
  };
  const result = await runFile("snake.py", { "snake.py": "print('hello')" }, { asTest: true });
  assert.deepEqual(calls, ["http://192.168.1.9:8811/v1/compile"]);
  assert.equal(result.ok, false);
  assert.equal(result.stdout, "before");
  assert.equal(result.stderr, "Exitcode 7");
  assert.equal(result.stage.out, "I:\\Anvil\\runs\\snake\\out");
  for (const target of [".anvil/rules.md", ".anvil/harness.json", "ref/README.md", "snake.h"]) {
    const files = { [target]: "text", "snake.py": "print(1)" };
    const toolResult = applyTool("run_file", { path: target }, new Map(Object.entries(files)), [], new Set(), []);
    assert.equal(toolResult.command, undefined);
    assert.equal(toolResult.result.ok, false);
    assert.equal((await runFile(target, files)).ok, false);
  }
  assert.equal(calls.length, 1, "metadata must never reach the process backend");
  let held = 0, released = 0;
  window.anvilNative = {
    companionEnsure: async () => { held++; return { ok: true }; },
    companionRelease: async () => { released++; return { ok: true }; },
  };
  globalThis.fetch = async () => {
    assert.equal(held - released, 1, "status requests must hold the local Companion alive");
    return Response.json({ ok: false, running: false, stderr: "late process failure", stdout: "", duration: 1000, code: 9, cmd: "fixture" });
  };
  const { companionRunStatus } = await server.ssrLoadModule("/src/lib/companion.ts");
  assert.equal((await companionRunStatus("fixture/123")).stderr, "late process failure");
  assert.equal(held, 1);
  assert.equal(released, 1);
  // The editor coordinator must release its own busy state across project switches.
  let started, finish;
  const began = new Promise((r) => { started = r; });
  globalThis.fetch = async () => { started(); return new Promise((r) => { finish = r; }); };
  useIde.setState({ files: { "snake.py": "print(1)" }, activePath: "snake.py", output: [], running: false });
  const oldRun = runFromEditor();
  await began;
  useIde.setState({ workspaceEpoch: useIde.getState().workspaceEpoch + 1, files: { "snake.py": "print(2)" } });
  finish(Response.json({ ok: true, stdout: "old project", stderr: "", duration: 1, stage: { kind: "log" } }));
  await oldRun;
  assert.equal(useIde.getState().running, false);
  assert.equal(useIde.getState().output.length, 0, "old project output stays isolated");

  let executions = 0, releaseFirst, signalFirst;
  const firstStarted = new Promise((r) => { signalFirst = r; });
  const response = () => Response.json({ ok: true, stdout: "current", stderr: "", duration: 1, stage: { kind: "log" } });
  globalThis.fetch = async () => {
    executions++;
    if (executions === 1) { signalFirst(); return new Promise((r) => { releaseFirst = () => r(response()); }); }
    return response();
  };
  const first = runFromEditor();
  await firstStarted;
  const latest = runFromEditor("snake.py", { live: true, current: () => true });
  assert.equal(executions, 1, "live run waits for the current execution");
  releaseFirst();
  await Promise.all([first, latest]);
  assert.equal(executions, 2, "latest live request is executed after the previous run");
  assert.equal(useIde.getState().running, false);

});
