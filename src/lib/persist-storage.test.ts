import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistDropped, shrinkFiles } from "./persist-storage.ts";

describe("persist-storage", () => {
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
});
