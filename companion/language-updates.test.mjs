import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLanguageUpdateChecker, compareVersions, parseLatestVersion, installedVersion, fetchLatestVersion } from "./language-updates.mjs";

test("release comparisons include fourth version components, reject previews and handle date releases", () => {
  assert.equal(compareVersions("v21.0.12.1", "21.0.12"), 1);
  assert.equal(compareVersions("7.0.2", "7.0.2"), 0);
  assert.equal(compareVersions("2026-10-02", "2026-09-28"), 1);
  assert.equal(compareVersions("0.18.0-dev.1", "0.17.0"), null);
  assert.equal(compareVersions("rust-analyzer", "2026-09-28"), null);
  assert.equal(compareVersions("1.0.0", "2026-09-28"), null);
});

test("official metadata selects stable versions and the configured release series", () => {
  assert.equal(parseLatestVersion("node", [{ version: "v26.1.0", lts: false }, { version: "v24.7.0", lts: "Krypton" }]), "24.7.0");
  assert.equal(parseLatestVersion("go", [{ version: "go1.28rc1", stable: false }, { version: "go1.27.1", stable: true }]), "1.27.1");
  assert.equal(parseLatestVersion("zig", { master: { version: "0.18.0-dev.1" }, "0.16.0": {}, "0.17.0": {} }), "0.17.0");
  assert.equal(parseLatestVersion("rust", 'manifest-version = "2"\n[pkg.cargo]\nversion = "0.100.0 (hash)"\n[pkg.rust]\nversion = "1.99.0 (hash 2026-10-01)"\n'), "1.99.0");
  assert.equal(parseLatestVersion("python", '<a>Latest Python 3 Release - Python 3.14.8</a><a>Python 3.15.0rc2</a>'), "3.14.8");
  assert.equal(parseLatestVersion("php", { "8.3": { version: "8.3.29" }, "8.5": { version: "8.5.1" } }, "8.3"), "8.3.29");
  assert.equal(parseLatestVersion("dotnet", { "channel-version": "8.0", "latest-sdk": "8.0.425", "latest-runtime": "8.0.31" }, "8.0"), "8.0.425");
  assert.equal(parseLatestVersion("jdk", 'microsoft-jdk-25.0.4.1-windows-x64.zip microsoft-jdk-21.0.12.1-windows-x64.zip', "21"), "21.0.12.1");
  assert.throws(() => parseLatestVersion("jdk", 'microsoft-jdk-27.0.0-windows-x64.zip', "21"), /version/i);
  assert.throws(() => parseLatestVersion("dotnet", { "channel-version": "10.0", "latest-sdk": "10.0.100" }, "8.0"), /version/i);
  assert.equal(parseLatestVersion("ruby", { tag_name: "RubyInstaller-4.0.7-1", prerelease: false }), "4.0.7");
  assert.throws(() => parseLatestVersion("clangd", { tag_name: "24.0.0-rc1", prerelease: true }), /version/i);
  assert.equal(parseLatestVersion("gopls", { Version: "v0.23.0" }), "0.23.0");
});

test("installed command output distinguishes compiler versions and standalone analyzer dates", () => {
  assert.equal(installedVersion("go", "go version go1.27.0 windows/amd64"), "1.27.0");
  assert.equal(installedVersion("rust", "rustc 1.99.0 (hash 2026-10-01)"), "1.99.0");
  assert.equal(installedVersion("jdk", "javac 21.0.12.1"), "21.0.12.1");
  assert.equal(installedVersion("ruby", "ruby 3.3.8 (2025-04-09 revision hash) [x64-mingw-ucrt]"), "3.3.8");
  assert.equal(installedVersion("analyzer", "rust-analyzer 0.3.2686-standalone (hash 2026-10-02)"), "2026-10-02");
  assert.equal(installedVersion("gopls", "golang.org/x/tools/gopls v0.22.0"), "0.22.0");
  assert.equal(installedVersion("clangd", "clangd version 23.1.0"), "23.1.0");
  assert.equal(installedVersion("python", "Python was not found; install from the Microsoft Store."), null);
});

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "anvil-language-updates-"));
  t.after(() => { assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(home, { recursive: true, force: true }); });
  let time = Date.UTC(2026, 9, 3, 10), calls = 0, fail = false, wait = null;
  const options = {
    home: () => home, now: () => time,
    inventory: async () => [
      { id: "tsls", label: "TypeScript Language Server", kind: "language-server", provider: "npm", package: "typescript-language-server", installed: "6.0.0", location: "anvil" },
      { id: "typescript", label: "TypeScript", kind: "language-server", provider: "npm", package: "typescript", installed: "7.0.2", location: "anvil" },
      { id: "python", label: "Python", kind: "runtime", provider: "python", installed: null, location: "missing" },
    ],
    latest: async (item) => { calls++; if (wait) await wait; if (fail && item.id === "typescript") throw new Error("HTTP 503"); return item.id === "tsls" ? "6.0.1" : item.id === "typescript" ? "7.0.2" : "3.14.8"; },
  };
  return { options, home, get calls() { return calls; }, advance: (n) => { time += n; }, fail: () => { fail = true; }, hold: (p) => { wait = p; } };
}

