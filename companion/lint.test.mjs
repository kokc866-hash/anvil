import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintToolResult, parsePyCompile, parseTsc, spawnArgs } from "./lint.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("companion lint parse", () => {
  it("parses tsc", () => {
    const hits = parseTsc("src/app.ts(10,5): error TS2304: Cannot find name 'foo'.");
    assert.equal(hits[0]?.line, 10);
    assert.equal(hits[0]?.source, "tsc");
    assert.ok(hits[0]?.message.includes("TS2304"));
  });
  it("parses py_compile", () => {
    const hits = parsePyCompile(`  File "src/app.py", line 3\n    x =\n       ^\nSyntaxError: invalid syntax`);
    assert.equal(hits[0]?.path, "src/app.py");
    assert.equal(hits[0]?.line, 3);
  });
});

describe("lint process launch", () => {
  it("distinguishes code findings from failed or incomplete Pyright checks", () => {
    const findings = [{ source: "pyright", message: "type mismatch" }];
    const result = { ok: false, code: 1, stderr: "" };
    assert.equal(lintToolResult("pyright", result, findings).status, "findings");
    assert.equal(lintToolResult("pyright", result, findings).ok, false, "code errors still fail code validation");
    assert.equal(lintToolResult("pyright", { ok: true, code: 0 }, []).status, "passed");
    assert.equal(lintToolResult("pyright", { ...result, code: 2 }, findings).status, "failed");
    assert.equal(lintToolResult("pyright", result, []).status, "failed");
    assert.equal(lintToolResult("pyright", result, findings, false).status, "failed");
    assert.match(lintToolResult("pyright", { ...result, timedOut: true }, findings).error, /Zeitlimit/);
    assert.equal(lintToolResult("pyright", { ...result, signal: "SIGTERM" }, findings).status, "failed");
    assert.equal(lintToolResult("pyright", { ...result, error: "spawn EINVAL" }, findings).status, "failed");
  });
  for (const [pkg, bin, entry] of [["pyright", "pyright", "index.js"], ["typescript", "tsc", "bin/tsc"]]) {
    for (const global of [false, true]) {
      it(`runs ${bin} through Node instead of its ${global ? "global" : "local"} Windows shim`, async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "anvil-lint-launch spaces &-"));
        try {
          const folder = path.join(root, "node_modules", pkg);
          mkdirSync(path.dirname(path.join(folder, entry)), { recursive: true });
          writeFileSync(path.join(folder, "package.json"), JSON.stringify({ bin: { [bin]: entry } }));
          writeFileSync(path.join(folder, entry), "#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n");
          const shim = path.join(global ? root : path.join(root, "node_modules", ".bin"), `${bin}.cmd`);
          mkdirSync(path.dirname(shim), { recursive: true });
          writeFileSync(shim, "@exit /b 99\n");
          const args = ["--outputjson", "-p", path.join(root, "project space & %value%")];
          const result = await spawnArgs(shim, args, root, 3000);
          assert.equal(result.ok, true, result.stderr);
          assert.deepEqual(JSON.parse(result.stdout), args);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }
  it("returns synchronous and asynchronous start errors without rejecting the whole lint request", async () => {
    const invalid = await spawnArgs(null, [], os.tmpdir(), 1000);
    assert.equal(invalid.ok, false);
    assert.ok(invalid.error);
    const missing = await spawnArgs(path.join(os.tmpdir(), "anvil-missing-lint-program.exe"), [], os.tmpdir(), 1000);
    assert.equal(missing.ok, false);
    assert.match(missing.error, /ENOENT/);
  });
});
