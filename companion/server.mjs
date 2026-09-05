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
import { ccArgs, javaMainClass, isCargo, isGoMod, isCsproj, firstCsproj, looksGui } from "./compile-plan.mjs";
import { snapshot, setAnvilHome, lspHome, ensureHomes } from "./paths.mjs";
import { termKill, termPlatform, termRead, termStart, termWrite } from "./term.mjs";
import { llmUpstream, noTimeout, pipeQuiet, isAbortNoise, isCloudLlmHost } from "../scripts/llm-agent.mjs";
import { rmDir, rmSoon, sweepAnvilTemp } from "./tmp.mjs";
import { gitDispatch, gitBin, listTree, writeRel, removeRel, mkdirRel, resolveCwd } from "./git.mjs";
import { debugCmd, debugPoll, debugStart, debugStop } from "./debug.mjs";
import {
  allowCorsOrigin,
  blockedCwd,
  homeOk,
  isLanHost,
  llmHeaders,
  MAX_BODY,
  mcpProtocol,
  pairTarget,
  runAllowed,
  tokenOk,
  whichExts,
} from "./guard.mjs";

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
  const ext = whichExts();
  const lookup = (name) => {
    for (const dir of env.split(path.delimiter)) {
      for (const e of ext) {
        const p = path.join(dir, name + e);
        if (existsSync(p)) return p;
      }
    }
    return null;
  };
  const hit = lookup(bin);
  if (hit) return hit;
  if (process.platform === "win32" && (bin === "python" || bin === "python3")) return lookup("py");
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
  const root = path.resolve(workspace || ROOT);
  const dir = path.resolve(cwd || root);
  if (blockedCwd(dir)) throw new Error("Systemordner gesperrt");
  if (dir === root || dir.startsWith(root + path.sep)) return dir;
  throw new Error("cwd außerhalb des Workspace");
}

