/**
 * Anvil Engine Companion — auf dem Rechner mit Godot/Unity/…
 *   HTTP  GET /v1/ping  POST /v1/run
 *   MCP   POST /mcp
 * Start: node companion/server.mjs
 * Token: ~/.anvil-companion-token  oder  ANVIL_COMPANION_TOKEN
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runLint, lintBins } from "./lint.mjs";
import { listLsp, pullLsp, checkLsp } from "./lsp.mjs";
import { installBin, installerKind, refreshPath } from "./install.mjs";
import { listToolchains, pullToolchain, removeToolchain, resolveBin, abortPull, toolchainProgress, toolHome, toolEnv } from "./toolchain.mjs";
import { ccArgs, javaMainClass, isCargo, isGoMod, isCsproj, firstCsproj } from "./compile-plan.mjs";
import { snapshot, setAnvilHome, lspHome, ensureHomes } from "./paths.mjs";
import { termKill, termPlatform, termRead, termStart, termWrite } from "./term.mjs";
import { llmUpstream, noTimeout, pipeQuiet, isAbortNoise } from "../scripts/llm-agent.mjs";
import { gitDispatch, gitBin, listTree, writeRel, removeRel, mkdirRel, resolveCwd } from "./git.mjs";
import { debugCmd, debugPoll, debugStart, debugStop } from "./debug.mjs";

process.on("uncaughtException", (err) => {
  if (isAbortNoise(err)) return;
  console.error(err);
});
process.on("unhandledRejection", (err) => {
  if (isAbortNoise(err)) return;
  console.error(err);
});

const PORT = Number(process.env.ANVIL_COMPANION_PORT || 7845);
const HOST = process.env.ANVIL_COMPANION_HOST || "127.0.0.1";
const MAX_MS = Number(process.env.ANVIL_COMPANION_TIMEOUT || 120000);
const ROOT = path.resolve(process.env.ANVIL_ENGINE_ROOT || process.cwd());
let workspace = ROOT;
const TOKEN_PATH = process.env.ANVIL_COMPANION_TOKEN_FILE || path.join(os.homedir(), ".anvil-companion-token");
const ALLOW = new Set(["godot", "godot4", "unity", "Unity", "UnrealEditor", "cargo", "love"]);

function loadToken() {
  if (process.env.ANVIL_COMPANION_TOKEN) return process.env.ANVIL_COMPANION_TOKEN.trim();
  try {
    const t = readFileSync(TOKEN_PATH, "utf8").trim();
    if (t) return t;
  } catch {
    /* */
  }
  const t = randomBytes(24).toString("hex");
  try {
    writeFileSync(TOKEN_PATH, t, { encoding: "utf8", mode: 0o600 });
  } catch {
    /* */
  }
  return t;
}

const TOKEN = loadToken();

