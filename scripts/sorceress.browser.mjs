// Actual production renderer, native IPC, credential vault and both MCP host owners.
// Only the vendor HTTP boundary is redirected to a synthetic local fixture.
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { _electron } from "playwright";
import { verifyBuild } from "./build-fingerprint.mjs";
import { verifyPackageFingerprint } from "./verify-package-fingerprint.mjs";

const root = process.cwd();
await verifyBuild(root, true);
const executableIndex = process.argv.indexOf("--executable");
const executable = executableIndex < 0 ? null : path.resolve(process.argv[executableIndex + 1]);
if (executable)
  await verifyPackageFingerprint(path.join(path.dirname(executable), "resources/app"));
const output = path.resolve(
  "artifacts/sorceress-2026-10-11",
  executable ? "packaged-desktop" : "desktop",
);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, "profile-"));
const key = "sk_sorc_synthetic_desktop_key";
const calls = [],
  errors = [],
  consoleErrors = [],
  checks = [];
let jobStatus = "processing",
  slow = false;
const fixture = httpServer(async (request, response) => {
  let body = "";
  for await (const part of request) body += part;
  const input = body ? JSON.parse(body) : null;
  calls.push({ path: request.url, method: request.method, input });
  const json = (data, status = 200) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(data));
  };
  if (request.headers.authorization !== `Bearer ${key}`)
    return json({ ok: false, error: "invalid key" }, 401);
  if (request.url === "/api/v1/tools/ping")
    return json({ ok: true, data: { message: input.message } });
  if (request.url === "/api/v1/tools")
    return json({
      ok: true,
      tools: [
        {
          id: "ping",
          status: "live",
          enabled: true,
          creditCost: 0,
          params: [{ name: "message", type: "string" }],
        },
        {
          id: "image_generate",
          status: "live",
          enabled: true,
          selfBilled: true,
          description: "Synthetic paid image tool.",
          params: [{ name: "prompt", type: "string", required: true }],
        },
        { id: "future_tool", status: "live", enabled: true, creditCost: 0, params: [] },
      ],
    });
  if (request.url === "/api/v1/tools/image_generate") {
    if (slow) return;
    return json({
      ok: true,
      data: { jobId: "desktop-job", poll: "https://evil.invalid/forbidden" },
    });
  }
  if (request.url === "/api/v1/jobs/desktop-job")
    return json({
      ok: true,
      status: jobStatus,
      ...(jobStatus === "succeeded"
        ? { images: [{ url: "https://example.invalid/synthetic.png" }] }
        : {}),
    });
  json({ ok: false, error: "unexpected route" }, 404);
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
const freePort = async () => {
  const server = netServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const port = await freePort(),
  companionPort = await freePort(),
  url = `http://127.0.0.1:${port}/`;
const env = {
  ...process.env,
  ANVIL_DESKTOP_MODE: "production",
  ANVIL_PORT: String(port),
  ANVIL_COMPANION_PORT: String(companionPort),
  ANVIL_QA_USER_DATA: profile,
  ANVIL_USER_DATA: profile,
  ANVIL_HOME: path.join(profile, "packages"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const card = () => page.getByRole("region", { name: "Dienst: Sorceress", exact: true });
const keyInput = () => card().getByLabel("Sorceress: API-Schlüssel", { exact: true });
async function launch() {
  app = await _electron.launch({
    ...(executable
      ? { executablePath: executable, args: [] }
      : { args: [path.resolve("fixtures/electron-boot.mjs")] }),
    env,
  });
  await app.evaluate((_, origin) => {
    const original = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      const url = new URL(String(input));
      if (url.origin === "https://sorceress.games" && url.pathname.startsWith("/api/v1/"))
        return original(`${origin}${url.pathname}`, options);
      return original(input, options);
    };
  }, fixtureOrigin);
  await app.context().route("**/*", (route) => {
    const target = new URL(route.request().url());
    if (target.hostname === "fonts.googleapis.com")
      return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    if (["http:", "https:"].includes(target.protocol) && target.origin !== new URL(url).origin)
      return route.abort();
    return route.continue();
  });
  for (let n = 0; n < 180; n++) {
    page = app.windows().find((window) => window.url() === url);
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(page, "production main window");
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  page.setDefaultTimeout(18000);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => !window.isDestroyed())
      ?.setSize(1380, 960),
  );
  await page.evaluate(() => {
    window.__anvilIde.setState({
      setupDone: true,
      autoUpdate: false,
      companionKeep: false,
      locale: "de",
      sidebar: "ext",
      settingsOpen: false,
      panels: { editor: true, agent: true, trail: false, output: false },
    });
  });
  await page.getByRole("button", { name: "Dienste", exact: true }).click();
}
async function invoke(name, args) {
  const summary = card().getByText("Werkzeug selbst ausführen", { exact: true });
  if (!(await summary.evaluate((element) => element.closest("details").open)))
    await summary.click();
  await card().getByLabel("Sorceress: Werkzeug ausführen", { exact: true }).selectOption(name);
  await card()
    .getByLabel("Sorceress: Werkzeugargumente als JSON", { exact: true })
    .fill(JSON.stringify(args));
  await card().getByRole("button", { name: "Jetzt ausführen", exact: true }).click();
}
try {
  await launch();
  await page.getByLabel("Dienst auswählen", { exact: true }).selectOption("sorceress");
  assert.equal(await page.getByLabel("Dienst: OAuth-Client-ID", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Verbindung hinzufügen", exact: true }).click();
  await card().waitFor();
  assert.equal(calls.length, 0, "preparing service never contacts the account");
  assert.equal(await card().getByRole("button", { name: "Anmelden", exact: true }).count(), 0);
  const input = keyInput();
  assert.equal(await input.getAttribute("type"), "password");
  await input.fill(key);
  await card().getByRole("button", { name: "Schlüssel speichern und prüfen", exact: true }).click();
  await card()
    .getByText(
      "Verbindung geprüft und Werkzeugkatalog geladen. Wähle die benötigten Werkzeuge aus.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await input.inputValue(), "");
  assert.ok(
    calls.every((call) => ["/api/v1/tools", "/api/v1/tools/ping"].includes(call.path)),
    "setup never starts a paid job",
  );
  const server = await page.evaluate(() =>
    window.__anvilIde.getState().mcpServers.find((server) => server.service === "sorceress"),
  );
  assert.deepEqual(server.allowedTools, []);
  const vault = await readFile(path.join(profile, "secrets.enc"));
  assert.equal(vault.includes(Buffer.from(key)), false, "key is not saved as plaintext");
  checks.push("REST adapter setup, free ping, encrypted credential and zero implicit grants");
  for (const name of ["image_generate", "sorceress_job_get", "sorceress_tool_info"])
    await card().getByLabel(`Sorceress: ${name} freigeben`, { exact: true }).check();
  await card().getByRole("button", { name: "In Anvil verwenden", exact: true }).click();
  await invoke("image_generate", { prompt: "synthetic fixture only" });
  await card()
    .getByLabel("Sorceress: Werkzeugantwort", { exact: true })
    .filter({ hasText: "desktop-job" })
    .waitFor();
  assert.equal(calls.filter((call) => call.path === "/api/v1/tools/image_generate").length, 1);
  await invoke("sorceress_job_get", { jobId: "desktop-job" });
  await card()
    .getByLabel("Sorceress: Werkzeugantwort", { exact: true })
    .filter({ hasText: "processing" })
    .waitFor();
  await page.screenshot({ path: path.join(output, "service-desktop.png") });
  jobStatus = "succeeded";
  await invoke("sorceress_job_get", { jobId: "desktop-job" });
  await card()
    .getByLabel("Sorceress: Werkzeugantwort", { exact: true })
    .filter({ hasText: "succeeded" })
    .waitFor();
  assert.ok(calls.every((call) => !call.path.includes("forbidden")));
  checks.push("generation jobId, pending status, explicit status query and completion URLs");
  const background = await app.evaluate(
    async (_, { module, server, key }) => {
      const require = process.getBuiltinModule("module").createRequire(module);
      const { createBackgroundMcpHost } = require(
        process.getBuiltinModule("url").fileURLToPath(module),
      );
      const host = createBackgroundMcpHost();
      try {
        const config = { ...server, headers: { authorization: `Bearer ${key}` } };
        await host.request(config, "initialize");
        const list = await host.request(config, "tools/list");
        const result = await host.request(config, "tools/call", {
          name: "sorceress_job_get",
          arguments: { jobId: "desktop-job" },
        });
        return {
          names: list.tools.map((tool) => tool.name),
          status: result.structuredContent.status,
        };
      } finally {
        await host.stop();
      }
    },
    {
      module: pathToFileURL(
        path.join(
          executable ? path.dirname(executable) + "/resources/app" : root,
          "electron/mcp-ipc.mjs",
        ),
      ).href,
      server,
      key,
    },
  );
  assert.equal(background.status, "succeeded");
  assert.ok(background.names.includes("image_generate"));
  checks.push("native background MCP owner uses the same adapter and status tool");
  await app.close();
  app = null;
  const generationCount = calls.filter(
    (call) => call.path === "/api/v1/tools/image_generate",
  ).length;
  await launch();
  await card().getByLabel("Sorceress: image_generate freigeben", { exact: true }).waitFor();
  assert.equal(
    await card().getByLabel("Sorceress: image_generate freigeben", { exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await card().getByLabel("Sorceress: future_tool freigeben", { exact: true }).isChecked(),
    false,
  );
  assert.equal(
    calls.filter((call) => call.path === "/api/v1/tools/image_generate").length,
    generationCount,
    "restart reconnects without generating",
  );
  checks.push("full restart reconnects with saved key, preserves selection and excludes new tools");
  jobStatus = "failed";
  await invoke("sorceress_job_get", { jobId: "desktop-job" });
  await card().getByRole("alert").filter({ hasText: "Werkzeugfehler" }).waitFor();
  slow = true;
  await invoke("image_generate", { prompt: "synthetic abort" });
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Dienst: Sorceress"]')
      ?.textContent.includes("Werkzeugaufruf läuft"),
  );
  await card().getByRole("button", { name: "Abbrechen", exact: true }).click();
  await card().getByRole("alert").filter({ hasText: "trotzdem ausgeführt" }).waitFor();
  slow = false;
  await keyInput().fill("sk_sorc_invalid_fixture");
  await card().getByRole("button", { name: "Schlüssel speichern und prüfen", exact: true }).click();
  await card().getByRole("alert").filter({ hasText: "401" }).waitFor();
  await keyInput().fill(key);
  await card().getByRole("button", { name: "Schlüssel speichern und prüfen", exact: true }).click();
  await card()
    .getByText(
      "Verbindung geprüft und Werkzeugkatalog geladen. Wähle die benötigten Werkzeuge aus.",
      { exact: true },
    )
    .waitFor();
  checks.push("failed job, canceled request and invalid key remain visible, without replay");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => !window.isDestroyed())
      ?.setSize(850, 900),
  );
  await page.screenshot({ path: path.join(output, "service-narrow.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await card().getByRole("button", { name: "Verbindung entfernen", exact: true }).click();
  await card().getByRole("button", { name: "Endgültig entfernen", exact: true }).click();
  await card().waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(
      (id) => Boolean(window.anvilNative.secretsLoad().secrets.keys[`mcp:${id}`]),
      server.id,
    ),
    false,
  );
  checks.push("remove disables the service and erases its scoped credential");
  assert.deepEqual(errors, []);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !message.includes("grok.com/grok-app-builder") &&
      !message.includes("ERR_BLOCKED_BY_CLIENT") &&
      !message.includes("ERR_FAILED"),
  );
  assert.deepEqual(unexpectedConsoleErrors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        ok: true,
        syntheticVendor: true,
        executable,
        profile,
        checks,
        httpRequests: calls.length,
        errors,
        consoleErrors,
        noPaidLiveRequests: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ ok: true, output, checks }));
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  await writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      { message: error.message, stack: error.stack, calls, errors, consoleErrors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close();
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
}