test("daily checks persist across restarts, retain update results, and never execute installers", async (t) => {
  const f = fixture(t), check = createLanguageUpdateChecker(f.options);
  const result = await check.check();
  assert.equal(result.items.find((x) => x.id === "tsls").status, "update");
  assert.equal(result.items.find((x) => x.id === "typescript").status, "current");
  assert.equal(result.items.find((x) => x.id === "python").status, "not-installed");
  assert.equal(result.updateCount, 1);
  assert.equal(f.calls, 3);
  const rebooted = createLanguageUpdateChecker(f.options);
  await rebooted.check();
  assert.equal(f.calls, 3);
  assert.equal(rebooted.status().updateCount, 1);
  assert.equal(JSON.parse(readFileSync(path.join(f.home, "language-updates.json"), "utf8")).automatic, true);
  f.advance(24 * 60 * 60 * 1000);
  await rebooted.check();
  assert.equal(f.calls, 6);
});

test("disabling automatic checks survives restart; a manual check remains available", async (t) => {
  const f = fixture(t), check = createLanguageUpdateChecker(f.options);
  check.configure(false);
  assert.equal((await check.check()).automatic, false);
  assert.equal(f.calls, 0);
  const rebooted = createLanguageUpdateChecker(f.options);
  assert.equal(rebooted.status().automatic, false);
  assert.equal((await rebooted.check({ manual: true })).items.length, 3);
  assert.equal(f.calls, 3);
  assert.throws(() => check.configure("false"), /boolean/i);
});

test("overlapping checks share one scan and preserve a preference changed while running", async (t) => {
  const f = fixture(t), check = createLanguageUpdateChecker(f.options);
  let release; f.hold(new Promise((resolve) => { release = resolve; }));
  const a = check.check(), b = check.check({ manual: true });
  assert.equal(check.status().checking, true);
  check.configure(false);
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.deepEqual(first, second);
  assert.equal(f.calls, 3);
  assert.equal(second.automatic, false);
  assert.equal(createLanguageUpdateChecker(f.options).status().automatic, false);
});

test("offline provider failures stay explicit and retry with backoff without discarding the last known version", async (t) => {
  const f = fixture(t), check = createLanguageUpdateChecker(f.options);
  const initial = await check.check();
  f.advance(24 * 60 * 60 * 1000); f.fail();
  const failed = await check.check();
  const item = failed.items.find((x) => x.id === "typescript");
  assert.equal(item.status, "error");
  assert.equal(item.latest, "7.0.2");
  assert.equal(item.checkedAt, initial.checkedAt);
  assert.match(item.error, /503/);
  assert.equal(failed.errorCount, 1);
  await check.check(); assert.equal(f.calls, 6);
  f.advance(60 * 60 * 1000); await check.check(); assert.equal(f.calls, 9);
});

test("unknown versions and other release series are never reported as current", async (t) => {
  const f = fixture(t);
  f.options.inventory = async () => [
    { id: "clangd", provider: "clangd", installed: null, location: "anvil", path: "/clangd" },
    { id: "rust-analyzer", provider: "analyzer", installed: "0.0.0", location: "anvil", path: "/rust-analyzer", managedBy: "rust" },
    { id: "node", provider: "node", installed: "22.0.0", location: "system", path: "/node" },
  ];
  f.options.latest = async (item) => item.provider === "analyzer" ? "2026-09-28" : item.provider === "node" ? "24.7.0" : "23.1.0";
  const result = await createLanguageUpdateChecker(f.options).check();
  assert.equal(result.items[0].status, "unknown");
  assert.equal(result.items[1].status, "bundled");
  assert.equal(result.items[2].status, "new-series");
  assert.equal(result.updateCount, 1);
});