function which(bin) {
  const env = process.env.PATH || "";
  const ext = process.platform === "win32" ? [".exe", ".bat", ""] : [""];
  for (const dir of env.split(path.delimiter)) {
    for (const e of ext) {
      const p = path.join(dir, bin + e);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function bins() {
  const extra = lintBins();
  const raw = {
    godot: which("godot") || which("godot4"),
    unity: which("unity") || which("Unity"),
    UnrealEditor: which("UnrealEditor"),
    cargo: which("cargo"),
    love: which("love"),
    python: extra.python,
    pyright: extra.pyright,
    tsc: which("tsc"),
    go: which("go"),
    rustc: which("rustc"),
    javac: which("javac"),
    java: which("java"),
    cc: which("cc") || which("gcc") || which("clang"),
    cxx: which("c++") || which("g++") || which("clang++"),
    php: which("php"),
    ruby: which("ruby"),
    dotnet: which("dotnet"),
  };
  for (const k of Object.keys(raw)) {
    if (!raw[k]) raw[k] = resolveBin(k);
  }
  return raw;
}

function safeCwd(cwd) {
  const dir = path.resolve(cwd || workspace || ROOT);
  const roots = [...new Set([path.resolve(ROOT), path.resolve(workspace || ROOT)])];
  if (roots.some((a) => dir === a || dir.startsWith(a + path.sep))) return dir;
  throw new Error("cwd außerhalb des Engine-Roots");
}

function parseCmd(cmd) {
  const raw = String(cmd || "").trim();
  if (!raw) throw new Error("cmd fehlt");
  if (/[;&|`$()<>\n]/.test(raw)) throw new Error("Shell-Metazeichen verboten");
  const parts = raw.split(/\s+/);
  const base = path.basename(parts[0]);
  if (!ALLOW.has(base) && !ALLOW.has(parts[0])) throw new Error(`Binärdatei nicht erlaubt: ${base}`);
  const file = which(base) || which(parts[0]) || resolveBin(base);
  if (!file) throw new Error(`${base} nicht im PATH`);
  return { file, args: parts.slice(1) };
}

function runCmd(cwd, cmd, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = parseCmd(cmd);
      cwd = safeCwd(cwd);
    } catch (err) {
      resolve({
        ok: false,
        code: 1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        duration: 0,
        cmd: String(cmd || ""),
      });
      return;
    }
    const start = Date.now();
    const child = spawn(parsed.file, parsed.args, { cwd, shell: false, env: toolEnv() });
    let stdout = "";
    let stderr = "";
    const cap = (s, add) => (s + add).slice(-24000);
    child.stdout?.on("data", (d) => {
      stdout = cap(stdout, d.toString());
    });
    child.stderr?.on("data", (d) => {
      stderr = cap(stderr, d.toString());
    });
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, timeoutMs || MAX_MS);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr, duration: Date.now() - start, cmd });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ ok: false, code: 1, stdout, stderr: String(err.message), duration: Date.now() - start, cmd });
    });
  });
}

function safeRel(p) {
  const n = String(p || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!n || n.includes("..") || path.isAbsolute(n)) throw new Error("ungültiger Pfad");
  return n;
}

function spawnOnce(file, args, cwd, timeoutMs, env) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(file, args, { cwd, shell: false, env: env || process.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const cap = (s, add) => (s + add).slice(-24000);
    child.stdout?.on("data", (d) => {
      stdout = cap(stdout, d.toString());
    });
    child.stderr?.on("data", (d) => {
      stderr = cap(stderr, d.toString());
    });
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, timeoutMs || MAX_MS);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr, duration: Date.now() - start });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ ok: false, code: 1, stdout, stderr: String(err.message), duration: Date.now() - start });
    });
  });
}

async function compileLang(body) {
  const lang = String(body.lang || "");
  const entry = safeRel(body.entry || "");
  const files = Array.isArray(body.files) ? body.files.slice(0, 80) : [];
  const timeoutMs = Math.min(MAX_MS, Number(body.timeoutMs) || 60000);
  const dir = path.join(os.tmpdir(), "anvil-run-" + randomBytes(6).toString("hex"));
  mkdirSync(dir, { recursive: true });
  const win = process.platform === "win32";
  const exe = (name) => (win ? path.join(dir, name + ".exe") : path.join(dir, name));
  const env = toolEnv();
  try {
    for (const f of files) {
      const rel = safeRel(f.path);
      const full = path.join(dir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, String(f.content ?? ""), "utf8");
    }
    const need = (bin) => {
      const p = resolveBin(bin) || which(bin);
      if (!p) throw new Error(`${bin} nicht in Anvil. Compiler holen (Einstellungen → Companion).`);
      return p;
    };
    const steps = [];
    if (lang === "go") {
      if (!isGoMod(files) && !existsSync(path.join(dir, "go.mod"))) writeFileSync(path.join(dir, "go.mod"), "module anvil\n\ngo 1.22\n");
      if (/_test\.go$/i.test(entry)) steps.push({ file: need("go"), args: ["test", "./..."] });
      else steps.push({ file: need("go"), args: ["run", entry] });
    } else if (lang === "rust") {
      if (isCargo(files) || existsSync(path.join(dir, "Cargo.toml"))) {
        const testRs = /_test\.rs$/i.test(entry) || /(^|\/)tests\//i.test(entry);
        steps.push({ file: need("cargo"), args: testRs ? ["test", "--quiet"] : ["run", "--quiet"] });
      } else {
        const out = exe("out");
        steps.push({ file: need("rustc"), args: [entry, "-o", out] });
        steps.push({ file: out, args: [] });
      }
    } else if (lang === "java") {
      const srcs = files.map((f) => safeRel(f.path)).filter((p) => p.endsWith(".java"));
      steps.push({ file: need("javac"), args: srcs.length ? srcs : [entry] });
      const src = files.find((f) => safeRel(f.path) === entry);
      const cls = javaMainClass(entry, src?.content ?? "");
      steps.push({ file: need("java"), args: ["-cp", ".", cls] });
    } else if (lang === "c" || lang === "cpp") {
      const bin = lang === "c" ? "cc" : "cxx";
      const compiler =
        resolveBin(bin) ||
        (lang === "c" ? which("cc") || which("gcc") || which("clang") : which("c++") || which("g++") || which("clang++"));
      if (!compiler) throw new Error(`${lang === "c" ? "cc" : "c++"} nicht in Anvil. Zig/C holen.`);
      const out = exe("out");
      steps.push({ file: compiler, args: ccArgs(compiler, lang, entry, files, out) });
      steps.push({ file: out, args: [] });
    } else if (lang === "php") {
      steps.push({ file: need("php"), args: [entry] });
    } else if (lang === "ruby") {
      steps.push({ file: need("ruby"), args: [entry] });
    } else if (lang === "csharp") {
      if (!isCsproj(files)) {
        const src = readFileSync(path.join(dir, entry), "utf8");
        if (entry !== "Program.cs") writeFileSync(path.join(dir, "Program.cs"), src);
        const csproj = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`;
        writeFileSync(path.join(dir, "app.csproj"), csproj);
      }
      const proj = firstCsproj(files);
      const args = proj ? ["run", "--nologo", "-v", "q", "--project", proj] : ["run", "--nologo", "-v", "q"];
      steps.push({ file: need("dotnet"), args });
    } else {
      throw new Error("Sprache nicht lokal: " + lang);
    }
    let last = { ok: false, code: 1, stdout: "", stderr: "", duration: 0 };
    let cmd = "";
    const phases = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      cmd = [s.file, ...s.args].join(" ");
      last = await spawnOnce(s.file, s.args, dir, timeoutMs, env);
      last.cmd = cmd;
      const phase = i < steps.length - 1 ? "compile" : "run";
      phases.push({ phase, cmd, ok: last.ok, stdout: last.stdout || "", stderr: last.stderr || "" });
      if (!last.ok) break;
    }
    const stdout = phases
      .map((p) => {
        const title = p.phase === "compile" ? "Compile" : "Run";
        const body = [p.cmd, p.stdout].filter(Boolean).join("\n");
        return `— ${title} —\n${body}`.trim();
      })
      .join("\n\n");
    const fail = phases.find((p) => !p.ok);
    return { ...last, cmd: phases.map((p) => p.cmd).join(" && "), stdout, stderr: fail ? fail.stderr : last.stderr, steps: phases };
  } catch (err) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      duration: 0,
      cmd: lang,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

function walkNames(root, max = 80) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= max || depth > 3) return;
    let ents = [];
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const rel = path.relative(root, path.join(dir, e.name)).replaceAll("\\", "/");
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
      else out.push(rel);
    }
  };
  walk(root, 0);
  return out;
}

