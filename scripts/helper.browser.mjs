import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const production = process.argv.includes("--production");
const base = production ? "http://127.0.0.1:8081" : "http://127.0.0.1:8080";
const kind = production ? "production" : "desktop";
const root = "/workspace/screenshots/anvil-helper";
await mkdir(root, { recursive: true });
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* startup */ }
  if (i === 79) throw new Error("Desktop app did not start");
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (route.request().resourceType() === "script") return route.fulfill({ contentType: "application/javascript", body: "" });
    if (route.request().resourceType() === "stylesheet") return route.fulfill({ contentType: "text/css", body: "" });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true,"data":[],"models":[],"sha":"fixture-revision"}' });
  });
  await page.addInitScript(() => {
    localStorage.setItem("anvil-ide", JSON.stringify({ state: { setupDone: true, autoUpdate: false, autoHw: false,
      llmProvider: "openai", llmAuthMode: "key", llmModel: "gpt-4o", files: { "README.md": "Helper desktop fixture" },
      activePath: "", openPaths: [], mcpServers: [], autoRunAgent: false }, version: 0 }));
    localStorage.setItem("anvil-brain", JSON.stringify({ state: { on: true, autoLoad: false, autoUpdate: false, autonomy: "off", gpuKeepAlive: false, modelId: "SmolLM2-360M-Instruct-q4f16_1-MLC" }, version: 0 }));
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.waitForFunction(() => window.monaco?.editor.getEditors().length > 0);
  await page.evaluate(() => window.__anvilIde.getState().setSettingsOpen(true));
  const nav = page.getByRole("navigation", { name: "Einstellungsbereiche" });
  await nav.getByRole("button", { name: "Helfer", exact: true }).click();
  await page.getByRole("heading", { name: "Lokaler Helfer", exact: true }).waitFor();
  const load = page.getByRole("button", { name: "Laden", exact: true });
  assert.equal(await load.isEnabled(), true);
  await page.getByRole("button", { name: "Update prüfen", exact: true }).click();
  await page.getByText("Online-Revision geprüft. Aktualisieren lädt und prüft die Modelldateien.", { exact: true }).waitFor();
  assert.equal(await load.isEnabled(), true, "Revision checks must never leave Load disabled");
  assert.equal(await page.getByLabel("Autonomie", { exact: true }).inputValue(), "off");
  const keep = page.getByRole("switch", { name: "GPU warm halten", exact: true });
  await keep.click(); assert.equal(await keep.getAttribute("aria-checked"), "true");
  await page.screenshot({ path: `${root}/${kind}-helper.png` });
  await page.getByRole("switch", { name: "Helfer an", exact: true }).click();
  assert.equal(await load.isEnabled(), false);
  // A native model library must retain a partial install as removable, and
  // deleting a family must include its fp32 alternative without touching pins.
  await page.evaluate(() => {
    window.helperDeleted = [];
    window.anvilNative = {
      helperDir: async () => "I:\\Anvil\\helper",
      helperList: async () => window.helperDeleted.length ? [] : [{ id: "SmolLM2-360M-Instruct-q4f16_1-MLC", ready: false, bytes: 0 }],
      helperHas: async () => false,
      helperDelete: async (id) => { window.helperDeleted.push(id); return true; },
    };
  });
  await nav.getByRole("button", { name: "Modelle", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: "SmolLM2 360M" });
  await row.getByText(/teilweise/).waitFor();
  assert.equal(await row.getByRole("button", { name: "Weg", exact: true }).isEnabled(), true);
  await page.getByRole("switch", { name: "Lokal behalten", exact: true }).click();
  await row.getByRole("button", { name: "Weg", exact: true }).click();
  await page.waitForFunction(() => window.helperDeleted.length === 2);
  assert.deepEqual(await page.evaluate(() => window.helperDeleted), ["SmolLM2-360M-Instruct-q4f16_1-MLC", "SmolLM2-360M-Instruct-q4f32_1-MLC"]);
  await row.getByText(/· fehlt/).waitFor();
  assert.equal(await row.getByRole("button", { name: "Laden", exact: true }).isEnabled(), true);
  await page.screenshot({ path: `${root}/${kind}-models.png` });
  assert.deepEqual(errors, []);
  console.log(`${kind.toUpperCase()}_HELPER_UPDATE_CONTROLS_DELETE_RENDER_OK`);
} finally { await browser.close(); }
