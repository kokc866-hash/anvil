/** Free language servers, pulled into <anvil-home>/lsp (npm/go). No paid LSPs. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveBin, toolEnv, findInKind, findAnywhere } from "./toolchain.mjs";
import { lspHome } from "./paths.mjs";

export { lspHome };

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
    entry: ["lib/cli.mjs", "lib/cli.js"],
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
    entry: ["lib/html-language-server/node/htmlServerMain.js", "lib/htmlServerMain.js", "dist/node/htmlServerMain.js"],
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
    entry: ["lib/css-language-server/node/cssServerMain.js", "lib/cssServerMain.js"],
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
    entry: ["lib/json-language-server/node/jsonServerMain.js", "lib/jsonServerMain.js"],
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
    entry: ["out/server/src/server.js", "out/server/server.js", "bin/yaml-language-server.js", "bin/yaml-language-server"],
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
  {
    id: "rust",
    label: "rust-analyzer",
    langs: "Rust",
    license: "MIT / Apache-2.0",
    bin: "rust-analyzer",
    args: [],
    kind: "lsp",
    ext: /\.rs$/i,
    language: () => "rust",
  },
  {
    id: "clangd",
    label: "clangd",
    langs: "C / C++",
    license: "Apache-2.0",
    bin: "clangd",
    args: [],
    kind: "lsp",
    ext: /\.(c|cc|cpp|cxx|h|hpp)$/i,
    language: (p) => (/\.(c|h)$/i.test(p) && !/\.(cc|cpp|cxx|hpp)$/i.test(p) ? "c" : "cpp"),
  },
  {
    id: "java",
    label: "Java (javac)",
    langs: "Java",
    license: "GPL-2.0",
    bin: "javac",
    kind: "cli",
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
  const local = path.join(lspHome(), "node_modules", ".bin", name);
  const gobin = path.join(lspHome(), "bin", name);
  const cargo = path.join(os.homedir(), ".cargo", "bin", name);
  const llvm = path.join(process.env.ProgramFiles || "C:\\Program Files", "LLVM", "bin", name);
  const ext = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const e of ext) {
    if (existsSync(local + e)) return local + e;
    if (existsSync(gobin + e)) return gobin + e;
    if (existsSync(cargo + e)) return cargo + e;
    if (existsSync(llvm + e)) return llvm + e;
  }
  if (name === "rust-analyzer") {
    const ra = findInKind("rust", ["rust-analyzer"]);
    if (ra) return ra;
  }
  if (name === "clangd") {
    const anywhere = findAnywhere(["clangd"]);
    if (anywhere) return anywhere;
  }
  if (name === "clangd" || name === "javac" || name === "java") {
    const fromTool = resolveBin(name === "clangd" ? "cc" : name === "javac" ? "javac" : "java");
    if (fromTool && name === "clangd") {
      if (/zig/i.test(fromTool)) {
        /* Zig has no clangd */
      } else {
        const dir = path.dirname(fromTool);
        for (const e of ext) {
          const p = path.join(dir, "clangd" + e);
          if (existsSync(p)) return p;
        }
      }
    }
    if (fromTool && (name === "javac" || name === "java")) return fromTool;
  }
  return pathWhich(name);
}

function findGo() {
  return pathWhich("go") || pathWhich("go.exe") || resolveBin("go");
}

function runnableFile(p) {
  if (!p) return null;
  if (existsSync(p) && /\.(js|mjs|cjs)$/i.test(p)) return p;
  for (const ext of [".js", ".mjs", ".cjs"]) {
    if (existsSync(p + ext)) return p + ext;
  }
  if (existsSync(p)) return p;
  return null;
}

function pkgBinFile(home, pkg, binName) {
  const dir = path.join(home, "node_modules", pkg);
  const pj = path.join(dir, "package.json");
  if (!existsSync(pj)) return null;
  try {
    const j = JSON.parse(readFileSync(pj, "utf8"));
    const b = j.bin;
    const rel = typeof b === "string" ? b : b && typeof b === "object" ? b[binName] || Object.values(b)[0] : null;
    if (!rel || typeof rel !== "string") return null;
    return runnableFile(path.join(dir, rel));
  } catch {
    return null;
  }
}

/** Real JS entry for an npm LSP — skip Windows .cmd shims (they break stdio). */
export function jsEntry(spec, home = lspHome()) {
  if (!spec?.npm?.length) return null;
  const pkg = spec.npm[0];
  const fromPkg = pkgBinFile(home, pkg, spec.bin);
  if (fromPkg && /\.(js|mjs|cjs)$/i.test(fromPkg)) return fromPkg;
  const dir = path.join(home, "node_modules", pkg);
  for (const rel of spec.entry || []) {
    const hit = runnableFile(path.join(dir, rel));
    if (hit) return hit;
  }
  return fromPkg;
}

function nodeScript(p) {
  if (!p) return false;
  if (/\.(js|mjs|cjs)$/i.test(p)) return true;
  try {
    const head = readFileSync(p, "utf8").slice(0, 160);
    return /^#!.*\bnode\b/i.test(head);
  } catch {
    return false;
  }
}

