import assert from "node:assert/strict";
import { test } from "node:test";
import * as catalog from "../electron/cli-models.mjs";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Windows resolves the subscription against the newest usable registered or PATH CLI", async t => {
  const { resolveWindowsCodex } = await import("../electron/windows-codex.mjs");
  const root = await mkdtemp(join(tmpdir(), "anvil-codex-installs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const install = join(root, "OpenAI.Codex_26.9.0.0_x64__2p2nqsd0c76g0");
  const desktop = join(install, "app", "resources", "codex.exe");
  await mkdir(join(install, "app", "resources"), { recursive: true });
  await writeFile(desktop, "");
  const primary = { file: join(root, "standalone", "codex.exe"), args: [] };
  let location = install, primaryVersion = "0.99.0", desktopVersion = "0.110.0-alpha.12";
  let versionReads = 0;
  const run = async (cmd, args, options) => {
    assert.ok(options.timeoutMs > 0);
    if (cmd.file.endsWith("powershell.exe")) {
      assert.ok(args.includes("-NonInteractive") && args.includes("-NoProfile"));
      assert.match(args.at(-1), /Get-AppxPackage.*OpenAI\.Codex/);
      return { code: 0, stdout: location };
    }
    assert.deepEqual(args, ["--version"]);
    versionReads++;
    const version = cmd.file === primary.file ? primaryVersion : desktopVersion;
    return { code: version ? 0 : 1, stdout: version ? `codex-cli ${version}\n` : "" };
  };
  const select = (pathCommand = primary, signal) => resolveWindowsCodex(pathCommand, { run, env: { SystemRoot: root }, signal, refresh: true });
  assert.equal((await select()).file, desktop, "the first PATH hit can be older");
  assert.equal((await select(null)).file, desktop, "Desktop alone is sufficient");
  primaryVersion = "0.110.0";
  assert.equal((await select()).file, primary.file, "stable beats prerelease of the same version");
  primaryVersion = "0.110.0-alpha.9";
  assert.equal((await select()).file, desktop, "compare numeric prerelease components");
  primaryVersion = desktopVersion;
  assert.equal((await select()).file, primary.file, "same version respects PATH");
  desktopVersion = "";
  assert.equal((await select()).file, primary.file, "a damaged optional install cannot hide the working CLI");
  location = join(root, "unregistered-package");
  const before = versionReads;
  assert.equal((await select()).file, primary.file);
  assert.equal(versionReads, before, "no second binary to compare");
  assert.equal(await select(null), null);
  await assert.rejects(select(primary, AbortSignal.abort()), /abgebrochen/i);
});

test("Claude and Copilot refresh their CLI catalog without creating a model turn or granting tools", async () => {
  const command = { file: process.execPath, args: [fileURLToPath(new URL("../fixtures/cli-catalog-fixture.mjs", import.meta.url))] };
  for (const kind of ["claude", "copilot"]) {
    const env = { ...process.env, ANVIL_CATALOG_KIND: kind, OPENAI_API_KEY: "fixture", ANTHROPIC_API_KEY: "fixture", GITHUB_TOKEN: "fixture" };
    assert.deepEqual(await catalog.listCliModels(kind, { command, env }), [kind === "claude" ? "claude-future[1m]" : "vendor/future-copilot"]);
    for (const mode of ["malformed", "permission", "early"])
      await assert.rejects(catalog.listCliModels(kind, { command, env: { ...env, ANVIL_CATALOG_MODE: mode } }), /Modellliste|Werkzeug|beendet/);
    await assert.rejects(catalog.listCliModels(kind, { command, env: { ...env, ANVIL_CATALOG_MODE: "wait" }, timeoutMs: 300 }), /Zeitlimit/);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await assert.rejects(catalog.listCliModels(kind, { command, env: { ...env, ANVIL_CATALOG_MODE: "wait" }, signal: controller.signal }), /abgebrochen/);
  }
});

test("Codex catalog retains new model IDs and excludes hidden entries without remapping", () => {
  assert.deepEqual(catalog.parseCodexModels(JSON.stringify({ models: [
    { slug: "future-model", visibility: "list" },
    { slug: "gpt-6.1-sol", visibility: "list" },
    { slug: "internal-model", visibility: "hide" },
    { slug: "future-model", visibility: "list" },
  ] })), ["future-model", "gpt-6.1-sol"]);
});

test("malformed Codex catalogs are errors, not empty successful refreshes", () => {
  for (const value of ["<html>failed</html>", "{}", '{"models":null}', '{"models":[null]}', '{"models":[{"slug":"bad model","visibility":"list"}]}']) {
    assert.throws(() => catalog.parseCodexModels(value), /Modellliste/);
  }
  assert.deepEqual(catalog.parseCodexModels('{"models":[]}'), []);
});

test("catalog refresh uses the CLI without inference and does not reuse an earlier result", async () => {
  const command = { file: process.execPath, args: ["-e", `
    const args=process.argv.slice(1);
    if(args[0]!=='debug'||args[1]!=='models'||!args.includes('forced_login_method="chatgpt"')||args.includes('--bundled')) process.exit(9);
    if(process.env.OPENAI_API_KEY) process.exit(10);
    console.log(JSON.stringify({models:[{slug:process.env.ANVIL_MODEL_FIXTURE,visibility:'list'}]}));
  `, "--"] };
  for (const model of ["gpt-6.1-sol", "future-model"]) {
    assert.deepEqual(await catalog.listCliModels("codex", { command, env: { ...process.env, OPENAI_API_KEY: "must-not-reach-child", ANVIL_MODEL_FIXTURE: model } }), [model]);
  }
});

test("catalog refresh reports process errors and can be cancelled", async () => {
  await assert.rejects(catalog.listCliModels("unsupported"), /Modellliste/);
  await assert.rejects(catalog.listCliModels("codex", { command: { file: process.execPath, args: ["-e", "process.stderr.write('catalog unavailable'); process.exit(7)", "--"] } }), /catalog unavailable/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(catalog.listCliModels("codex", { signal: controller.signal }), /abgebrochen/);
});
