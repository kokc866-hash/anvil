// Actual built Electron, OAuth SDK, encrypted vault, renderer mcpCall and local HTTP.
// Only browser consent is simulated; no MCP IPC replacement or external account.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { _electron } from "playwright";
import { startServiceFixture } from "../fixtures/mcp-service-server.mjs";

const root = process.cwd(),
  output = path.resolve("artifacts/services");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.resolve("data/services-qa-"));
const fixture = await startServiceFixture();
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
  stdio: "ignore",
  env: {
    ...env,
    PORT: String(port),
    NITRO_PORT: String(port),
    HOST: "127.0.0.1",
    NITRO_HOST: "127.0.0.1",
  },
});
let app, page;
const checks = [],
  errors = [];
async function eventually(predicate, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout: ${label}`);
}
async function launch() {
  app = await _electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [`--user-data-dir=${profile}`, path.join(root, "fixtures/electron-boot.mjs")],
    env,
    timeout: 45000,
  });
  await app.evaluate(({ shell }, origin) => {
    globalThis.__serviceConsentChecks = [];
    globalThis.__deferServiceConsent = false;
    globalThis.__serviceAuthorizationUrls = [];
    // Simulate consenting only to our local OAuth fixture; native MCP remains real.
    shell.openExternal = async (raw) => {
      const url = new URL(raw);
      if (url.origin !== origin || url.pathname !== "/authorize")
        throw new Error("QA forbids external navigation");
      globalThis.__serviceAuthorizationUrls.push(raw);
      if (globalThis.__deferServiceConsent) return;
      const authorization = await fetch(url, { redirect: "manual" });
      if (authorization.status !== 302) throw new Error("Fixture rejected authorization");
      const callback = new URL(authorization.headers.get("location"));
      const wrong = new URL(callback);
      wrong.searchParams.set("state", "invalid-qa-state");
      const wrongStatus = (await fetch(wrong)).status;
      const goodStatus = (await fetch(callback)).status;
      if (wrongStatus !== 400 || goodStatus !== 200)
        throw new Error("OAuth callback state validation failed");
      globalThis.__serviceConsentChecks.push({
        wrongStatus,
        goodStatus,
        pkce: url.searchParams.get("code_challenge_method"),
      });
    };
  }, fixture.base);
  await eventually(
    () => {
      page = app.windows().find((p) => p.url() === `http://127.0.0.1:${port}/`);
      return page;
    },
    "desktop window",
    45000,
  );
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith("/"))
      ?.maximize(),
  );
  await page.evaluate(() =>
    window.__anvilIde.setState({
      setupDone: true,
      autoUpdate: false,
      companionKeep: true,
      locale: "de",
      sidebar: "ext",
    }),
  );
  await page.getByRole("button", { name: "Dienste", exact: true }).click();
}
const card = () => page.getByRole("region", { name: "Dienst: Lokaler QA-Dienst", exact: true });
const localState = () =>
  page.evaluate(() =>
    window.__anvilIde.getState().mcpServers.find((s) => s.name === "Lokaler QA-Dienst"),
  );
