/** Read-only release checks. No installer, project dependency or model call is invoked. */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { anvilHome, lspHome, toolHome } from "./paths.mjs";
import { listToolchains, resolveBin, toolchainBin } from "./toolchain.mjs";
import { LSP_CATALOG, listLsp } from "./lsp.mjs";
import { refreshPath } from "./install.mjs";

const DAY = 24 * 60 * 60 * 1000;
const RETRY = 60 * 60 * 1000;
const ITEM_STATES = new Set(["update", "new-series", "current", "newer-installed", "unknown", "bundled", "provider-reference", "not-installed", "error"]);
const NPM_PACKAGES = new Set(["pyright", "typescript", "typescript-language-server", "vscode-langservers-extracted", "yaml-language-server"]);
const LINKS = {
  node: "https://nodejs.org/en/download", go: "https://go.dev/dl/", rust: "https://www.rust-lang.org/tools/install",
  zig: "https://ziglang.org/download/", php: "https://windows.php.net/download/", python: "https://www.python.org/downloads/",
  jdk: "https://learn.microsoft.com/en-us/java/openjdk/download", dotnet: "https://dotnet.microsoft.com/download/dotnet",
  ruby: "https://rubyinstaller.org/downloads/", gopls: "https://github.com/golang/tools/releases",
  clangd: "https://github.com/clangd/clangd/releases", analyzer: "https://github.com/rust-lang/rust-analyzer/releases",
};

function stable(raw) {
  const text = String(raw || "").trim().replace(/^v/, "");
  return /^\d+\.\d+(?:\.\d+){0,2}$/.test(text) ? text : null;
}

