import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { extraLspDiagnostics, lspBin } from "./lsp.mjs";

export function which(bin) {
  const local = lspBin(bin);
  if (local) return local;
  const env = process.env.PATH || "";
  const ext = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of env.split(path.delimiter)) {
    for (const e of ext) {
      const p = path.join(dir, bin + e);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function lintBins() {
  return {
    python: which("python3") || which("python") || which("py"),
    tsc: lspBin("tsc") || which("tsc"),
    pyright: lspBin("pyright") || which("pyright"),
    gopls: lspBin("gopls"),
    html: lspBin("vscode-html-language-server"),
    yaml: lspBin("yaml-language-server"),
  };
}

function findTsc(cwd) {
  const pulled = lspBin("tsc");
  if (pulled) return pulled;
  const local = path.join(cwd, "node_modules", "typescript", "bin", "tsc");
  if (existsSync(local)) return local;
  const g = which("tsc");
  return g;
}

function spawnArgs(file, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(file, args, { cwd, shell: false, env: process.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const cap = (s, add) => (s + add).slice(-80_000);
    child.stdout?.on("data", (d) => {
      stdout = cap(stdout, d.toString());
    });
    child.stderr?.on("data", (d) => {
      stderr = cap(stderr, d.toString());
    });
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, timeoutMs || 45000);
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

export function parseTsc(text) {
  const hits = [];
  for (const raw of text.split("\n")) {
    const m = raw.trim().match(/^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(\S+):\s+(.*)$/);
    if (!m) continue;
    hits.push({
      path: m[1].replace(/\\/g, "/"),
      line: Number(m[2]),
      col: Number(m[3]),
      severity: m[4] === "warning" ? "warning" : "error",
      message: `${m[5]}: ${m[6]}`.slice(0, 240),
      source: "tsc",
    });
  }
  return hits;
}

export function parsePyCompile(text) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/File "([^"]+)", line (\d+)/);
    if (!m) continue;
    let msg = "SyntaxError";
    for (let j = i; j < Math.min(i + 6, lines.length); j++) {
      if (/Error|error/.test(lines[j])) {
        msg = lines[j].trim();
        break;
      }
    }
    hits.push({
      path: m[1].replace(/\\/g, "/"),
      line: Number(m[2]),
      col: 1,
      severity: "error",
      message: msg.slice(0, 240),
      source: "py",
    });
  }
  return hits;
}

export function parsePyright(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    const diags = data.generalDiagnostics || data.diagnostics || [];
    return diags.slice(0, 80).map((d) => ({
      path: String(d.file || d.path || "").replace(/\\/g, "/"),
      line: Number(d.range?.start?.line ?? d.line ?? 0) + (d.range ? 1 : 0) || 1,
      col: Number(d.range?.start?.character ?? d.col ?? 0) + 1,
      severity: d.severity === "warning" || d.severity === "information" ? "warning" : "error",
      message: String(d.message || "").slice(0, 240),
      source: "pyright",
    }));
  } catch {
    return [];
  }
}

function safeRel(p) {
  const n = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n || n.includes("..") || n.startsWith("/")) return null;
  return n;
}

function writeSnap(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-lint-"));
  let n = 0;
  for (const f of files) {
    const rel = safeRel(f.path);
    if (!rel) continue;
    const body = String(f.content ?? "");
    if (body.length > 200_000) continue;
    const full = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
    n += 1;
    if (n >= 48) break;
  }
  return dir;
}

function relFrom(dir, abs) {
  return path.relative(dir, abs).replace(/\\/g, "/");
}

export async function runLint({ files = [], timeoutMs = 40000, enabled = null, lspTimeoutMs = 8000 } = {}) {
  const list = Array.isArray(files) ? files.slice(0, 48) : [];
  if (!list.length) return { ok: true, diagnostics: [], tools: [] };
  const allow = Array.isArray(enabled) && enabled.length ? new Set(enabled) : null;
  const on = (id) => !allow || allow.has(id);
  const dir = writeSnap(list);
  const tools = [];
  const diagnostics = [];
  const python = which("python3") || which("python") || which("py");
  const pyFiles = list.filter((f) => /\.py$/i.test(f.path)).map((f) => safeRel(f.path)).filter(Boolean);
  const tsFiles = list.filter((f) => /\.(ts|tsx|mts|cts)$/i.test(f.path)).map((f) => safeRel(f.path)).filter(Boolean);

  try {
    if (python && pyFiles.length) {
      const args = python.endsWith("py") || python.endsWith("py.exe")
        ? ["-3", "-m", "py_compile", ...pyFiles]
        : ["-m", "py_compile", ...pyFiles];
      const r = await spawnArgs(python, args, dir, timeoutMs);
      tools.push({ name: "py_compile", ok: r.ok });
      diagnostics.push(...parsePyCompile(r.stderr + "\n" + r.stdout).map((h) => ({ ...h, path: relFrom(dir, path.isAbsolute(h.path) ? h.path : path.join(dir, h.path)) || h.path })));
      const pr = on("pyright") ? lspBin("pyright") || which("pyright") : null;
      if (pr) {
        const p = await spawnArgs(pr, ["--outputjson", "-p", dir], dir, timeoutMs);
        tools.push({ name: "pyright", ok: p.ok });
        diagnostics.push(
          ...parsePyright(p.stdout || p.stderr).map((h) => ({
            ...h,
            path: relFrom(dir, h.path) || h.path,
          })),
        );
      }
    }
    const tsc = on("typescript") ? findTsc(dir) : null;
    if (tsc && tsFiles.length) {
      writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            noEmit: true,
            allowJs: true,
            skipLibCheck: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            strict: false,
          },
          include: ["**/*"],
        }),
      );
      const file = tsc.endsWith(".js") || tsc.includes("typescript") ? process.execPath : tsc;
      const args = file === process.execPath ? [tsc, "--noEmit", "--pretty", "false", "-p", dir] : ["--noEmit", "--pretty", "false", "-p", dir];
      const r = await spawnArgs(file, args, dir, timeoutMs);
      tools.push({ name: "tsc", ok: r.ok });
      diagnostics.push(
        ...parseTsc(r.stdout + "\n" + r.stderr).map((h) => ({
          ...h,
          path: relFrom(dir, path.isAbsolute(h.path) ? h.path : path.join(dir, h.path)) || h.path,
        })),
      );
    }
    const snapFiles = list
      .map((f) => ({ path: safeRel(f.path), content: String(f.content ?? "") }))
      .filter((f) => f.path);
    const extra = await extraLspDiagnostics(dir, snapFiles, Math.max(4000, lspTimeoutMs || 8000), enabled);
    diagnostics.push(...extra.map((h) => ({ ...h, path: relFrom(dir, path.isAbsolute(h.path) ? h.path : path.join(dir, h.path)) || h.path })));
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  }

  const seen = new Set();
  const uniq = [];
  for (const h of diagnostics) {
    const key = `${h.path}:${h.line}:${h.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ ...h, path: String(h.path).replace(/\\/g, "/") });
    if (uniq.length >= 80) break;
  }
  return { ok: true, diagnostics: uniq, tools };
}
