/** Free language servers, pulled into ~/.anvil/lsp (npm/go). No paid LSPs. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LSP_HOME = process.env.ANVIL_LSP_HOME || path.join(os.homedir(), ".anvil", "lsp");

export const LSP_CATALOG = [
  {
    id: "pyright",
    label: "Pyright",
    langs: "Python",
    license: "MIT",
    npm: ["pyright"],
    bin: "pyright",
    kind: "cli",
  },
  {
    id: "typescript",
    label: "TypeScript (tsc)",
    langs: "TS / TSX",
    license: "Apache-2.0",
    npm: ["typescript"],
    bin: "tsc",
    kind: "cli",
  },
  {
    id: "tsls",
    label: "TypeScript Language Server",
    langs: "JS / TS",
    license: "Apache-2.0",
    npm: ["typescript-language-server", "typescript"],
    bin: "typescript-language-server",
    args: ["--stdio"],
    kind: "lsp",
    ext: /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i,
    language: (p) => (/\.tsx$/i.test(p) ? "typescriptreact" : /\.jsx$/i.test(p) ? "javascriptreact" : /\.ts/i.test(p) ? "typescript" : "javascript"),
  },
  {
    id: "html",
    label: "HTML / CSS / JSON",
    langs: "HTML, CSS, JSON",
    license: "MIT",
    npm: ["vscode-langservers-extracted"],
    bin: "vscode-html-language-server",
    args: ["--stdio"],
    kind: "lsp",
    ext: /\.html?$/i,
    language: () => "html",
  },
  {
    id: "css",
    label: "CSS (im HTML-Paket)",
    langs: "CSS",
    license: "MIT",
    npm: ["vscode-langservers-extracted"],
    bin: "vscode-css-language-server",
    args: ["--stdio"],
    kind: "lsp",
    ext: /\.css$/i,
    language: () => "css",
    via: "html",
  },
  {
    id: "jsonls",
    label: "JSON (im HTML-Paket)",
    langs: "JSON",
    license: "MIT",
    npm: ["vscode-langservers-extracted"],
    bin: "vscode-json-language-server",
    args: ["--stdio"],
    kind: "lsp",
    ext: /\.json$/i,
    language: () => "json",
    via: "html",
  },
  {
    id: "yaml",
    label: "YAML",
    langs: "YAML",
    license: "MIT",
    npm: ["yaml-language-server"],
    bin: "yaml-language-server",
    args: ["--stdio"],
    kind: "lsp",
    ext: /\.ya?ml$/i,
    language: () => "yaml",
  },
  {
    id: "gopls",
    label: "gopls",
    langs: "Go",
    license: "BSD-3-Clause",
    go: "golang.org/x/tools/gopls@latest",
    bin: "gopls",
    args: ["serve"],
    kind: "lsp",
    ext: /\.go$/i,
    language: () => "go",
  },
];

function pathWhich(bin) {
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

export function lspBin(name) {
  const local = path.join(LSP_HOME, "node_modules", ".bin", name);
  const gobin = path.join(LSP_HOME, "bin", name);
  const ext = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const e of ext) {
    if (existsSync(local + e)) return local + e;
    if (existsSync(gobin + e)) return gobin + e;
  }
  return pathWhich(name);
}

export function listLsp() {
  const seen = new Set();
  return LSP_CATALOG.filter((p) => {
    if (p.via && seen.has(p.via)) return false;
    if (!p.via) seen.add(p.id);
    return !p.via;
  }).map((p) => {
    const bin = lspBin(p.bin);
    const extra = (p.id === "html" ? ["vscode-css-language-server", "vscode-json-language-server"] : [])
      .map((b) => lspBin(b))
      .filter(Boolean);
    return {
      id: p.id,
      label: p.label,
      langs: p.langs,
      license: p.license,
      ready: Boolean(bin),
      path: bin,
      extra: extra.length,
      via: p.npm ? "npm" : p.go ? "go" : "",
    };
  });
}

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(opts.env || {}) };
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
    const child = spawn(useShell ? process.env.ComSpec || "cmd.exe" : file, useShell ? ["/c", file, ...args] : args, {
      cwd: opts.cwd || process.cwd(),
      env,
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout = (stdout + d.toString()).slice(-120_000);
    });
    child.stderr?.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-80_000);
    });
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, opts.timeoutMs || 180000);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ ok: false, code: 1, stdout, stderr: String(err.message) });
    });
  });
}

export async function pullLsp(id) {
  const pack = LSP_CATALOG.find((p) => p.id === id || p.via === id);
  const target = LSP_CATALOG.find((p) => p.id === id) || pack;
  if (!target || target.via) {
    const parent = LSP_CATALOG.find((p) => p.id === (target?.via || id));
    if (!parent) return { ok: false, error: "Unbekanntes Paket", servers: listLsp() };
    return pullLsp(parent.id);
  }
  mkdirSync(path.join(LSP_HOME, "bin"), { recursive: true });
  if (target.npm) {
    const npm = pathWhich("npm") || pathWhich("npm.cmd");
    if (!npm) return { ok: false, error: "npm fehlt (Node.js).", servers: listLsp() };
    const r = await run(npm, ["install", "--prefix", LSP_HOME, "--omit=dev", "--no-fund", "--no-audit", ...target.npm], {
      timeoutMs: 180000,
    });
    if (!r.ok && !lspBin(target.bin)) {
      return { ok: false, error: (r.stderr || r.stdout || "npm install fehlgeschlagen").slice(0, 400), servers: listLsp() };
    }
  }
  if (target.go) {
    const go = pathWhich("go") || pathWhich("go.exe");
    if (!go) return { ok: false, error: "Go SDK fehlt für gopls.", servers: listLsp() };
    const r = await run(go, ["install", target.go], {
      timeoutMs: 180000,
      env: { ...process.env, GOBIN: path.join(LSP_HOME, "bin") },
    });
    if (!r.ok && !lspBin(target.bin)) {
      return { ok: false, error: (r.stderr || r.stdout || "go install fehlgeschlagen").slice(0, 400), servers: listLsp() };
    }
  }
  return { ok: Boolean(lspBin(target.bin)), servers: listLsp(), id: target.id };
}

function langOf(p, spec) {
  if (typeof spec.language === "function") return spec.language(p);
  return "plaintext";
}

export function diagnoseWithLsp(spec, root, files, timeoutMs = 8000) {
  const bin = lspBin(spec.bin);
  if (!bin || spec.kind !== "lsp") return Promise.resolve([]);
  const want = files.filter((f) => spec.ext?.test(f.path));
  if (!want.length) return Promise.resolve([]);
  return new Promise((resolve) => {
    const args = spec.args || ["--stdio"];
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
    const child = spawn(useShell ? process.env.ComSpec || "cmd.exe" : bin, useShell ? ["/c", bin, ...args] : args, {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = Buffer.alloc(0);
    const hits = [];
    let n = 0;
    const send = (obj) => {
      const msg = JSON.stringify(obj);
      const b = Buffer.from(msg, "utf8");
      try {
        child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
        child.stdin.write(b);
      } catch {
        /* closed */
      }
    };
    const request = (method, params) => {
      n += 1;
      send({ jsonrpc: "2.0", id: n, method, params });
      return n;
    };
    const onMsg = (msg) => {
      if (msg.method === "textDocument/publishDiagnostics" && Array.isArray(msg.params?.diagnostics)) {
        const uri = String(msg.params.uri || "");
        const rel = uri.replace(/^file:\/\//, "").replace(/^\/[A-Za-z]:/, (m) => m.slice(1));
        const file = want.find((f) => uri.endsWith(f.path.replace(/\\/g, "/")) || rel.endsWith(f.path.replace(/\\/g, "/")));
        const pth = file?.path || rel.split(root.replace(/\\/g, "/")).pop()?.replace(/^\//, "") || "";
        for (const d of msg.params.diagnostics.slice(0, 40)) {
          hits.push({
            path: pth,
            line: (d.range?.start?.line ?? 0) + 1,
            col: (d.range?.start?.character ?? 0) + 1,
            severity: d.severity === 2 || d.severity === 3 ? "warning" : "error",
            message: String(d.message || "").slice(0, 240),
            source: spec.bin,
          });
        }
      }
    };
    child.stdout?.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (true) {
        const s = buf.toString("utf8");
        const m = s.match(/^Content-Length:\s*(\d+)\r\n\r\n/i);
        if (!m) break;
        const len = Number(m[1]);
        const start = m[0].length;
        const bytes = Buffer.byteLength(s.slice(0, start), "utf8");
        if (buf.length < bytes + len) break;
        const json = buf.slice(bytes, bytes + len).toString("utf8");
        buf = buf.slice(bytes + len);
        try {
          onMsg(JSON.parse(json));
        } catch {
          /* */
        }
      }
    });
    request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      capabilities: { textDocument: { publishDiagnostics: {} } },
    });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
      for (const f of want.slice(0, 12)) {
        const full = path.join(root, f.path);
        send({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: pathToFileURL(full).href,
              languageId: langOf(f.path, spec),
              version: 1,
              text: f.content.slice(0, 200_000),
            },
          },
        });
      }
    }, 200);
    const done = () => {
      try {
        request("shutdown", null);
        send({ jsonrpc: "2.0", method: "exit" });
      } catch {
        /* */
      }
      child.kill("SIGTERM");
      resolve(hits);
    };
    setTimeout(done, timeoutMs);
    child.on("error", () => resolve(hits));
    child.on("close", () => resolve(hits));
  });
}