/** null means incomparable, never "up to date". Pre-release versions are not stable releases. */
export function compareVersions(a, b) {
  const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v));
  if (date(a) || date(b)) return date(a) && date(b) ? Math.sign(Date.parse(a) - Date.parse(b)) : null;
  const av = stable(a), bv = stable(b);
  if (!av || !bv) return null;
  const aa = av.split(".").map(Number), bb = bv.split(".").map(Number);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const diff = (aa[i] || 0) - (bb[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

export function parseLatestVersion(provider, data, channel = "") {
  let version;
  if (provider === "node") version = data.find((r) => r.lts && stable(r.version))?.version;
  else if (provider === "go") version = data.find((r) => r.stable)?.version?.replace(/^go/, "");
  else if (provider === "zig") version = Object.keys(data).filter(stable).sort((a, b) => compareVersions(b, a))[0];
  else if (provider === "rust") version = String(data).match(/^\[pkg\.rust\]\s*\r?\nversion\s*=\s*"(\d+\.\d+\.\d+)/m)?.[1];
  else if (provider === "python") version = String(data).match(/Latest Python 3 Release\s*-\s*Python\s+(\d+\.\d+\.\d+)/)?.[1];
  else if (provider === "jdk") {
    const versions = [...String(data).matchAll(/microsoft-jdk-(\d+\.\d+\.\d+(?:\.\d+)?)-(?:windows|linux|macos)/gi)].map((m) => m[1]);
    version = versions.filter((v) => v.split(".")[0] === (channel || "21")).sort((a, b) => compareVersions(b, a))[0];
  } else if (provider === "php") version = data[channel || "8.3"]?.version;
  else if (provider === "dotnet") version = data["channel-version"] === (channel || "8.0") ? data["latest-sdk"] : null;
  else if (provider === "gopls") version = data.Version;
  else if (provider === "ruby") version = !data.prerelease && !data.draft ? data.tag_name?.match(/^RubyInstaller-(\d+\.\d+\.\d+)-\d+$/)?.[1] : null;
  else if (provider === "analyzer") {
    const tag = data.tag_name;
    if (!data.prerelease && !data.draft && /^\d{4}-\d{2}-\d{2}$/.test(tag || "") && !Number.isNaN(Date.parse(tag))) return tag;
  } else if (provider === "clangd") version = !data.prerelease && !data.draft ? data.tag_name : null;
  else if (provider === "npm") version = data.version;
  const clean = stable(version);
  if (!clean) throw new Error(`Keine passende stabile Version (${provider}${channel ? ` ${channel}` : ""}).`);
  return clean;
}

export function installedVersion(provider, output) {
  const text = String(output || "");
  if (provider === "analyzer") return text.match(/rust-analyzer[^\r\n]*\b(\d{4}-\d{2}-\d{2})\b/)?.[1] || null;
  const prefix = { go: /\bgo(\d+\.\d+\.\d+)/, rust: /\brustc\s+(\d+\.\d+\.\d+)/, jdk: /(?:javac\s+|version\s+")(\d+\.\d+\.\d+(?:\.\d+)?)/,
    python: /\bPython\s+(\d+\.\d+\.\d+)/, ruby: /\bruby\s+(\d+\.\d+\.\d+)/, php: /\bPHP\s+(\d+\.\d+\.\d+)/,
    clangd: /clangd version\s+(\d+\.\d+\.\d+)/, gopls: /\bgopls\s+v?(\d+\.\d+\.\d+)/ }[provider];
  return prefix ? text.match(prefix)?.[1] || null : stable(text.trim().split(/\s/)[0]);
}

function metadataUrl(item) {
  const channel = item.channel || "";
  if (item.provider === "npm") {
    if (!NPM_PACKAGES.has(item.package)) throw new Error("Unbekanntes Sprachpaket.");
    return `https://registry.npmjs.org/${item.package}/latest`;
  }
  if (item.provider === "dotnet") {
    if (!/^\d{1,2}\.0$/.test(channel || "8.0")) throw new Error("Unbekannte .NET-Versionsreihe.");
    return `https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/${channel || "8.0"}/releases.json`;
  }
  return {
    node: "https://nodejs.org/dist/index.json", go: "https://go.dev/dl/?mode=json", rust: "https://static.rust-lang.org/dist/channel-rust-stable.toml",
    zig: "https://ziglang.org/download/index.json", php: "https://windows.php.net/downloads/releases/releases.json",
    python: "https://www.python.org/downloads/windows/", jdk: LINKS.jdk,
    ruby: "https://api.github.com/repos/oneclick/rubyinstaller2/releases/latest", gopls: "https://proxy.golang.org/golang.org/x/tools/gopls/@latest",
    clangd: "https://api.github.com/repos/clangd/clangd/releases/latest", analyzer: "https://api.github.com/repos/rust-lang/rust-analyzer/releases/latest",
  }[item.provider];
}

/** Only small official metadata documents; response bodies share the fetch deadline. */
export async function fetchLatestVersion(item, fetchImpl = globalThis.fetch) {
  const url = metadataUrl(item);
  if (!url) throw new Error("Keine Updatequelle für dieses Werkzeug.");
  const response = await fetchImpl(url, { headers: { "user-agent": "Anvil-version-check" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const limit = 6 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("Versionsdaten zu groß."); }
  let text = "", bytes = 0;
  if (response.body) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) { await reader.cancel(); throw new Error("Versionsdaten zu groß."); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  const raw = ["rust", "python", "jdk"].includes(item.provider) ? text : JSON.parse(text);
  return parseLatestVersion(item.provider, raw, item.channel);
}

function inside(file, root) {
  const relative = path.relative(root, file || "");
  return Boolean(file) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function probe(file, args, env, cwd) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env, timeout: 4000, maxBuffer: 65536, windowsHide: true }, (error, stdout, stderr) =>
      resolve(error ? "" : `${stdout}\n${stderr}`.trim()));
  });
}

async function mapLimited(items, work, concurrency = 3) {
  let next = 0;
  const result = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const index = next++; if (index >= items.length) break; result[index] = await work(items[index], index); }
  }));
  return result;
}

