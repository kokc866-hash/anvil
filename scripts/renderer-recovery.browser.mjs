// Real built UI and actual main/preload. Only the native dialog answer is controlled.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { _electron } from "playwright";

const output = path.resolve("artifacts/renderer-recovery"); await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, "profile-"));
const socket = createServer(); await new Promise(r => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port; await new Promise(r => socket.close(r));
const url = `http://127.0.0.1:${port}/`;
const env = { ...process.env, ANVIL_PORT: String(port), ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, "packages") };
delete env.ELECTRON_RUN_AS_NODE;
const server = spawn(process.execPath, [path.resolve(".output/server/index.mjs")], {
  windowsHide: true, stdio: "ignore", env: { ...env, PORT: String(port), NITRO_PORT: String(port), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1" },
});
let app, page;
let watcherDirectory;
const watchdog = setTimeout(() => { console.error("Renderer recovery test timed out"); app?.process()?.kill(); server.kill(); process.exitCode = 1; }, 120000);
try {
  for (let n = 0; n < 120; n++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  app = await _electron.launch({ args: [path.resolve("fixtures/electron-boot.mjs")], env, timeout: 45000 });
  for (let n = 0; n < 360; n++) { page = app.windows().find(p => p.url() === url); if (page) break; await new Promise(r => setTimeout(r, 125)); }
  assert.ok(page); await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  if (process.platform === "win32") {
    for (let n = 0; n < 120; n++) {
      const runs = await readdir(path.join(profile, "waechter")).catch(() => []);
      watcherDirectory = runs[0] && path.join(profile, "waechter", runs[0]);
      const summary = watcherDirectory && await readFile(path.join(watcherDirectory, "summary.json"), "utf8").then(JSON.parse).catch(() => null);
      if (summary?.samples > 0) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const summary = JSON.parse(await readFile(path.join(watcherDirectory, "summary.json"), "utf8"));
    assert(summary.samples > 0 && !summary.ended, "external watcher must be running");
  }
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.evaluate(() => {
    const s = window.__anvilIde;
    s.setState({ autoUpdate: false, setupDone: true, files: { "recovery.txt": "Saved before crash" }, dirty: {}, workspaceCwd: "", agentBusy: false });
  });
  await page.waitForFunction(() => window.__anvilIde.getState().files["recovery.txt"] === "Saved before crash");
  const retention = await page.evaluate(async () => {
    const store = window.__anvilIde;
    store.getState().startAssistant();
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(512, 512);
    for (let i = 0; i < pixels.data.length; i += 65536) crypto.getRandomValues(pixels.data.subarray(i, i + 65536));
    ctx.putImageData(pixels, 0, 0);
    let generated = 0;
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgb(${i},0,0)`; ctx.fillRect(0, 0, 1, 1);
      const image = canvas.toDataURL(); generated += image.length;
      store.getState().addAgentStep({ name: "run_file", status: "ok", detail: `Preview ${i}`, image });
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
    }
    const steps = store.getState().chat.at(-1).steps;
    return { generated, steps: steps.length, images: steps.filter(s => s.image).length, bytes: steps.reduce((n, s) => n + (s.image?.length || 0), 0) };
  });
  assert.equal(retention.steps, 120); assert.ok(retention.images <= 8);
  assert.ok(retention.bytes <= 8 * 1024 * 1024); assert.ok(retention.generated > 100 * 1024 * 1024);
  await page.screenshot({ path: path.join(output, "longrun.png") });
  assert.deepEqual(errors, []);
  // Persist via the application's own save path before intentionally killing the renderer.
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => window.__anvilIde.getState().notice === "Gespeichert");
  await app.evaluate(({ dialog }) => {
    globalThis.__recoveryDialogs = [];
    dialog.showMessageBox = async (_w, options) => { globalThis.__recoveryDialogs.push(options); return { response: 0 }; };
  });
  await page.evaluate(() => window.__anvilIde.setState({ agentBusy: true }));
  const crashed = page.waitForEvent("crash");
  await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
    const contents = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/"))?.webContents;
    contents.once("did-finish-load", resolve);
    contents.forcefullyCrashRenderer();
  }));
  await crashed;
  // Playwright keeps the old Page marked as crashed. Inspect the restored real
  // WebContents through Electron instead of pretending this was a normal reload.
  let restored;
  for (let n = 0; n < 180; n++) {
    restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/"))?.webContents.executeJavaScript(`(() => {
      const store = window.__anvilIde;
      return store?.persist.hasHydrated() ? { file: store.getState().files['recovery.txt'], busy: store.getState().agentBusy, text: document.body.innerText.length, steps: store.getState().chat.at(-1)?.steps?.length } : null;
    })()`)).catch(() => null);
    if (restored?.file === "Saved before crash") break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(restored?.file, "Saved before crash");
  assert.equal(restored.busy, false);
  assert.equal(restored.steps, 120);
  assert.ok(restored.text > 100);
  const dialogs = await app.evaluate(() => globalThis.__recoveryDialogs);
  assert.equal(dialogs.length, 1); assert.match(dialogs[0].detail, /nicht automatisch wiederholt/);
  assert.match(await readFile(path.join(profile, "anvil-desktop.log"), "utf8"), /renderer-gone.*reason/);
  if (watcherDirectory) {
    assert.match(await readFile(path.join(watcherDirectory, "events.jsonl"), "utf8"), /renderer-gone/);
    let heartbeat;
    for (let n = 0; n < 120; n++) {
      heartbeat = await readFile(path.join(watcherDirectory, "main.json"), "utf8").then(JSON.parse).catch(() => null);
      if (heartbeat?.renderer?.heapUsedBytes > 0 && heartbeat.processes.some(p => p.type === "Tab")) break;
      await new Promise(r => setTimeout(r, 250));
    }
    assert(heartbeat.processes.some(p => p.type === "Tab"));
    assert(heartbeat.renderer?.heapUsedBytes > 0);
    console.log("EXTERNAL_WATCHER_AND_RENDERER_TELEMETRY_OK");
  }
  const capture = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/"))?.webContents.capturePage()).toDataURL());
  await writeFile(path.join(output, "restored.png"), Buffer.from(capture.split(",")[1], "base64"));
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, retention, checks: ["120 real screenshot steps with bounded image retention", "real renderer crash", "native recovery prompt", "saved project and steps restored", "agent stopped", "visible UI", "crash diagnostic"] }, null, 2));
  console.log("RENDERER_CRASH_RECOVERY_OK");
} finally {
  clearTimeout(watchdog);
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  if (watcherDirectory) await writeFile(path.join(watcherDirectory, "stop"), "QA finished");
  server.kill();
}
