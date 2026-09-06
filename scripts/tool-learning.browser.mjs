/** Actual ChatPane, persisted learning controls and optional minified production runtime. No model API. */
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createServer, preview } from "vite";
import { chromium } from "playwright";
import { createLlmPipeServer } from "../electron/llm-pipe.mjs";

const production = process.argv.includes("--production");
let replies = [];
const requests = [];
const upstream = httpServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"models":[],"data":[]}'); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  requests.push(JSON.parse(raw));
  const reply = replies.shift();
  if (!reply) { res.writeHead(500); res.end("Unexpected extra model request"); return; }
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  res.end(JSON.stringify({ message: { role: "assistant", ...reply }, done: true, done_reason: "stop" }) + "\n");
});
const pipe = createLlmPipeServer("learning-fixture");
let server;
let browser;
try {
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  pipe.listen(0, "127.0.0.1"); await once(pipe, "listening");
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const cfg = { base: origin + "/v1", key: JSON.stringify(["ollama", origin, "ollama-chat", "learning-fixture"]), pipe: { port: pipe.address().port, token: "learning-fixture" } };
  server = production ? await preview({ preview: { host: "127.0.0.1", port: 8191, strictPort: true } })
    : await createServer({ server: { host: "127.0.0.1", port: 8191, strictPort: true }, cacheDir: "node_modules/.vite-tool-learning" });
  if (!production) await server.listen();
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((cfg) => {
    if (!localStorage.getItem("anvil-ide")) {
      localStorage.setItem("anvil-ide", JSON.stringify({ state: {
        setupDone: true, autoUpdate: false, llmProvider: "ollama", llmBaseUrl: cfg.base, llmModel: "learning-fixture", llmAuthMode: "key",
        llmToolModes: { [cfg.key]: "text" }, llmContext: 8192, llmContextAuto: false, llmThinking: "low",
        agentMode: "agent", activeSurfaceId: "anvil", files: { "README.md": "Fixture documentation" }, openPaths: [], activePath: null,
        autoRunAgent: false, runLoop: false, graphLoop: false, testLoop: false, engineLoop: false, attached: [], mcpServers: [],
      }, version: 0 }));
      localStorage.setItem("anvil-brain", JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
    }
    window.anvilNative = { llmPipe: async () => cfg.pipe, companionEnsure: async () => ({ ok: true }), companionRelease: async () => ({ ok: true }) };
  }, cfg);
  await page.goto("http://127.0.0.1:8191", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  const learning = () => page.evaluate((key) => window.__anvilIde.getState().llmToolLearning[key], cfg.key);
  const settings = (open) => page.evaluate((open) => window.__anvilIde.getState().setSettingsOpen(open), open);
  const row = page.getByRole("group", { name: "Gelernte Tool-Aufrufe", exact: true });
  async function send(responses, task = "Lies README.md und erkläre den Inhalt kurz.") {
    await settings(false); replies = [...responses]; const start = requests.length;
    await page.evaluate(() => window.__anvilIde.setState({ chat: [], attached: [] }));
    await page.locator("#anvil-chat").fill(task); await page.locator("#anvil-chat").press("Enter");
    await page.waitForFunction(() => !window.__anvilIde.getState().agentBusy && window.__anvilIde.getState().chat.some((m) => m.role === "assistant" && m.content), undefined, { timeout: 20_000 });
    if (replies.length) console.error("Incomplete fixture", JSON.stringify(await page.evaluate(() => { const s = window.__anvilIde.getState(); return { log: JSON.parse(localStorage.getItem("anvil-applog") || "[]").slice(-10), model: s.llmModel, modes: s.llmToolModes, learning: s.llmToolLearning, chat: s.chat.map((m) => ({ role: m.role, content: m.content })) }; })), JSON.stringify(requests.slice(start).map((r) => ({ model: r.model, tools: r.tools?.length, messages: r.messages?.slice(-2) }))));
    assert.equal(replies.length, 0, "expected fixture replies consumed");
    assert.equal(requests.length - start, responses.length, "no learning probes or retries");
  }
  const read = { content: '{"tool":"read","file":"README.md"}' };
  const save = (text) => ({ content: JSON.stringify({ tool: "save", file: "learned.txt", text }) });
  const done = { content: "Fertig. Die Fixture-Datei wurde gelesen." };
  for (let i = 1; i <= 2; i++) { await send([read, done]); assert.equal((await learning()).rules[0].successes, i); }
  assert.equal((await learning()).rules[0].status, "learned");
  await settings(true);
  await row.getByText("Bewährt", { exact: true }).waitFor();
  await row.getByRole("button", { name: "Aus", exact: true }).click();
  await send([read]);
  assert.equal((await learning()).rules[0].seen, 2);
  await settings(true);
  await row.getByRole("button", { name: "Beobachten", exact: true }).click();
  await send([save("private-canary")], "Speichere learned.txt.");
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files["learned.txt"]), undefined);
  assert.equal((await learning()).rules.find((r) => r.shape.name === "save").successes, 0);
  await settings(true);
  await row.getByRole("button", { name: "Lernen & anwenden", exact: true }).click();
  await send([save("private-canary")], "Speichere learned.txt.");
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files["learned.txt"]), undefined);
  await page.getByText(/Tool-Zuordnung für „save“/).waitFor();
  await settings(true);
  const ruleId = (await learning()).rules.find((r) => r.shape.name === "save").id;
  const card = row.locator(`[data-tool-rule="${ruleId}"]`);
  await card.getByText("Bestätigung nötig", { exact: true }).waitFor();
  await card.getByRole("button", { name: "Zuordnung bestätigen", exact: true }).click();
  await send([save("saved by the confirmed mapping"), done], "Speichere learned.txt.");
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files["learned.txt"]), "saved by the confirmed mapping");
  assert.ok(!JSON.stringify(await learning()).includes("private-canary"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  assert.equal((await learning()).rules.find((r) => r.shape.name === "save").status, "manual");
  await settings(true);
  await card.getByText("Bestätigt", { exact: true }).waitFor();
  console.log("PASS actual chat learns across jobs; Off/Observe/manual confirmation and reload persist without extra requests");

  if (process.env.ANVIL_QA_SCREENSHOTS) {
    await mkdir(process.env.ANVIL_QA_SCREENSHOTS, { recursive: true });
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(process.env.ANVIL_QA_SCREENSHOTS, `tool-learning-${production ? "production" : "dev"}.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await row.getByRole("button", { name: "Lernen & anwenden", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "learning controls fit mobile width");
    await page.screenshot({ path: path.join(process.env.ANVIL_QA_SCREENSHOTS, `tool-learning-${production ? "production" : "dev"}-mobile.png`) });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await card.getByRole("button", { name: "Sperren", exact: true }).click();
  await send([save("must not execute")], "Speichere learned.txt.");
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files["learned.txt"]), "saved by the confirmed mapping");
  await settings(true);
  await card.getByRole("button", { name: "Löschen", exact: true }).click();
  assert.equal((await learning()).rules.some((r) => r.id === ruleId), false);
  await page.evaluate(() => window.__anvilIde.getState().setLlmModel("another-model"));
  await row.getByText(/Noch keine abweichenden Aufrufe/).waitFor();
  await page.evaluate(() => window.__anvilIde.getState().setLlmModel("learning-fixture"));
  await row.getByText("Bewährt", { exact: true }).waitFor();
  await page.evaluate(() => window.__anvilIde.getState().setLlmBaseUrl("http://192.168.1.99:11434/v1"));
  await row.getByText(/Noch keine abweichenden Aufrufe/).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS ${production ? "production" : "dev"} settings: disable, delete, per-model/per-server isolation, clean render`);
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close();
  if (production) server?.httpServer.close(); else await server?.close();
  await Promise.all([new Promise((resolve) => upstream.close(resolve)), new Promise((resolve) => pipe.close(resolve))]);
}