function spawnLsp(spec, extraArgs, opts = {}) {
  const args = extraArgs ?? spec.args ?? ["--stdio"];
  const entry = spec.npm ? jsEntry(spec) : spec.via ? jsEntry({ ...spec, npm: LSP_CATALOG.find((p) => p.id === spec.via)?.npm || spec.npm }) : null;
  if (entry && nodeScript(entry)) {
    return spawn(process.execPath, [entry, ...args], {
      cwd: opts.cwd,
      env: opts.env || toolEnv(),
      windowsHide: true,
      shell: false,
      stdio: opts.stdio || "pipe",
    });
  }
  const bin = lspBin(spec.bin);
  if (!bin) return null;
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin) && spec.npm) {
    return null;
  }
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  return spawn(useShell ? process.env.ComSpec || "cmd.exe" : bin, useShell ? ["/c", bin, ...args] : args, {
    cwd: opts.cwd,
    env: opts.env || toolEnv(),
    windowsHide: true,
    shell: false,
    stdio: opts.stdio || "pipe",
  });
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
      ready: Boolean(bin) || Boolean(p.npm && jsEntry(p)),
      path: bin || (p.npm ? jsEntry(p) : null),
      extra: extra.length,
      via: p.npm ? "npm" : p.go ? "go" : "",
    };
  });
}

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...toolEnv(), ...(opts.env || {}) };
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
  mkdirSync(path.join(lspHome(), "bin"), { recursive: true });
  if (target.npm) {
    const npm = pathWhich("npm") || pathWhich("npm.cmd");
    if (!npm) return { ok: false, error: "npm fehlt (Node.js).", servers: listLsp() };
    const r = await run(npm, ["install", "--prefix", lspHome(), "--omit=dev", "--no-fund", "--no-audit", ...target.npm], {
      timeoutMs: 180000,
    });
    if (!r.ok && !lspBin(target.bin)) {
      return { ok: false, error: (r.stderr || r.stdout || "npm install fehlgeschlagen").slice(0, 400), servers: listLsp() };
    }
  }
  if (target.go) {
    const go = findGo();
    if (!go) {
      return {
        ok: false,
        error: "Go SDK fehlt für gopls. Zuerst Go holen (Companion, Compiler), dann gopls nochmal Holen.",
        servers: listLsp(),
      };
    }
    const r = await run(go, ["install", target.go], {
      timeoutMs: 180000,
      env: {
        ...toolEnv(),
        GOBIN: path.join(lspHome(), "bin"),
      },
    });
    if (!r.ok && !lspBin(target.bin)) {
      return { ok: false, error: (r.stderr || r.stdout || "go install fehlgeschlagen").slice(0, 400), servers: listLsp() };
    }
  }
  if (target.id === "rust") {
    const rustup = pathWhich("rustup") || pathWhich("rustup.exe") || findInKind("rust", ["rustup"]);
    if (!rustup) return { ok: false, error: "rustup fehlt. Zuerst Rust holen (Companion, Compiler).", servers: listLsp() };
    const r = await run(rustup, ["component", "add", "rust-analyzer"], { timeoutMs: 180000, env: toolEnv() });
    if (!r.ok && !lspBin(target.bin)) {
      return { ok: false, error: (r.stderr || r.stdout || "rust-analyzer fehlgeschlagen").slice(0, 400), servers: listLsp() };
    }
  }
  if (target.id === "clangd") {
    if (lspBin("clangd")) return { ok: true, servers: listLsp(), id: "clangd" };
    try {
      const pulled = await pullClangd();
      if (pulled.ok) return { ok: true, servers: listLsp(), id: "clangd" };
      return { ok: false, error: pulled.error || "clangd fehlt.", servers: listLsp() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "clangd Download fehlgeschlagen", servers: listLsp() };
    }
  }
  if (target.id === "java") {
    const javac = lspBin("javac") || resolveBin("javac");
    if (!javac) return { ok: false, error: "javac fehlt. OpenJDK holen (Companion, Compiler).", servers: listLsp() };
  }
  return { ok: Boolean(lspBin(target.bin)), servers: listLsp(), id: target.id };
}

