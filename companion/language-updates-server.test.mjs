import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

test("language update HTTP routes authenticate, validate, check official metadata and retain preferences after restart", { timeout: 30000 }, async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-language-http-"));
  const home = path.join(root, "home"), log = path.join(root, "fetch.log");
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const preload = path.join(root, "official-fixture.mjs");
  writeFileSync(preload, `import {appendFileSync} from 'node:fs';
globalThis.fetch=async(url, init)=>{
  appendFileSync(${JSON.stringify(log)}, String(url)+'\\n');
  if (init?.method && init.method !== 'GET') throw Error('metadata must be read-only');
  const u=new URL(url); let value;
  if(u.hostname==='registry.npmjs.org')value={version:u.pathname.includes('pyright')?'1.1.414':u.pathname.includes('typescript-language')?'6.0.1':u.pathname.includes('typescript')?'7.0.2':u.pathname.includes('yaml')?'1.24.0':'4.10.0'};
  else if(u.hostname==='nodejs.org')value=[{version:'v24.21.0',lts:'Krypton'}];
  else if(u.hostname==='go.dev')value=[{version:'go1.27.1',stable:true}];
  else if(u.hostname==='ziglang.org')value={'0.17.0':{},master:{}};
  else if(u.hostname==='static.rust-lang.org')return new Response('[pkg.rust]\\nversion = "1.99.0 (hash)"\\n');
  else if(u.hostname==='www.python.org')return new Response('Latest Python 3 Release - Python 3.14.8');
  else if(u.hostname==='learn.microsoft.com')return new Response('microsoft-jdk-21.0.12.1-windows-x64.zip microsoft-jdk-25.0.4.1-windows-x64.zip');
  else if(u.hostname==='windows.php.net')value={'8.3':{version:'8.3.35'}};
  else if(u.hostname==='dotnetcli.blob.core.windows.net')value={'channel-version':u.pathname.split('/')[3],'latest-sdk':u.pathname.includes('/10.0/')?'10.0.401':'8.0.425'};
  else if(u.hostname==='proxy.golang.org')value={Version:'v0.23.0'};
  else if(u.hostname==='api.github.com')value={tag_name:u.pathname.includes('rubyinstaller')?'RubyInstaller-4.0.7-1':u.pathname.includes('rust-analyzer')?'2026-09-28':'23.1.0',prerelease:false};
  else throw Error('unexpected metadata host '+u.hostname);
  return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
};`);
  mkdirSync(path.join(home, "lsp", "node_modules", ".bin"), { recursive: true });
  mkdirSync(path.join(home, "lsp", "node_modules", "pyright"), { recursive: true });
  writeFileSync(path.join(home, "lsp", "node_modules", "pyright", "package.json"), JSON.stringify({ version: "1.1.413" }));
  writeFileSync(path.join(home, "lsp", "node_modules", ".bin", process.platform === "win32" ? "pyright.cmd" : "pyright"), "fixture, not executable");
  const env = { ...process.env, ANVIL_ENGINE_ROOT: root, ANVIL_COMPANION_PORT: String(port), ANVIL_COMPANION_HOST: "127.0.0.1",
    ANVIL_COMPANION_TOKEN: "language-test-token", ANVIL_HOME: home, ANVIL_HOME_FILE: path.join(root, "home.txt"),
    ANVIL_TOOLCHAIN_HOME: path.join(home, "toolchains"), ANVIL_LSP_HOME: path.join(home, "lsp"), ANVIL_INSTALL_DIR: root };
  let child;
  async function stop() { if (child?.exitCode == null) { const ended = once(child, "exit"); child.kill(); await ended; } }
  t.after(async () => { await stop(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(root, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, "companion/server.mjs"], { cwd: path.resolve("."), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Companion did not start")), 10000);
      child.once("error", (e) => { clearTimeout(timer); reject(e); });
      child.stdout.on("data", (data) => { if (String(data).includes("Anvil companion")) { clearTimeout(timer); resolve(); } });
      child.stderr.on("data", () => {});
    });
  }
  const base = `http://127.0.0.1:${port}`, route = `${base}/v1/language-updates`;
  const request = async (body) => {
    const response = await fetch(route, { method: body ? "POST" : "GET", headers: { "x-anvil-token": "language-test-token", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  await start();
  assert.equal((await fetch(route)).status, 401);
  assert.equal((await fetch(route, { method: "POST", body: '{"action":"check"}' })).status, 401);
  assert.equal((await request()).data.automatic, true);
  assert.equal((await request({ action: "install" })).status, 400);
  assert.equal((await request({ action: "configure", automatic: "false" })).status, 400);
  assert.equal((await request({ action: "check", manual: "false" })).status, 400);
  assert.equal((await request({ action: "configure", automatic: false })).data.automatic, false);
  assert.equal((await request({ action: "check" })).data.items.length, 0);
  await stop(); await start();
  assert.equal((await request()).data.automatic, false);
  const result = await request({ action: "check", manual: true });
  assert.equal(result.status, 200);
  const pyright = result.data.items.find((r) => r.id === "lsp:pyright");
  assert.equal(pyright.installed, "1.1.413");
  assert.equal(pyright.latest, "1.1.414");
  assert.equal(pyright.status, "update");
  assert.equal(result.data.automatic, false);
  const calls = readFileSync(log, "utf8");
  assert.match(calls, /https:\/\/registry\.npmjs\.org\/pyright\/latest/);
  assert.equal((await request({ action: "check" })).data.checkedAt, result.data.checkedAt);
  assert.equal(readFileSync(log, "utf8"), calls);
  assert.equal(JSON.parse(readFileSync(path.join(home, "lsp", "node_modules", "pyright", "package.json"), "utf8")).version, "1.1.413");
  await stop(); await start();
  assert.equal((await request()).data.items.find((r) => r.id === "lsp:pyright").status, "update");
});