async function vaultRecordCount() {
  const bytes = [...(await readFile(path.join(profile, "mcp-oauth.enc")))];
  // Inspect only record count; credentials are never returned to the renderer or log.
  return app.evaluate(
    ({ safeStorage }, bytes) =>
      Object.keys(JSON.parse(safeStorage.decryptString(Buffer.from(bytes))).records).length,
    bytes,
  );
}
async function add() {
  await page.getByLabel("Dienst auswählen", { exact: true }).selectOption("custom");
  await page.getByLabel("Eigener Dienst: Name", { exact: true }).fill("Lokaler QA-Dienst");
  await page.getByLabel("Eigener Dienst: MCP-Adresse", { exact: true }).fill(fixture.url);
  await page.getByRole("button", { name: "Verbindung hinzufügen", exact: true }).click();
  await card().waitFor();
}
async function login() {
  await card().getByRole("button", { name: "Anmelden", exact: true }).click();
  await card()
    .getByText("Anmeldung und Katalogabruf erfolgreich. Wähle jetzt die Werkzeuge aus.", {
      exact: true,
    })
    .waitFor();
}
async function readNote() {
  const summary = card().getByText("Werkzeug selbst ausführen", { exact: true });
  if (!(await summary.evaluate((el) => el.closest("details").open))) await summary.click();
  await card()
    .getByLabel("Lokaler QA-Dienst: Werkzeug ausführen", { exact: true })
    .selectOption("read_note");
  const offered = await card()
    .getByLabel("Lokaler QA-Dienst: Werkzeug ausführen", { exact: true })
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  assert.deepEqual(offered, ["", "read_note"], "unselected write tool absent from executable list");
  await card().getByRole("button", { name: "Jetzt ausführen", exact: true }).click();
  await card()
    .getByLabel("Lokaler QA-Dienst: Werkzeugantwort", { exact: true })
    .filter({ hasText: fixture.state.note })
    .waitFor();
}
try {
  await eventually(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/`)).ok;
      } catch {
        return false;
      }
    },
    "built server",
    45000,
  );
  await launch();
  assert.equal(await page.getByLabel("Dienst auswählen", { exact: true }).inputValue(), "notion");
  const providerSelect = page.getByLabel("Dienst auswählen", { exact: true });
  assert.ok((await providerSelect.locator("optgroup").count()) >= 6, "providers grouped by work");
  await page.getByLabel("Dienste durchsuchen", { exact: true }).fill("Design");
  assert.ok(await providerSelect.locator('option[value="canva"]').count());
  assert.equal(await providerSelect.locator('option[value="neon"]').count(), 0);
  assert.equal(await providerSelect.inputValue(), "notion", "search preserves explicit selection");
  await providerSelect.selectOption("figma");
  assert.equal(
    await page.getByRole("button", { name: "Verbindung hinzufügen", exact: true }).isEnabled(),
    false,
  );
  await page.getByText(/Figma muss Anvil zuerst/).waitFor();
  await page.getByLabel("Dienste durchsuchen", { exact: true }).fill("zz-unbekannt-zz");
  await page.getByText(/Kein Treffer/).waitFor();
  assert.equal(await providerSelect.inputValue(), "figma");
  await page.getByLabel("Dienste durchsuchen", { exact: true }).fill("");
  await providerSelect.selectOption("canva");
  assert.equal(
    await page.getByRole("button", { name: "Verbindung hinzufügen", exact: true }).isEnabled(),
    true,
  );
  await page.screenshot({ path: path.join(output, "dienste-katalog.png") });
  checks.push("Catalog search, categories, stable selection and blocked provider setup verified");
  await page.getByText("Engines & 3D-Werkzeuge", {exact:true}).click();
  await page.getByLabel("Engine-Erweiterung auswählen", {exact:true}).selectOption("unity-official");
  const beforeEngine = await page.evaluate(() => window.__anvilIde.getState().mcpServers.length);
  await page.getByRole("button",{name:"In MCP vorbereiten",exact:true}).click();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().mcpServers.length), beforeEngine, "missing relay path cannot create a broken entry");
  await page.getByLabel("Engine-Erweiterung auswählen", {exact:true}).selectOption("godot-coding-solo");
  await page.getByRole("button",{name:"In MCP vorbereiten",exact:true}).click();
  const engineDraft = await page.evaluate(() => window.__anvilIde.getState().mcpServers.at(-1));
  assert.equal(engineDraft.transport,"stdio");
  assert.equal(engineDraft.enabled,false);
  assert.equal(engineDraft.service,undefined);
  assert.ok(engineDraft.args.includes("@coding-solo/godot-mcp"));
  assert.equal(fixture.state.requests.length,0);
  await page.getByRole("button",{name:"MCP-Verbindungen öffnen",exact:true}).click();
  await page.waitForFunction(name => [...document.querySelectorAll("input")].some(input => input.value === name), engineDraft.name);
  await page.getByRole("button",{name:"Erweiterungen",exact:true}).click();
  await page.getByRole("button",{name:"Dienste",exact:true}).click();
  checks.push("Engine templates validate required setup, create an inactive local connection and open existing MCP management without starting it");
  await add();
  assert.equal((await localState()).enabled, false);
  assert.deepEqual((await localState()).allowedTools, []);
  assert.equal(fixture.state.requests.length, 0, "adding a service must not contact it");
  checks.push("Notion is default; adding custom service is inert and has no grants");
  await app.evaluate(() => {
    globalThis.__deferServiceConsent = true;
  });
  await card().getByRole("button", { name: "Anmelden", exact: true }).click();
  await card()
    .getByText(/Warte auf die Freigabe im Browser/)
    .waitFor();
  await app.evaluate(() => {
    globalThis.__deferServiceConsent = false;
  });
  await card().getByRole("button", { name: "Anmeldeseite erneut öffnen", exact: true }).click();
  await card()
    .getByText("Anmeldung und Katalogabruf erfolgreich. Wähle jetzt die Werkzeuge aus.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await app.evaluate(
      () =>
        globalThis.__serviceAuthorizationUrls.length === 2 &&
        globalThis.__serviceAuthorizationUrls[0] === globalThis.__serviceAuthorizationUrls[1],
    ),
    true,
  );
  checks.push(
    "missing initial browser callback shows waiting status; reopening resumes identical OAuth authorization and completes login",
  );
  assert.equal(fixture.state.pkceVerified, 1);
  assert.deepEqual(await app.evaluate(() => globalThis.__serviceConsentChecks), [
    { wrongStatus: 400, goodStatus: 200, pkce: "S256" },
  ]);
  assert.equal(
    await card().getByLabel("Lokaler QA-Dienst: read_note freigeben", { exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await card()
      .getByLabel("Lokaler QA-Dienst: update_note freigeben", { exact: true })
      .isChecked(),
    false,
  );
  assert.equal(fixture.state.calls.length, 0);
  checks.push(
    "real native OAuth: dynamic registration, PKCE and callback state; catalog starts unchecked",
  );
  await card().getByRole("button", { name: "Auswahl vergrößern", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: "Lokaler QA-Dienst: Werkzeugauswahl",
    exact: true,
  });
  await picker.waitFor();
  await picker.getByRole("button", { name: "Alle freigeben", exact: true }).click();
  assert.deepEqual((await localState()).allowedTools.sort(), ["read_note", "update_note"]);
  assert.equal(fixture.state.calls.length, 0, "selection alone never executes a tool");
  const search = picker.getByLabel("Lokaler QA-Dienst: Werkzeuge suchen", { exact: true });
  await search.fill("update");
  await picker.getByRole("button", { name: "Treffer abwählen", exact: true }).click();
  assert.deepEqual(
    (await localState()).allowedTools,
    ["read_note"],
    "filtered removal preserves hidden selection",
  );
  await search.fill("no-such-tool");
  await picker.getByText("Keine passenden Werkzeuge.", { exact: true }).waitFor();
  assert.equal(
    await picker.getByRole("button", { name: "Treffer freigeben", exact: true }).isDisabled(),
    true,
  );
  await search.fill("");
  await picker.getByLabel("Nur ausgewählte", { exact: true }).check();
  assert.equal(
    await picker.getByLabel("Lokaler QA-Dienst: update_note freigeben", { exact: true }).count(),
    0,
  );
  await picker.getByLabel("Nur ausgewählte", { exact: true }).uncheck();
  await picker.getByText("Beschreibung", { exact: true }).first().click();
  await picker.getByText("Testnotiz lesen", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "werkzeugauswahl.png") });
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });
  await card().getByRole("button", { name: "Auswahl vergrößern", exact: true }).click();
  await picker.getByRole("button", { name: "Alle abwählen", exact: true }).click();
  assert.deepEqual((await localState()).allowedTools, []);
  await search.fill("read");
  await picker.getByRole("button", { name: "Treffer freigeben", exact: true }).click();
  assert.deepEqual((await localState()).allowedTools, ["read_note"]);
  await picker.getByRole("button", { name: "Fertig", exact: true }).click();
  checks.push(
    "expanded tool picker: bulk grants, search-scoped changes, selected filter, details, empty results and keyboard close preserve permissions without tool calls",
  );
  await card().getByLabel("Lokaler QA-Dienst: read_note freigeben", { exact: true }).check();
  await card().getByRole("button", { name: "In Anvil verwenden", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().surfaceMode), "bridge");
  await readNote();
  assert.equal(fixture.state.calls.length, 1);
  assert.equal(fixture.state.calls[0].name, "read_note");
  assert.deepEqual((await localState()).allowedTools, ["read_note"]);
  await page.screenshot({ path: path.join(output, "dienst-verbunden.png") });
  const encrypted = await readFile(path.join(profile, "mcp-oauth.enc"));
  assert.equal(encrypted.includes(Buffer.from("qa-access-")), false);
  assert.equal(encrypted.includes(Buffer.from("qa-refresh-")), false);
  assert.equal(await vaultRecordCount(), 1);
  checks.push(
    "selected tool executes via renderer mcpCall/native SDK/real HTTP; unselected write tool never sent; encrypted vault",
  );
  await app.close();
  app = null;
  await launch();
  await card().getByText("Anmeldung lokal gespeichert.", { exact: true }).waitFor();
  assert.deepEqual((await localState()).allowedTools, ["read_note"]);
  await card().getByRole("button", { name: "Werkzeuge laden", exact: true }).click();
  await card().getByText("Werkzeugkatalog erfolgreich geladen.", { exact: true }).waitFor();
  await readNote();
  assert.equal(
    fixture.state.tokenExchanges,
    1,
    "restart reuses encrypted credentials without new browser login",
  );
  checks.push(
    "full desktop restart preserves selected tools and encrypted login; real request works without reauthentication",
  );
  await card().getByLabel("Lokaler QA-Dienst aktiv", { exact: true }).uncheck();
  assert.equal((await localState()).enabled, false);
  assert.equal(
    await card().getByRole("button", { name: "Werkzeuge laden", exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    await card().getByRole("button", { name: "In Anvil verwenden", exact: true }).isEnabled(),
    false,
  );
  await card().getByRole("button", { name: "Abmelden", exact: true }).click();
  await card().getByText("Keine Anmeldung gespeichert.", { exact: true }).waitFor();
  assert.deepEqual((await localState()).allowedTools, []);
  assert.equal(await vaultRecordCount(), 0);
  checks.push("disable blocks use; logout clears local credentials and tool grants");
  fixture.state.failTools = true;
  await card().getByRole("button", { name: "Anmelden", exact: true }).click();
  await card()
    .getByText(/Anmeldung gespeichert; Werkzeugkatalog konnte nicht geladen werden/)
    .waitFor();
  await card().getByText("Anmeldung lokal gespeichert.", { exact: true }).waitFor();
  assert.equal(await vaultRecordCount(), 1);
  fixture.state.failTools = false;
  await card().getByRole("button", { name: "Werkzeuge laden", exact: true }).click();
  await card().getByText("Werkzeugkatalog erfolgreich geladen.", { exact: true }).waitFor();
  await card().getByRole("button", { name: "Abmelden", exact: true }).click();
  await card().getByText("Keine Anmeldung gespeichert.", { exact: true }).waitFor();
  checks.push(
    "catalog failure after successful OAuth retains stored login; catalog retry succeeds without renewed consent",
  );
  fixture.state.holdTokens = true;
  await card().getByRole("button", { name: "Anmelden", exact: true }).click();
  await eventually(() => fixture.state.heldTokens.length === 1, "pending OAuth token exchange");
  await card().getByRole("button", { name: "Abbrechen", exact: true }).click();
  fixture.releaseTokens();
  await card().getByRole("button", { name: "Anmelden", exact: true }).waitFor();
  await card().getByRole("button", { name: "Verbindung entfernen", exact: true }).click();
  await card().getByRole("button", { name: "Endgültig entfernen", exact: true }).click();
  await card().waitFor({ state: "detached" });
  await app.close();
  app = null;
  await launch();
  assert.equal(await card().count(), 0);
  assert.equal(await localState(), undefined);
  assert.equal(await vaultRecordCount(), 0, "late token response must not recreate credentials");
  assert.equal(
    fixture.state.calls.some((call) => call.name === "update_note"),
    false,
  );
  assert.deepEqual(fixture.state.errors, []);
  assert.deepEqual(errors, []);
  checks.push(
    "cancel during delayed token exchange, remove and restart cannot restore connection; no write tool calls",
  );
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        ok: true,
        checks,
        errors,
        profile,
        actualNotionAccountUsed: false,
        simulatedOnly: "User consent at local OAuth fixture",
        realTransport: "Native Electron MCP IPC, OAuth SDK and HTTP",
        modelCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(checks.map((check) => `PASS: ${check}`).join("\n"));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  await writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      { error: error.stack, checks, fixture: fixture.state, errors, profile },
      null,
      2,
    ),
  );
  throw error;
} finally {
  fixture.releaseTokens();
  await app?.close().catch(() => {});
  server.kill();
  await fixture.close();
}