async function pullClangd() {
  const destDir = path.join(lspHome(), "clangd");
  mkdirSync(destDir, { recursive: true });
  mkdirSync(path.join(lspHome(), "bin"), { recursive: true });
  const api = await fetch("https://api.github.com/repos/clangd/clangd/releases/latest", {
    signal: AbortSignal.timeout(15000),
    headers: { "user-agent": "anvil-companion" },
  });
  if (!api.ok) return { ok: false, error: `clangd releases ${api.status}` };
  const j = await api.json();
  const plat = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const assets = Array.isArray(j.assets) ? j.assets : [];
  const asset = assets.find((a) => String(a.name || "").toLowerCase().includes(plat) && /\.zip$/i.test(a.name));
  if (!asset?.browser_download_url) return { ok: false, error: "clangd-Paket nicht gefunden." };
  const zip = path.join(lspHome(), String(asset.name));
  const r = await fetch(asset.browser_download_url, { redirect: "follow", signal: AbortSignal.timeout(8 * 60 * 1000) });
  if (!r.ok) return { ok: false, error: `clangd download ${r.status}` };
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  const unpack = await run(process.platform === "win32" ? "tar.exe" : "tar", ["-xf", zip, "-C", destDir], { timeoutMs: 120000 });
  if (!unpack.ok && !findNamed(destDir, "clangd")) {
    return { ok: false, error: (unpack.stderr || "clangd entpacken fehlgeschlagen").slice(0, 400) };
  }
  const found = findNamed(destDir, "clangd");
  if (!found) return { ok: false, error: "clangd nach Download nicht im Archiv." };
  const ext = process.platform === "win32" ? ".exe" : "";
  copyFileSync(found, path.join(lspHome(), "bin", "clangd" + ext));
  return { ok: true };
}

function findNamed(root, name, depth = 0) {
  if (!existsSync(root) || depth > 6) return null;
  const want = process.platform === "win32" ? [name + ".exe", name] : [name];
  let ents = [];
  try {
    ents = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of ents) {
    const full = path.join(root, e.name);
    if (e.isFile() && want.includes(e.name.toLowerCase() === e.name ? e.name : e.name) && want.some((w) => e.name.toLowerCase() === w.toLowerCase())) {
      return full;
    }
    if (e.isFile() && want.some((w) => e.name.toLowerCase() === w.toLowerCase())) return full;
    if (e.isDirectory() && !e.name.startsWith(".")) {
      const hit = findNamed(full, name, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function langOf(p, spec) {
  if (typeof spec.language === "function") return spec.language(p);
  return "plaintext";
}

export function diagnoseWithLsp(spec, root, files, timeoutMs = 8000) {
  if (spec.kind !== "lsp") return Promise.resolve([]);
  if (!lspBin(spec.bin) && !jsEntry(spec)) return Promise.resolve([]);
  const want = files.filter((f) => spec.ext?.test(f.path));
  if (!want.length) return Promise.resolve([]);
  return new Promise((resolve) => {
    const args = spec.args || ["--stdio"];
    const child = spawnLsp(spec, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    if (!child) return resolve([]);
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
      capabilities: { workspace: { workspaceFolders: true }, textDocument: { publishDiagnostics: {}, hover: {}, completion: {} } },
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
    if (!lspBin(spec.bin) && !jsEntry(spec)) continue;
    const hits = await diagnoseWithLsp(spec, root, files, timeoutMs);
    out.push(...hits);
  }
  return out;
}

export async function checkLsp(id) {
  const spec = LSP_CATALOG.find((p) => p.id === id);
  if (!spec) return { ok: false, id, error: "Unbekanntes Paket." };
  const target = spec.via ? LSP_CATALOG.find((p) => p.id === spec.via) || spec : spec;
  if (spec.go && !findGo()) {
    return { ok: false, id, error: "Go SDK fehlt.", hint: "Zuerst Go holen (Companion, Compiler), dann gopls Holen." };
  }
  const bin = lspBin(spec.bin) || lspBin(target.bin);
  const entry = spec.npm ? jsEntry(spec) : spec.via && target.npm ? jsEntry({ ...target, bin: spec.bin, entry: spec.entry }) : null;
  if (!bin && !entry) {
    return {
      ok: false,
      id,
      error: "Nicht geholt.",
      hint: target.go ? "Zuerst Go holen (Companion, Compiler), dann gopls Holen." : "npm muss im PATH sein, dann Holen.",
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
    const child = spawnLsp(spec, args, { stdio: ["pipe", "pipe", "pipe"] });
    if (!child) {
      resolve({ ok: false, id, error: "Start fehlgeschlagen.", path: bin || "" });
      return;
    }
    let stderr = "";
    let ok = false;
    child.stderr?.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    const root = pathToFileURL(process.cwd()).href;
    const msg = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        processId: process.pid,
        clientInfo: { name: "Anvil", version: "1.2.1" },
        rootUri: root,
        workspaceFolders: [{ uri: root, name: "anvil" }],
        capabilities: {
          workspace: { workspaceFolders: true, configuration: true },
          textDocument: { publishDiagnostics: {}, synchronization: {} },
        },
      },
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
          ? { ok: true, id, version: spec.bin, path: entry || bin }
          : { ok: false, id, error: (stderr || "Keine Antwort (stdio)").slice(0, 280), path: entry || bin },
      );
    }, 8000);
    child.stdout?.on("data", () => {
      ok = true;
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ ok: false, id, error: String(err.message).slice(0, 280), path: entry || bin });
    });
    child.on("close", () => {
      clearTimeout(t);
      resolve(
        ok
          ? { ok: true, id, version: spec.bin, path: entry || bin }
          : { ok: false, id, error: (stderr || "Prozess beendet").slice(0, 280), path: entry || bin },
      );
    });
  });
}