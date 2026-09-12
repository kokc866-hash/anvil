// Deterministic native regression: real built UI, IPC, disk, save and restart.
// Only folder selection and agent-produced round data are fixtures; no model call.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { _electron } from "playwright";
import { SEED_FILES } from "../src/lib/seed-files.ts";

const root = process.cwd(), output = path.resolve("artifacts/product-workflow");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.resolve("data/workflow-"));
const project = path.join(profile, "Neustart-Test");
await mkdir(project);
const socket = createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const env = { ...process.env, ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: "7845", ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, "packages") };
delete env.ELECTRON_RUN_AS_NODE;
const server = spawn(process.execPath, [path.join(root, ".output/server/index.mjs")], { cwd: root, windowsHide: true, env: { ...env, PORT: String(port), NITRO_PORT: String(port), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1" }, stdio: "ignore" });
let app, page;
const errors = [];
const before = '<!doctype html><html lang="de"><title>Neustart-Test</title><h1>Vor der Runde</h1></html>';
const after = before.replace("Vor der Runde", "Nach der Runde");
async function launch() {
  app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [`--user-data-dir=${profile}`, root], env, timeout: 45000 });
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, project);
  for (let i = 0; i < 360; i++) {
    page = app.windows().find(p => p.url() === `http://127.0.0.1:${port}/`);
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  assert.ok(page);
  page.setDefaultTimeout(30000);
  page.on("pageerror", e => errors.push(e.message));
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/"))?.maximize());
}
async function saveAll() {
  await page.keyboard.press("Control+Alt+s");
  await page.waitForFunction(() => !Object.values(window.__anvilIde.getState().dirty).some(Boolean));
}
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await launch();
  await page.evaluate(() => window.__anvilIde.setState({ setupDone: true, autoUpdate: false, autoSaveDisk: false, formatOnSave: false, companionKeep: true }));
  await page.getByRole("button", { name: "Mehr", exact: true }).first().click();
  await page.getByRole("button", { name: "Desktop-Ordner", exact: true }).click();
  await page.waitForFunction(directory => window.__anvilIde.getState().workspaceCwd.toLowerCase() === directory.toLowerCase(), project);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__anvilIde.getState().files)), []);
  await page.evaluate(content => {
    const s = window.__anvilIde.getState();
    s.writeFile("index.html", content); s.openFile("index.html");
  }, before);
  await saveAll();
  assert.equal(await readFile(path.join(project, "index.html"), "utf8"), before);
  // Simulate the clean template ghosts persisted by the old broken bootstrap.
  await page.evaluate(seeds => window.__anvilIde.setState(s => ({ files: { ...seeds, ...s.files } })), SEED_FILES);
  await page.keyboard.press("Control+Alt+s");
  await app.close(); app = undefined;
  await launch();
  await page.waitForFunction(() => window.__anvilIde.getState().diskName === "Neustart-Test");
  // Allow the asynchronous on-start disk tree read to finish before asserting.
  await page.waitForTimeout(2000);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__anvilIde.getState().files)), ["index.html"]);
  assert.deepEqual(await readdir(project), ["index.html"]);
  console.log("PASS: empty native workspace, save, full restart, folder name and exact file set.");
  await page.evaluate(({ before, after }) => {
    const store = window.__anvilIde;
    store.setState({ checkpoints: [{ id: "round", at: Date.now(), files: { "index.html": before }, dirs: [], endFiles: { "index.html": after }, endDirs: [], sealedBy: "round-answer" }], chat: [{ id: "round-answer", role: "assistant", content: "Teständerung abgeschlossen.", checkpointId: "round", harness: "Fertig · Tools 1/20", plan: [{ text: "Datei ändern", status: "ok" }], changes: [{ path: "index.html", before, after, add: 1, del: 1 }] }] });
    store.getState().writeFile("index.html", after);
  }, { before, after });
  await saveAll();
  assert.equal(await readFile(path.join(project, "index.html"), "utf8"), after);
  // Expand the actual round trail, then use both rollback buttons.
  const trail = page.getByRole("button", { name: /Spur/ }).first();
  if (await trail.count()) await trail.click();
  await page.getByRole("button", { name: "Zurück vor diese Runde", exact: true }).click();
  await page.getByRole("button", { name: "Zurück vor diese Runde", exact: true }).click();
  await page.waitForFunction(() => window.__anvilIde.getState().files['index.html'].includes('Vor der Runde') && !window.__anvilIde.getState().restoreIntent);
  assert.deepEqual(await page.evaluate(() => window.__anvilIde.getState().dirty), {});
  assert.equal(await readFile(path.join(project, "index.html"), "utf8"), before);
  assert.deepEqual(await readdir(project), ["index.html"]);
  console.log("PASS: real round rollback controls and save-all, no phantom files or conflicts.");
  await page.screenshot({ path: path.join(output, "restart-rollback.png") });
  // Real conflict: another writer changes the saved file, then Anvil attempts save.
  await writeFile(path.join(project, "index.html"), "external change");
  await page.evaluate(content => window.__anvilIde.getState().writeFile("index.html", content), after);
  await page.keyboard.press("Control+Alt+s");
  await page.waitForFunction(() => /extern geändert/.test(window.__anvilIde.getState().notice));
  assert.equal(await readFile(path.join(project, "index.html"), "utf8"), "external change");
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().dirty["index.html"]), true);
  console.log("PASS: genuine external modification rejected without overwriting data.");
  await page.screenshot({ path: path.join(output, "real-conflict.png") });
  // Restore only this fixture for clean shutdown; no user project involved.
  await writeFile(path.join(project, "index.html"), before);
  await saveAll();
  await page.evaluate(() => {
    const store = window.__anvilIde;
    store.setState({ chat: [{ id: "stop", role: "assistant", content: '{"action":"set_plan",', harness: "Arbeit · Tools 2/20" }] });
    store.getState().failRunningSteps();
  });
  await page.getByText("Gestoppt", { exact: true }).first().waitFor();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().chat.at(-1).content), "Gestoppt");
  await page.evaluate(() => {
    const store = window.__anvilIde;
    store.setState({ chat: [{ id: "unfinished", role: "assistant", content: "Datei erstellt. Die Funktionsprüfung ist noch offen.", harness: "Arbeit · Run 1/1 · Tools 3/64", plan: [{ text: "Datei schreiben", status: "ok" }, { text: "Funktionsprüfung per Snapshot", status: "todo" }] }] });
    store.getState().finalizeAssistant("Datei erstellt.");
  });
  await page.getByText(/Beendet · 1 Schritt offen/).first().waitFor();
  await page.screenshot({ path: path.join(output, "unfinished-check.png") });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, project, profile, errors, modelCalls: 0, checks: ["restart", "folder-name", "no-seed-files", "round-rollback", "save-all", "real-conflict-protected", "stop-content", "honest-completion"] }, null, 2));
  console.log("PASS: visible Stop and honest unfinished-check labels; no renderer errors.");
} finally {
  await app?.close().catch(() => {});
  server.kill();
}
