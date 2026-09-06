/** Real agent loop + native Ollama/Cloud serializers, with fixture replies only. */
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { once } from "node:events";
import { createServer } from "vite";
import { chromium } from "playwright";
import { createLlmPipeServer } from "../electron/llm-pipe.mjs";

const requests = [];
let replies = [];
const upstream = httpServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "profile" }], models: [{ name: "profile" }] }));
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push({ url: req.url, body });
  const reply = replies.shift();
  if (!reply) { res.writeHead(500); res.end("Unexpected extra request"); return; }
  if (reply.status) { res.writeHead(reply.status); res.end(reply.error); return; }
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  res.end(JSON.stringify({ message: { role: "assistant", ...reply }, done: true, done_reason: "stop" }) + "\n");
});
const pipe = createLlmPipeServer("compat-fixture");
let server;
let browser;
const native = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (name, args) => ({ content: JSON.stringify({ name, arguments: args }) });
const done = { content: "Fertig." };
try {
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  pipe.listen(0, "127.0.0.1"); await once(pipe, "listening");
  const cfg = { pipe: { port: pipe.address().port, token: "compat-fixture" }, base: `http://127.0.0.1:${upstream.address().port}/v1` };
  server = await createServer({ server: { host: "127.0.0.1", port: 8190, strictPort: true }, cacheDir: "node_modules/.vite-tool-compat" });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((cfg) => {
    if (!localStorage.getItem("anvil-ide")) {
    localStorage.setItem("anvil-ide", JSON.stringify({ state: { setupDone: true, autoUpdate: false, llmProvider: "ollama", llmBaseUrl: cfg.base, llmModel: "legacy", autoRunAgent: false, files: {}, openPaths: [], activePath: null }, version: 0 }));
    localStorage.setItem("anvil-brain", JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
    localStorage.setItem("anvil-model-caps", JSON.stringify({ "ollama-native-chat::legacy": { tools: "ok", noStreamTools: true, at: Date.now() }, "ollama::legacy": { tools: "off", at: Date.now() } }));
    }
    window.anvilNative = { llmPipe: async () => cfg.pipe, companionEnsure: async () => ({ ok: true }), companionRelease: async () => ({ ok: true }) };
  }, cfg);
  await page.goto("http://127.0.0.1:8190", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  const migrated = await page.evaluate(async (cfg) => {
    const { getCap } = await import("/src/lib/model-caps.ts");
    return [getCap("ollama", "legacy", cfg.base), getCap("ollama", "legacy", "http://192.168.1.99:11434/v1")];
  }, cfg);
  assert.equal(migrated[0].tools, "ok"); assert.equal(migrated[0].noStreamTools, true); assert.equal(migrated[1].tools, "unknown");
  console.log("PASS unambiguous legacy learning migrates only to the saved native endpoint");

  async function run(name, mode, task, responses, extra = {}) {
    requests.length = 0; replies = [...responses];
    const result = await page.evaluate(async ({ cfg, name, mode, task, extra }) => {
      const { chatWithProvider } = await import("/src/lib/agent-client.ts");
      const { resetCap, getCap } = await import("/src/lib/model-caps.ts");
      const { toolTargetKey } = await import("/src/lib/tool-compat.ts");
      const store = window.__anvilIde;
      const provider = extra.provider || "ollama";
      const baseUrl = provider === "openai" ? "https://api.openai.com/v1" : provider === "anthropic" ? "https://api.anthropic.com/v1" : cfg.base;
      resetCap(provider, name, baseUrl);
      store.setState({ llmProvider: provider, llmModel: name, llmBaseUrl: baseUrl, llmAuthMode: "key", llmToolModes: { [toolTargetKey(provider, name, baseUrl)]: mode }, llmThinking: "low", llmRetries: 3, llmContext: 8192, llmContextAuto: false, llmApiKey: "fixture", activeSurfaceId: extra.surface || "anvil", surfaceMode: "exclusive", mcpServers: [], files: { "a.txt": "old" }, openPaths: [], activePath: null, graphLoop: false, runLoop: false, testLoop: false, engineLoop: false });
      const events = []; const tools = [];
      const result = await chatWithProvider({ provider, baseUrl, model: name, apiKey: "fixture", messages: [{ role: "user", content: task }], files: [{ path: "a.txt", content: "old" }], context: 8192, thinking: "low", maxRounds: 8, graphLoop: false, runLoop: false, testLoop: false, afterWrite: "none", observeOnly: extra.ask || false, onWorkspace: (event) => { events.push(event); }, onTool: (event) => tools.push(event), onDelta: () => {} });
      return { result, events, tools, cap: getCap(provider, name, baseUrl) };
    }, { cfg, name, mode, task, extra });
    assert.equal(replies.length, 0, `${name}: expected replies consumed`);
    return result;
  }
  const offered = (i = 0) => requests[i].body.tools?.map((t) => t.function?.name || t.name) || [];
  let r = await run("standard", "standard", "Lies a.txt", [native("read_file", { path: "a.txt" }), done]);
  assert.ok(offered().length > 8); assert.ok(!offered().includes("select_tools")); assert.equal(requests[0].url, "/api/chat"); assert.equal(requests[0].body.think, "low"); assert.equal(r.tools[0].name, "read_file"); assert.equal(r.cap.tools, "ok");
  console.log("PASS existing native Ollama catalog and thinking survive a full round");

  r = await run("compact", "compact", "MCP und Run compile prüfen", [native("mcp_list", {}), done]);
  assert.ok(offered().length <= 8); for (const name of ["mcp_list", "mcp_call", "run_file", "see_run", "ask_user", "select_tools"]) assert.ok(offered().includes(name), name);
  assert.equal(r.tools[0].name, "mcp_list"); assert.equal(requests.length, 2);
  console.log("PASS MCP and Run are offered immediately in compact mode");

  await run("select", "compact", "Prüfe Tools", [native("select_tools", { names: ["debug_start", "engine_run", "play"] }), done]);
  for (const name of ["debug_start", "engine_run", "play"]) assert.ok(offered(1).includes(name), name);
  assert.ok(offered(1).length <= 8);
  console.log("PASS tool discovery updates the next request without executing selections");

  r = await run("text", "text", "Schreibe a.txt", [text("write_file", { path: "a.txt", content: "new" }), done]);
  assert.equal(r.events.filter((e) => e.op === "write" && e.path === "a.txt").length, 1);
  assert.equal(requests[0].body.tools, undefined); assert.equal(requests[0].body.tool_choice, undefined); assert.equal(requests[0].body.think, "low");
  assert.match(JSON.stringify(requests[1].body.messages), /Tool result/); assert.equal(r.cap.tools, "unknown");
  console.log("PASS strict text writes once, preserves results and leaves thinking/cached capabilities unchanged");

  r = await run("ask", "text", "Frage mich nach einer Farbe", [text("ask_user", { prompt: "Welche Farbe?", choices: ["Rot", "Blau"] })]);
  assert.equal(r.result.parked, true); assert.equal(r.result.ask.prompt, "Welche Farbe?");
  console.log("PASS ask_user parks through the common executor in text mode");

  for (const [name, reply] of [["thinking", { content: "So sieht ein Beispiel aus.", thinking: text("write_file", { path: "a.txt", content: "bad" }).content }], ["quoted", { content: "Beispiel:\n```json\n" + text("write_file", { path: "a.txt", content: "bad" }).content + "\n```" }], ["invalid", text("write_file", { path: "a.txt" })]]) {
    r = await run(name, "text", "Erkläre ein Beispiel", [reply]);
    assert.equal(r.events.filter((e) => e.op === "write").length, 0);
  }
  r = await run("readonly", "text", "Schreibe a.txt", [text("write_file", { path: "a.txt", content: "bad" })], { ask: true });
  assert.equal(r.events.length, 0); assert.equal(r.result.ok, false);
  r = await run("surface", "text", "Schreibe a.txt", [text("write_file", { path: "a.txt", content: "bad" })], { surface: "external" });
  assert.equal(r.events.length, 0); assert.equal(r.result.ok, false);
  console.log("PASS thinking, quoted examples, invalid args, Ask and exclusive MCP cannot write");

  await run("answer", "compact", "Schreibe a.txt", [{ content: "Welche Variante möchtest du?", thinking: "Thinking. ".repeat(30) }]);
  assert.equal(requests.length, 1);
  r = await run("fallback", "compact", "Schreibe a.txt und kompiliere das Projekt", [native("write_file", { path: "a.txt", content: "new" }), { content: "Keine Tools verfügbar" }, text("write_file", { content: "new", path: "a.txt" }), { content: "Keine Tools verfügbar" }]);
  assert.equal(requests.length, 4); assert.ok(requests[1].body.tools); assert.equal(requests[2].body.tools, undefined); assert.match(JSON.stringify(requests[2].body.messages), /Tool result/);
  assert.equal(r.events.filter((e) => e.op === "write" && e.path === "a.txt").length, 1); assert.equal(r.cap.tools, "ok"); assert.equal(r.result.ok, false);
  console.log("PASS normal questions do not retry; one stall fallback preserves writes and is never cached");

  r = await run("unsupported", "compact", "Lies a.txt", [{ status: 400, error: "model does not support tools" }, text("read_file", { path: "a.txt" }), done]);
  assert.equal(requests.length, 3); assert.equal(requests[1].body.tools, undefined); assert.equal(r.cap.tools, "text"); assert.equal(r.tools[0].name, "read_file");
  console.log("PASS explicit unsupported-tools error learns endpoint-scoped text transport");

  // Exercise the real Responses and Anthropic conversion paths at the external boundary.
  await page.route("**/pipe", async (route) => {
    const req = route.request();
    const target = req.headers()["x-anvil-target"] || "";
    if (target.startsWith(cfg.base.replace(/\/v1$/, ""))) return route.continue();
    assert.ok(target === "https://api.openai.com/v1/responses" || target === "https://api.anthropic.com/v1/messages", target);
    const body = req.postDataJSON(); requests.push({ url: target, body });
    const reply = replies.shift(); assert.ok(reply, "no unexpected cloud retry");
    const content = reply.content;
    const sse = (event) => `data: ${JSON.stringify(event)}\n\n`;
    const response = target.includes("openai.com") ? sse({ type: "response.output_text.delta", delta: content }) + sse({ type: "response.completed", response: { output_text: content, output: [] } }) : sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content } }) + sse({ type: "message_stop" });
    return route.fulfill({ headers: { "content-type": "text/event-stream", "access-control-allow-origin": "http://127.0.0.1:8190", "access-control-expose-headers": "x-anvil-lan", "x-anvil-lan": "1" }, body: response });
  });
  for (const provider of ["openai", "anthropic"]) {
    r = await run(provider === "openai" ? "gpt-5-fixture" : "claude-fixture", "text", "Lies a.txt", [text("read_file", { path: "a.txt" }), done], { provider });
    assert.equal(r.tools[0].name, "read_file"); assert.equal(requests[0].body.tools, undefined); assert.match(JSON.stringify(requests[0].body), /Tool transport for this request/);
  }
  console.log("PASS text tools reach both Cloud protocol converters without native schemas");

  const settings = await page.evaluate(async (cfg) => {
    const { toolTargetKey } = await import("/src/lib/tool-compat.ts");
    const { exportSettingsPack } = await import("/src/lib/settings-io.ts");
    const s = window.__anvilIde;
    s.setState({ llmProvider: "ollama", llmModel: "profile", llmBaseUrl: cfg.base, llmProfiles: [], llmToolModes: {} });
    s.getState().setLlmToolMode("text"); s.getState().saveLlmProfile("LAN Text");
    const profile = s.getState().llmProfiles[0];
    s.getState().setLlmBaseUrl("http://192.168.1.99:11434/v1");
    const other = s.getState().llmToolModes[toolTargetKey("ollama", "profile", s.getState().llmBaseUrl)];
    s.getState().setLlmToolMode("compact"); s.getState().applyLlmProfile(profile.id);
    return { other, profile, restored: s.getState().llmToolModes[toolTargetKey("ollama", "profile", s.getState().llmBaseUrl)], pack: exportSettingsPack() };
  }, cfg);
  assert.equal(settings.other, undefined); assert.equal(settings.profile.toolMode, "text"); assert.equal(settings.restored, "text"); assert.match(JSON.stringify(settings.pack), /llmToolModes/);
  await page.evaluate(() => window.__anvilIde.getState().setSettingsOpen(true));
  const modeRow = page.getByRole("group", { name: "Tool-Kompatibilität" });
  await modeRow.getByRole("button", { name: "Kompakt", exact: true }).click();
  assert.equal(await modeRow.getByRole("button", { name: "Kompakt", exact: true }).getAttribute("aria-pressed"), "true");
  await page.evaluate(() => window.__anvilIde.getState().setLlmBaseUrl("http://"));
  await modeRow.getByRole("button", { name: "Bisherig", exact: true }).waitFor();
  await page.evaluate((cfg) => window.__anvilIde.getState().setLlmBaseUrl(cfg.base), cfg);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  assert.equal(await page.evaluate(async (cfg) => {
    const { toolTargetKey } = await import("/src/lib/tool-compat.ts");
    return window.__anvilIde.getState().llmToolModes[toolTargetKey("ollama", "profile", cfg.base)];
  }, cfg), "compact");

  const canceled = await page.evaluate(async () => {
    const { runAgentLoop } = await import("/src/lib/agent-core.ts");
    const { beginAgent, abortAgent } = await import("/src/lib/abort.ts");
    beginAgent(); let writes = 0; let stopped = false;
    try {
      await runAgentLoop({ messages: [{ role: "user", content: "Schreibe a.txt" }], files: [], runLoop: false, graphLoop: false }, async () => {
        abortAgent("Fixture Stop");
        return { role: "assistant", content: '{"name":"write_file","arguments":{"path":"a.txt","content":"late"}}', toolContract: { transport: "text", names: ["write_file"] } };
      }, { onWorkspace: () => { writes++; } });
    } catch { stopped = true; }
    beginAgent(); return { stopped, writes };
  });
  assert.deepEqual(canceled, { stopped: true, writes: 0 });
  assert.deepEqual(errors, []);
  console.log("PASS settings UI, incomplete URLs, profile/export/reload persistence and Stop before execution");
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
  await Promise.all([new Promise((resolve) => upstream.close(resolve)), new Promise((resolve) => pipe.close(resolve))]);
}
