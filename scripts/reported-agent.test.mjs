import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("agent completion follows tool outcomes and fresh diagnostic results", async (t) => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  try {
    const { runAgentLoop } = await server.ssrLoadModule("/src/lib/agent-core.ts");
    const { beginAgent } = await server.ssrLoadModule("/src/lib/abort.ts");
    const call = (name, args) => ({ id: Math.random().toString(16).slice(2), type: "function", function: { name, arguments: JSON.stringify(name === "write_file" ? { overwrite_reason: "Replace the complete one-line fixture to test execution and persistence evidence.", ...args } : args) } });
    const script = (rounds) => async () => ({ content: "Alles behoben und Run bestätigt.", toolContract: { transport: "native", names: ["write_file", "run_file"] }, tool_calls: rounds.shift() || [] });
    const data = (ask = "Korrigiere das Programm.") => ({ messages: [{ role: "user", content: ask }], files: [{ path: "snake.ts", content: "const n = 1;" }], runLoop: false, afterWrite: "none", maxRounds: 8 });
    await t.test("declared negative shell case does not block a later verified fix", async () => {
      beginAgent();
      const rounds = [[call("shell",{command:"node negative.cjs",expected_exit_code:1})],[call("write_file",{path:"snake.ts",content:"const n = 2;"})],[call("shell",{command:"node test.cjs"})]];
      const r=await runAgentLoop(data("Prüfe den erwarteten Fehlercode 1, ändere die Datei und teste sie."),async()=>({content:"Geprüft.",tool_calls:rounds.shift()||[],toolContract:{transport:"native",names:["shell","write_file"]}}),{
        shell:async(command,_files,expected)=>{if(command.includes('negative')){assert.equal(expected,1);return{ok:false,code:1,stdout:'',stderr:'expected'};}return{ok:true,code:0,stdout:'passed',stderr:''};},onWorkspace:async()=>{}
      });
      assert.equal(r.ok,true);assert.equal(r.verification.state,'passed');
    });
    await t.test("a passing negative case alone does not certify a working project", async () => {
      const {AgentEvidence}=await server.ssrLoadModule('/src/lib/agent-evidence.ts');
      const evidence=new AgentEvidence();
      evidence.record('shell',{command:'node negative.cjs',expected_exit_code:1},{ok:true,code:1,expectedExitCode:1,exitExpectationMatched:true});
      assert.equal(evidence.status().state,'none');
      evidence.record('shell',{command:'node negative.cjs',expected_exit_code:1},{ok:false,code:2,expectedExitCode:1,exitExpectationMatched:false});
      assert.equal(evidence.status().state,'failed');
    });
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
    await t.test("diagnostic failures retain the concrete save error", async () => {
      beginAgent();
      const r = await runAgentLoop(data("Behebe diese Probleme im Workspace.\nsnake.ts:1 [error · tsc] bad type"), script([[call("write_file", { path: "snake.ts", content: "const n = 2;" })]]), {
        onWorkspace: async () => { throw new Error("Speichern: Zugriff verweigert"); },
        verify: async () => ({ ok: false, detail: "tsc: bad type" }),
      });
      assert.equal(r.ok, false);
      assert.equal(r.verification.state, "failed");
      assert.match(r.error, /Zugriff verweigert/);
      assert.match(r.error, /tsc: bad type/);
    });
  } finally { await server.close(); }
});
