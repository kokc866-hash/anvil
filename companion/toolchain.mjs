/** Portable compilers into <anvil-home>/toolchains — not the Anvil install, not Wandbox. */
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolHome } from "./paths.mjs";

export { toolHome };
export const TOOL_HOME = toolHome();

const WIN = process.platform === "win32";
const ARCH = process.arch === "arm64" ? "arm64" : "x64";

/** id → binary names Anvil looks for after extract */
export const TOOLS = {
  go: { label: "Go", bins: ["go"], about: "~60 MB", kind: "go" },
  rustc: { label: "Rust", bins: ["rustc", "cargo"], about: "~250 MB", kind: "rust" },
  cargo: { label: "Rust", bins: ["cargo", "rustc"], about: "~250 MB", kind: "rust" },
  javac: { label: "OpenJDK 21", bins: ["javac", "java"], about: "~180 MB", kind: "jdk" },
  java: { label: "OpenJDK 21", bins: ["java", "javac"], about: "~180 MB", kind: "jdk" },
  cc: { label: "Zig (C/C++)", bins: ["zig"], about: "~70 MB", kind: "zig" },
  cxx: { label: "Zig (C/C++)", bins: ["zig"], about: "~70 MB", kind: "zig" },
  php: { label: "PHP", bins: ["php"], about: "~35 MB", kind: "php" },
  ruby: { label: "Ruby", bins: ["ruby"], about: "~30 MB", kind: "ruby" },
  python: { label: "Python", bins: ["python", "python3"], about: "~15 MB", kind: "python" },
  tsc: { label: "Node.js", bins: ["node"], about: "~30 MB", kind: "node" },
  dotnet: { label: ".NET SDK", bins: ["dotnet"], about: "~220 MB", kind: "dotnet" },
};

