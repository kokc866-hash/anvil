/** Real git + source tree on a registered workspace folder. Token-gated by the server. */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { toolEnv } from "./toolchain.mjs";
import { runRoot } from "./run-storage.mjs";
import { blockedCwd, whichExts } from "./guard.mjs";

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".vercel",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "vendor",
  "coverage",
  ".turbo",
  ".cache",
  "out",
  "bin",
  "obj",
  ".pnpm-store",
  "Pods",
  ".idea",
  ".gradle",
  ".output",
  ".nuxt",
  ".svelte-kit",
]);

const KEEP_DOT = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".env.example",
  ".env.sample",
  ".env.template",
  ".anvil",
  ".github",
  ".vscode",
  ".editorconfig",
  ".nvmrc",
  ".node-version",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierignore",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintignore",
  ".dockerignore",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".clang-format",
  ".clang-tidy",
  ".tool-versions",
  ".python-version",
  ".ruby-version",
  ".mailmap",
]);

const TEXT =
  /\.(py|ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|rb|md|html|css|json|toml|yml|yaml|sql|sh|vue|svelte|txt|gd|csproj|xml|gitignore|env\.example)$/i;
const BARE = /^(Makefile|makefile|GNUmakefile|Dockerfile|Gemfile|Procfile|LICENSE|COPYING|CMakeLists\.txt)$/;
const IMG_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
};


export const TREE_FILES = 4000;
export const TREE_EACH = 1_500_000;
export const TREE_TOTAL = 96_000_000;

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

export function gitBin() {
  const hit = which("git") || which("git.exe");
  if (hit) return hit;
  const extras = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "cmd", "git.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "cmd", "git.exe"),
  ];
  for (const p of extras) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export function resolveCwd(raw) {
  const cwd = path.resolve(String(raw || "").trim() || process.cwd());
  const root = path.parse(cwd).root;
  if (!cwd || cwd === root) throw new Error("Ordner ungültig.");
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error("Ordner fehlt.");
  if (blockedCwd(cwd)) throw new Error("Systemordner gesperrt.");
  return cwd;
}

function run(file, args, cwd, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, windowsHide: true, shell: false, env: toolEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout = (stdout + d.toString()).slice(-200_000);
    });
    child.stderr?.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-80_000);
    });
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, timeoutMs);
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

async function git(cwd, args, timeoutMs) {
  const bin = gitBin();
  if (!bin) return { ok: false, code: 127, stdout: "", stderr: "git fehlt im PATH." };
  return run(bin, args, cwd, timeoutMs);
}

function parseStatus(raw) {
  const rows = [];
  for (const line of raw.split("\n")) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const file = line.slice(3).replace(/^"|"$/g, "").replace(/\\"/g, '"');
    const staged = xy[0] !== " " && xy[0] !== "?";
    const unstaged = xy[1] !== " ";
    const untracked = xy[0] === "?";
    let kind = "M";
    if (untracked) kind = "U";
    else if (xy.includes("D")) kind = "D";
    else if (xy.includes("A") || xy.includes("?")) kind = "A";
    else if (xy.includes("R")) kind = "R";
    rows.push({ path: file.replace(/ -> .*$/, ""), kind, staged, unstaged, untracked });
  }
  return rows;
}

export async function gitStatus(cwd) {
  const root = resolveCwd(cwd);
  const bin = gitBin();
  if (!bin) return { ok: false, error: "git fehlt im PATH.", cwd: root };
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) return { ok: true, cwd: root, repo: false, branch: "", files: [], log: [] };
  const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const st = await git(root, ["status", "--porcelain", "-uall"]);
  const log = await git(root, ["log", "-12", "--pretty=format:%H%x09%at%x09%s"]);
  const branches = await git(root, ["branch", "--format=%(refname:short)"]);
  return {
    ok: true,
    cwd: root,
    repo: true,
    branch: (branch.stdout || "HEAD").trim(),
    files: parseStatus(st.stdout),
    log: (log.stdout || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, at, ...rest] = line.split("\t");
        return { hash, at: Number(at) * 1000, message: rest.join("\t") };
      }),
    branches: (branches.stdout || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export async function gitCommit(cwd, message, all = true) {
  const root = resolveCwd(cwd);
  if (!message?.trim()) return { ok: false, error: "Nachricht fehlt." };
  const cfg = await git(root, ["config", "user.email"]);
  if (!cfg.ok || !(cfg.stdout || "").trim()) {
    return { ok: false, error: "git user.email fehlt. Einmal: git config --global user.email …" };
  }
  if (all) await git(root, ["add", "-A"]);
  const r = await git(root, ["commit", "-m", message.trim()]);
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || "Commit fehlgeschlagen").slice(0, 400) };
  return { ok: true, ...(await gitStatus(root)) };
}

