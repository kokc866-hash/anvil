// Actual built desktop UI and disk; isolated QA profile/project, no model calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { _electron } from "playwright";
const root = process.cwd(),
  output = path.resolve("artifacts/extensions-product");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.resolve("data/extensions-qa-")),
  project = path.join(profile, "Produkt-Test");
await mkdir(project);
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const env = {
  ...process.env,
  ANVIL_PORT: String(port),
  ANVIL_COMPANION_PORT: "7845",
  ANVIL_QA_USER_DATA: profile,
  ANVIL_HOME: path.join(profile, "packages"),
};
delete env.ELECTRON_RUN_AS_NODE;
const server = spawn(process.execPath, [path.join(root, ".output/server/index.mjs")], {
  cwd: root,
  windowsHide: true,
  env: {
    ...env,
    PORT: String(port),
    NITRO_PORT: String(port),
    HOST: "127.0.0.1",
    NITRO_HOST: "127.0.0.1",
  },
  stdio: "ignore",
});
let app, page;
const errors = [],
  checks = [];
async function launch() {
  app = await _electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [`--user-data-dir=${profile}`, path.join(root, "fixtures/electron-boot.mjs")],
    env,
    timeout: 45000,
  });
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, project);
  for (let i = 0; i < 360; i++) {
    page = app.windows().find((p) => p.url() === `http://127.0.0.1:${port}/`);
    if (page) break;
    await new Promise((r) => setTimeout(r, 125));
  }
  assert.ok(page);
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith("/"))
      ?.maximize(),
  );
}
async function saveAll() {
  await page.keyboard.press("Control+Alt+s");
  await page.waitForFunction(
    () => !Object.values(window.__anvilIde.getState().dirty).some(Boolean),
  );
}
async function side(id) {
  await page.evaluate((id) => window.__anvilIde.getState().setSidebar(id), id);
}
async function runCheck(status) {
  const activeBefore = await page.evaluate(() => window.__anvilIde.getState().activePath);
  await page.getByRole("button", { name: "Prüfung starten", exact: true }).click();
  await page.waitForFunction(
    (expected) => {
      const raw = window.__anvilIde.getState().files[".anvil/interaction-results.json"];
      if (!raw) return false;
      const r = JSON.parse(raw).results.find((r) => r.scenarioId === "web-paket-aufgaben");
      return r?.status === expected;
    },
    status,
    { timeout: 30000 },
  );
  await page
    .getByRole("button", { name: "Prüfung starten", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !Object.values(window.__anvilIde.getState().dirty).some(Boolean),
  );
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().activePath), activeBefore,
    "internal check results must not replace the open editor");
}
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  await launch();
  await page.evaluate(() =>
    window.__anvilIde.setState({
      setupDone: true,
      autoUpdate: false,
      autoSaveDisk: false,
      formatOnSave: false,
      companionKeep: true,
      locale: "de",
    }),
  );
  await page.getByRole("button", { name: "Mehr", exact: true }).first().click();
  await page.getByRole("button", { name: "Desktop-Ordner", exact: true }).click();
  await page.waitForFunction(
    (directory) =>
      window.__anvilIde.getState().workspaceCwd.toLowerCase() === directory.toLowerCase(),
    project,
  );
  await side("ext");
  await page.getByRole("button", { name: "Neues Plugin", exact: true }).click();
  await saveAll();
  assert.match(
    await readFile(path.join(project, "plugins/mein-plugin.js"), "utf8"),
    /function activate/,
  );
  await page.getByRole("button", { name: "Entfernen: mein-plugin", exact: true }).click();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await access(path.join(project, "plugins/mein-plugin.js"));
  await page.getByRole("button", { name: "Entfernen: mein-plugin", exact: true }).click();
  await page.getByRole("button", { name: "Plugin entfernen", exact: true }).click();
  await page.waitForFunction(
    () =>
      !("plugins/mein-plugin.js" in window.__anvilIde.getState().files) &&
      window.__anvilIde.getState().pathOperation === null,
  );
  await assert.rejects(() => access(path.join(project, "plugins/mein-plugin.js")));
  checks.push("create, save, cancel removal, confirm removal through actual UI");
  await page.getByRole("button", { name: "Aufgabenpakete", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Web-Aufgabenpaket ergänzen", exact: true })
    .evaluate(el => el.scrollWidth <= el.clientWidth + 1), "package button text must fit");
  await page.getByRole("button", { name: "Web-Aufgabenpaket ergänzen", exact: true }).click();
  await page.getByText("Paket ergänzt und gespeichert.", { exact: false }).waitFor();
  const html = await readFile(path.join(project, "web-paket/index.html"), "utf8");
  assert.match(html, /task-input/);
  await access(path.join(project, ".anvil/skills/kleine-webanwendung/references/abnahme.md"));
  assert.equal(
    JSON.parse(await readFile(path.join(project, ".anvil/interaction-checks.json"), "utf8"))
      .scenarios[0].id,
    "web-paket-aufgaben",
  );
  await page.screenshot({ path: path.join(output, "aufgabenpaket.png") });
  checks.push(
    "offline Web package includes source, skill, reference and stored interaction scenario",
  );
  await side("tests");
  await page.getByLabel("Gespeicherte Bedienprüfung").selectOption("web-paket-aufgaben");
  await runCheck("passed");
  await page.getByText("Bestanden", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "bedienpruefung.png") });
  await page.evaluate(
    (source) =>
      window.__anvilIde
        .getState()
        .writeFile("web-paket/index.html", source.replace("if(!text)return;", "")),
    html,
  );
  await saveAll();
  await page.getByText("Veraltet — Projekt oder Prüfung verändert", { exact: true }).waitFor();
  await runCheck("failed");
  await page.getByText("Fehlgeschlagen", { exact: true }).waitFor();
  await page.evaluate(
    (source) => window.__anvilIde.getState().writeFile("web-paket/index.html", source),
    html,
  );
  await saveAll();
  await runCheck("passed");
  checks.push(
    "saved scenario passes, deliberate empty-input defect fails, corrected source passes; stale result visible",
  );
  await side("ext");
  await page.getByRole("button", { name: "API", exact: true }).click();
  await page.getByText("Externe Agenten · ACP-Vorschau", { exact: true }).click();
  await page.getByLabel("ACP-Programmpfad").fill(process.execPath);
  await page
    .getByLabel("ACP-Argumente")
    .fill(JSON.stringify([path.join(root, "fixtures/acp-agent.mjs"), "normal"]));
  await page.getByRole("button", { name: "ACP-Verbindung prüfen", exact: true }).click();
  await page
    .getByText("ACP-Initialisierung erfolgreich: anvil-local-acp-fixture", { exact: false })
    .waitFor();
  checks.push("ACP actual native initialization with local protocol fixture; no model inference");
  await saveAll();
  await app.close();
  app = null;
  page = null;
  await launch();
  await page.waitForFunction(
    (directory) =>
      window.__anvilIde.getState().workspaceCwd.toLowerCase() === directory.toLowerCase(),
    project,
  );
  await side("ext");
  assert.equal(
    await page.getByRole("button", { name: "Entfernen: mein-plugin", exact: true }).count(),
    0,
  );
  await assert.rejects(() => access(path.join(project, "plugins/mein-plugin.js")));
  await side("tests");
  await page.getByLabel("Gespeicherte Bedienprüfung").selectOption("web-paket-aufgaben");
  await page.getByText("Bestanden", { exact: true }).waitFor();
  checks.push("full desktop restart preserves removal, package, scenario and result");
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify({ ok: true, checks, errors, profile, project, modelCalls: 0 }, null, 2),
  );
  console.log(checks.map((c) => "PASS: " + c).join("\n"));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app?.close().catch(() => {});
  server.kill();
}
