import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const production = process.argv.includes("--production");
const base = production ? "http://127.0.0.1:8081" : "http://127.0.0.1:8080";
const folder = `artifacts/language-updates/browser/${production ? "production" : "dev"}`;
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
const errors = [], actions = [], workspaces = [], forbidden = [];
const time = Date.now();
const seed = { home: "isolated-test-packages", automatic: true, checking: false, intervalHours: 24, checkedAt: 0,
  lastAttemptAt: 0, nextCheckAt: 0, updateCount: 0, errorCount: 0, items: [], error: "" };
let stored = structuredClone(seed), scans = 0, partial = false, failure = false;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", async (route) => {
    const request = route.request(), u = new URL(request.url());
    if (u.origin === base || ["data:", "blob:"].includes(u.protocol)) return route.continue();
    if (u.pathname === "/v1/language-updates") {
      const body = request.method() === "POST" ? request.postDataJSON() : null;
      actions.push(body || { action: "read" });
      if (failure) return route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false,"error":"HTTP 503"}' });
      if (body?.action === "configure") { stored.automatic = body.automatic; stored.nextCheckAt = stored.automatic ? stored.checkedAt + 86400000 : null; }
      if (body?.action === "check" && (body.manual || stored.automatic && Date.now() >= (stored.nextCheckAt || 0))) {
        scans++;
        await new Promise((resolve) => setTimeout(resolve, 200));
        stored.items = [
          { id: "lsp:tsls", label: "TypeScript Language Server", kind: "language-server", provider: "npm", location: "anvil", installed: "6.0.0", latest: "6.0.1", checkedAt: time, status: "update", source: "https://www.npmjs.com/package/typescript-language-server", error: "" },
          { id: "python", label: "Python", kind: "runtime", provider: "python", location: "system", installed: "3.12.0", latest: "3.14.8", checkedAt: time, status: "new-series", source: "https://www.python.org/downloads/", error: "" },
          { id: "node", label: "Node.js", kind: "runtime", provider: "node", location: "system", installed: "24.19.0", latest: "24.21.0", checkedAt: time, status: partial ? "error" : "update", source: "https://nodejs.org/en/download", error: partial ? "HTTP 429" : "" },
          { id: "jdk", label: "OpenJDK 21", kind: "runtime", provider: "jdk", location: "anvil", installed: "21.0.12.1", latest: "21.0.12.1", channel: "21", checkedAt: time, status: "current", source: "https://learn.microsoft.com/en-us/java/openjdk/download", error: "" },
        ];
        stored.checkedAt = Date.now(); stored.lastAttemptAt = stored.checkedAt;
        stored.updateCount = partial ? 2 : 3; stored.errorCount = partial ? 1 : 0;
        stored.nextCheckAt = stored.automatic ? stored.checkedAt + (partial ? 3600000 : 86400000) : null;
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ...stored }) });
    }
    if (u.pathname === "/v1/workspace") workspaces.push(request.postData());
    if (/\/v1\/(lsp\/pull|install|toolchain)$/.test(u.pathname) || /ollama|api\.openai|api\/chat/.test(u.hostname + u.pathname)) forbidden.push(request.url());
    if (request.resourceType() === "script") return route.fulfill({ contentType: "application/javascript", body: "" });
    if (request.resourceType() === "stylesheet") return route.fulfill({ contentType: "text/css", body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"bins":{},"lsp":[],"toolchains":[],"data":[],"models":[]}' });
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem("anvil-ide")) localStorage.setItem("anvil-ide", JSON.stringify({ state: {
      setupDone: true, locale: "de", autoUpdate: false, companionUrl: "http://127.0.0.1:7845", settingsOpen: false,
      llmProvider: "ollama", llmModel: "qwen3.8:27b-mtp-q8_0", llmUrl: "http://model-server.invalid:11434", llmContext: 262144,
      files: { "README.md": "Isolated language update UI check." }, openPaths: [], activePath: "", mcpServers: [], autoRunAgent: false,
      workspaceCwd: "", brainOn: false,
    }, version: 0 }));
    localStorage.setItem("anvil-secrets", JSON.stringify({ companionToken: "isolated-test-token", keys: {}, vault: [] }));
    localStorage.setItem("anvil-brain", JSON.stringify({ state: { on: false, autoLoad: false, autoUpdate: false }, version: 0 }));
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => { if (message.type() === "error" && !(failure && /503/.test(message.text()))) errors.push(message.text()); });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  // Settings stay closed: the first scan must be scheduled by the workspace itself.
  const completed = page.waitForResponse((r) => new URL(r.url()).pathname === "/v1/language-updates" && r.request().method() === "POST", { timeout: 40000 });
  await completed;
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().settingsOpen), false);
  assert.ok(actions.some((a) => a.action === "check" && a.manual === false));
  assert.equal(scans, 1);
  await page.evaluate(() => window.__anvilIde.getState().setSettingsOpen(true));
  const nav = page.getByRole("navigation", { name: "Einstellungsbereiche" });
  await nav.getByRole("button", { name: "Companion", exact: true }).click();
  const section = page.getByRole("region", { name: "Updates für Sprachwerkzeuge", exact: true });
  await section.waitFor();
  const automatic = section.getByRole("switch", { name: "Automatisch täglich prüfen", exact: true });
  await automatic.waitFor();
  assert.equal(await automatic.isChecked(), true);
  assert.match(await section.innerText(), /3 Aktualisierungen verfügbar/);
  await section.getByText("Versionen und Ergebnisse (4)", { exact: true }).click();
  await section.getByText("TypeScript Language Server", { exact: true }).waitFor();
  assert.match(await section.innerText(), /6\.0\.0.*6\.0\.1/);
  assert.match(await section.innerText(), /Neue Versionsreihe verfügbar/);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/desktop.png` });
  await automatic.uncheck();
  await page.waitForFunction(() => document.querySelector('[role="switch"]') != null);
  assert.equal(stored.automatic, false);
  const beforeReload = scans;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(() => window.__anvilIde.getState().setSettingsOpen(true));
  await nav.getByRole("button", { name: "Companion", exact: true }).click();
  await automatic.waitFor();
  await page.waitForFunction(() => !document.querySelector('section[aria-label="Updates für Sprachwerkzeuge"] input')?.checked);
  assert.equal(scans, beforeReload);
  partial = true;
  await section.getByRole("button", { name: "Jetzt auf Updates prüfen", exact: true }).click();
  await section.getByText(/1 Prüfung fehlgeschlagen/).waitFor();
  assert.equal(stored.automatic, false);
  assert.equal(scans, 2);
  assert.match(await section.innerText(), /HTTP 429/);
  assert.match(await section.innerText(), /Letzte erfolgreiche Prüfung/);
  await page.setViewportSize({ width: 580, height: 900 });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/narrow.png` });
  assert.equal(await section.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "Update contents must fit the panel");
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/mobile.png` });
  assert.equal(await section.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "Update contents must fit a narrow settings panel");
  // A total connection failure remains actionable and does not discard the saved results.
  failure = true;
  await section.getByRole("button", { name: "Jetzt auf Updates prüfen", exact: true }).click();
  await section.getByRole("alert").filter({ hasText: "HTTP 503" }).waitFor();
  assert.match(await section.innerText(), /TypeScript Language Server/);
  failure = false;
  await page.evaluate(() => window.__anvilIde.getState().setLocale("en"));
  await page.getByRole("region", { name: "Language tool updates", exact: true }).getByRole("switch", { name: "Check automatically every day" }).waitFor();
  const model = await page.evaluate(() => ({ provider: window.__anvilIde.getState().llmProvider, model: window.__anvilIde.getState().llmModel }));
  assert.deepEqual(model, { provider: "ollama", model: "qwen3.8:27b-mtp-q8_0" });
  assert.deepEqual(workspaces, [], "Metadata checks must not register a different project");
  assert.deepEqual(forbidden, [], "Update checks must not install anything or contact a model");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, production, scans, automaticCheckWithoutSettings: true, restartRetainsPreference: true, partialAndOfflineErrors: true, modelUnchanged: true, screenshots: folder }, null, 2));
} finally { await browser.close(); }