export async function gitCheckout(cwd, branch, create = false) {
  const root = resolveCwd(cwd);
  const args = create ? ["checkout", "-b", branch] : ["checkout", branch];
  const r = await git(root, args);
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || "Checkout fehlgeschlagen").slice(0, 400) };
  return gitStatus(root);
}

export async function gitPush(cwd, remote = "origin") {
  const root = resolveCwd(cwd);
  const r = await git(root, ["push", "-u", remote, "HEAD"], 120000);
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || "Push fehlgeschlagen").slice(0, 400) };
  return { ok: true, stdout: r.stdout.slice(0, 800) };
}

export async function gitPull(cwd) {
  const root = resolveCwd(cwd);
  const r = await git(root, ["pull", "--ff-only"], 120000);
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || "Pull fehlgeschlagen").slice(0, 400) };
  return { ok: true, ...(await gitStatus(root)), stdout: r.stdout.slice(0, 800) };
}

export async function gitBlame(cwd, file) {
  const root = resolveCwd(cwd);
  const rel = String(file || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return { ok: false, error: "Pfad fehlt." };
  const r = await git(root, ["blame", "-e", "--", rel]);
  if (!r.ok) return { ok: false, error: (r.stderr || "Blame fehlgeschlagen").slice(0, 280) };
  return { ok: true, path: rel, text: r.stdout.slice(0, 80_000) };
}

export async function gitInit(cwd) {
  const root = resolveCwd(cwd);
  const r = await git(root, ["init"]);
  if (!r.ok) return { ok: false, error: (r.stderr || "git init fehlgeschlagen").slice(0, 280) };
  return gitStatus(root);
}

export async function gitClone(url, dest) {
  const bin = gitBin();
  if (!bin) return { ok: false, error: "git fehlt im PATH. Git holen (Companion)." };
  let remote = String(url || "").trim().replace(/\.git$/, "");
  if (/^github\.com\//i.test(remote)) remote = `https://${remote}`;
  if (!/^https?:\/\//i.test(remote) && !/^git@/i.test(remote)) return { ok: false, error: "Git-URL fehlt." };
  if (!/\.git$/i.test(remote) && /^https?:\/\//i.test(remote)) remote = `${remote}.git`;
  mkdirSync(dest, { recursive: true });
  const target = resolveCwd(dest);
  let ents = [];
  try {
    ents = readdirSync(target);
  } catch {
    ents = [];
  }
  const empty = ents.filter((n) => n !== ".anvil").length === 0;
  if (empty) {
    const r = await git(target, ["clone", "--depth", "1", "--single-branch", remote, "."], 180000);
    if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || "Clone fehlgeschlagen").slice(0, 400) };
    return { ok: true, cwd: target, ...(await gitStatus(target)) };
  }
  const name = remote.replace(/\.git$/i, "").split("/").pop() || "repo";
  const child = path.join(target, name.replace(/[^\w.-]+/g, "-"));
  mkdirSync(child, { recursive: true });
  const r = await git(target, ["clone", "--depth", "1", "--single-branch", remote, path.basename(child)], 180000);
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || "Clone fehlgeschlagen").slice(0, 400) };
  const cwd = resolveCwd(child);
  return { ok: true, cwd, ...(await gitStatus(cwd)) };
}

export async function gitStash(cwd, message = "") {
  const root = resolveCwd(cwd);
  const args = message.trim() ? ["stash", "push", "-u", "-m", message.trim()] : ["stash", "push", "-u"];
  const r = await git(root, args);
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || "Stash fehlgeschlagen").slice(0, 400) };
  return { ok: true, ...(await gitStatus(root)) };
}

export async function gitStashPop(cwd) {
  const root = resolveCwd(cwd);
  const r = await git(root, ["stash", "pop"]);
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || "Stash pop fehlgeschlagen").slice(0, 400) };
  return { ok: true, ...(await gitStatus(root)) };
}

export async function gitBranch(cwd, name) {
  const root = resolveCwd(cwd);
  const b = String(name || "").trim();
  if (!b || /[^\w./-]+/.test(b)) return { ok: false, error: "Branch-Name ungültig." };
  return gitCheckout(root, b, true);
}

export async function gitDiff(cwd, file) {
  const root = resolveCwd(cwd);
  const args = file ? ["diff", "--", String(file)] : ["diff"];
  const r = await git(root, args);
  return { ok: true, text: (r.stdout || r.stderr || "").slice(0, 120_000) };
}

