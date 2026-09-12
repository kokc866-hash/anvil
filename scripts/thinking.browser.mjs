import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { _electron } from "playwright";

const root = process.cwd();
const output = path.resolve("artifacts/thinking-qa");
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(tmpdir(), "anvil-thinking-qa-"));
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const port = await freePort();
const env = { ...process.env, ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(await freePort()), ANVIL_QA_USER_DATA: userData, ANVIL_HOME: path.join(userData, "packages") };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.ANVIL_ELECTRON_PATH || path.join(root, "node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron");
const app = await _electron.launch({ executablePath, args: [root], env, timeout: 45000 });
try {
  // The real renderer/preload IPC path ends at a fixture, never at a paid model.
  await app.evaluate(({ ipcMain }) => {
    globalThis.thinkingRequests = [];
    ipcMain.removeHandler("cli-run");
    ipcMain.handle("cli-run", (_event, request) => {
      globalThis.thinkingRequests.push(request);
      return { ok: true, value: '{"content":"Thinking fixture OK","tool_calls":[]}' };
    });
    ipcMain.removeHandler("cli-probe");
    ipcMain.handle("cli-probe", (_event, request) => ({ ok: true, value: { kind: request.kind, installed: true, authenticated: true, version: "test fixture" } }));
  });
  let page;
  for (let i = 0; i < 480; i++) {
    page = app.windows().find(p => p.url() === `http://127.0.0.1:${port}/`);
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  assert.ok(page, "Anvil UI opened");
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && url.port === String(port) || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"data":[],"models":[]}' });
  });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated(), null, { timeout: 45000 });
  await page.evaluate(() => {
    const store = window.__anvilIde;
    store.setState({ setupDone: true, autoUpdate: false, autoRunAgent: false, settingsOpen: true, llmTemperature: 0.7, llmMaxOut: 4096 });
    store.getState().setLlmProvider("codex", "abo");
    store.getState().setLlmModel("gpt-5.6-terra");
    store.getState().setLlmTemperature(0.7);
    store.getState().setLlmMaxOut(4096);
  });
  await page.getByRole("navigation", { name: "Einstellungsbereiche" }).getByRole("button", { name: "Agent", exact: true }).click();
  const group = page.getByRole("group", { name: "Thinking", exact: true });
  await group.getByRole("button", { name: "Max", exact: true }).click();
  assert.equal(await page.getByRole("slider", { name: "Temperatur", exact: true }).count(), 0);
  await page.getByText("Temperatur und Antwortlimit werden von der CLI gesteuert.", { exact: true }).waitFor();
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "codex-thinking.png") });
  const result = await page.evaluate(async () => {
    const { chatWithProvider } = await import("/src/lib/agent-client.ts");
    const { beginAgent } = await import("/src/lib/abort.ts");
    beginAgent();
    const s = window.__anvilIde.getState();
    const before = { temp: s.llmTemperature, out: s.llmMaxOut, thinking: s.llmThinking };
    await chatWithProvider({ provider: s.llmProvider, model: s.llmModel, baseUrl: "", apiKey: "", thinking: s.llmThinking, context: 32768, messages: [{ role: "user", content: "Reply with fixture OK" }], files: [], maxRounds: 1, observeOnly: true });
    return before;
  });
  assert.equal(result.thinking, "max");
  const requests = await app.evaluate(() => globalThis.thinkingRequests);
  assert.ok(requests.length >= 1);
  assert.ok(requests.every(request => request.thinking === "max" && request.kind === "codex"));
  await page.evaluate(() => {
    const s = window.__anvilIde.getState();
    s.setLlmProvider("anthropic", "abo"); s.setLlmModel("claude-fable-5");
  });
  await group.getByRole("button", { name: "XHigh", exact: true }).click();
  assert.equal(await group.getByRole("button", { name: "Aus", exact: true }).count(), 0);
  await page.screenshot({ path: path.join(output, "claude-thinking.png") });
  await page.evaluate(() => {
    const s = window.__anvilIde.getState();
    s.setLlmProvider("google", "key"); s.setLlmModel("gemini-2.5-flash");
  });
  await group.getByRole("button", { name: "Aus", exact: true }).click();
  assert.equal(await page.getByRole("slider", { name: "Temperatur", exact: true }).count(), 1);
  await page.evaluate(() => {
    const s = window.__anvilIde.getState();
    s.setLlmProvider("ollama", "key"); s.setLlmModel("qwen3");
  });
  assert.deepEqual(await group.getByRole("button").allTextContents(), ["Aus", "Auto", "Low", "Mid", "High"]);
  assert.deepEqual(await page.evaluate(() => ({ temp: window.__anvilIde.getState().llmTemperature, out: window.__anvilIde.getState().llmMaxOut })), { temp: result.temp, out: result.out });
  await page.evaluate(() => window.__anvilIde.getState().setLlmProvider("codex", "abo"));
  assert.equal(await group.getByRole("button", { name: "Max", exact: true }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, cli: requests.map(({ kind, model, thinking }) => ({ kind, model, thinking })), preserved: result, errors }, null, 2));
  console.log("Thinking UI, saved connection choice, unchanged local controls and renderer → preload → CLI request: passed. No model inference.");
} finally {
  await app.close();
  const cleanupPath = path.resolve(userData);
  assert.equal(path.dirname(cleanupPath), path.resolve(tmpdir()));
  assert.ok(path.basename(cleanupPath).startsWith("anvil-thinking-qa-"));
  await rm(cleanupPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
