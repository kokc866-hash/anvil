import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistDropped, shrinkFiles } from "./persist-storage.ts";

describe("persist-storage", () => {
  it("retains complete plugin resource bundles within the archive budget", () => {
    const root = ".anvil/skills/package-test/";
    const files = {
      [root + ".codex-plugin/plugin.json"]: '{"name":"test"}',
      [root + ".mcp.json"]: '{"mcpServers":{}}',
      [root + "assets/icon.png"]: "data:application/octet-stream;base64,AP8=",
      [root + "dist/helper.js"]: "export const x = 1;",
      [root + "node_modules/tool/package.json"]: "{}",
      [root + "assets/large.dat"]: "x".repeat(16 * 1024 * 1024),
      ".anvil/plugin-imports/test.json": '{"schema":1}',
    };
    assert.deepEqual(shrinkFiles(files), files);
    assert.deepEqual(shrinkFiles({ [root + "oversize.txt"]: "x".repeat(16 * 1024 * 1024 + 1) }), {});
    assert.deepEqual(shrinkFiles({ [root + "large.txt"]: "xxxx" }, 3), {});
  });
  it("does not exempt ordinary files or secrets, even preferred package secrets", () => {
    const secret = ".anvil/skills/package-test/.env";
    const files = { "assets/icon.png": "png", "other.bin": "x".repeat(3_000_001), [secret]: "TOKEN=test", ".anvil/skills/package-test/key.pem": "test" };
    assert.deepEqual(shrinkFiles(files, undefined, [secret]), {});
  });
  it("keeps preferred files when the budget is tight", () => {
    const files: Record<string, string> = {
      "a.ts": "a".repeat(80),
      "z.ts": "z".repeat(80),
    };
    const slim = shrinkFiles(files, 100, ["z.ts"]);
    assert.equal("z.ts" in slim, true);
    assert.equal("a.ts" in slim, false);
  });
  it("skips vendor paths", () => {
    const files = {
      "src/app.ts": "export const n = 1;\n",
      "node_modules/foo/index.js": "module.exports = 1;\n",
    };
    const slim = shrinkFiles(files);
    assert.equal("src/app.ts" in slim, true);
    assert.equal("node_modules/foo/index.js" in slim, false);
    assert.equal(persistDropped(files, slim), 1);
  });
  it("keeps open files first in a small budget", () => {
    const files: Record<string, string> = {
      "open.ts": "o".repeat(40),
      "other.ts": "x".repeat(40),
    };
    const slim = shrinkFiles(files, 50, ["open.ts"]);
    assert.equal("open.ts" in slim, true);
  });
  it("keeps ref images even when skipPath would drop pngs", () => {
    const files = {
      "ref/shot.png": "data:image/png;base64," + "a".repeat(80),
      "logo.png": "x",
      "a.ts": "x",
    };
    const slim = shrinkFiles(files);
    assert.equal("ref/shot.png" in slim, true);
    assert.equal("logo.png" in slim, false);
    assert.equal(slim["a.ts"], "x");
  });
});
