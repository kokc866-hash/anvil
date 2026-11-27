import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createNativeWorkspace } from "../electron/native-workspace.mjs";

function fixture(t) {
  const parent = fileURLToPath(new URL("../artifacts/", import.meta.url));
  mkdirSync(parent, { recursive: true });
  const box = mkdtempSync(path.join(parent, "native-project-test-"));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const profile = path.join(box, "profile");
  const project = path.join(box, "project");
  const other = path.join(box, "unselected");
  for (const dir of [profile, project, other]) mkdirSync(dir);
  writeFileSync(path.join(project, "local.txt"), "first");
  writeFileSync(path.join(other, "private.txt"), "outside");
  const workspace = createNativeWorkspace(profile);
  return { profile, project, other, workspace };
}

test("selected native project reads, edits and restores using the same root after restart", (t) => {
  const { profile, project, workspace } = fixture(t);
  assert.equal(workspace.run({ action: "tree", root: project }).code, "workspace-not-authorized");
  const root = workspace.remember(project);
  const run = (action, data) => createNativeWorkspace(profile).run({ root, action, ...data });
  assert.deepEqual(run("tree").files, { "local.txt": "first" });
  assert.deepEqual(run("read", { paths: ["local.txt", "missing.txt"] }), {
    ok: true,
    files: { "local.txt": "first", "missing.txt": null },
  });
  assert.equal(run("write", { path: "local.txt", expected: "first", content: "edited" }).ok, true);
  assert.equal(run("write", { path: "local.txt", expected: "first", content: "conflict" }).ok, false);
  assert.equal(readFileSync(path.join(root, "local.txt"), "utf8"), "edited");
  assert.equal(run("mkdir", { path: "nested" }).ok, true);
  assert.equal(run("move", { from: "local.txt", to: "nested/renamed.txt" }).ok, true);
  assert.deepEqual(run("restore", {
    mkdir: [], rmdir: ["nested"], files: [{ path: "nested/renamed.txt", expected: "edited", after: null }],
  }), { ok: true, removedDirs: ["nested"] });
  assert.equal(run("write", { path: "delete.txt", expected: null, content: "delete me" }).ok, true);
  assert.equal(run("remove", { path: "delete.txt" }).ok, true);
  assert.deepEqual(run("tree").files, {});
});

test("a different root or replacement cannot be opened or mutated with an earlier grant", (t) => {
  const { project, other, workspace } = fixture(t);
  const root = workspace.remember(project);
  assert.equal(workspace.run({ action: "read", root: other, paths: ["private.txt"] }).code, "workspace-not-authorized");
  assert.equal(workspace.run({ action: "write", root: other, path: "private.txt", content: "invalid" }).code, "workspace-not-authorized");
  renameSync(project, project + "-original");
  mkdirSync(project);
  assert.equal(workspace.run({ action: "tree", root }).code, "workspace-not-authorized");
  assert.equal(readFileSync(path.join(other, "private.txt"), "utf8"), "outside");
});

test("the separate tree scanner uses the persisted grant and the exact project root", async (t) => {
  const { profile, project, other, workspace } = fixture(t);
  const root = workspace.remember(project);
  const reopened = createNativeWorkspace(profile);
  const scan = reopened.runTree({ root });
  assert.equal(reopened.runTree({ root }), scan);
  assert.deepEqual((await scan).files, { "local.txt": "first" });
  assert.equal((await reopened.runTree({ root: other })).code, "workspace-not-authorized");
});

test("a physically empty project differs from one with only ignored entries", async (t) => {
  const { project, other, workspace } = fixture(t);
  const emptyFolder = path.join(project, "empty");
  mkdirSync(emptyFolder);
  const root = workspace.remember(emptyFolder);
  assert.deepEqual(workspace.run({ action: "empty", root }), { ok: true, empty: true });
  assert.equal((await workspace.runTree({ root })).empty, true);
  assert.equal(workspace.run({ action: "empty", root: other }).code, "workspace-not-authorized");

  writeFileSync(path.join(root, ".gitkeep"), "");
  assert.deepEqual(workspace.run({ action: "empty", root }), { ok: true, empty: false });
  const tree = await workspace.runTree({ root });
  assert.equal(tree.empty, false);
  assert.deepEqual(tree.files, {});
});

test("native editor actions cannot follow a symlink or filesystem escape", (t) => {
  const { project, other, workspace } = fixture(t);
  const root = workspace.remember(project);
  const run = (action, data) => workspace.run({ root, action, ...data });
  assert.equal(run("mkdir", { path: "../unselected/new" }).ok, false);
  try {
    symlinkSync(other, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
    t.skip("Diese Testumgebung erlaubt keine symbolischen Verknüpfungen.");
    return;
  }
  assert.deepEqual(run("tree").files, { "local.txt": "first" });
  assert.equal(run("read", { paths: ["linked/private.txt"] }).ok, false);
  assert.equal(run("write", { path: "linked/private.txt", content: "invalid" }).ok, false);
  assert.equal(run("move", { from: "local.txt", to: "linked/private.txt" }).ok, false);
  assert.equal(run("remove", { path: "linked" }).ok, false);
  assert.equal(run("restore", {
    mkdir: [], rmdir: [], files: [{ path: "linked/private.txt", expected: "outside", after: "invalid" }],
  }).ok, false);
  assert.equal(readFileSync(path.join(other, "private.txt"), "utf8"), "outside");
});

test("normal save refuses to overwrite hard-linked content shared outside the selected folder", (t) => {
  const { project, other, workspace } = fixture(t);
  const root = workspace.remember(project);
  const outside = path.join(other, "private.txt");
  try { linkSync(outside, path.join(root, "linked.txt")); }
  catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
    t.skip("Diese Testumgebung erlaubt keine Festverknüpfungen.");
    return;
  }
  const saved = workspace.run({ root, action: "write", path: "linked.txt", content: "invalid", expected: "outside" });
  assert.equal(saved.ok, false);
  assert.match(saved.error, /Festverknüpfungen/);
  assert.equal(readFileSync(outside, "utf8"), "outside");
});