function detectOnDisk(root) {
  const cwd = safeCwd(root || ROOT);
  const names = walkNames(cwd);
  const engines = [];
  if (names.some((p) => p.endsWith("project.godot"))) {
    engines.push({ id: "godot", cmds: { play: "godot --path .", check: "godot --headless --path . --quit-after 1", editor: "godot --editor --path ." } });
  }
  if (names.some((p) => p.includes("ProjectSettings")) && names.some((p) => p.includes("Assets"))) {
    engines.push({ id: "unity", cmds: { editor: "unity -projectPath .", test: "unity -projectPath . -batchmode -runTests -logFile -" } });
  }
  const up = names.find((p) => p.endsWith(".uproject"));
  if (up) engines.push({ id: "unreal", cmds: { editor: `UnrealEditor ${up}` } });
  const cargo = names.find((p) => p.endsWith("Cargo.toml"));
  if (cargo) {
    try {
      if (/bevy/i.test(readFileSync(path.join(cwd, cargo), "utf8"))) {
        engines.push({ id: "bevy", cmds: { play: "cargo run", check: "cargo check" } });
      }
    } catch {
      /* */
    }
  }
  if (names.includes("main.lua")) engines.push({ id: "love", cmds: { play: "love ." } });
  return { root: cwd, engines };
}

