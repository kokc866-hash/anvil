import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const production = process.argv.includes("--production");
const base = production ? "http://127.0.0.1:8081" : "http://127.0.0.1:8080";
const screenshotRoot = "/workspace/screenshots/anvil-mcp";
await mkdir(screenshotRoot, { recursive: true });
let server;
if (production)
  server = spawn(process.execPath, [".output/server/index.mjs"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "8081",
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: "8081",
    },
    stdio: "ignore",
  });
else
  execFileSync("sh", ["/workspace/startup.sh"], {
    env: { ...process.env, ANVIL_ELECTRON_BUILD: "1" },
  });
let browser, page;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
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
  await page.getByText("Katalog geladen · 2 Tools · 2 Ressourcen", { exact: true }).waitFor();
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
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.fixtureCanceled) && !window.fixturePending);
  await page.getByRole("checkbox", { name: "Dokumentation aktiviert", exact: true }).uncheck();
  await page.getByText("Deaktiviert", { exact: true }).waitFor();
  assert.equal(await args.count(), 0);
  assert.equal(await page.getByRole("button", { name: /Dokumentation · search/ }).count(), 0);
  await page.getByRole("checkbox", { name: "Dokumentation aktiviert", exact: true }).check();
  await page.getByRole("combobox", { name: "MCP-Transport" }).selectOption("stdio");
  await page.getByRole("textbox", { name: "MCP-Programm", exact: true }).fill("npx");
  await page
    .getByRole("textbox", { name: "MCP-Programmargumente" })
    .fill('["-y","@anbieter/server"]');
  await page.getByRole("textbox", { name: "MCP-Arbeitsordner" }).fill("I:\\AnvilTest");
  await page.screenshot({
    path: `${screenshotRoot}/${production ? "production" : "desktop"}-stdio.png`,
  });
  await page.getByRole("combobox", { name: "MCP-Transport" }).selectOption("http");
  await page.getByRole("combobox", { name: "MCP-Anmeldung" }).selectOption("oauth");
  await page.getByRole("button", { name: "Anmelden", exact: true }).waitFor();
  await page.screenshot({
    path: `${screenshotRoot}/${production ? "production" : "desktop"}-oauth.png`,
  });
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
  server?.kill("SIGTERM");
}
