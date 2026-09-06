import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron } from "playwright";

const folder = await mkdtemp(path.join(tmpdir(), "anvil-ipc-"));
const server = createServer((_req, res) => res.end("<!doctype html><title>Anvil IPC QA</title>"));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const userData = path.join(folder, "user-data");
const origin = `http://127.0.0.1:${server.address().port}/`;
const fixtureKey = "anvil-fixture-secret-do-not-use";
let electron;
async function launch() {
  electron = await _electron.launch({
    args: [path.resolve("fixtures/electron-boot.mjs")],
    env: { ...process.env, ANVIL_PORT: String(server.address().port), ANVIL_QA_USER_DATA: userData, ANVIL_HOME: folder },
    timeout: 45_000,
  });
  let page;
  for (let attempt = 0; attempt < 360; attempt++) {
    page = electron.windows().find((window) => window.url() === origin);
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  assert.ok(page, "production Anvil window must load the fixture origin");
  await page.waitForFunction(() => Boolean(window.anvilNative?.secretsLoad()));
  return page;
}
try {
  const page = await launch();
  const saved = await page.evaluate(async (key) => {
    const api = window.anvilNative;
    const first = api.secretsLoad();
    const saved = await api.secretsSave({ llmApiKey: key, keys: { openai: key } }, { migrate: true });
    const cli = await api.cliProbe({ id: "fixture", kind: "invalid-kind" });
    return { first, saved, cli };
  }, fixtureKey);
  assert.equal(saved.first.ok, true, "production window must be allowed to load credentials");
  assert.equal(saved.saved.persistent, true, "release gate requires real OS encryption");
  assert.equal(saved.saved.browserMigrated, true);
  assert.equal(saved.saved.secrets.llmApiKey, fixtureKey);
  assert.match(saved.cli.error, /Ungültige CLI-Anfrage/, "CLI must reach validation after the origin guard");
  const capture = await page.evaluate(() => window.anvilNative.canvasCapture({ x: 0, y: 0, width: 320, height: 160 }));
  assert.match(capture, /^data:image\/png;base64,/, "real Electron must capture the output surface");
  const invalidCapture = await page.evaluate(() => window.anvilNative.canvasCapture({ x: 0, y: 0, width: -1, height: 20 }).then(() => "allowed", error => error.message));
  assert.match(invalidCapture, /Aufnahmebereich/);
  const encrypted = await readFile(path.join(userData, "secrets.enc"));
  assert.equal(encrypted.includes(Buffer.from(fixtureKey)), false);
  await page.evaluate(() => {
    window.__qaAllowClose = false;
    window.__qaCloseRequests = 0;
    window.anvilNative.onBeforeClose(async () => {
      window.__qaCloseRequests++;
      return window.__qaAllowClose;
    });
  });
  const closeAllowed = await electron.evaluate(({ app, ipcMain }) => new Promise((resolve) => {
    ipcMain.once("editor-close-result", (_event, _ticket, allowed) => resolve(allowed));
    app.quit();
  }));
  assert.equal(closeAllowed, false, "main process must receive the cancellation before a retry");
  await page.waitForFunction(() => window.__qaCloseRequests === 1);
  assert.ok(electron.windows().includes(page), "canceling the save prompt must keep the editor open");
  await page.evaluate(() => { window.__qaAllowClose = true; });
  await electron.close();
  electron = null;

  const restarted = await launch();
  const restored = await restarted.evaluate(() => window.anvilNative.secretsLoad());
  assert.equal(restored.secrets.keys.openai, fixtureKey, "keys must survive a complete process restart");
  assert.equal(restored.browserMigrated, true);
  assert.equal(restored.persistent, true);
  await electron.evaluate(async ({ BrowserWindow }, preload) => {
    const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
    await window.loadURL("data:text/html,<title>Untrusted</title>");
  }, path.resolve("electron/preload.cjs"));
  const untrusted = electron.windows().find((window) => window.url().startsWith("data:"));
  assert.ok(untrusted);
  const rejected = await untrusted.evaluate(async () => ({
    capture: await window.anvilNative.canvasCapture({ x: 0, y: 0, width: 20, height: 20 }).then(() => "allowed", error => error.message),
    loaded: window.anvilNative.secretsLoad(),
    cli: await window.anvilNative.cliProbe({ id: "fixture", kind: "codex" }),
    save: await window.anvilNative.secretsSave({ llmApiKey: "overwrite" }).then(() => "allowed", (error) => error.message),
  }));
  assert.equal(rejected.loaded, null);
  assert.match(rejected.capture, /Hauptfenster/);
  assert.match(rejected.cli.error, /Hauptfenster/);
  assert.match(rejected.save, /nicht erlaubt/);
  assert.deepEqual(await readFile(path.join(userData, "secrets.enc")), encrypted);
  console.log("ELECTRON_PRIVATE_IPC_ENCRYPTED_RESTART_AND_ORIGIN_OK");
  // The extra window above must not prevent a complete application quit.
} finally {
  await electron?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
