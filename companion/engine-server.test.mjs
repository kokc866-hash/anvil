import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { once } from "node:events";

test("authenticated engine HTTP/MCP routes persist paths and reject unsupported actions", { timeout: 20000 }, async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-engine-http-"));
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  mkdirSync(path.join(root, "Unity Project/Assets"), { recursive: true });
  mkdirSync(path.join(root, "Unity Project/ProjectSettings"), { recursive: true });
  writeFileSync(path.join(root, "Unity Project/ProjectSettings/ProjectVersion.txt"), "m_EditorVersion: 6000.3");
  const env = { ...process.env, ANVIL_ENGINE_ROOT: root, ANVIL_COMPANION_PORT: String(port), ANVIL_COMPANION_HOST: "127.0.0.1",
    ANVIL_COMPANION_TOKEN: "engine-test-token", ANVIL_HOME: path.join(root, "home"), ANVIL_TOOLCHAIN_HOME: path.join(root, "tools"), ANVIL_INSTALL_DIR: root,
    ANVIL_GODOT_BIN: "", ANVIL_UNITY_BIN: "", ANVIL_UNREAL_BIN: "" };
  const child = spawn(process.execPath, ["companion/server.mjs"], { cwd: path.resolve("."), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode == null) { child.kill(); await once(child, "exit"); }
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Companion did not start")), 10000);
    child.once("error", reject);
    child.stdout.on("data", (data) => { if (String(data).includes("Anvil companion")) { clearTimeout(timer); resolve(); } });
    child.stderr.on("data", () => {});
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/v1/engines`)).status, 401);
  const request = async (route, body) => {
    const response = await fetch(base + route, { method: body ? "POST" : "GET", headers: { "x-anvil-token": "engine-test-token", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await request("/v1/engines")).data.configured.godot, "");
  const configured = await request("/v1/engines", { godot: process.execPath });
  assert.equal(configured.status, 200);
  assert.equal(configured.data.bins.godot, process.execPath);
  assert.equal((await request("/v1/engines")).data.configured.godot, process.execPath);
  assert.equal((await request("/v1/engines", { godot: "missing" })).status, 400);
  const failure = await request("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "engine_run", arguments: { action: "check", engine: "unity" } } });
  assert.equal(failure.data.result.isError, true);
  assert.match(failure.data.result.content[0].text, /nicht unterstützt/);
  const script = path.join(root, "arg check.mjs");
  writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const run = await request("/v1/run", { cmd: `godot "${script}" "nested project"`, action: "check", timeoutMs: 3000 });
  assert.equal(run.data.ok, true);
  assert.match(run.data.stdout, /\["nested project"\]/);
  const status = await request(`/v1/run-status?id=${encodeURIComponent(run.data.stage.id)}`);
  assert.equal(status.data.running, false);
  assert.equal(status.data.ok, true);
});
