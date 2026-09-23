// Production desktop + real utility worker + existing OAuth vault/CLI runner.
// Every external endpoint and CLI binary is an isolated, controlled fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as socketServer } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { _electron } from "playwright";
import { oauthKey } from "../electron/mcp-oauth.mjs";
import { serviceFixture, installCliFixture } from "./fixtures/background-connections.mjs";
await import("./pack-ui.mjs");
const output = path.resolve("artifacts/background-stage3");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, "profile-")),
  project = path.join(profile, "project");
await mkdir(project);
const cliRoot = await installCliFixture(path.join(profile, "cli"));
const f = await serviceFixture();
f.state.mode = "hold";
const sock = socketServer();
await new Promise((r) => sock.listen(0, "127.0.0.1", r));
const port = sock.address().port;
await new Promise((r) => sock.close(r));
let round = 0;
const modelErrors = [];
const model = createServer(async (req, res) => {
  let raw = "";
  for await (const b of req) raw += b;
  if (!req.url.endsWith("/chat/completions")) {
    res.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}');
    return;
  }
  const n = ++round,
    payload = JSON.parse(raw);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const emit = (value) => res.write(`data: ${JSON.stringify({ choices: [value] })}\n\n`);
  const name = n === 1 ? "mcp_list" : n === 2 ? "mcp_call" : "";
  if (name) {
    emit({
      delta: {
        tool_calls: [
          {
            index: 0,
            id: `service-${n}`,
            function: {
              name,
              arguments: JSON.stringify(
                n === 1
                  ? {}
                  : { server: f.config.id, name: "record", arguments: { text: "desktop" } },
              ),
            },
          },
        ],
      },
    });
    emit({ delta: {}, finish_reason: "tool_calls" });
  } else {
    if (!JSON.stringify(payload.messages).includes("SERVICE_OK desktop"))
      modelErrors.push(payload.messages.slice(-4));
    emit({ delta: { content: "SERVICE_DESKTOP_OK" } });
    emit({ delta: {}, finish_reason: "stop" });
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const env = {
  ...process.env,
  PATH: cliRoot + path.delimiter + process.env.PATH,
  ANVIL_DESKTOP_MODE: "production",
  ANVIL_PORT: String(port),
  ANVIL_QA_USER_DATA: profile,
  ANVIL_HOME: path.join(profile, "packages"),
  ANVIL_WATCHDOG: "0",
};
delete env.ELECTRON_RUN_AS_NODE;
const until = async (check, label = "condition") => {
  for (let n = 0; n < 250; n++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Stage 3 timeout: " + label);
};
let app, proc;
try {
  app = await _electron.launch({
    args: [path.resolve("fixtures/electron-boot.mjs")],
    env,
    timeout: 45000,
  });
  proc = app.process();
  const issuer = new URL(f.url).origin;
  const record = {
    version: 1,
    records: {
      [oauthKey(f.config)]: {
        issuer,
        clients: {},
        tokens: { [issuer]: { access_token: "fixture-access", token_type: "Bearer" } },
        expiresAt: { [issuer]: Date.now() + 3600000 },
      },
    },
  };
  const encrypted = await app.evaluate(
    ({ safeStorage }, record) =>
      safeStorage.encryptString(JSON.stringify(record)).toString("base64"),
    record,
  );
  await writeFile(path.join(profile, "mcp-oauth.enc"), Buffer.from(encrypted, "base64"));
  const editorUrl = `http://127.0.0.1:${port}/`;
  let page;
  await until(() => {
    page = app.windows().find((w) => w.url() === editorUrl);
    return page;
  }, "editor");
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const evalEditor = (source) =>
    app.evaluate(
      ({ BrowserWindow }, { source, editorUrl }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === editorUrl)
          .webContents.executeJavaScript(source),
      { source, editorUrl },
    );
  const status = async () => (await evalEditor('window.anvilNative.agentJob("status")')).state;
  const files = { "note.txt": "BEFORE" };
  await page.evaluate(
    ({ project, files, service, baseUrl }) =>
      window.__anvilIde.setState({
        setupDone: true,
        autoUpdate: false,
        backgroundAgent: true,
        backgroundWriteThrough: false,
        agentMode: "agent",
        files,
        dirty: {},
        editBases: {},
        pendingDiffs: [],
        chat: [],
        workspaceCwd: project,
        autoSaveDisk: false,
        mcpServers: [service],
        activeSurfaceId: "anvil",
        surfaceMode: "bridge",
        llmProvider: "custom",
        llmAuthMode: "key",
        llmBaseUrl: baseUrl,
        llmModel: "qa-local",
        llmApiKey: "",
        llmContext: 32768,
        llmContextAuto: false,
        llmThinking: "auto",
        llmHardStopMin: 0,
        autoRunAgent: false,
        runLoop: false,
        graphLoop: false,
      }),
    { project, files, service: f.config, baseUrl: `http://127.0.0.1:${model.address().port}/v1` },
  );
  await until(async () => (await evalEditor('window.anvilNative.agentJob("status")')).available);
  await page
    .locator("textarea")
    .last()
    .fill("Lade die freigegebenen Werkzeuge und rufe record mit text desktop auf.");
  await page.locator("textarea").last().press("Enter");
  await until(() => f.state.calls.length === 1, "pending MCP call");
  const running = await status();
  assert.equal(running.operation.kind, "mcp");
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  const crash = () =>
    app.evaluate(
      ({ BrowserWindow }, editorUrl) =>
        new Promise((resolve) => {
          const wc = BrowserWindow.getAllWindows().find(
            (w) => w.webContents.getURL() === editorUrl,
          ).webContents;
          wc.once("did-finish-load", resolve);
          wc.forcefullyCrashRenderer();
        }),
      editorUrl,
    );
  await crash();
  assert.equal((await status()).id, running.id);
  assert.equal((await status()).status, "running");
  assert.equal(
    f.state.held[0].res.destroyed,
    false,
    "editor recovery must not cancel background MCP",
  );
  f.release();
  await until(async () => (await status()).status === "done", "service completion");
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.badAuth, 0);
  assert.match((await status()).text, /SERVICE_DESKTOP_OK/);
  assert.deepEqual(modelErrors, []);
  assert.ok(!JSON.stringify(await status()).includes("fixture-access"));
  await until(
    () => evalEditor('document.body.innerText.includes("SERVICE_DESKTOP_OK")'),
    "restored UI",
  );
  await evalEditor(`window.anvilNative.agentJob('dismiss',{id:${JSON.stringify(running.id)}})`);
  round = 0;
  const base = {
    project,
    files,
    // Direct IPC starts must carry the same permissions as the restored UI.
    knowledge: { enabled: true, personEnabled: true, projectEnabled: true, skillsEnabled: true, skillBodies: true, pluginSkills: true, memories: [], skills: [] },
    execution: true,
    writeThrough: false,
    services: [f.config],
    surface: { id: "anvil", mode: "bridge" },
    messages: [{ role: "user", content: "Use the test service." }],
    model: {
      provider: "custom",
      baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
      model: "qa-local",
      context: 32768,
      thinking: "auto",
      hardStopMin: 0,
    },
    maxRounds: 8,
  };
  await evalEditor(`window.anvilNative.agentJob('start',${JSON.stringify(base)})`);
  await until(() => f.state.calls.length === 2, "second pending MCP");
  await evalEditor(
    "window.__anvilIde.setState({mcpServers:window.__anvilIde.getState().mcpServers.map(s=>({...s,allowedTools:[]}))})",
  );
  await until(async () => (await status()).status === "stopped", "revoked permission");
  assert.equal(f.state.calls.length, 2);
  assert.match((await status()).error, /möglicherweise bereits/);
  await evalEditor(
    'window.anvilNative.agentJob("status").then(r=>window.anvilNative.agentJob("dismiss",{id:r.state.id}))',
  );
  await evalEditor(`window.__anvilIde.setState({mcpServers:[${JSON.stringify(f.config)}]})`);
  round = 0;
  await evalEditor(`window.anvilNative.agentJob('start',${JSON.stringify(base)})`);
  await until(() => f.state.calls.length === 3, "logout fixture call");
  const logout = await evalEditor(
    `window.anvilNative.mcpRequest(${JSON.stringify({ id: "stage3-logout", server: f.config, method: "oauth/logout" })})`,
  );
  assert.equal(logout.ok, true, logout.error);
  await until(async () => (await status()).status === "failed", "OAuth logout aborts owned call");
  assert.match((await status()).error, /Prüfe dort das Ergebnis, bevor du sie erneut startest/);
  assert.equal(f.state.calls.length, 3);
  await evalEditor(
    'window.anvilNative.agentJob("status").then(r=>window.anvilNative.agentJob("dismiss",{id:r.state.id}))',
  );
  await evalEditor("window.__anvilIde.setState({mcpServers:[]})");
  await writeFile(path.join(cliRoot, "cli-hold"), "hold");
  await writeFile(
    path.join(cliRoot, "cli-choice.json"),
    JSON.stringify([
      {
        content: "Ich lese die Datei.",
        tool_calls: [{ name: "read_file", arguments: JSON.stringify({ path: "note.txt" }) }],
      },
      {
        content: "Ich ändere den Entwurf.",
        tool_calls: [
          {
            name: "edit_file",
            arguments: JSON.stringify({
              path: "note.txt",
              old_string: "BEFORE",
              new_string: "CLI_AFTER",
            }),
          },
        ],
      },
      { content: "CLI_DESKTOP_OK", tool_calls: [] },
    ]),
  );
  const cliRequest = {
    ...base,
    services: [],
    model: {
      cliKind: "claude",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      thinking: "low",
      context: 32768,
      hardStopMin: 0,
    },
  };
  await evalEditor(`window.anvilNative.agentJob('start',${JSON.stringify(cliRequest)})`);
  await until(() => existsSync(path.join(cliRoot, "cli.pid")), "CLI process");
  const cliJob = await status(),
    pid = Number(await readFile(path.join(cliRoot, "cli.pid"), "utf8"));
  assert.equal(cliJob.operation.kind, "cli");
  await crash();
  assert.doesNotThrow(() => process.kill(pid, 0));
  assert.equal((await status()).id, cliJob.id);
  await rm(path.join(cliRoot, "cli-hold"));
  await until(async () => ["done", "failed"].includes((await status()).status), "CLI completion");
  const done = await status();
  assert.equal(done.status, "done", done.error);
  assert.equal(done.drafts["note.txt"].after, "CLI_AFTER");
  assert.match(done.text, /CLI_DESKTOP_OK/);
  const calls = (await readFile(path.join(cliRoot, "cli-calls.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].thinking, "2048");
  assert.ok(calls[2].input.includes("CLI_AFTER"));
  assert.equal(calls[0].args[calls[0].args.indexOf("--tools") + 1], "");
  await until(
    () => evalEditor('document.body.innerText.includes("CLI_DESKTOP_OK")'),
    "CLI restored UI",
  );
  const shot = await app.evaluate(
    async ({ BrowserWindow }, editorUrl) =>
      (
        await BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === editorUrl)
          .webContents.capturePage()
      ).toDataURL(),
    editorUrl,
  );
  await writeFile(path.join(output, "editor.png"), Buffer.from(shot.split(",")[1], "base64"));
  assert.deepEqual(errors, []);
  await evalEditor(`window.anvilNative.agentJob('dismiss',{id:${JSON.stringify(done.id)}})`);
  await writeFile(path.join(cliRoot, "cli-hold"), "hold");
  await evalEditor(`window.anvilNative.agentJob('start',${JSON.stringify(cliRequest)})`);
  await until(
    async () =>
      (await readFile(path.join(cliRoot, "cli-calls.jsonl"), "utf8")).trim().split("\n").length ===
      4,
    "CLI close fixture",
  );
  const stopPid = Number(await readFile(path.join(cliRoot, "cli.pid"), "utf8"));
  await evalEditor("window.__anvilIde.setState({dirty:{},pendingDiffs:[]})");
  await app.evaluate(
    ({ BrowserWindow }, editorUrl) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === editorUrl)
        .close(),
    editorUrl,
  );
  await until(() => proc.exitCode !== null, "app close");
  assert.throws(() => process.kill(stopPid, 0));
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        ok: true,
        checks: [
          "saved OAuth reused",
          "MCP call survives renderer crash exactly once",
          "revoking tool grant cancels job",
          "OAuth logout cancels owned request",
          "CLI process survives renderer crash",
          "real CLI choice loop reads and edits draft",
          "thinking preserved",
          "no CLI native tools",
          "normal app close kills CLI",
        ],
        mcpCalls: f.state.calls.length,
        cliCalls: 4,
      },
      null,
      2,
    ),
  );
  console.log("BACKGROUND_STAGE3_SERVICES_AND_CLI_RECOVERY_OK");
} finally {
  f.release();
  if (app) {
    const deadline = setTimeout(() => proc?.kill(), 8000);
    try {
      await app.close();
    } catch {}
    clearTimeout(deadline);
  }
  model.closeAllConnections();
  await new Promise((r) => model.close(r));
  await f.close();
}
