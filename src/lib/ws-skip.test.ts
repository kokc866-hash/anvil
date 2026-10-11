import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentSig,
  formatBytes,
  isSourcePath,
  isImportedPluginPath,
  keepBareFile,
  keepDotName,
  overlayDiskTree,
  rankPaths,
  skipDirName,
  skipPath,
} from "./ws-skip.ts";

describe("ws-skip", () => {
  it("recognizes only reserved imported package paths without widening source filters", () => {
    assert.equal(isImportedPluginPath(".anvil/skills/package-photo/assets/logo.png"), true);
    assert.equal(isImportedPluginPath(".anvil/skills/package-photo/.codex-plugin/plugin.json"), true);
    assert.equal(isImportedPluginPath(".anvil/plugin-imports/photo.json"), true);
    for (const p of ["src/.anvil/skills/package-photo/icon.png", ".anvil/skills/package-/x", ".anvil/skills/package-x/../../outside.png", ".anvil/skills/package-x//x", ".anvil/skills/other/icon.png", ".anvil/plugin-imports/arbitrary.txt"])
      assert.equal(isImportedPluginPath(p), false, p);
    assert.equal(skipPath(".anvil/skills/package-photo/assets/logo.png"), true);
  });
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
  it("keeps config dots and bare files, skips .anvil/work", () => {
    assert.equal(keepDotName(".github"), true);
    assert.equal(keepDotName(".editorconfig"), true);
    assert.equal(keepDotName(".gitignore"), true);
    assert.equal(keepDotName(".env"), false);
    assert.equal(keepBareFile("Makefile"), true);
    assert.equal(keepBareFile("Dockerfile"), true);
    assert.equal(isSourcePath("Makefile"), true);
    assert.equal(isSourcePath("game.gd"), true);
    assert.equal(skipPath(".anvil/work/tmp.ts"), true);
    assert.equal(skipPath(".anvil/out/app"), true);
    assert.equal(skipPath("ref/shot.png"), false);
    assert.equal(skipPath("logo.png"), true);
  });
  it("overlay keeps dirty edits and ram-only source", () => {
    const disk = { "a.ts": "disk", "b.ts": "disk-b" };
    const ram = { "a.ts": "edit", "c.ts": "new", "empty.ts": "", ".github/workflows/ci.yml": "on: push" };
    const out = overlayDiskTree(disk, ram, { "a.ts": true });
    assert.equal(out["a.ts"], "edit");
    assert.equal(out["b.ts"], "disk-b");
    assert.equal(out["c.ts"], "new");
    assert.equal(out["empty.ts"], "");
    assert.equal(out[".github/workflows/ci.yml"], "on: push");
  });
  it("overlay keeps ram-only ref images", () => {
    const disk = { "a.ts": "x" };
    const ram = { "a.ts": "x", "ref/shot.png": "data:image/png;base64,aaa" };
    const out = overlayDiskTree(disk, ram, {});
    assert.equal(out["ref/shot.png"], "data:image/png;base64,aaa");
  });
  it("overlay prefers ram data-url over disk binary junk", () => {
    const disk = { "ref/shot.png": "\uFFFD\uFFFD" };
    const ram = { "ref/shot.png": "data:image/png;base64,aaa" };
    const out = overlayDiskTree(disk, ram, {});
    assert.equal(out["ref/shot.png"], "data:image/png;base64,aaa");
  });
});
