// Built Electron UI, isolated profile, controlled MCP IPC transport; no GitHub account or model calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { _electron } from "playwright";

const root = process.cwd(),
  output = path.resolve("artifacts/mcp-packages");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.resolve("data/mcp-package-qa-"));
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
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
  await app.evaluate(({ ipcMain }) => {
    globalThis.__packageRequests = [];
    globalThis.__packageFail = false;
    ipcMain.removeHandler("mcp-request");
    ipcMain.handle("mcp-request", (_event, request) => {
      globalThis.__packageRequests.push({ method: request.method, params: request.params });
      const reply = (value) => ({ ok: true, value });
      if (request.method === "initialize")
        return reply({ protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} } });
      if (request.method === "tools/list")
        return reply({
          tools: [
            {
              name: "get_file_contents",
              inputSchema: {
                type: "object",
                properties: {
                  owner: { type: "string" },
                  repo: { type: "string" },
                  path: { type: "string" },
                },
                required: ["owner", "repo"],
              },
            },
            { name: "delete_file", inputSchema: { type: "object" } },
            { name: "future_tool", inputSchema: { type: "object" } },
          ],
        });
      if (request.method === "tools/call")
        return reply({
          isError: globalThis.__packageFail,
          content: [
            {
              type: "text",
              text: globalThis.__packageFail
                ? "Access denied"
                : "# GitHub MCP Server\nFixture README",
            },
          ],
        });
      return { ok: false, error: `Unexpected request ${request.method}` };
    });
  });
  for (let i = 0; i < 360; i++) {
    page = app.windows().find((p) => p.url() === `http://127.0.0.1:${port}/`);
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  assert.ok(page);
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith("/"))
      ?.maximize(),
  );
}
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await launch();
  await page.evaluate(() =>
    window.__anvilIde.setState({
      setupDone: true,
      autoUpdate: false,
      autoSaveDisk: false,
      autoRunAgent: false,
      liveRun: false,
      sidebar: "mcp",
      mcpServers: [
        {
          id: "keep-custom",
          name: "Eigene Verbindung",
          url: "https://custom.invalid/mcp",
          enabled: false,
        },
        // First-run may already have started its asynchronous Companion probe
        // before this fixture replaces setup state. Keep its known endpoint so
        // that unrelated startup completion cannot append a new connection.
        {
          id: "keep-companion",
          name: "Companion fixture",
          url: "http://127.0.0.1:7845/mcp",
          enabled: false,
        },
      ],
    }),
  );
  await page
    .locator("summary")
    .filter({ hasText: /^Aufgabenpakete$/ })
    .click();
  await page.getByRole("button", { name: "Lesepaket hinzufügen", exact: true }).click();
  await page.getByLabel("GitHub-Lesepaket Token").waitFor();
  assert.equal(await app.evaluate(() => globalThis.__packageRequests.length), 0);
  assert.equal(
    await page.evaluate(
      () =>
        window.__anvilIde.getState().mcpServers.find((s) => s.id.startsWith("anvil-pack:")).enabled,
    ),
    false,
  );
  await page.getByLabel("GitHub-Lesepaket Token").fill("qa-not-a-real-token");
  await page.getByLabel("GitHub · Projektquelle lesen aktiviert", { exact: true }).check();
  await page.getByRole("button", { name: "Öffentliche README lesen", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /^Leseprobe erfolgreich/ })
    .waitFor();
  assert.deepEqual(
    await app.evaluate(() =>
      globalThis.__packageRequests.filter((r) => r.method === "tools/call").map((r) => r.params),
    ),
    [
      {
        name: "get_file_contents",
        arguments: { owner: "github", repo: "github-mcp-server", path: "README.md" },
      },
    ],
  );
  assert.equal(
    await page
      .getByRole("button")
      .filter({ hasText: /delete_file|future_tool/ })
      .count(),
    0,
  );
  await page.screenshot({ path: path.join(output, "read-package.png") });
  checks.push(
    "UI adds inert package, real MCP client reads fixture README, unauthorized/new tools stay hidden",
  );
  await page.getByLabel("GitHub-Lesepaket Token").fill("changed-qa-token");
  await page
    .getByText("Lesezugriff noch nicht mit dieser Konfiguration bestätigt.", { exact: true })
    .waitFor();
  await app.evaluate(() => {
    globalThis.__packageFail = true;
  });
  await page.getByRole("button", { name: "Öffentliche README lesen", exact: true }).click();
  await page
    .getByText(/Leseprobe fehlgeschlagen/)
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("status")
      .filter({ hasText: /^Leseprobe erfolgreich/ })
      .count(),
    0,
  );
  checks.push("changed credentials invalidate success and server failure never displays success");
  const card = page
    .locator("div.border-b")
    .filter({ has: page.getByLabel("GitHub-Lesepaket Token") })
    .last();
  await card.getByRole("button", { name: "Entfernen", exact: true }).click();
  assert.equal(await page.getByLabel("GitHub-Lesepaket Token").count(), 0);
  assert.deepEqual(
    await page.evaluate(() => window.__anvilIde.getState().mcpServers.map((s) => s.id)),
    ["keep-custom", "keep-companion"],
  );
  await app.close();
  app = null;
  page = null;
  await launch();
  await page.evaluate(() => window.__anvilIde.getState().setSidebar("mcp"));
  assert.deepEqual(
    await page.evaluate(() => window.__anvilIde.getState().mcpServers.map((s) => s.id)),
    ["keep-custom", "keep-companion"],
  );
  checks.push("removal survives actual Electron restart and preserves custom connection");
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      { ok: true, checks, errors, modelCalls: 0, liveGitHubTest: false, profile },
      null,
      2,
    ),
  );
  console.log(checks.map((check) => `PASS: ${check}`).join("\n"));
} finally {
  await app?.close().catch(() => {});
  server.kill();
}