function walk(dir, prefix, acc) {
  let ents = [];
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (acc.n >= TREE_FILES || acc.bytes >= TREE_TOTAL) {
      acc.skipped += 1;
      continue;
    }
    if (e.name.startsWith(".") && !KEEP_DOT.has(e.name) && !/^\.(eslint|prettier)/i.test(e.name)) continue;
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (path.resolve(full) === path.resolve(runRoot())) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const relPosix = rel.replace(/\\/g, "/");
    if (/(^|\/)\.anvil\/(work|out)(\/|$)/i.test(relPosix) || relPosix === ".anvil/work" || relPosix === ".anvil/out") continue;
    if (e.isDirectory()) {
      acc.dirs.push(relPosix);
      walk(full, relPosix, acc);
      continue;
    }
    if (!e.isFile()) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      acc.skipped += 1;
      continue;
    }
    if (st.size > TREE_EACH && !IMG_MIME[e.name.split(".").pop()?.toLowerCase() || ""]) {
      acc.skipped += 1;
      continue;
    }
    const ext = (e.name.split(".").pop() || "").toLowerCase();
    const mime = IMG_MIME[ext];
    if (mime) {
      if (!relPosix.startsWith("ref/") || st.size > 4_000_000) {
        acc.skipped += 1;
        continue;
      }
      try {
        const buf = readFileSync(full);
        const head = buf.subarray(0, 16).toString("utf8");
        acc.files[relPosix] = head.startsWith("data:image/")
          ? buf.toString("utf8")
          : `data:${mime};base64,${buf.toString("base64")}`;
        acc.n += 1;
        acc.bytes += st.size;
      } catch {
        acc.skipped += 1;
      }
      continue;
    }
    if (st.size > TREE_EACH) {
      acc.skipped += 1;
      continue;
    }
    if (!TEXT.test(e.name) && !BARE.test(e.name) && acc.n > TREE_FILES * 0.7) {
      acc.skipped += 1;
      continue;
    }
    try {
      acc.files[relPosix] = readFileSync(full, "utf8");
      acc.n += 1;
      acc.bytes += st.size;
    } catch {
      acc.skipped += 1;
    }
  }
}

export function listTree(cwd) {
  const root = resolveCwd(cwd);
  const acc = { files: {}, dirs: [], n: 0, bytes: 0, skipped: 0 };
  walk(root, "", acc);
  return { ok: true, cwd: root, files: acc.files, dirs: acc.dirs, skipped: acc.skipped, n: acc.n };
}

export function insideRoot(root, full) {
  const r = path.resolve(root);
  const f = path.resolve(full);
  if (process.platform === "win32") {
    const rl = r.replace(/[/\\]+$/, "").toLowerCase();
    const fl = f.toLowerCase();
    return fl === rl || fl.startsWith(`${rl}\\`) || fl.startsWith(`${rl}/`);
  }
  const rs = r.endsWith(path.sep) ? r : r + path.sep;
  return f === r || f.startsWith(rs);
}

export function writeRel(cwd, rel, content) {
  const root = resolveCwd(cwd);
  const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("Pfad ungültig.");
  if (String(content || "").trim().startsWith("data:image/")) return { ok: true, path: clean, skipped: "image" };
  const full = path.join(root, ...clean.split("/"));
  if (!insideRoot(root, full)) throw new Error("Pfad ungültig.");
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  return { ok: true, path: clean };
}

export function mkdirRel(cwd, rel) {
  const root = resolveCwd(cwd);
  const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("Pfad ungültig.");
  const full = path.join(root, ...clean.split("/"));
  if (!insideRoot(root, full)) throw new Error("Pfad ungültig.");
  mkdirSync(full, { recursive: true });
  return { ok: true, path: clean };
}

export function removeRel(cwd, rel) {
  const root = resolveCwd(cwd);
  const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("Pfad ungültig.");
  const full = path.join(root, ...clean.split("/"));
  if (!insideRoot(root, full)) throw new Error("Pfad ungültig.");
  if (existsSync(full)) rmSync(full, { recursive: true, force: true });
  return { ok: true, path: clean };
}

export async function gitDispatch(action, body) {
  const cwd = body.cwd;
  if (action === "status") return gitStatus(cwd);
  if (action === "commit") return gitCommit(cwd, String(body.message || ""), body.all !== false);
  if (action === "checkout") return gitCheckout(cwd, String(body.branch || ""), Boolean(body.create));
  if (action === "push") return gitPush(cwd, String(body.remote || "origin"));
  if (action === "pull") return gitPull(cwd);
  if (action === "blame") return gitBlame(cwd, String(body.path || ""));
  if (action === "init") return gitInit(cwd);
  if (action === "clone") return gitClone(String(body.url || ""), String(body.cwd || cwd));
  if (action === "stash") return gitStash(cwd, String(body.message || ""));
  if (action === "stash-pop") return gitStashPop(cwd);
  if (action === "branch") return gitBranch(cwd, String(body.branch || body.name || ""));
  if (action === "diff") return gitDiff(cwd, body.path ? String(body.path) : "");
  if (action === "tree") return listTree(cwd);
  return { ok: false, error: `unbekannt: ${action}` };
}
