import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("malformed CLI argument JSON reaches strict validation and the model can correct it without a write", async () => {
  const server = await createServer({ configFile: false, cacheDir: "node_modules/.vite-cli-malformed-tests", root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  try {
    const { runAgentLoop } = await server.ssrLoadModule("/src/lib/agent-core.ts");
    const { parseCliChoice } = await server.ssrLoadModule("/src/lib/cli-protocol.ts");
    const { beginAgent } = await server.ssrLoadModule("/src/lib/abort.ts");
    const malformed = '{"path":"cart.mjs"}, {"old_string":"red","new_string":"green"}';
    const offered = ["edit_file"];
    const envelope = args => JSON.stringify({ content: "", tool_calls: [{ name: "edit_file", arguments: args }] });
    const events = [], writes = [];
    let round = 0;
    beginAgent();
    const result = await runAgentLoop({ messages: [{ role: "user", content: "Change red to green in cart.mjs." }], files: [{ path: "cart.mjs", content: "red" }], runLoop: false, afterWrite: "none", maxRounds: 5 }, async messages => {
      round++;
      if (round === 1) return parseCliChoice(envelope(malformed), offered);
      if (round === 2) {
        assert.equal(writes.length, 0, "malformed arguments must not execute, even if their prefix is repairable");
        assert.ok(messages.some(message => message.role === "tool" && /one complete JSON object/.test(String(message.content))));
        return parseCliChoice(envelope(JSON.stringify({ path: "cart.mjs", old_string: "red", new_string: "green" })), offered);
      }
      return parseCliChoice(JSON.stringify({ content: "Farbe geändert; keine Ausführung geprüft.", tool_calls: [] }), offered);
    }, { onWorkspace: event => { writes.push(event); }, onTool: event => events.push(event) });
    assert.equal(round, 3);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].content, "green");
    assert.match(events[0].result.error, /one complete JSON object/);
    assert.equal(events[1].result.ok, true);
    assert.equal(result.files.find(file => file.path === "cart.mjs").content, "green");
    assert.equal(result.ok, true, "a corrected rejected invocation leaves no phantom execution failure");
    assert.notEqual(result.verification.state, "passed", "a corrected edit alone is no execution proof");
    assert.throws(() => parseCliChoice(envelope("{}"), []), /unbekannt/);
    assert.throws(() => parseCliChoice("broken outer JSON", offered), /Antwortformat/);

    let failedRound = 0, unintendedWrites = 0;
    beginAgent();
    const abandoned = await runAgentLoop({ messages: [{ role: "user", content: "Change red to green in cart.mjs." }], files: [{ path: "cart.mjs", content: "red" }], runLoop: false, afterWrite: "none", maxRounds: 5 }, async () => {
      if (++failedRound === 1) return parseCliChoice(envelope(malformed), offered);
      return parseCliChoice(JSON.stringify({ content: "Fertig, Farbe wurde geändert.", tool_calls: [] }), offered);
    }, { onWorkspace: () => { unintendedWrites++; } });
    assert.equal(unintendedWrites, 0);
    assert.equal(abandoned.ok, false, "prose cannot erase an uncorrected malformed edit");
    assert.equal(abandoned.verification.state, "failed");
    assert.equal(abandoned.files.find(file => file.path === "cart.mjs").content, "red");

    let unrelatedRound = 0;
    beginAgent();
    const unrelated = await runAgentLoop({ messages: [{ role: "user", content: "Change red to green in cart.mjs." }], files: [{ path: "cart.mjs", content: "red" }], runLoop: false, afterWrite: "none", maxRounds: 5 }, async () => {
      const names = ["edit_file", "read_file"];
      if (++unrelatedRound === 1) return parseCliChoice(envelope(malformed), names);
      if (unrelatedRound === 2) return parseCliChoice(JSON.stringify({ content: "", tool_calls: [{ name: "read_file", arguments: '{"path":"cart.mjs"}' }] }), names);
      return parseCliChoice(JSON.stringify({ content: "Datei gelesen; Änderung erledigt.", tool_calls: [] }), names);
    }, { onWorkspace: () => { unintendedWrites++; } });
    assert.equal(unintendedWrites, 0);
    assert.equal(unrelated.ok, false, "a successful read cannot clear an invalid edit request");
    assert.equal(unrelated.verification.state, "failed");
  } finally { await server.close(); }
});