export async function extraLspDiagnostics(root, files, timeoutMs = 8000, enabled = null) {
  const out = [];
  const allow = Array.isArray(enabled) && enabled.length ? new Set(enabled) : null;
  for (const spec of LSP_CATALOG) {
    if (spec.kind !== "lsp") continue;
    const id = spec.via || spec.id;
    if (allow && !allow.has(spec.id) && !allow.has(id)) continue;
    if (!lspBin(spec.bin)) continue;
    const hits = await diagnoseWithLsp(spec, root, files, timeoutMs);
    out.push(...hits);
  }
  return out;
}

export async function checkLsp(id) {
  const spec = LSP_CATALOG.find((p) => p.id === id);
  if (!spec) return { ok: false, id, error: "Unbekanntes Paket." };
  const target = spec.via ? LSP_CATALOG.find((p) => p.id === spec.via) || spec : spec;
  const bin = lspBin(spec.bin) || lspBin(target.bin);
  if (!bin) {
    return {
      ok: false,
      id,
      error: "Nicht geholt.",
      hint: target.go ? "Go SDK installieren, dann Holen." : "npm muss im PATH sein, dann Holen.",
    };
  }
  const args = spec.kind === "cli" ? ["--version"] : spec.args || ["--stdio"];
  if (spec.kind === "cli") {
    const r = await run(bin, args, { timeoutMs: 10000 });
    const ver = (r.stdout || r.stderr || "").trim().split("\n")[0].slice(0, 120);
    if (r.ok || ver) return { ok: true, id, version: ver || spec.bin, path: bin };
    return { ok: false, id, error: (r.stderr || "Start fehlgeschlagen").slice(0, 280), path: bin };
  }
  return new Promise((resolve) => {
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
    const child = spawn(useShell ? process.env.ComSpec || "cmd.exe" : bin, useShell ? ["/c", bin, ...args] : args, {
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    let ok = false;
    child.stderr?.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    const msg = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: process.pid, rootUri: null, capabilities: {} },
    });
    const b = Buffer.from(msg, "utf8");
    try {
      child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
      child.stdin.write(b);
    } catch {
      /* */
    }
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(
        ok
          ? { ok: true, id, version: spec.bin, path: bin }
          : { ok: false, id, error: (stderr || "Keine Antwort (stdio)").slice(0, 280), path: bin },
      );
    }, 4000);
    child.stdout?.on("data", () => {
      ok = true;
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ ok: false, id, error: String(err.message).slice(0, 280), path: bin });
    });
    child.on("close", () => {
      clearTimeout(t);
      resolve(
        ok
          ? { ok: true, id, version: spec.bin, path: bin }
          : { ok: false, id, error: (stderr || "Prozess beendet").slice(0, 280), path: bin },
      );
    });
  });
}