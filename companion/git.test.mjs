import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { gitBin, gitDispatch, insideRoot, listTree, mkdirRel, resolveCwd, writeRel } from "./git.mjs";

describe("git cwd", () => {
  it("rejects drive root", () => {
    assert.throws(() => resolveCwd("/"));
  });
  it("rejects ssh", () => {
    assert.throws(() => resolveCwd(path.join(os.homedir(), ".ssh")));
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
  it("loads only declared Cursor rule paths and keeps unrelated hidden data excluded", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-rule-tree-"));
    try {
      const accepted = { '.cursorrules': 'ROOT LEGACY', '.cursor/rules/global.mdc': 'ROOT MDC', '.cursor/rules/group/ui.mdc': 'GROUP MDC', 'app/.cursor/rules/typescript.mdc': 'APP MDC', 'app/AGENTS.md': 'APP AGENTS', 'app/.anvil/rules.md': 'APP ANVIL' };
      const excluded = { '.cursor/mcp.json': '{}', '.cursor/hooks/script.js': 'must-not-run', '.cursor/rules/README.md': 'not a rule', '.cursor/rules/.env': 'TOKEN=private', '.foreign/rules/always.mdc': 'PRIVATE HIDDEN', 'app/.cursorrules': 'nested legacy unsupported' };
      for (const [file, body] of Object.entries({ ...accepted, ...excluded })) { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), body); }
      const result = listTree(dir);
      for (const [file, body] of Object.entries(accepted)) assert.equal(result.files[file], body, file);
      for (const file of Object.keys(excluded)) assert.equal(file in result.files, false, file);
      assert.equal(result.dirs.includes('.cursor/hooks'), false);
      assert.equal(result.dirs.includes('.foreign'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("reopens imported package manifests and complete binary resources only within reserved storage", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-package-tree-"));
    try {
      const root = ".anvil/skills/package-test/";
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]);
      const large = Buffer.alloc(4_000_001, 255);
      const resources = {
        [root + ".codex-plugin/plugin.json"]: '{"name":"test"}',
        [root + ".cursor-plugin/plugin.json"]: '{"name":"test"}',
        [root + ".mcp.json"]: '{"mcpServers":{}}',
        [root + "dist/worker.js"]: "export {};",
        [root + "node_modules/tool/package.json"]: "{}",
        [root + "assets/picture.png"]: png,
        [root + "assets/audio.dat"]: large,
        [root + ".env"]: "TOKEN=test",
        [root + "key.pem"]: "fake-private-key",
        ".anvil/plugin-imports/test.json": '{"schema":1}',
        "src/.codex-plugin/plugin.json": "{}",
        "src/picture.png": png,
        "src/node_modules/tool/index.js": "no",
      };
      for (const [file, content] of Object.entries(resources)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), content);
      }
      const { files } = listTree(dir);
      for (const file of [".codex-plugin/plugin.json", ".cursor-plugin/plugin.json", ".mcp.json", "dist/worker.js", "node_modules/tool/package.json"])
        assert.equal(files[root + file], resources[root + file]);
      assert.equal(files[root + "assets/picture.png"], `data:application/octet-stream;base64,${png.toString("base64")}`);
      assert.equal(files[root + "assets/audio.dat"], `data:application/octet-stream;base64,${large.toString("base64")}`);
      assert.equal(files[".anvil/plugin-imports/test.json"], '{"schema":1}');
      for (const file of [root + ".env", root + "key.pem", "src/.codex-plugin/plugin.json", "src/picture.png", "src/node_modules/tool/index.js"])
        assert.equal(file in files, false, file);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
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
  it("keeps .github, empty files, Makefile; skips .anvil/work", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-dots-"));
    try {
      mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
      mkdirSync(path.join(dir, ".anvil", "work"), { recursive: true });
      writeFileSync(path.join(dir, ".github", "workflows", "ci.yml"), "on: push\n");
      writeFileSync(path.join(dir, "empty.ts"), "");
      writeFileSync(path.join(dir, "Makefile"), "all:\n");
      writeFileSync(path.join(dir, ".anvil", "rules.md"), "ok\n");
      writeFileSync(path.join(dir, ".anvil", "work", "tmp.ts"), "nope\n");
      const t = listTree(dir);
      assert.equal(t.files[".github/workflows/ci.yml"], "on: push\n");
      assert.equal(t.files["empty.ts"], "");
      assert.equal(t.files["Makefile"], "all:\n");
      assert.equal(t.files[".anvil/rules.md"], "ok\n");
      assert.equal(".anvil/work/tmp.ts" in t.files, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("loads ref png as data URLs and saves image bytes without overwriting external changes", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-img-"));
    try {
      mkdirSync(path.join(dir, "ref"), { recursive: true });
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=", "base64");
      writeFileSync(path.join(dir, "ref", "shot.png"), png);
      writeFileSync(path.join(dir, "logo.png"), png);
      const t = listTree(dir);
      assert.match(t.files["ref/shot.png"] ?? "", /^data:image\/png;base64,/);
      assert.equal("logo.png" in t.files, false);
      const image = t.files["ref/shot.png"];
      const w = writeRel(dir, "ref/x.png", image, null);
      assert.equal(w.ok, true);
      assert.deepEqual(readFileSync(path.join(dir, "ref", "x.png")), png);
      assert.equal(listTree(dir).files["ref/x.png"], image);
      assert.equal(writeRel(dir, "ref/x.png", image, image).ok, true);
      const external = Buffer.from("external image change");
      writeFileSync(path.join(dir, "ref", "x.png"), external);
      assert.throws(() => writeRel(dir, "ref/x.png", image, image), /extern geändert/);
      assert.deepEqual(readFileSync(path.join(dir, "ref", "x.png")), external);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("insideRoot rejects prefix siblings", () => {
    assert.equal(insideRoot("/tmp/ab", "/tmp/ab"), true);
    assert.equal(insideRoot("/tmp/ab", "/tmp/ab/c"), true);
    assert.equal(insideRoot("/tmp/ab", "/tmp/abc"), false);
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-esc-"));
    try {
      assert.throws(() => writeRel(dir, "../x.ts", "no"));
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
      assert.equal(init.ok, true, JSON.stringify(init));
      spawnSync(gitBin(), ["config", "user.email", "anvil-test@local"], { cwd: dir, windowsHide: true });
      spawnSync(gitBin(), ["config", "user.name", "Anvil Test"], { cwd: dir, windowsHide: true });
      const c = await gitDispatch("commit", { cwd: dir, message: "first" });
      assert.equal(c.ok, true);
      assert.equal(c.repo, true);
      assert.ok(c.log.some((x) => x.message === "first"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
