// Opt-in native acceptance test. Uses the existing Codex login for one small task.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { _electron } from "playwright";

const setupOnly = process.argv.includes("--setup-only");
if (!setupOnly) assert.equal(process.env.ANVIL_REAL_CLI_QA, "1", "Explicitly enable the real CLI acceptance test with ANVIL_REAL_CLI_QA=1");
const root = process.cwd();
const output = path.resolve("artifacts/produkt-fixes");
await mkdir(output, { recursive: true });
await mkdir(path.resolve("data"), { recursive: true });
const profile = await mkdtemp(path.resolve("data/produkt-fixes-"));
const project = path.join(profile, "projekt");
await mkdir(project);
await writeFile(path.join(project, "index.html"), `<!doctype html><html lang="de"><meta charset="utf-8"><title>Anvil Praxistest</title>
<style>body{font:22px system-ui;margin:60px;background:#141414;color:#eee}button{font:inherit;padding:12px 24px}output{display:block;margin:24px 0;font-size:48px}</style>
<h1>Anvil Praxistest</h1><p>Isoliertes Testprojekt. Keine externen Ressourcen.</p><output id="count">0</output><button id="add">Erhöhen</button>
<script>let count=0;document.querySelector('#add').onclick=()=>{document.querySelector('#count').textContent=++count};</script></html>`);
async function freePort() {
  const s = createServer();
  await new Promise(resolve => s.listen(0, "127.0.0.1", resolve));
  const p = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return p;
}
const port = await freePort();
// The desktop workspace integration uses the standard Companion endpoint.
// All filesystem operations still target only the unique fixture directory.
const companionPort = 7845;
const env = { ...process.env, ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort), ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, "packages") };
delete env.ELECTRON_RUN_AS_NODE;
const built = process.argv.includes("--built");
let server;
let app;
let page;
const errors = [];
try {
  if (built) {
    server = spawn(process.execPath, [path.join(root, ".output/server/index.mjs")], { cwd: root, windowsHide: true, env: { ...env, PORT: String(port), NITRO_PORT: String(port), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1" }, stdio: "ignore" });
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, "Built UI server starts");
  }
  app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [`--user-data-dir=${profile}`, root], env, timeout: 45000 });
  // Only the OS folder chooser is substituted; the actual preload, workspace
  // IPC, Companion, filesystem, renderer and model transport are exercised.
  await app.evaluate(({ dialog }, directory) => {
    globalThis.folderPicks = 0;
    dialog.showOpenDialog = async () => { globalThis.folderPicks++; return { canceled: false, filePaths: [directory] }; };
  }, project);
  for (let i = 0; i < 360; i++) {
    page = app.windows().find(p => p.url() === `http://127.0.0.1:${port}/`);
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  assert.ok(page, "Native Anvil UI opened");
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated(), null, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith("http://127.0.0.1:"))?.maximize());
  await page.evaluate(() => {
    const store = window.__anvilIde;
    store.setState({ autoUpdate: false, setupDone: false, companionKeep: true });
    store.getState().setLlmBaseUrl("http://127.0.0.1:1/v1");
  });
  await page.getByText("Verbindung zu Ollama konnte nicht geprüft werden.", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Eingebaut", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Custom", exact: true }).waitFor();
  assert.equal(await page.locator("details").filter({ has: page.getByText("Technische Details", { exact: true }) }).getAttribute("open"), null);
  await page.screenshot({ path: path.join(output, `${built ? "built" : "dev"}-einrichtung.png`) });
  await page.getByRole("button", { name: "Ordner vom Rechner öffnen", exact: true }).click();
  await page.waitForFunction(directory => window.__anvilIde.getState().workspaceCwd.replaceAll("\\", "/").toLowerCase() === directory.replaceAll("\\", "/").toLowerCase() && window.__anvilIde.getState().files["index.html"], project, { timeout: 45000 });
  assert.equal(await app.evaluate(() => globalThis.folderPicks), 1);
  await page.getByRole("button", { name: "Fertig, loslegen", exact: true }).click();
  await page.evaluate(() => {
    const store = window.__anvilIde;
    store.getState().setLlmProvider("codex", "abo");
    store.getState().setLlmModel("gpt-5.6-terra");
    store.getState().setLlmThinking("low");
  });
  console.log("First-run labels, friendly connection error, native workspace IPC and file loading: passed.");
  if (setupOnly) {
    await page.screenshot({ path: path.join(output, `${built ? "built" : "dev"}-arbeitsplatz.png`) });
    assert.deepEqual(errors, []);
  } else {
  const prompt = "Ergänze ausschließlich in index.html einen zweiten Button mit dem Text Zurücksetzen. Er soll den vorhandenen Zähler auf 0 setzen. Behalte Gestaltung und Erhöhen-Funktion bei. Keine Bibliotheken, Downloads oder weiteren Dateien. Führe index.html aus. Dies ist ein kleines isoliertes Testprojekt.";
  await page.locator("#anvil-chat").fill(prompt);
  await page.locator("#anvil-chat").press("Enter");
  await page.waitForFunction(() => window.__anvilIde.getState().agentBusy);
  console.log("Real Codex CLI edit/run task started.");
  await page.waitForFunction(() => !window.__anvilIde.getState().agentBusy, null, { timeout: 180000 });
  const state = await page.evaluate(() => {
    const s = window.__anvilIde.getState();
    return { file: s.files["index.html"], chat: s.chat, job: s.agentJob };
  });
  assert.match(state.file, /Zurücksetzen/);
  assert.equal(state.job, null, "The agent is neither paused nor waiting for input");
  assert.ok(state.chat.at(-1).steps.some(step => step.name === "run_file" && step.status === "ok" && step.image), "The agent successfully ran the page and Anvil retained the preview image");
  assert.doesNotMatch(JSON.stringify(state.chat), /Bilder werden über die Abo-CLI|CLI lieferte kein gültiges/);
  await page.screenshot({ path: path.join(output, `${built ? "built" : "dev"}-cli-abgeschlossen.png`) });
  const accept = page.getByRole("button", { name: "Übernehmen", exact: true });
  if (await accept.count()) await accept.first().click();
  // Run the accepted HTML through Anvil's normal UI and test the real renderer.
  await page.getByRole("button", { name: /^Ausführen/ }).first().click();
  let runPage;
  for (let i = 0; i < 100; i++) {
    runPage = app.windows().find(p => p !== page && /run/i.test(p.url()));
    if (runPage) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(runPage, "Native output window opens");
  const frame = runPage.frameLocator("iframe").first();
  await frame.getByRole("button", { name: "Erhöhen", exact: true }).click({ clickCount: 2 });
  assert.equal(await frame.locator("#count").innerText(), "2");
  await frame.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
  assert.equal(await frame.locator("#count").innerText(), "0");
  await runPage.screenshot({ path: path.join(output, `${built ? "built" : "dev"}-reset-geprueft.png`) });
  await runPage.close();
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(500);
  assert.match(await readFile(path.join(project, "index.html"), "utf8"), /Zurücksetzen/);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, `${built ? "built" : "dev"}-result.json`), JSON.stringify({ ok: true, built, project, rounds: state.chat.length, job: state.job, errors }, null, 2));
  console.log("Real CLI completion, accepted patch, native run, 0 → 2 → 0, disk save and renderer errors: passed.");
  }
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png") });
    console.log(await page.evaluate(() => { const s = window.__anvilIde?.getState(); return { notice: s?.notice, cwd: s?.workspaceCwd, files: Object.keys(s?.files ?? {}), job: s?.agentJob, text: document.body.innerText.slice(-2000) }; }));
  }
  throw error;
} finally {
  if (app) await app.close();
  if (server) server.kill();
}