const TOOLS = [
  { name: "engine_detect", description: "Welche Engine liegt im Ordner?", inputSchema: { type: "object", properties: { cwd: { type: "string" } } } },
  { name: "engine_status", description: "Welche Engine-Binaries sind im PATH?", inputSchema: { type: "object", properties: {} } },
  {
    name: "engine_run",
    description: "Play/Check/Editor über die erkannte Engine. cmd nur Allowlist (godot/unity/cargo/…).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        cmd: { type: "string" },
        cwd: { type: "string" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "lint",
    description: "tsc / py_compile / pyright auf Dateien (Snapshot). files: [{path, content}]",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array" },
        timeoutMs: { type: "number" },
      },
    },
  },
];

async function callTool(name, args = {}) {
  const cwd = String(args.cwd || workspace);
  if (name === "engine_detect") return detectOnDisk(cwd);
  if (name === "engine_status") return { ok: true, bins: bins(), cwd };
  if (name === "engine_run") {
    const found = detectOnDisk(cwd);
    const hit = found.engines[0];
    const action = String(args.action || "check");
    const cmd = String(args.cmd || hit?.cmds[action] || hit?.cmds.play || hit?.cmds.check || "").trim();
    if (!cmd) return { ok: false, error: "Keine Engine oder kein Befehl." };
    return runCmd(cwd, cmd, Number(args.timeoutMs) || MAX_MS);
  }
  if (name === "lint") return runLint({ files: args.files || [], timeoutMs: args.timeoutMs });
  return { ok: false, error: `unbekanntes Tool ${name}` };
}