function parseCmd(cmd) {
  const raw = String(cmd || "").trim();
  if (!raw) throw new Error("cmd fehlt");
  if (/[;&|`$()<>\n]/.test(raw)) throw new Error("Shell-Metazeichen verboten");
  const parts = raw.split(/\s+/);
  const base = path.basename(parts[0]);
  if (!runAllowed(base) && !runAllowed(parts[0])) throw new Error(`Binärdatei nicht erlaubt: ${base}`);
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

function spawnOnce(file, args, cwd, timeoutMs, env, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const show = Boolean(opts.show);
    const detach = Boolean(opts.detach);
    const child = spawn(file, args, {
      cwd,
      shell: false,
      env: env || process.env,
      windowsHide: !show,
      detached: detach,
      stdio: detach ? ["ignore", "pipe", "pipe"] : undefined,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cap = (s, add) => (s + add).toString().slice(-24000);
    child.stdout?.on("data", (d) => {
      stdout = cap(stdout, d.toString());
    });
    child.stderr?.on("data", (d) => {
      stderr = cap(stderr, d.toString());
    });
    const finish = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    if (detach) {
      const t = setTimeout(() => {
        try {
          child.stdout?.destroy();
        } catch {
          /* */
        }
        try {
          child.stderr?.destroy();
        } catch {
          /* */
        }
        try {
          child.unref();
        } catch {
          /* */
        }
        finish({
          ok: true,
          code: 0,
          stdout: (stdout || "Bühne: Fenster läuft.") + (child.pid ? `\npid ${child.pid}` : ""),
          stderr,
          duration: Date.now() - start,
          running: true,
          pid: child.pid,
        });
      }, 2500);
      child.on("close", (code) => {
        clearTimeout(t);
        finish({ ok: code === 0, code: code ?? 1, stdout, stderr, duration: Date.now() - start });
      });
      child.on("error", (err) => {
        clearTimeout(t);
        finish({ ok: false, code: 1, stdout, stderr: String(err.message), duration: Date.now() - start });
      });
      return;
    }
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, timeoutMs || MAX_MS);
    child.on("close", (code) => {
      clearTimeout(t);
      finish({ ok: code === 0, code: code ?? 1, stdout, stderr, duration: Date.now() - start });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      finish({ ok: false, code: 1, stdout, stderr: String(err.message), duration: Date.now() - start });
    });
  });
}

function trySafeCwd(cwd) {
  if (!cwd) return "";
  try {
    return safeCwd(cwd);
  } catch {
    return "";
  }
}

async function compileLang(body) {
  const lang = String(body.lang || "");
  const entry = safeRel(body.entry || "");
  const files = Array.isArray(body.files) ? body.files.slice(0, 80) : [];
  const timeoutMs = Math.min(MAX_MS, Number(body.timeoutMs) || 60000);
  const persistRoot = trySafeCwd(body.cwd);
  const tmp = path.join(os.tmpdir(), "anvil-run-" + randomBytes(6).toString("hex"));
  const workDir = persistRoot ? path.join(persistRoot, ".anvil", "work") : tmp;
  const outDir = persistRoot ? path.join(persistRoot, ".anvil", "out") : workDir;
  const runCwd = persistRoot || workDir;
  mkdirSync(workDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const win = process.platform === "win32";
  const exe = (name) => (win ? path.join(outDir, name + ".exe") : path.join(outDir, name));
  const env = toolEnv();
  const gui = looksGui(files);
  const abs = (rel) => path.join(workDir, rel);
  let keepTmp = false;
  try {
    for (const f of files) {
      const rel = safeRel(f.path);
      const full = abs(rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, String(f.content ?? ""), "utf8");
    }
    const need = (bin) => {
      const p = resolveBin(bin) || which(bin);
      if (!p) throw new Error(`${bin} nicht in Anvil. Compiler holen (Einstellungen → Companion).`);
      return p;
    };
    const steps = [];
    let projectBound = false;
    if (lang === "go") {
      projectBound = true;
      if (!isGoMod(files) && !existsSync(path.join(workDir, "go.mod"))) writeFileSync(path.join(workDir, "go.mod"), "module anvil\n\ngo 1.22\n");
      if (/_test\.go$/i.test(entry)) steps.push({ file: need("go"), args: ["test", "-v", "./..."] });
      else steps.push({ file: need("go"), args: ["run", entry] });
    } else if (lang === "rust") {
      if (isCargo(files) || existsSync(path.join(workDir, "Cargo.toml"))) {
        projectBound = true;
        const testRs = /_test\.rs$/i.test(entry) || /(^|\/)tests\//i.test(entry);
        steps.push({ file: need("cargo"), args: testRs ? ["test"] : ["run", "--quiet"] });
      } else {
        const out = exe("out");
        steps.push({ file: need("rustc"), args: [entry, "-o", out] });
        steps.push({ file: out, args: [] });
      }
    } else if (lang === "java") {
      const srcs = files.map((f) => safeRel(f.path)).filter((p) => p.endsWith(".java"));
      steps.push({ file: need("javac"), args: ["-d", outDir, ...(srcs.length ? srcs : [entry])] });
      const src = files.find((f) => safeRel(f.path) === entry);
      const cls = javaMainClass(entry, src?.content ?? "");
      steps.push({ file: need("java"), args: ["-cp", outDir, cls] });
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
      steps.push({ file: need("php"), args: [abs(entry)] });
    } else if (lang === "ruby") {
      steps.push({ file: need("ruby"), args: [abs(entry)] });
    } else if (lang === "python") {
      const py = resolveBin("python") || which("python") || which("python3") || which("py");
      if (!py) throw new Error("python nicht in Anvil. Python holen (Einstellungen → Companion).");
      steps.push({ file: py, args: [abs(entry)] });
    } else if (lang === "javascript" || lang === "typescript") {
      const node = resolveBin("node") || which("node");
      if (!node) throw new Error("node nicht in Anvil. Node holen (Einstellungen → Companion).");
      if (lang === "typescript") {
        const tsc = resolveBin("tsc") || which("tsc") || which("tsc.cmd");
        if (tsc) {
          steps.push({ file: tsc, args: ["--outDir", ".", "--esModuleInterop", "--module", "commonjs", "--skipLibCheck", entry] });
          steps.push({ file: node, args: [abs(entry.replace(/\.tsx?$/i, ".js"))] });
        } else {
          steps.push({ file: node, args: ["--experimental-strip-types", abs(entry)] });
        }
      } else {
        steps.push({ file: node, args: [abs(entry)] });
      }
    } else if (lang === "csharp") {
      projectBound = true;
      const testCs = /Tests?\.cs$/i.test(entry) || /(^|\/)tests?\//i.test(entry);
      if (!isCsproj(files)) {
        const src = readFileSync(abs(entry), "utf8");
        if (entry !== "Program.cs") writeFileSync(path.join(workDir, "Program.cs"), src);
        const csproj = testCs
          ? `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" /><PackageReference Include="xunit" Version="2.9.2" /><PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" /></ItemGroup></Project>`
          : `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`;
        writeFileSync(path.join(workDir, "app.csproj"), csproj);
      }
      const proj = firstCsproj(files);
      const args = testCs
        ? proj
          ? ["test", "--nologo", "-v", "n", "--project", proj]
          : ["test", "--nologo", "-v", "n"]
        : proj
          ? ["run", "--nologo", "-v", "q", "--project", proj]
          : ["run", "--nologo", "-v", "q"];
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
      const isRun = i === steps.length - 1;
      const cwd = isRun && !projectBound ? runCwd : workDir;
      last = await spawnOnce(s.file, s.args, cwd, timeoutMs, env, {
        show: isRun && gui,
        detach: isRun && gui,
      });
      last.cmd = cmd;
      const phase = i < steps.length - 1 ? "compile" : "run";
      phases.push({ phase, cmd, ok: last.ok, stdout: last.stdout || "", stderr: last.stderr || "" });
      if (last.running) keepTmp = !persistRoot;
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
    const outPath = persistRoot ? path.join(".anvil", "out") : "";
    const stage = last.running
      ? { kind: "window", out: outPath }
      : { kind: "log", out: outPath };
    return {
      ...last,
      cmd: phases.map((p) => p.cmd).join(" && "),
      stdout,
      stderr: fail ? fail.stderr : last.stderr,
      steps: phases,
      stage,
    };
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
    if (!persistRoot) {
      if (keepTmp) {
        rmSoon(workDir, 6, 10 * 60 * 1000);
        sweepAnvilTemp({ keep: 1, maxAgeMs: 60 * 60 * 1000 });
      } else {
        if (!rmDir(workDir)) rmSoon(workDir);
        sweepAnvilTemp({ keep: 0, maxAgeMs: 0 });
      }
    } else {
      sweepAnvilTemp({ keep: 0, maxAgeMs: 0 });
    }
  }
}

async function formatLang(body) {
  const rel = safeRel(body.path || "file.txt");
  const src = String(body.content ?? "");
  const ext = path.extname(rel).toLowerCase();
  const dir = path.join(os.tmpdir(), "anvil-fmt-" + randomBytes(4).toString("hex"));
  mkdirSync(dir, { recursive: true });
  const full = path.join(dir, path.basename(rel) || "file.txt");
  writeFileSync(full, src, "utf8");
  try {
    let bin = "";
    let args = [];
    if (ext === ".go") {
      bin = resolveBin("gofmt") || which("gofmt") || "";
      args = ["-w", full];
    } else if (ext === ".rs") {
      bin = resolveBin("rustfmt") || which("rustfmt") || "";
      args = [full];
    } else if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".hh"].includes(ext)) {
      bin = which("clang-format") || resolveBin("clang-format") || "";
      args = ["-i", full];
    }
    if (!bin) return { ok: true, content: src, via: "none" };
    await spawnOnce(bin, args, dir, 20000, toolEnv(), { show: false });
    return { ok: true, content: readFileSync(full, "utf8"), via: path.basename(bin) };
  } catch (err) {
    return { ok: false, content: src, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (!rmDir(dir)) rmSoon(dir);
    sweepAnvilTemp({ keep: 0, maxAgeMs: 0 });
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
      protocolVersion: mcpProtocol(params?.protocolVersion),
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "anvil-companion", version: "1.2.7" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method === "resources/list") {
    return reply({
      resources: [{ uri: "anvil://workspace", name: "workspace", mimeType: "text/plain" }],
    });
  }
  if (method === "resources/read") {
    const uri = String(params?.uri || "");
    if (uri === "anvil://workspace") {
      return reply({
        contents: [{ uri, mimeType: "text/plain", text: workspace }],
      });
    }
    return fail(-32002, `Resource unbekannt: ${uri}`);
  }
  if (method === "tools/call") {
    const data = await callTool(params?.name, params?.arguments || {});
    const err = Boolean(data && typeof data === "object" && (data.ok === false || data.error));
    return reply({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: err });
  }
  return fail(-32601, `Methode unbekannt: ${method}`);
}

function cors(req, res) {
  const origin = allowCorsOrigin(req.headers.origin);
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
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
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > MAX_BODY) {
        req.destroy();
        reject(new Error("Body zu groß"));
        return;
      }
      chunks.push(c);
    });
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
  const target = pairTarget(to);
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

function lanTarget(raw) {
  const u = new URL(String(raw || "").trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("nur http(s)");
  if (!isLanHost(u.hostname) && !isCloudLlmHost(u.hostname)) throw new Error("nur LAN oder Cloud-LLM");
  return u.origin + u.pathname + u.search;
}

function checkToken(req) {
  return tokenOk(req.headers["x-anvil-token"], TOKEN);
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
      version: "1.2.7",
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
      const hdrs = llmHeaders(body.headers);
      const ac = new AbortController();
      req.on("aborted", () => ac.abort());
      res.on("close", () => {
        if (!res.writableEnded) ac.abort();
      });
      const timeoutMs = Math.max(0, Number(body.timeoutMs) || 0);
      const init = {
        method,
        headers: hdrs,
        redirect: "error",
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
      json(req, res, 200, listTree(safeCwd(cwd)));
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
      const cwd = safeCwd(body.cwd || workspace);
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
      json(req, res, 200, removeRel(safeCwd(body.cwd || workspace), String(body.path || "")));
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
      json(req, res, 200, mkdirRel(safeCwd(body.cwd || workspace), String(body.path || "")));
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
      json(req, res, 200, await gitDispatch(String(body.action || "status"), { ...body, cwd: safeCwd(body.cwd || workspace) }));
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
  if (req.method === "POST" && url.pathname === "/v1/format") {
    try {
      const body = await readBody(req);
      json(req, res, 200, await formatLang(body));
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
      json(req, res, 200, { ok: true, ...termStart(safeCwd(body.cwd || workspace)), ...termPlatform() });
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
  if (req.method === "POST" && url.pathname === "/mcp") {
    try {
      const body = await readBody(req);
      const msgs = Array.isArray(body) ? body : [body];
      const out = [];
      for (const m of msgs) {
        if (m && m.method === "initialize") {
          res.setHeader("mcp-session-id", randomBytes(8).toString("hex"));
        }
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
  sweepAnvilTemp({ keep: 0, maxAgeMs: 0, toolchain: true });
  setInterval(() => sweepAnvilTemp({ keep: 0, maxAgeMs: 15 * 60 * 1000, toolchain: true }), 20 * 60 * 1000).unref?.();
  const snap = snapshot();
  console.log(`Anvil companion http://${HOST}:${PORT}`);
  console.log(`Token-Datei ${TOKEN_PATH}`);
  console.log(`Pakete ${snap.home}`);
  console.log(`Koppeln: http://127.0.0.1:${PORT}/v1/pair`);
});