test("provider access is limited to official metadata and rejects failures and oversized documents", async () => {
  let request;
  const version = await fetchLatestVersion({ provider: "npm", package: "typescript-language-server" }, async (url, init) => {
    request = { url, init }; return new Response('{"version":"6.0.1"}');
  });
  assert.equal(version, "6.0.1");
  assert.equal(request.url, "https://registry.npmjs.org/typescript-language-server/latest");
  assert.equal(request.init.method, undefined);
  assert.ok(request.init.signal instanceof AbortSignal);
  await assert.rejects(fetchLatestVersion({ provider: "npm", package: "user-plugin" }), /Unbekanntes Sprachpaket/);
  await assert.rejects(fetchLatestVersion({ provider: "clangd" }, async () => new Response("rate limited", { status: 429 })), /429/);
  await assert.rejects(fetchLatestVersion({ provider: "node" }, async () => new Response("data", { headers: { "content-length": "99999999" } })), /zu groß/);
  await assert.rejects(fetchLatestVersion({ provider: "node" }, async () => new Response("x".repeat(6 * 1024 * 1024 + 1))), /zu groß/);
  await assert.rejects(fetchLatestVersion({ provider: "node" }, async () => new Response("not JSON")), SyntaxError);
});

test("managed and system copies share metadata while keeping independent update states", async (t) => {
  const f = fixture(t);
  f.options.inventory = async () => [
    { id: "node", label: "Node.js", provider: "node", installed: "24.21.0", location: "system" },
    { id: "node:backup", label: "Node.js", provider: "node", installed: "24.19.0", location: "anvil", backup: true },
  ];
  let requests = 0; f.options.latest = async () => { requests++; return "24.21.0"; };
  const result = await createLanguageUpdateChecker(f.options).check();
  assert.equal(requests, 1);
  assert.equal(result.items[0].status, "current");
  assert.equal(result.items[1].status, "update");
  assert.equal(result.items[1].backup, true);
});

test("another JDK provider's reference version is not counted as an update", async (t) => {
  const f = fixture(t);
  f.options.inventory = async () => [{ id: "jdk", provider: "jdk", channel: "21", installed: "21.0.12", location: "system", comparisonOnly: true }];
  f.options.latest = async () => "21.0.12.1";
  const result = await createLanguageUpdateChecker(f.options).check();
  assert.equal(result.updateCount, 0);
  assert.equal(result.items[0].status, "provider-reference");
});

test("an interrupted scan retries after one hour and package folder changes have separate settings", async (t) => {
  const f = fixture(t), second = fixture(t);
  let selected = f.home;
  const options = { ...f.options, home: () => selected };
  const first = createLanguageUpdateChecker(options);
  const previous = await first.check();
  const file = path.join(f.home, "language-updates.json");
  const stored = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...stored, incomplete: true }));
  const rebooted = createLanguageUpdateChecker(options);
  assert.equal(rebooted.status().checkedAt, previous.checkedAt);
  f.advance(60 * 60 * 1000); await rebooted.check();
  assert.equal(f.calls, 6);
  rebooted.configure(false);
  selected = second.home;
  assert.equal(rebooted.status().automatic, true);
  assert.equal(rebooted.status().items.length, 0);
  selected = f.home;
  assert.equal(rebooted.status().automatic, false);
});

test("a damaged cache does not block a new scan or break the version display", async (t) => {
  const f = fixture(t), file = path.join(f.home, "language-updates.json");
  writeFileSync(file, "null");
  const fresh = createLanguageUpdateChecker(f.options);
  assert.equal(fresh.status().checkedAt, 0);
  assert.equal((await fresh.check()).items.length, 3);
  writeFileSync(file, JSON.stringify({ automatic: false, checkedAt: "invalid", lastAttemptAt: "Infinity", items: [null, { id: "corrupt", label: {}, status: "current" }] }));
  const damaged = createLanguageUpdateChecker(f.options);
  assert.equal(damaged.status().automatic, false);
  assert.equal(damaged.status().checkedAt, 0);
  assert.deepEqual(damaged.status().items, []);
  assert.equal((await damaged.check({ manual: true })).items.length, 3);
});
