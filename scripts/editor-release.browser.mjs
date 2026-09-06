/** Production editor integration, with all external model endpoints blocked. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:8194";
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env: { ...process.env, PORT: "8194", HOST: "127.0.0.1", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "", browser;
server.stdout.on("data", (s) => { log = (log + s).slice(-8000); });
server.stderr.on("data", (s) => { log = (log + s).slice(-8000); });
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try { ready = (await fetch(origin)).ok; } catch { /* booting */ }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, log);
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    if (!localStorage.getItem("anvil-ide")) {
      localStorage.setItem("anvil-ide", JSON.stringify({ state: { setupDone: true, autoUpdate: false, autoSaveDisk: false, suggestOn: false, liveRun: false }, version: 0 }));
      localStorage.setItem("anvil-brain", JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
    }
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(() => {
    const st = window.__anvilIde;
    st.setState({ workspaceCwd: "", autoSaveDisk: false, suggestOn: false, liveRun: false, previewOpen: false });
    st.getState().applyFiles({ "editor.css": "body{color:red;background:blue}", "check.ts": 'export const value: number = "wrong";' });
    st.getState().openFile("editor.css");
    window.editor = () => window.monaco?.editor.getEditors().find((e) => e.getModel()?.uri.path === "/" + st.getState().activePath);
  });
  await page.waitForFunction(() => window.editor());
  await page.evaluate(() => window.editor().getAction("anvil.format").run());
  await page.waitForFunction(() => window.__anvilIde.getState().files["editor.css"].includes("color: red;"));
  await page.evaluate(() => {
    const s = window.__anvilIde.getState();
    s.patchFiles({ "editor.css": "body { color: blue; }" });
    s.rejectDiff("editor.css");
    s.openFile("check.ts");
  });
  await page.waitForFunction(() => window.editor()?.getValue().includes('"wrong"'));
  await page.waitForFunction(() => window.__anvilIde.getState().compileProblems.some((p) => p.path === "check.ts" && p.source === "tsc"), undefined, { timeout: 30000 });
  await page.evaluate(() => {
    const st = window.__anvilIde;
    st.getState().applyFiles({ "check.ts": "export const value = 42;" });
    st.getState().openFile("check.ts");
  });
  await page.waitForFunction(() => window.editor()?.getValue() === "export const value = 42;");
  await page.evaluate(() => window.editor().trigger("regression", "undo"));
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files["check.ts"]), "export const value = 42;");
  await page.waitForFunction(() => !window.__anvilIde.getState().compileProblems.some((p) => p.path === "check.ts"));
  await mkdir("/workspace/screenshots", { recursive: true });
  await page.screenshot({ path: "/workspace/screenshots/anvil-editor-production.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Arbeitsbereich" }).waitFor();
  await page.getByRole("navigation", { name: "Arbeitsbereich" }).getByRole("button", { name: "Dateien", exact: true }).click();
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await page.waitForFunction(() => window.editor()?.getValue() === "export const value = 42;");
  await page.screenshot({ path: "/workspace/screenshots/anvil-editor-production-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ productionEditor: true, localFormat: true, compilerWorker: true, workspaceUndoIsolated: true, uncaughtErrors: errors }));
} catch (error) { console.error(error, log); process.exitCode = 1; }
finally { await browser?.close(); server.kill("SIGTERM"); }
