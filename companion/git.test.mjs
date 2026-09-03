import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { gitBin, gitDispatch, listTree, mkdirRel, resolveCwd, writeRel } from "./git.mjs";

describe("git cwd", () => {
  it("rejects drive root", () => {
    assert.throws(() => resolveCwd("/"));
  });
  it("accepts a temp dir under home or tmp", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-git-"));
    try {
      const cwd = resolveCwd(dir);
      assert.equal(cwd, path.resolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("tree", () => {
  it("skips node_modules and keeps source", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-tree-"));
    try {
      mkdirSync(path.join(dir, "src"));
      mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
      writeFileSync(path.join(dir, "src", "app.ts"), "export const n = 1;\n");
      writeFileSync(path.join(dir, "node_modules", "x", "index.js"), "nope");
      writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
      const t = listTree(dir);
      assert.equal(t.files["src/app.ts"], "export const n = 1;\n");
      assert.equal(t.files[".gitignore"], "node_modules\n");
      assert.equal("node_modules/x/index.js" in t.files, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("mkdir then write", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-mkdir-"));
    try {
      mkdirRel(dir, "src/pkg");
      writeRel(dir, "src/pkg/a.ts", "export {}\n");
      const t = listTree(dir);
      assert.equal(t.files["src/pkg/a.ts"], "export {}\n");
      assert.ok(t.dirs.includes("src/pkg"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps empty dirs", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-empty-"));
    try {
      mkdirRel(dir, "empty/nested");
      const t = listTree(dir);
      assert.ok(t.dirs.includes("empty"));
      assert.ok(t.dirs.includes("empty/nested"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("git op", () => {
  it("rejects a bad clone url", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-clone-"));
    try {
      const r = await gitDispatch("clone", { cwd: dir, url: "not-a-url" });
      assert.equal(r.ok, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects a bad branch name", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-br-"));
    try {
      const r = await gitDispatch("branch", { cwd: dir, branch: "???" });
      assert.equal(r.ok, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("init + commit when git exists", async () => {
    if (!gitBin()) return;
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-gitop-"));
    try {
      writeRel(dir, "readme.md", "# hi\n");
      const init = await gitDispatch("init", { cwd: dir });
      if (!init.ok && /Benutzerbereich/.test(init.error || "")) return;
      assert.equal(init.ok, true);
      const c = await gitDispatch("commit", { cwd: dir, message: "first" });
      assert.equal(c.ok, true);
      assert.equal(c.repo, true);
      assert.ok(c.log.some((x) => x.message === "first"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
