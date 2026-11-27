import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";

const production = process.argv.includes("--production");
const external = process.argv.includes("--external");
const port = external ? (production ? 8081 : 8080) : production ? 8186 : 8185;
const base = `http://127.0.0.1:${port}`;
const screenshotRoot = "screenshots/anvil-mcp";
await mkdir(screenshotRoot, { recursive: true });
let server, dev;
if (production && !external)
  server = spawn(process.execPath, [".output/server/index.mjs"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(port),
    },
    stdio: "ignore",
    windowsHide: true,
  });
else if (!external) {
  dev = await createServer({
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
    cacheDir: "node_modules/.vite-mcp-check",
  });
  await dev.listen();
}
let browser, page;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch { /* Retry while the production server is starting. */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  browser = await chromium.launch({
    executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  page = await browser.newPage({ viewport: { width: 1580, height: 1050 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (route.request().resourceType() === "script")
      return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    if (["http:", "https:"].includes(url.protocol))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"ok":true,"tools":[],"models":[],"files":[]}',
      });
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "anvil-ide",
      JSON.stringify({
        state: {
          setupDone: true,
          autoUpdate: false,
          autoHw: false,
          autoSaveDisk: false,
          formatOnSave: false,
          liveRun: false,
          autoRunAgent: false,
          suggestOn: false,
          files: {},
          openPaths: [],
          activePath: null,
          workspaceCwd: "",
          companionKeep: false,
          sidebar: "mcp",
          sidebarWidth: 440,
          mcpServers: [
            {
              id: "docs",
              name: "Dokumentation",
              url: "https://fixture.invalid/mcp",
              enabled: true,
            },
          ],
          activeSurfaceId: "anvil",
        },
        version: 0,
      }),
    );
    localStorage.setItem(
      "anvil-brain",
      JSON.stringify({
        state: { on: false, autoLoad: false, autoUpdate: false, autonomy: "off" },
        version: 0,
      }),
    );
    localStorage.setItem(
      "anvil-intern",
      JSON.stringify({ state: { prefs: { on: false, autoHeal: false } }, version: 0 }),
    );
    window.fixtureCalls = [];
    window.fixtureListeners = new Set();
    window.anvilNative = {
      onMcpEvent: (fn) => {
        window.fixtureListeners.add(fn);
        return () => window.fixtureListeners.delete(fn);
      },
      mcpClose: async () => {
        if (window.fixturePending) {
          window.fixturePending.resolve({ ok: false, error: "closed" });
          window.fixturePending = null;
        }
      },
      mcpCancel: async (id) => {
        window.fixtureCanceled = id;
        if (window.fixturePending?.id === id) {
          window.fixturePending.resolve({ ok: false, error: "canceled" });
          window.fixturePending = null;
        }
      },
      mcpRequest: async (r) => {
        const reply = (value) => ({ ok: true, value });
        if (r.method === "initialize")
          return reply({
            protocolVersion: "2025-03-26",
            capabilities: { tools: {}, resources: {} },
          });
        if (r.method === "tools/list")
          return reply({
            tools: [
              {
                name: "search",
                description: "Dokumente durchsuchen",
                inputSchema: {
                  type: "object",
                  properties: { q: { type: "string" }, n: { type: "integer" } },
                  required: ["q"],
                  additionalProperties: false,
                },
              },
              {
                name: "select",
                description: "Projekt wählen",
                inputSchema: {
                  type: "object",
                  properties: { enabled: { type: "boolean" } },
                  required: ["enabled"],
                  additionalProperties: false,
                },
              },
            ],
          });
        if (r.method === "resources/list")
          return reply({ resources: [{ uri: "docs://guide", name: "Leitfaden" }] });
        if (r.method === "resources/templates/list")
          return reply({
            resourceTemplates: [{ uriTemplate: "docs://projects/{id}", name: "Projektvorlage" }],
          });
        if (r.method === "resources/read")
          return reply({ contents: [{ uri: r.params.uri, text: "Vollständiger Leitfaden" }] });
        if (r.method === "tools/call") {
          window.fixtureCalls.push(r);
          if (r.params.arguments.q === "wait")
            return new Promise((resolve) => {
              window.fixturePending = { id: r.id, resolve };
            });
          return reply({
            content: [{ type: "text", text: "Gefunden" }],
            structuredContent: { projects: ["Anvil"] },
          });
        }
        throw new Error(r.method);
      },
    };
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__anvilIde.getState().setSidebar("mcp");
    window.__anvilIde.getState().setSidebarWidth(440);
  });
  await page.getByText("Katalog geladen · 2 Werkzeuge · 2 Ressourcen", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "MCP-URL", exact: true }).isVisible(), false);
  await page.getByRole("tab", { name: "Werkzeuge", exact: true }).click();
  await page.getByRole("button", { name: /Dokumentation · search/ }).click();
  const args = page.getByRole("textbox", { name: "MCP-Toolargumente", exact: true });
  await args.fill('{"q":"test","n":"wrong"}');
  await page.getByRole("button", { name: "Aufrufen", exact: true }).click();
  await page.waitForFunction(() => window.__anvilIde.getState().notice.includes("MCP-Argumente"));
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 0);
  await args.fill('{"q":"test","n":2}');
  await page.getByRole("button", { name: "Aufrufen", exact: true }).click();
  await page.waitForFunction(() =>
    window.__anvilIde.getState().mcpView.docs?.text.includes("Anvil"),
  );
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
  await page.getByRole("button", { name: /Dokumentation · select/ }).click();
  assert.deepEqual(JSON.parse(await args.inputValue()), { enabled: false });
  await page.getByRole("button", { name: "Leitfaden", exact: true }).click();
  await page.getByText("Vollständiger Leitfaden", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Dokumentation · search/ }).click();
  await args.fill('{"q":"wait"}');
  await page.getByRole("button", { name: "Aufrufen", exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(() => Boolean(window.fixturePending));
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 2);
  assert.equal(
    await page.getByRole("button", { name: "Aufrufen", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Stoppen", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.fixtureCanceled) && !window.fixturePending);
  await page.getByRole("tab", { name: "Verbindungen", exact: true }).click();
  await page.locator("#mcp-panel-connections summary").filter({ hasText: "Dokumentation" }).click();
  await page.getByRole("checkbox", { name: "Dokumentation aktiviert", exact: true }).uncheck();
  assert.equal(await page.getByRole("checkbox", { name: "Dokumentation aktiviert", exact: true }).isChecked(), false);
  assert.equal(await args.count(), 0);
  assert.equal(await page.getByRole("button", { name: /Dokumentation · search/ }).count(), 0);
  await page.getByRole("checkbox", { name: "Dokumentation aktiviert", exact: true }).check();
  await page.getByRole("combobox", { name: "MCP-Transport" }).selectOption("stdio");
  await page.getByRole("textbox", { name: "MCP-Programm", exact: true }).fill("npx");
  await page
    .getByRole("textbox", { name: "MCP-Programmargumente" })
    .fill('["-y","@anbieter/server"]');
  await page.getByRole("textbox", { name: "MCP-Arbeitsordner" }).fill("I:\\Test-Workspace");
  await page.screenshot({
    path: `${screenshotRoot}/${production ? "production" : "desktop"}-stdio.png`,
  });
  await page.getByRole("combobox", { name: "MCP-Transport" }).selectOption("http");
  await page.getByRole("combobox", { name: "MCP-Anmeldung" }).selectOption("oauth");
  await page.getByRole("button", { name: "Anmelden", exact: true }).waitFor();
  await page.screenshot({
    path: `${screenshotRoot}/${production ? "production" : "desktop"}-oauth.png`,
  });
  await page.evaluate(() => {
    const state = window.__anvilIde.getState();
    state.setMcpServers([
      { ...state.mcpServers[0], enabled: false },
      { id: "anvil-service:notion:fixture", name: "Notion-Testkonto", service: "notion", auth: "oauth", transport: "http", url: "https://mcp.notion.com/mcp", enabled: false, allowedTools: ["search"] },
      { id: "companion-fixture", name: "Companion", url: "http://127.0.0.1:7845/mcp", enabled: false },
      { id: "cad-fixture", name: "OpenSCAD-Test", transport: "stdio", command: "npx", args: ["-y", "test-cad-mcp"], url: "", enabled: false },
    ]);
  });
  for (const name of ["Dienste mit Anmeldung", "Anvil-Companion", "Lokale Programme", "Server über Adresse"])
    await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.locator("#mcp-panel-connections summary").filter({ hasText: "Dokumentation" }).click();
  assert.equal(await page.getByRole("textbox", { name: "MCP-Programm", exact: true }).isVisible(), false);
  await page.getByRole("searchbox", { name: "Verbindungen suchen" }).fill("openscad");
  assert.equal(await page.getByRole("heading", { name: "Dienste mit Anmeldung", exact: true }).count(), 0);
  await page.locator("#mcp-panel-connections summary").filter({ hasText: "OpenSCAD-Test" }).click();
  assert.equal(await page.getByRole("textbox", { name: "MCP-Programm", exact: true }).inputValue(), "npx");
  await page.getByRole("searchbox", { name: "Verbindungen suchen" }).fill("nicht-vorhanden");
  await page.getByText("Keine passende Verbindung gefunden. Ändere den Suchtext.", { exact: true }).waitFor();
  await page.getByRole("searchbox", { name: "Verbindungen suchen" }).fill("");
  await page.locator("#mcp-panel-connections summary").filter({ hasText: "OpenSCAD-Test" }).click();
  await page.getByRole("button", { name: "Server hinzufügen", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "MCP-URL", exact: true }).isVisible(), true);
  await page.getByRole("textbox", { name: "MCP-Servername", exact: true }).fill("Neuer Testserver");
  await page.getByRole("textbox", { name: "MCP-Servername", exact: true }).press("Tab");
  await page.evaluate(() => {
    const state = window.__anvilIde.getState();
    state.setMcpServers(state.mcpServers.filter((server) => server.name !== "Neuer Testserver"));
  });
  await page.evaluate(() => {
    const state = window.__anvilIde.getState();
    window.fixtureServerSnapshot = state.mcpServers;
    state.setMcpServers([
      ...state.mcpServers.map((server, index) => index === 0 ? { ...server, enabled: true } : server),
      { id: "second-fixture", name: "Zweite Dokumentation", url: "https://second-fixture.invalid/mcp", enabled: true },
    ]);
  });
  await page.getByRole("button", { name: "Werkzeuge laden", exact: true }).click();
  await page.getByRole("tab", { name: "Werkzeuge", exact: true }).click();
  await page.getByRole("button", { name: /Zweite Dokumentation · search/ }).waitFor();
  await page.getByRole("combobox", { name: "Werkzeuge von", exact: true }).selectOption("second-fixture");
  assert.equal(await page.getByRole("button", { name: /^Dokumentation · search/ }).count(), 0);
  await page.getByRole("button", { name: /Zweite Dokumentation · search/ }).click();
  await page.getByRole("textbox", { name: "MCP-Toolargumente", exact: true }).fill('{"q":"scoped","n":1}');
  await page.getByRole("button", { name: "Aufrufen", exact: true }).click();
  await page.waitForFunction(() => window.__anvilIde.getState().mcpView["second-fixture"]?.text.includes("Anvil"));
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().activeSurfaceId), "anvil");
  await page.evaluate(() => window.__anvilIde.getState().setMcpServers(window.fixtureServerSnapshot));
  await page.waitForFunction(() => document.querySelector('[aria-label="Werkzeuge von"]').value === "");
  assert.equal(await page.getByRole("textbox", { name: "MCP-Toolargumente", exact: true }).count(), 0);
  await page.getByRole("tab", { name: "Verbindungen", exact: true }).click();
  await page.getByRole("tab", { name: "Verbindungen", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Werkzeuge", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "Verlauf", exact: true }).click();
  await page.getByText(/Dokumentation · search ·/).first().waitFor();
  await page.getByRole("tab", { name: "Verbindungen", exact: true }).click();
  assert.equal(await page.getByRole("tab", { name: "Verbindungen", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#mcp-panel-tools").isVisible(), false);
  await page.mouse.move(1500, 30);
  await page.evaluate(() => window.__anvilIde.getState().setNotice(""));
  await page.screenshot({ path: `${screenshotRoot}/${production ? "production" : "desktop"}-connections.png`, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__anvilIde.getState().setSidebarWidth(320));
  await page.getByRole("button", { name: "Dateien", exact: true }).filter({ hasText: "Dateien" }).click();
  await page.getByRole("tab", { name: "Verbindungen", exact: true }).waitFor();
  assert.equal(await page.locator("#mcp-panel-connections").evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1), true);
  await page.mouse.move(389, 30);
  await page.screenshot({ path: `${screenshotRoot}/${production ? "production" : "desktop"}-mobile.png`, animations: "disabled" });
  await page.evaluate(() => window.__anvilIde.getState().setLocale("en"));
  await page.getByRole("tab", { name: "Connections", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Local programs", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__anvilIde.getState().mcpServers.find((server) => server.service === "notion").allowedTools), ["search"]);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: production ? "production" : "desktop",
      checks: [
        "catalog",
        "schema",
        "structured result",
        "reset arguments",
        "resource read",
        "single call",
        "stop",
        "disabled catalog",
        "stdio settings",
        "oauth settings",
        "separate connections/tools/history views",
        "four connection types",
        "collapsed settings and editable new connection",
        "connection search and empty results",
        "tools filtered by server and result ownership",
        "removed tool filter resets without changing agent surface",
        "keyboard navigation",
        "history identifies connection",
        "narrow viewport without MCP overflow",
        "English labels and preserved tool permissions",
      ],
      pageErrors: errors.length,
    }),
  );
} catch (error) {
  if (page) {
    console.log(
      await page.evaluate(() => ({
        body: document.body.innerText.slice(0, 7000),
        state: window.__anvilIde
          ? {
              sidebar: window.__anvilIde.getState().sidebar,
              servers: window.__anvilIde.getState().mcpServers,
              notice: window.__anvilIde.getState().notice,
            }
          : null,
      })),
    );
    await page.screenshot({ path: `${screenshotRoot}/failure.png` }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await dev?.close();
  server?.kill("SIGTERM");
}
