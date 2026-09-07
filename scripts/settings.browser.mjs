import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const production = process.argv.includes("--production");
const base = production ? "http://127.0.0.1:8081" : "http://127.0.0.1:8080";
const kind = production ? "production" : "desktop";
const root = "/workspace/screenshots/anvil-settings";
await mkdir(root, { recursive: true });
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* startup */ }
  if (i === 79) throw new Error("App did not start");
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    // No provider, compiler or model download is contacted by this desktop fixture.
    requests.push(`${route.request().resourceType()}:${u.pathname}`);
    if (route.request().resourceType() === "script") return route.fulfill({ contentType: "application/javascript", body: "" });
    if (route.request().resourceType() === "stylesheet") return route.fulfill({ contentType: "text/css", body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"data":[],"models":[]}' });
  });
  await page.addInitScript(() => {
    localStorage.setItem("anvil-ide", JSON.stringify({ state: { setupDone: true, autoUpdate: false,
      llmProvider: "openai", llmAuthMode: "key", llmModel: "gpt-4o", llmApiKey: "", llmContext: 8192, llmContextAuto: false,
      files: { "README.md": "Settings fixture" }, activePath: "", openPaths: [], mcpServers: [], autoRunAgent: false,
    }, version: 0 }));
    localStorage.setItem("anvil-brain", JSON.stringify({ state: { on: false, autoLoad: false, autoUpdate: false }, version: 0 }));
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  // The desktop build bundles Monaco; a missing editor must not pass as a
  // successful settings render merely because the dialog itself opens.
  await page.waitForFunction(() => window.monaco?.editor.getEditors().length > 0);
  await page.evaluate(() => window.__anvilIde.getState().setSettingsOpen(true));
  const search = page.getByRole("textbox", { name: "Einstellungen durchsuchen", exact: true });
  await search.waitFor();
  await page.getByRole("button", { name: "Ins Projekt", exact: true }).waitFor();
  // The workspace schedules a compiler-health ping after its 600ms lint
  // debounce and a further 1600ms delay. Settle that independent startup
  // request before measuring searches, rather than racing a fixed timeout.
  if (!requests.includes("fetch:/v1/ping")) {
    await page.waitForResponse((r) => new URL(r.url()).pathname === "/v1/ping");
  }
  const beforeSearch = requests.length;
  await search.fill("zzznomatchxyz");
  await page.getByText("Keine passenden Einstellungen gefunden.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Lokaler Helfer", { exact: true }).isVisible(), false);
  assert.equal(await page.getByText("MCP", { exact: true }).isVisible(), false);
  await search.fill("Schriftgröße");
  const font = page.getByRole("group", { name: "Schriftgröße", exact: true });
  await font.waitFor();
  assert.equal(await page.getByText("Keine passenden Einstellungen gefunden.", { exact: true }).isVisible(), false);
  assert.equal(await page.getByText("Lokaler Helfer", { exact: true }).isVisible(), false);
  await font.getByRole("button", { name: "16", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().fontSize), 16);
  assert.equal(await font.getByRole("button", { name: "16", exact: true }).getAttribute("aria-pressed"), "true");
  await page.screenshot({ path: `${root}/${kind}-search.png` });
  await search.fill("GPU warm");
  await page.getByRole("switch", { name: "GPU warm halten", exact: true }).waitFor();
  assert.equal(await page.getByText("Keine passenden Einstellungen gefunden.", { exact: true }).isVisible(), false);
  assert.equal(requests.length, beforeSearch, `Typing in search must not start server/model scans: ${requests.join(", ")}`);
  await page.getByRole("navigation", { name: "Einstellungsbereiche" }).getByRole("button", { name: "Editor", exact: true }).click();
  assert.equal(await search.inputValue(), "");
  await page.getByRole("button", { name: "Bereich zurücksetzen", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().fontSize), 13);
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().llmProvider), "openai");
  await page.evaluate(() => window.__anvilIde.getState().setLocale("en"));
  const english = page.getByRole("textbox", { name: "Search settings", exact: true });
  await english.fill("font size");
  await page.getByRole("group", { name: "Font size", exact: true }).waitFor();
  await page.evaluate(() => window.__anvilIde.getState().setLocale("de"));
  await page.getByRole("navigation", { name: "Einstellungsbereiche" }).getByRole("button", { name: "Agent", exact: true }).click();
  await page.evaluate(() => {
    const s = window.__anvilIde.getState();
    window.__anvilIde.setState({ files: { "main.py": "print(1)",
      ".anvil/harness.json": JSON.stringify({ runLoop: true, loopTries: 5, maxTools: 11, stopOn: ["keep-stop"] }),
      ".anvil/graph.json": '{"edges":[],"idea":"keep"}',
      ".anvil/board.json": JSON.stringify({ cam: { x: 123, y: 456, z: 1.7 }, nodes: [{ id: "plan", kind: "phase", phase: "plan", label: "Plan", x: 999, y: 48 }], wires: [], idea: "keep board" }),
    } });
    s.setRunLoop(false); s.setGraphLoop(false); s.setLoopTries(3);
  });
  await page.getByText("Wirksame Einstellungen im Projekt", { exact: true }).click();
  const effective = page.getByRole("table");
  assert.match(await effective.getByRole("row").filter({ hasText: "Run-Schleife" }).innerText(), /Aus.*Anvil/);
  assert.match(await effective.getByRole("row").filter({ hasText: "Versuche" }).innerText(), /5.*Projekt/);
  const beforeProject = await page.evaluate(() => window.__anvilIde.getState().files);
  await page.getByRole("button", { name: "Ins Projekt", exact: true }).click();
  const saved = await page.evaluate(() => window.__anvilIde.getState().files);
  assert.equal(saved[".anvil/board.json"], beforeProject[".anvil/board.json"]);
  assert.equal(saved[".anvil/graph.json"], beforeProject[".anvil/graph.json"]);
  assert.equal(JSON.parse(saved[".anvil/harness.json"]).maxTools, 11);
  await page.getByRole("button", { name: "Raten · Vorschlag", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__anvilIde.getState().files), saved, "Raten prepares a suggestion without writing files");
  await page.screenshot({ path: `${root}/${kind}-project.png` });
  await page.getByRole("navigation", { name: "Einstellungsbereiche" }).getByRole("button", { name: "Daten", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".settings-results")?.scrollTop === 0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importieren", exact: true }).click();
  await (await chooser).setFiles({ name: "invalid-settings.json", mimeType: "application/json", buffer: Buffer.from('{"ide":{"fontSize":19,"llmProfiles":null}}') });
  await page.waitForFunction(() => window.__anvilIde.getState().notice.includes("Ungültige Einstellung: ide.llmProfiles"));
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().fontSize), 13);
  await page.screenshot({ path: `${root}/${kind}-data.png` });
  assert.deepEqual(errors, []);
  console.log(`${production ? "PRODUCTION" : "DESKTOP"}_SETTINGS_SEARCH_RESET_PROJECT_IMPORT_OK`);
} finally {
  await browser.close();
}