/** Detect actual installed versions, including a managed backup when PATH takes precedence. */
export async function languageInventory() {
  refreshPath();
  const home = anvilHome(), tools = toolHome(), lsHome = lspHome();
  const rows = [];
  for (const tool of listToolchains()) {
    const effective = tool.kind === "python" ? resolveBin("python") || tool.path : tool.path;
    const managed = toolchainBin(tool.id);
    const files = [...new Set([effective, managed].filter(Boolean))];
    if (!files.length) files.push(null);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      rows.push({ id: `${tool.kind}${i ? ":backup" : ""}`, label: tool.label, kind: "runtime", provider: tool.kind,
        location: file ? inside(file, tools) ? "anvil" : "system" : "missing", path: file, backup: i > 0,
        source: LINKS[tool.kind] });
    }
  }
  const servers = listLsp();
  for (const spec of LSP_CATALOG.filter((r) => !r.via && r.id !== "java")) {
    const found = servers.find((r) => r.id === spec.id);
    const file = found?.path;
    const provider = spec.npm ? "npm" : spec.id === "rust" ? "analyzer" : spec.id;
    const pkg = spec.npm?.[0];
    let installed = null;
    if (pkg && inside(file, lsHome)) {
      try { installed = stable(JSON.parse(readFileSync(path.join(lsHome, "node_modules", pkg, "package.json"), "utf8")).version); } catch { /* Unknown stays explicit. */ }
    }
    rows.push({ id: `lsp:${spec.id}`, label: spec.label, kind: "language-server", provider, package: pkg, installed,
      location: file ? inside(file, lsHome) || inside(file, tools) ? "anvil" : "system" : "missing", path: file || null,
      ...(provider === "analyzer" && /(?:^|[\\/])cargo[\\/]bin[\\/]rust-analyzer(?:\.exe)?$/i.test(file || "") ? { managedBy: "rust" } : {}),
      source: pkg ? `https://www.npmjs.com/package/${pkg}` : LINKS[provider] });
  }
  return mapLimited(rows, async (item) => {
    if (item.path && !item.installed && item.provider !== "npm") {
      const env = { ...process.env, RUSTUP_AUTO_INSTALL: "0", DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1" };
      if (inside(item.path, path.join(tools, "rust"))) {
        env.CARGO_HOME = path.join(tools, "rust", "cargo"); env.RUSTUP_HOME = path.join(tools, "rust", "rustup");
      }
      const args = item.provider === "go" || item.provider === "zig" || item.provider === "gopls" ? ["version"] : item.provider === "jdk" ? ["-version"] : ["--version"];
      item.installed = installedVersion(item.provider, await probe(item.path, args, env, home));
    }
    const parts = item.installed?.split(".") || [];
    if (item.provider === "php") item.channel = parts.length >= 2 ? parts.slice(0, 2).join(".") : "8.3";
    if (item.provider === "dotnet") item.channel = parts.length >= 2 ? `${parts[0]}.0` : "8.0";
    if (item.provider === "jdk") item.channel = parts[0] || "21";
    if (item.provider === "jdk" && item.path) {
      let implementor = "";
      try { implementor = readFileSync(path.resolve(path.dirname(item.path), "..", "release"), "utf8").match(/^IMPLEMENTOR="([^"]+)"/m)?.[1] || ""; } catch { /* A different vendor cannot be treated as a Microsoft package update. */ }
      item.comparisonOnly = !/microsoft/i.test(implementor);
    }
    if (item.provider === "node") item.channel = "LTS";
    return item;
  });
}

function itemStatus(item, latest) {
  if (item.location === "missing") return "not-installed";
  if (item.managedBy) return "bundled";
  if (item.comparisonOnly) return "provider-reference";
  const comparison = compareVersions(latest, item.installed);
  if (comparison == null) return "unknown";
  if (comparison < 0) return "newer-installed";
  if (comparison === 0) return "current";
  const oldParts = item.installed.split("."), newParts = latest.split(".");
  const seriesParts = ["python", "php"].includes(item.provider) ? 2 : 1;
  return oldParts.slice(0, seriesParts).join(".") !== newParts.slice(0, seriesParts).join(".") ? "new-series" : "update";
}

