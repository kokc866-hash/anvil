import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("agent completion follows tool outcomes and fresh diagnostic results", async (t) => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { runAgentLoop } = await server.ssrLoadModule("/src/lib/agent-core.ts");
    const { beginAgent } = await server.ssrLoadModule("/src/lib/abort.ts");
    const call = (name, args) => ({ id: Math.random().toString(16).slice(2), type: "function", function: { name, arguments: JSON.stringify(args) } });
    const script = (rounds) => async () => ({ content: "Alles behoben und Run bestätigt.", toolContract: { transport: "native", names: ["write_file", "run_file"] }, tool_calls: rounds.shift() || [] });
    const data = (ask = "Korrigiere das Programm.") => ({ messages: [{ role: "user", content: ask }], files: [{ path: "snake.ts", content: "const n = 1;" }], runLoop: false, afterWrite: "none", maxRounds: 8 });
    await t.test("failed run followed by an edit cannot finish successfully", async () => {
      beginAgent();
      const r = await runAgentLoop(data(), script([[call("run_file", { path: "snake.ts" })], [call("write_file", { path: "snake.ts", content: "const n = 2;" })]]), { runFile: async () => ({ ok: false, error: "compile failed" }), onWorkspace: async () => {} });
      assert.equal(r.ok, false); assert.equal(r.verification.state, "failed"); assert.match(r.reply, /Nicht abgeschlossen.*compile failed/s);
    });
    await t.test("successful run before the last edit is stale", async () => {
      beginAgent();
      const r = await runAgentLoop(data(), script([[call("run_file", { path: "snake.ts" })], [call("write_file", { path: "snake.ts", content: "const n = 2;" })]]), { runFile: async () => ({ ok: true }), onWorkspace: async () => {} });
      assert.equal(r.verification.state, "stale"); assert.match(r.reply, /Noch nicht bestätigt/);
    });
    await t.test("fix tasks feed remaining diagnostics back and recheck after the correction", async () => {
      beginAgent(); let checks = 0;
      const r = await runAgentLoop(data("Behebe diese Probleme im Workspace.\nsnake.ts:1 [error · tsc] bad type"), script([[call("write_file", { path: "snake.ts", content: "const n = 2;" })], [], [call("write_file", { path: "snake.ts", content: "const n = 3;" })]]), {
        onWorkspace: async () => {}, verify: async (paths) => { assert.deepEqual(paths, ["snake.ts"]); checks++; return { ok: checks > 1, detail: checks === 1 ? "snake.ts:1 tsc bad type" : "keine Fehler" }; },
      });
      assert.equal(checks, 2); assert.equal(r.ok, true); assert.equal(r.verification.state, "passed");
    });
    await t.test("failed persistence is not converted to a successful edit", async () => {
      beginAgent();
      const r = await runAgentLoop(data(), script([[call("write_file", { path: "snake.ts", content: "const n = 2;" })]]), { onWorkspace: async () => { throw new Error("cwd außerhalb des Workspace"); } });
      assert.equal(r.ok, false); assert.match(r.reply, /cwd außerhalb/);
    });
  } finally { await server.close(); }
});
