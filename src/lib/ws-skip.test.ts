import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentSig, formatBytes, isSourcePath, rankPaths, skipDirName, skipPath } from "./ws-skip.ts";

describe("ws-skip", () => {
  it("drops vendor dirs and lockfiles", () => {
    assert.equal(skipDirName("node_modules"), true);
    assert.equal(skipDirName("src"), false);
    assert.equal(skipPath("src/app.ts"), false);
    assert.equal(skipPath("node_modules/foo/index.js"), true);
    assert.equal(skipPath("web/.venv/lib/x.py"), true);
    assert.equal(skipPath("package-lock.json"), true);
    assert.equal(skipPath("src/package-lock.json"), true);
  });
  it("ranks open files first", () => {
    const ranked = rankPaths(["z.md", "a.ts", "b.json"], ["b.json"]);
    assert.equal(ranked[0], "b.json");
    assert.equal(isSourcePath("a.ts"), true);
    assert.equal(isSourcePath("a.png"), false);
  });
  it("sig changes when a same-length edit happens", () => {
    assert.notEqual(contentSig("number"), contentSig("string"));
    assert.equal(contentSig("aa"), contentSig("aa"));
    assert.match(formatBytes(1_500_000), /MB/);
  });
});
