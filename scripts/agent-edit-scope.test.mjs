import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

const original = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="16" fill="#ff3333"/></svg>';
const unwanted = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#33cc66"/></svg>';
const expected = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="16" fill="#33cc66"/></svg>';

test("existing assets require deliberate replacement; exact edits preserve unrelated bytes", async (t) => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  try {
    const { applyTool, runAgentLoop } = await server.ssrLoadModule("/src/lib/agent-core.ts");
    const { beginAgent } = await server.ssrLoadModule("/src/lib/abort.ts");
    const call = (files, name, args) => applyTool(name, args, files, [], new Set(), []);

    await t.test("unqualified replacement of the reported SVG is rejected before mutation", () => {
      const files = new Map([["badge.svg", original]]);
      const outcome = call(files, "write_file", { path: "badge.svg", content: unwanted });
      assert.match(outcome.result.error, /edit_file/);
      assert.equal(outcome.event, undefined);
      assert.equal(outcome.writes, undefined);
      assert.equal(files.get("badge.svg"), original);
      const edited = call(files, "edit_file", { path: "badge.svg", old_string: 'fill="#ff3333"', new_string: 'fill="#33cc66"' });
      assert.equal(edited.result.ok, true);
      assert.equal(files.get("badge.svg"), expected);
      assert.equal(edited.event.content, expected);
    });

    await t.test("new files, idempotent writes and deliberate redesigns remain available", () => {
      const files = new Map();
      assert.equal(call(files, "write_file", { path: "badge.svg", content: original }).result.ok, true);
      assert.equal(call(files, "write_file", { path: "badge.svg", content: original }).result.ok, true);
      for (const overwrite_reason of ["", "  ", true, {}]) {
        assert.match(call(files, "write_file", { path: "badge.svg", content: unwanted, overwrite_reason }).result.error, /edit_file/);
        assert.equal(files.get("badge.svg"), original);
      }
      const replaced = call(files, "write_file", { path: "badge.svg", content: unwanted, overwrite_reason: "User requested a new 120 × 80 rectangular badge with a viewBox." });
      assert.equal(replaced.result.ok, true);
      assert.equal(files.get("badge.svg"), unwanted);
      assert.equal(replaced.event.content, unwanted);
    });

    for (const transport of ["native", "text"]) await t.test(`${transport} agent receives the rejection and retries without persisting unwanted geometry`, async () => {
      beginAgent();
      const events = [];
      let round = 0;
      const names = ["read_file", "write_file", "edit_file"];
      const answer = (name, args) => ({
        toolContract: { transport, names },
        content: transport === "text" ? JSON.stringify({ name, arguments: args }) : "",
        ...(transport === "native" ? { tool_calls: [{ id: `call_${round}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } : {}),
      });
      const result = await runAgentLoop({ messages: [{ role: "user", content: "Ändere in badge.svg nur die Farbe auf #33cc66. Alles andere bleibt unverändert." }], files: [{ path: "badge.svg", content: original }], runLoop: false, afterWrite: "none", maxRounds: 8 }, async (messages) => {
        round++;
        if (round === 1) return answer("read_file", { path: "badge.svg" });
        if (round === 2) {
          assert.match(JSON.stringify(messages.at(-1)), /width=\\"128\\"/);
          assert.match(JSON.stringify(messages.at(-1)), /rx=\\"16\\"/);
          return answer("write_file", { path: "badge.svg", content: unwanted });
        }
        if (round === 3) {
          assert.match(JSON.stringify(messages.at(-1)), /edit_file/);
          assert.equal(events.length, 0);
          return answer("edit_file", { path: "badge.svg", old_string: 'fill="#ff3333"', new_string: 'fill="#33cc66"' });
        }
        return { toolContract: { transport, names }, content: "Nur die Farbe wurde geändert. Maße und Rundung sind unverändert." };
      }, { onWorkspace: async (event) => events.push(event) });
      assert.equal(result.ok, true);
      assert.equal(result.files.find(file => file.path === "badge.svg").content, expected);
      assert.deepEqual(events, [{ op: "write", path: "badge.svg", content: expected }]);
    });
  } finally { await server.close(); }
});