function walkFind(root, names, depth = 0) {
  if (!existsSync(root) || depth > 5) return null;
  const want = new Set(names.map((n) => n.toLowerCase()));
  let ents = [];
  try {
    ents = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of ents) {
    const full = path.join(root, e.name);
    if (e.isFile()) {
      const base = e.name.replace(/\.(exe|bat|cmd)$/i, "").toLowerCase();
      if (want.has(base)) return full;
    }
  }
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const hit = walkFind(path.join(root, e.name), names, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function dirOf(kind) {
  return path.join(toolHome(), kind);
}

export function toolchainBin(bin) {
  const spec = TOOLS[bin];
  if (!spec) return null;
  const names = WIN ? spec.bins.flatMap((b) => [b + ".exe", b]) : spec.bins;
  return walkFind(dirOf(spec.kind), names);
}

export function listToolchains() {
  mkdirSync(toolHome(), { recursive: true });
  const seen = new Set();
  return Object.entries(TOOLS)
    .filter(([, s]) => {
      if (seen.has(s.kind)) return false;
      seen.add(s.kind);
      return true;
    })
    .map(([id, s]) => {
      const ids = Object.entries(TOOLS)
        .filter(([, x]) => x.kind === s.kind)
        .map(([k]) => k);
      const pathHit = s.bins.map((b) => whichSys(b)).find(Boolean) || null;
      const anvil = toolchainBin(id);
      return {
        id,
        ids,
        label: s.label,
        about: s.about,
        kind: s.kind,
        ready: Boolean(pathHit || anvil),
        via: pathHit ? "path" : anvil ? "anvil" : "",
        path: pathHit || anvil || null,
        home: dirOf(s.kind),
      };
    });
}

function whichSys(bin) {
  const env = process.env.PATH || "";
  const ext = WIN ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of env.split(path.delimiter)) {
    for (const e of ext) {
      const p = path.join(dir, bin + e);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** PATH first, then Anvil cache. */
export function resolveBin(bin) {
  const aliases = {
    cc: ["cc", "gcc", "clang"],
    cxx: ["c++", "g++", "clang++"],
    python: ["python3", "python", "py"],
    tsc: ["tsc"],
  };
  const names = aliases[bin] || [bin];
  for (const n of names) {
    const s = whichSys(n);
    if (s) return s;
  }
  if (bin === "cc" || bin === "cxx") {
    const zig = toolchainBin("cc") || whichSys("zig");
    if (zig) return zig;
  }
  if (bin === "tsc") {
    const node = toolchainBin("tsc") || whichSys("node");
    const tsc = walkFind(dirOf("node"), WIN ? ["tsc.cmd", "tsc"] : ["tsc"]);
    if (tsc) return tsc;
    if (node) return node;
  }
  return toolchainBin(bin);
}

/** Env for every spawn: Anvil compilers on PATH + CARGO_HOME / JAVA_HOME / GOROOT. */
export function toolEnv(base = process.env) {
  const dirs = [];
  const extra = {};
  const add = (bin) => {
    const p = resolveBin(bin);
    if (p) dirs.push(path.dirname(p));
    return p;
  };
  const go = add("go");
  if (go) {
    const root = path.resolve(path.dirname(go), "..");
    if (existsSync(path.join(root, "src")) || existsSync(path.join(root, "lib"))) extra.GOROOT = root;
  }
  add("cargo");
  add("rustc");
  const cargoHome = path.join(toolHome(), "rust", "cargo");
  const rustupHome = path.join(toolHome(), "rust", "rustup");
  if (existsSync(cargoHome)) extra.CARGO_HOME = cargoHome;
  if (existsSync(rustupHome)) extra.RUSTUP_HOME = rustupHome;
  const java = add("java");
  add("javac");
  if (java) extra.JAVA_HOME = path.resolve(path.dirname(java), "..");
  add("cc");
  add("php");
  add("ruby");
  add("dotnet");
  add("python");
  const uniq = [...new Set(dirs.filter(Boolean))];
  extra.PATH = uniq.length ? `${uniq.join(path.delimiter)}${path.delimiter}${base.PATH || ""}` : base.PATH;
  return { ...base, ...extra };
}

export function findAnywhere(names) {
  const want = WIN ? names.flatMap((n) => [n + ".exe", n]) : names;
  return walkFind(toolHome(), want);
}

export function findInKind(kind, names) {
  const want = WIN ? names.flatMap((n) => [n + ".exe", n]) : names;
  return walkFind(dirOf(kind), want);
}

let busy = null;
const pull = { kind: "", phase: "", got: 0, total: 0, abort: false };

export function toolchainProgress() {
  const pct = pull.total > 0 ? Math.min(100, Math.round((pull.got / pull.total) * 100)) : pull.phase && pull.phase !== "done" ? 0 : 0;
  return { kind: pull.kind, phase: pull.phase, got: pull.got, total: pull.total, pct, busy: Boolean(busy) };
}

export function abortPull() {
  if (!busy) return { ok: false, error: "nichts läuft" };
  pull.abort = true;
  return { ok: true };
}

function throwIfAbort() {
  if (pull.abort) throw new Error("abgebrochen");
}

async function download(url, dest) {
  throwIfAbort();
  pull.phase = "download";
  pull.got = 0;
  pull.total = 0;
  mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8 * 60 * 1000) });
  if (!r.ok || !r.body) throw new Error(`Download ${r.status}: ${url}`);
  pull.total = Number(r.headers.get("content-length") || 0);
  const file = createWriteStream(dest);
  const reader = r.body.getReader();
  try {
    for (;;) {
      throwIfAbort();
      const { done, value } = await reader.read();
      if (done) break;
      pull.got += value.byteLength;
      if (!file.write(Buffer.from(value))) {
        await new Promise((res) => file.once("drain", res));
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* */
    }
    await new Promise((res, rej) => file.end((err) => (err ? rej(err) : res())));
  }
}

async function downloadWithFallback(url, fallback, dest) {
  try {
    await download(url, dest);
  } catch (err) {
    if (!fallback || fallback === url) throw err;
    pull.phase = "download";
    await download(fallback, dest);
  }
}

function unzip(zip, dest) {
  mkdirSync(dest, { recursive: true });
  const ms = 5 * 60 * 1000;
  if (WIN) {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`],
      { timeout: ms, windowsHide: true },
    );
    return;
  }
  execFileSync("unzip", ["-qo", zip, "-d", dest], { timeout: ms });
}

function spawnWait(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false, env: { ...process.env, ...(opts.env || {}) }, cwd: opts.cwd });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const t = setTimeout(() => child.kill(), opts.timeoutMs || 12 * 60 * 1000);
    const tick = setInterval(() => {
      if (pull.abort) child.kill();
    }, 400);
    child.on("close", (code) => {
      clearTimeout(t);
      clearInterval(tick);
      if (pull.abort) reject(new Error("abgebrochen"));
      else if (code === 0) resolve();
      else reject(new Error(stderr || `exit ${code}`));
    });
    child.on("error", (err) => {
      clearTimeout(t);
      clearInterval(tick);
      reject(err);
    });
  });
}

async function latestGo() {
  const list = await (await fetch("https://go.dev/dl/?mode=json")).json();
  const ver = list[0];
  const osName = WIN ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = ARCH === "arm64" ? "arm64" : "amd64";
  const f = ver.files.find((x) => x.os === osName && x.arch === arch && x.kind === "archive");
  if (!f) throw new Error("Kein Go-Archiv für dieses System");
  return `https://go.dev/dl/${f.filename}`;
}

async function latestNode() {
  const list = await (await fetch("https://nodejs.org/dist/index.json")).json();
  const lts = list.find((x) => x.lts);
  const v = lts.version;
  if (WIN) return `https://nodejs.org/dist/${v}/node-${v}-win-${ARCH === "arm64" ? "arm64" : "x64"}.zip`;
  const plat = process.platform === "darwin" ? "darwin" : "linux";
  return `https://nodejs.org/dist/${v}/node-${v}-${plat}-${ARCH === "arm64" ? "arm64" : "x64"}.tar.gz`;
}

function zigPlat() {
  if (WIN) return ARCH === "arm64" ? "aarch64-windows" : "x86_64-windows";
  if (process.platform === "darwin") return ARCH === "arm64" ? "aarch64-macos" : "x86_64-macos";
  return ARCH === "arm64" ? "aarch64-linux" : "x86_64-linux";
}

/** 0.14.1+ : zig-x86_64-windows-VER.zip  ·  älter: zig-windows-x86_64-VER.zip */
export function zigArchiveName(ver, plat = zigPlat()) {
  const parts = plat.split("-");
  const arch = parts[0];
  const os = parts.slice(1).join("-");
  const [maj, min, pat] = String(ver)
    .split(".")
    .map((n) => Number(n) || 0);
  const modern = maj > 0 || min > 14 || (min === 14 && pat >= 1);
  const stem = modern ? `zig-${plat}-${ver}` : `zig-${os}-${arch}-${ver}`;
  return os.includes("windows") ? `${stem}.zip` : `${stem}.tar.xz`;
}

export function zigGithubUrl(ver, plat = zigPlat()) {
  return `https://github.com/ziglang/zig/releases/download/${ver}/${zigArchiveName(ver, plat)}`;
}

function semverDesc(a, b) {
  const pa = String(a).split(".").map((n) => Number(n) || 0);
  const pb = String(b).split(".").map((n) => Number(n) || 0);
  return pb[0] - pa[0] || pb[1] - pa[1] || (pb[2] || 0) - (pa[2] || 0);
}

async function fetchJson(url, ms = 15000) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

async function latestZig() {
  const plat = zigPlat();
  const fallbackVer = "0.14.1";
  try {
    const j = await fetchJson("https://ziglang.org/download/index.json", 12000);
    const vers = Object.keys(j).filter((k) => k !== "master" && /^\d+\.\d+/.test(k) && j[k]?.[plat]?.tarball);
    vers.sort(semverDesc);
    const ver = vers[0];
    if (ver) {
      return { url: String(j[ver][plat].tarball), fallback: zigGithubUrl(ver, plat), ver };
    }
  } catch {
    /* GitHub */
  }
  return { url: zigGithubUrl(fallbackVer, plat), fallback: "", ver: fallbackVer };
}

function phpUrl() {
  if (!WIN) throw new Error("PHP-Zip nur Windows. Auf Linux: Paketmanager.");
  return "https://windows.php.net/downloads/releases/latest/php-8.3-nts-Win32-vs16-x64-latest.zip";
}

function pythonUrl() {
  if (!WIN) throw new Error("Python-Embed nur Windows. Auf Linux liegt python3 meist schon da.");
  return "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip";
}

function jdkUrl() {
  if (WIN) return "https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip";
  if (process.platform === "darwin") return "https://aka.ms/download-jdk/microsoft-jdk-21-macos-x64.tar.gz";
  return "https://aka.ms/download-jdk/microsoft-jdk-21-linux-x64.tar.gz";
}

function rubyUrl() {
  if (!WIN) throw new Error("Ruby-Installer nur Windows.");
  return "https://github.com/oneclick/rubyinstaller2/releases/download/RubyInstaller-3.3.8-1/rubyinstaller-3.3.8-1-x64.exe";
}

function rustupUrl() {
  if (WIN) return "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe";
  return "https://sh.rustup.rs";
}

export async function pullToolchain(id) {
  const spec = TOOLS[id];
  if (!spec) return { ok: false, error: `Unbekannt: ${id}` };
  if (busy) return { ok: false, error: `Lädt schon: ${busy}` };
  busy = spec.kind;
  pull.kind = spec.kind;
  pull.phase = "start";
  pull.got = 0;
  pull.total = 0;
  pull.abort = false;
  const dest = dirOf(spec.kind);
  const tmp = path.join(os.tmpdir(), "anvil-tc-" + spec.kind);
  try {
    mkdirSync(toolHome(), { recursive: true });
    mkdirSync(tmp, { recursive: true });
    if (spec.kind === "rust") {
      const init = path.join(tmp, WIN ? "rustup-init.exe" : "rustup-init.sh");
      await download(rustupUrl(), init);
      throwIfAbort();
      pull.phase = "install";
      const cargo = path.join(dest, "cargo");
      const rustup = path.join(dest, "rustup");
      mkdirSync(cargo, { recursive: true });
      mkdirSync(rustup, { recursive: true });
      if (WIN) await spawnWait(init, ["-y", "--default-toolchain", "stable", "--no-modify-path"], { env: { CARGO_HOME: cargo, RUSTUP_HOME: rustup } });
      else {
        await spawnWait("sh", [init, "-y", "--default-toolchain", "stable", "--no-modify-path"], { env: { CARGO_HOME: cargo, RUSTUP_HOME: rustup } });
      }
    } else if (spec.kind === "dotnet") {
      mkdirSync(dest, { recursive: true });
      if (WIN) {
        const ps1 = path.join(tmp, "dotnet-install.ps1");
        await download("https://dot.net/v1/dotnet-install.ps1", ps1);
        await spawnWait("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Channel", "8.0", "-InstallDir", dest]);
      } else {
        const sh = path.join(tmp, "dotnet-install.sh");
        await download("https://dot.net/v1/dotnet-install.sh", sh);
        await spawnWait("bash", [sh, "--channel", "8.0", "--install-dir", dest]);
      }
    } else if (spec.kind === "ruby") {
      const exe = path.join(tmp, "ruby-setup.exe");
      await download(rubyUrl(), exe);
      mkdirSync(dest, { recursive: true });
      await spawnWait(exe, ["/verysilent", `/dir=${dest}`, "/tasks="]);
    } else {
      let url = "";
      let fallback = "";
      if (spec.kind === "go") url = await latestGo();
      else if (spec.kind === "node") url = await latestNode();
      else if (spec.kind === "zig") {
        const z = await latestZig();
        url = z.url;
        fallback = z.fallback;
      } else if (spec.kind === "php") url = phpUrl();
      else if (spec.kind === "python") url = pythonUrl();
      else if (spec.kind === "jdk") url = jdkUrl();
      if (!url) throw new Error("Keine URL");
      const ext = url.endsWith(".tar.xz") || url.endsWith(".txz")
        ? ".tar.xz"
        : url.endsWith(".tar.gz") || url.endsWith(".tgz")
          ? ".tar.gz"
          : url.endsWith(".exe")
            ? ".exe"
            : ".zip";
      const zip = path.join(tmp, "pack" + ext);
      await downloadWithFallback(url, fallback, zip);
      throwIfAbort();
      pull.phase = "unpack";
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      if (ext === ".tar.xz") {
        execFileSync("tar", ["-xJf", zip, "-C", dest], { timeout: 5 * 60 * 1000 });
      } else if (ext === ".tar.gz") {
        execFileSync("tar", ["-xzf", zip, "-C", dest], { timeout: 5 * 60 * 1000 });
      } else unzip(zip, dest);
      if (spec.kind === "node") {
        const node = walkFind(dest, WIN ? ["node.exe"] : ["node"]);
        if (node) {
          try {
            await spawnWait(node, ["-e", "try{require('child_process').execSync('npm install typescript --prefix .',{stdio:'ignore'})}catch(e){}"], {
              cwd: dest,
            });
          } catch {
            /* tsc optional */
          }
        }
      }
    }
    const p = toolchainBin(id) || resolveBin(id);
    if (!p) throw new Error("Archiv da, Binärdatei nicht gefunden");
    pull.phase = "done";
    return { ok: true, id, path: p, label: spec.label, home: dest };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), id };
  } finally {
    busy = null;
    if (pull.phase !== "done") pull.phase = pull.abort ? "abort" : pull.phase;
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

export function removeToolchain(id) {
  const spec = TOOLS[id];
  if (!spec) return { ok: false, error: `Unbekannt: ${id}` };
  const dest = dirOf(spec.kind);
  try {
    rmSync(dest, { recursive: true, force: true });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