async function handleMcp(msg) {
  if (!msg || typeof msg !== "object") return null;
  const { id, method, params } = msg;
  const reply = (result) => (id === undefined ? null : { jsonrpc: "2.0", id, result });
  const fail = (code, message) => (id === undefined ? null : { jsonrpc: "2.0", id, error: { code, message } });
  if (method === "initialize") {
    return reply({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "anvil-companion", version: "1.1.0" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method === "tools/call") {
    const data = await callTool(params?.name, params?.arguments || {});
    return reply({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
  }
  return fail(-32601, `Methode unbekannt: ${method}`);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  else res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id, x-anvil-token",
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(req, res, code, obj) {
  cors(req, res);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function isLoopback(req) {
  const a = req.socket.remoteAddress || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function pairPage(to) {
  const token = TOKEN.replace(/[<>&]/g, "");
  const target = /^https?:\/\//.test(to) ? to.replace(/"/g, "") : "";
  return `<!doctype html><meta charset="utf-8"/><title>Anvil Companion</title>
<meta http-equiv="X-Frame-Options" content="DENY"/>
<body style="font:14px system-ui;background:#111;color:#eee;padding:24px;max-width:40rem">
<h1 style="font-size:16px">Companion-Token</h1>
<p>Nur von diesem Rechner. In Anvil unter Einstellungen → Token eintragen, oder koppeln.</p>
<pre id="tok" style="padding:12px;background:#000;overflow:auto">${token}</pre>
<p><button id="copy">Kopieren</button> ${target ? '<button id="send">An Anvil übergeben</button>' : ""}</p>
<script>
document.getElementById("copy").onclick=function(){navigator.clipboard.writeText(${JSON.stringify(TOKEN)});this.textContent="Kopiert"};
var send=document.getElementById("send");
if(send) send.onclick=function(){
  if(window.opener) window.opener.postMessage({anvilPair:1,token:${JSON.stringify(TOKEN)}}, ${JSON.stringify(target)});
  this.textContent="Gesendet — Tab zu";
};
<\/script></body>`;
}

function isLanHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "169.254.169.254") return false;
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal")) return true;
  if (h === "::1") return true;
  const p = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!p) return false;
  const a = Number(p[1]);
  const b = Number(p[2]);
  if (a === 10 || a === 127 || a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function lanTarget(raw) {
  const u = new URL(String(raw || "").trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("nur http(s)");
  if (!isLanHost(u.hostname)) throw new Error("nur lokale / LAN-Adressen");
  return u.toString();
}

function checkToken(req) {
  const got = String(req.headers["x-anvil-token"] || "");
  return Boolean(TOKEN) && got === TOKEN;
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  if (req.method === "GET" && url.pathname === "/v1/pair") {
    if (!isLoopback(req)) {
      json(req, res, 403, { ok: false, error: "pair nur localhost" });
      return;
    }
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.writeHead(200);
    res.end(pairPage(url.searchParams.get("to") || ""));
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/ping") {
    if (!checkToken(req)) {
      json(req, res, 401, { ok: false, error: "Token fehlt. ~/.anvil-companion-token nach Einstellungen kopieren.", needToken: true });
      return;
    }
    refreshPath();
    json(req, res, 200, {
      ok: true,
      version: "1.1.0",
      modes: ["http", "mcp", "compile", "lsp", "install", "toolchain", "git", "debug"],
      bins: bins(),
      lsp: listLsp(),
      installer: installerKind(),
      toolchains: listToolchains(),
      toolHome: toolHome(),
      lspHome: lspHome(),
      packages: snapshot(),
      toolPull: toolchainProgress(),
      git: Boolean(gitBin()),
      workspace,
    });
    return;
  }
  if (!checkToken(req)) {
    json(req, res, 401, { ok: false, error: "Token fehlt (Header x-anvil-token)." });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/llm") {
    try {
      const body = await readBody(req);
      const target = lanTarget(body.url);
      const method = String(body.method || "GET").toUpperCase();
      const hdrs = body.headers && typeof body.headers === "object" ? body.headers : {};
      const ac = new AbortController();
      req.on("aborted", () => ac.abort());
      res.on("close", () => {
        if (!res.writableEnded) ac.abort();
      });
      const timeoutMs = Math.max(0, Number(body.timeoutMs) || 0);
      const init = {
        method,
        headers: hdrs,
        signal: timeoutMs > 0 ? AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]) : ac.signal,
      };
      if (method !== "GET" && method !== "HEAD" && body.body != null) init.body = typeof body.body === "string" ? body.body : JSON.stringify(body.body);
      let r;
      try {
        r = await llmUpstream(target, init);
      } catch (e) {
        res.setHeader("x-anvil-proxy", "1");
        json(req, res, 502, { error: `Modell nicht erreichbar (${target}): ${e instanceof Error ? e.message : e}` });
        return;
      }
      cors(req, res);
      res.writeHead(r.status, {
        "content-type": r.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      });
      if (!r.stream) {
        res.end();
        return;
      }
      pipeQuiet(r.stream, res);
    } catch (e) {
      res.setHeader("x-anvil-proxy", "1");
      json(req, res, 400, { error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/run") {
    try {
      const body = await readBody(req);
      const cmd = String(body.cmd || "").trim();
      if (!cmd) {
        json(req, res, 400, { ok: false, error: "cmd fehlt" });
        return;
      }
      json(req, res, 200, await runCmd(String(body.cwd || workspace), cmd, Number(body.timeoutMs) || MAX_MS));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/workspace") {
    if (!checkToken(req)) {
      json(req, res, 401, { ok: false, error: "Token fehlt.", needToken: true });
      return;
    }
    try {
      const body = await readBody(req);
      workspace = resolveCwd(String(body.cwd || ""));
      json(req, res, 200, { ok: true, cwd: workspace, git: Boolean(gitBin()) });
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/tree") {
    if (!checkToken(req)) {
      json(req, res, 401, { ok: false, error: "Token fehlt.", needToken: true });
      return;
    }
    try {
      const cwd = url.searchParams.get("cwd") || workspace;
      json(req, res, 200, listTree(cwd));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/file") {
    if (!checkToken(req)) {
      json(req, res, 401, { ok: false, error: "Token fehlt.", needToken: true });
      return;
    }
    try {
      const body = await readBody(req);
      const cwd = String(body.cwd || workspace);
      json(req, res, 200, writeRel(cwd, String(body.path || ""), String(body.content ?? "")));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/file/delete") {
    if (!checkToken(req)) {
      json(req, res, 401, { ok: false, error: "Token fehlt.", needToken: true });
      return;
    }
    try {
      const body = await readBody(req);
      json(req, res, 200, removeRel(String(body.cwd || workspace), String(body.path || "")));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/mkdir") {
    if (!checkToken(req)) {
      json(req, res, 401, { ok: false, error: "Token fehlt.", needToken: true });
      return;
    }
    try {
      const body = await readBody(req);
      json(req, res, 200, mkdirRel(String(body.cwd || workspace), String(body.path || "")));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/git") {
    if (!checkToken(req)) {
      json(req, res, 401, { ok: false, error: "Token fehlt.", needToken: true });
      return;
    }
    try {
      const body = await readBody(req);
      json(req, res, 200, await gitDispatch(String(body.action || "status"), { ...body, cwd: body.cwd || workspace }));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/debug") {
    try {
      const body = await readBody(req);
      const action = String(body.action || "poll");
      if (action === "start") {
        json(req, res, 200, debugStart({ ...body, cwd: body.cwd || workspace }));
        return;
      }
      if (action === "cmd") {
        json(req, res, 200, debugCmd(String(body.id || ""), String(body.cmd || "continue"), body.expr != null ? String(body.expr) : "", body.breakpoints));
        return;
      }
      if (action === "stop") {
        json(req, res, 200, debugStop(String(body.id || "")));
        return;
      }
      json(req, res, 200, debugPoll(String(body.id || "")));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/toolchain") {
    json(req, res, 200, { ok: true, pull: toolchainProgress(), toolHome: toolHome(), toolchains: listToolchains() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/toolchain") {
    try {
      const body = await readBody(req);
      const id = String(body.id || body.bin || "");
      const action = String(body.action || "pull");
      if (action === "remove") json(req, res, 200, removeToolchain(id));
      else if (action === "abort") json(req, res, 200, abortPull());
      else json(req, res, 200, await pullToolchain(id));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/install") {
    try {
      const body = await readBody(req);
      json(req, res, 200, await installBin(String(body.bin || "")));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/compile") {
    try {
      const body = await readBody(req);
      json(req, res, 200, await compileLang(body));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/lsp") {
    json(req, res, 200, { ok: true, servers: listLsp(), home: lspHome() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/lsp/pull") {
    try {
      const body = await readBody(req);
      json(req, res, 200, await pullLsp(String(body.id || "")));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/lsp/check") {
    try {
      const body = await readBody(req);
      json(req, res, 200, await checkLsp(String(body.id || "")));
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/home") {
    json(req, res, 200, { ok: true, ...snapshot() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/home") {
    try {
      const body = await readBody(req);
      json(req, res, 200, { ok: true, ...setAnvilHome(String(body.path || body.home || "")) });
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e instanceof Error ? e.message : e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/lint") {
    try {
      const body = await readBody(req);
      json(
        req,
        res,
        200,
        await runLint({
          files: body.files || [],
          timeoutMs: Number(body.timeoutMs) || 40000,
          enabled: body.enabled,
          lspTimeoutMs: Number(body.lspTimeoutMs) || 8000,
        }),
      );
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/term/start") {
    try {
      const body = await readBody(req).catch(() => ({}));
      json(req, res, 200, { ok: true, ...termStart(String(body.cwd || ROOT)), ...termPlatform() });
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/term/in") {
    try {
      const body = await readBody(req);
      json(req, res, 200, { ok: termWrite(String(body.id || ""), String(body.data || "")) });
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/term/out") {
    json(req, res, 200, termRead(url.searchParams.get("id") || ""));
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/term/kill") {
    try {
      const body = await readBody(req);
      json(req, res, 200, { ok: termKill(String(body.id || "")) });
    } catch (e) {
      json(req, res, 400, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
    try {
      const body = await readBody(req);
      const msgs = Array.isArray(body) ? body : [body];
      const out = [];
      for (const m of msgs) {
        const r = await handleMcp(m);
        if (r) out.push(r);
      }
      if (!out.length) {
        res.writeHead(202);
        res.end();
        return;
      }
      json(req, res, 200, out.length === 1 ? out[0] : out);
    } catch (e) {
      json(req, res, 400, { jsonrpc: "2.0", error: { code: -32700, message: String(e) }, id: null });
    }
    return;
  }
  json(req, res, 404, { ok: false, error: "not found" });
});

noTimeout(server);
server.listen(PORT, HOST, () => {
  ensureHomes();
  const snap = snapshot();
  console.log(`Anvil companion http://${HOST}:${PORT}`);
  console.log(`Token-Datei ${TOKEN_PATH}`);
  console.log(`Pakete ${snap.home}`);
  console.log(`Koppeln: http://127.0.0.1:${PORT}/v1/pair`);
});
