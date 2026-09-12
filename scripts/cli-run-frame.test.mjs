import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("Anvil run images stay visible while a CLI edit/run conversation finishes", async () => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  try {
    const { runAgentLoop } = await server.ssrLoadModule("/src/lib/agent-core.ts");
    const { beginAgent } = await server.ssrLoadModule("/src/lib/abort.ts");
    const { cliPrompt } = await server.ssrLoadModule("/src/lib/cli-protocol.ts");
    const frame = "data:image/png;base64,dGVzdC1mcmFtZQ==";
    const changed = '<button id="reset">Zurücksetzen</button>';
    const events = [];
    let rounds = 0;
    const call = (name, args) => ({ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } });
    beginAgent();
    const result = await runAgentLoop({ messages: [{ role: "user", content: "Ergänze einen Reset-Button und führe index.html aus." }], files: [{ path: "index.html", content: "<p>Zähler</p>" }], runLoop: false, afterWrite: "none", maxRounds: 5 }, async (messages) => {
      const before = JSON.stringify(messages);
      const prompt = cliPrompt(messages, []);
      assert.equal(JSON.stringify(messages), before, "CLI conversion must not change messages used by image-capable transports");
      rounds++;
      if (rounds === 3) {
        assert.ok(before.includes(frame), "The original conversation retains the run image");
        const wireFrame = JSON.parse(before).find(m => Array.isArray(m.content) && m.content.some(p => p.image_url?.url === frame));
        assert.deepEqual(Object.keys(wireFrame).sort(), ["content", "role"], "Image API requests gain no unsupported transport metadata");
        assert.ok(!prompt.includes(frame), "No image is sent through the text-only CLI");
        assert.match(prompt, /keine Bildsicht behaupten/);
        assert.doesNotMatch(prompt, /Kurz sagen, was du siehst/);
        assert.match(prompt, /fixture run completed/);
      }
      return { content: rounds > 2 ? "Reset-Button ergänzt; Ausführung erfolgreich. Keine visuelle Prüfung." : "", toolContract: { transport: "native", names: ["write_file", "run_file"] }, tool_calls: rounds === 1 ? [call("write_file", { path: "index.html", content: changed })] : rounds === 2 ? [call("run_file", { path: "index.html" })] : [] };
    }, { onWorkspace: async () => {}, runFile: async () => ({ ok: true, stdout: "fixture run completed", image: frame }), onTool: event => events.push(event) });
    assert.equal(result.ok, true);
    assert.equal(result.verification.state, "passed");
    assert.equal(rounds, 3);
    assert.equal(result.files.find(file => file.path === "index.html").content, changed);
    assert.equal(events.find(event => event.name === "run_file").result.image, frame, "The visible Anvil trail keeps the screenshot");
  } finally {
    await server.close();
  }
});