export function createLanguageUpdateChecker({ home = anvilHome, now = Date.now, inventory = languageInventory, latest = fetchLatestVersion } = {}) {
  const caches = new Map(), running = new Map();
  const file = (root) => path.join(root, "language-updates.json");
  function load(root) {
    if (caches.has(root)) return caches.get(root);
    let saved = {};
    try { saved = JSON.parse(readFileSync(file(root), "utf8")); } catch { /* Fresh profile or invalid cache: check again. */ }
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
    const stamp = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 8640000000000000 ? Number(value) : 0;
    const items = Array.isArray(saved.items) ? saved.items.filter((r) => r && typeof r.id === "string" && typeof r.label === "string" && ITEM_STATES.has(r.status))
      .map((r) => ({ ...r, checkedAt: stamp(r.checkedAt), installed: typeof r.installed === "string" ? r.installed : null, latest: typeof r.latest === "string" ? r.latest : null })) : [];
    const state = { version: 1, automatic: saved.automatic !== false, lastAttemptAt: stamp(saved.lastAttemptAt),
      checkedAt: stamp(saved.checkedAt), incomplete: saved.incomplete === true,
      items, error: typeof saved.error === "string" ? saved.error : "" };
    caches.set(root, state);
    return state;
  }
  function save(root, state) {
    mkdirSync(root, { recursive: true });
    const tmp = `${file(root)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, file(root));
    caches.set(root, state);
  }
  function status(root = home()) {
    const state = load(root), errorCount = state.items.filter((r) => r.status === "error").length;
    return { ...state, home: root, checking: running.has(root), intervalHours: 24,
      nextCheckAt: state.automatic ? state.lastAttemptAt ? state.lastAttemptAt + (state.error || errorCount || state.incomplete ? RETRY : DAY) : 0 : null,
      updateCount: state.items.filter((r) => ["update", "new-series"].includes(r.status)).length, errorCount };
  }
  function configure(automatic) {
    if (typeof automatic !== "boolean") throw new Error("automatic must be a boolean.");
    const root = home(); save(root, { ...load(root), automatic }); return status(root);
  }
  function check({ manual = false } = {}) {
    const root = home();
    if (running.has(root)) return running.get(root);
    const cached = status(root);
    if (!manual && (!cached.automatic || now() < cached.nextCheckAt)) return Promise.resolve(cached);
    const started = now();
    save(root, { ...load(root), lastAttemptAt: started, incomplete: true });
    // Defer inventory so the promise is registered before another caller can start a scan.
    const task = Promise.resolve().then(async () => {
      try {
        const items = await inventory();
        const prior = load(root).items;
        const releases = new Map();
        const result = await mapLimited(items, async (item) => {
          try {
            // rustup's component is updated through the Rust toolchain, not a standalone GitHub build.
            if (item.managedBy) return { ...item, latest: null, status: "bundled", checkedAt: now(), error: "" };
            const key = `${item.provider}:${item.package || ""}:${item.channel || ""}`;
            if (!releases.has(key)) releases.set(key, Promise.resolve().then(() => latest(item)));
            const version = await releases.get(key);
            if (compareVersions(version, version) == null) throw new Error("Unbekanntes Versionsformat des Anbieters.");
            return { ...item, latest: version, status: itemStatus(item, version), checkedAt: now(), error: "" };
          } catch (error) {
            const old = prior.find((row) => row.id === item.id && row.channel === item.channel);
            return { ...item, latest: old?.latest || null, checkedAt: old?.checkedAt || 0, status: "error", error: String(error.message || error).slice(0, 200) };
          }
        });
        save(root, { ...load(root), checkedAt: now(), items: result, error: "", incomplete: false });
      } catch (error) {
        save(root, { ...load(root), error: String(error.message || error).slice(0, 200), incomplete: false });
      }
      running.delete(root);
      return status(root);
    }).finally(() => running.delete(root));
    running.set(root, task);
    return task;
  }
  return { status, configure, check };
}

export const languageUpdates = createLanguageUpdateChecker();
