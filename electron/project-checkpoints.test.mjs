import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createProjectCheckpoint as create, previewProjectCheckpoint as preview, restoreProjectCheckpoint as restore, readProjectCheckpointFiles as readFiles, PROJECT_CHECKPOINT_READ_LIMITS } from "./project-checkpoints.mjs";

async function fixture(t, inside = false) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-checkpoint-test-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "project"), storageRoot = path.join(inside ? root : base, "data", "checkpoints");
  await fs.mkdir(root);
  const args = { root, storageRoot, id: randomUUID() };
  const write = async (name, value) => { const p = path.join(root, name); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, value); };
  return { ...args, args, base, write, read: (name) => fs.readFile(path.join(root, name)), before: () => create({ ...args, phase: "before" }), after: () => create({ ...args, phase: "after" }) };
}

test("disk checkpoints restore binary changes, additions, deletes, renames, unopened files and empty directories after restart", async (t) => {
  const f = await fixture(t);
  const original = Buffer.from([0, 255, 128, 13, 10, 254, 0]);
  await f.write("Assets/image.png", original);
  await f.write("Assets/old.bin", Buffer.from([3, 4, 5]));
  await f.write("unopened.scene", "unopened original");
  await fs.mkdir(path.join(f.root, "empty"));
  const first = await f.before();
  assert.equal(first.files, 3);
  await f.write("Assets/image.png", Buffer.from([9, 8, 7]));
  await fs.rename(path.join(f.root, "Assets/old.bin"), path.join(f.root, "Assets/renamed.bin"));
  await fs.unlink(path.join(f.root, "unopened.scene"));
  await fs.rmdir(path.join(f.root, "empty"));
  await fs.mkdir(path.join(f.root, "new-empty"));
  await f.write("new.txt", "added");
  await f.after();
  // A fresh module instance reads only persisted manifests/blobs, as on restart.
  const restarted = await import(`./project-checkpoints.mjs?restart=${randomUUID()}`);
  const p = await restarted.previewProjectCheckpoint(f.args);
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(p.mkdir, ["empty"]);
  assert.deepEqual(p.rmdir, ["new-empty"]);
  assert.equal(p.files.length, 5);
  await restarted.restoreProjectCheckpoint(f.args);
  assert.deepEqual(await f.read("Assets/image.png"), original);
  assert.deepEqual(await f.read("Assets/old.bin"), Buffer.from([3, 4, 5]));
  assert.equal((await f.read("unopened.scene")).toString(), "unopened original");
  await assert.rejects(f.read("Assets/renamed.bin"), { code: "ENOENT" });
  await assert.rejects(f.read("new.txt"), { code: "ENOENT" });
  assert.ok((await fs.stat(path.join(f.root, "empty"))).isDirectory());
  assert.deepEqual((await preview(f.args)).files, []);
});

test("later file edits and deletes reject the entire restore before any writes", async (t) => {
  const f = await fixture(t);
  await f.write("first.txt", "before first"); await f.write("second.txt", "before second");
  await f.before();
  await f.write("first.txt", "agent first"); await f.write("second.txt", "agent second");
  await f.after();
  await f.write("second.txt", "later user edit");
  assert.deepEqual((await restore(f.args)).conflicts, ["second.txt"]);
  assert.equal((await f.read("first.txt")).toString(), "agent first");
  await fs.unlink(path.join(f.root, "second.txt"));
  assert.deepEqual((await restore(f.args)).conflicts, ["second.txt"]);
  assert.equal((await f.read("first.txt")).toString(), "agent first");
});

test("a later missing parent directory rejects restoration of an agent-deleted file", async (t) => {
  const f = await fixture(t);
  await f.write("first.txt", "before"); await f.write("folder/deleted.txt", "deleted by agent"); await f.before();
  await f.write("first.txt", "after"); await fs.unlink(path.join(f.root, "folder/deleted.txt")); await f.after();
  await fs.rmdir(path.join(f.root, "folder"));
  assert.deepEqual((await restore(f.args)).conflicts, ["folder"]);
  assert.equal((await f.read("first.txt")).toString(), "after");
});

test("excluded secrets/dependencies and unrelated later files survive; new directory containing a later file conflicts", async (t) => {
  const f = await fixture(t);
  await f.write(".env", "secret original"); await f.write("node_modules/a.bin", Buffer.from([0, 1]));
  await f.write(".env.example", "EXAMPLE="); await f.write("scene.tscn", "before");
  const b = await f.before();
  assert.deepEqual(b.excluded.sort(), [".env", "node_modules"]);
  await f.write("scene.tscn", "after"); await f.write("new/agent.txt", "agent"); await f.after();
  await f.write(".env", "secret later"); await f.write("unrelated.txt", "keep me"); await f.write("new/user.txt", "keep this too");
  assert.deepEqual((await restore(f.args)).conflicts, ["new/user.txt"]);
  await fs.unlink(path.join(f.root, "new/user.txt"));
  assert.deepEqual((await restore(f.args)).conflicts, []);
  assert.equal((await f.read(".env")).toString(), "secret later");
  assert.equal((await f.read("unrelated.txt")).toString(), "keep me");
});

test("interrupted file restore can be resumed from journal and detects new user edits", async (t) => {
  const f = await fixture(t);
  await f.write("a.bin", Buffer.from([0, 1])); await f.write("b.bin", Buffer.from([2, 3])); await f.before();
  await f.write("a.bin", Buffer.from([4, 5])); await f.write("b.bin", Buffer.from([6, 7])); await f.after();
  await assert.rejects(restore({ ...f.args, onProgress: () => { throw new Error("simulated process interruption"); } }), /interruption/);
  assert.deepEqual(await f.read("a.bin"), Buffer.from([0, 1]));
  assert.deepEqual(await f.read("b.bin"), Buffer.from([6, 7]));
  const restarted = await import(`./project-checkpoints.mjs?restart=${randomUUID()}`);
  await restarted.restoreProjectCheckpoint(f.args);
  assert.deepEqual(await f.read("b.bin"), Buffer.from([2, 3]));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.storageRoot, "checkpoints", f.id, "restore.json"), "utf8")).state, "complete");
  await f.write("a.bin", "later edit after rollback");
  assert.deepEqual((await preview(f.args)).conflicts, ["a.bin"]);
});

test("a restart discards only the journaled incomplete staging file and finishes restoring", async (t) => {
  const f = await fixture(t);
  await f.write("nested/a.bin", Buffer.from([0, 1, 2])); await f.before(); await f.write("nested/a.bin", "agent"); await f.after();
  const pendingTemp = `nested/.anvil-restore-${f.id}-${randomUUID()}.tmp`;
  await f.write(pendingTemp, "incomplete copy at power loss");
  await fs.writeFile(path.join(f.storageRoot, "checkpoints", f.id, "restore.json"), JSON.stringify({ version: 1, id: f.id, state: "restoring", completed: 0, pendingTemp }));
  await restore(f.args);
  await assert.rejects(f.read(pendingTemp), { code: "ENOENT" });
  assert.deepEqual(await f.read("nested/a.bin"), Buffer.from([0, 1, 2]));
});

test("files can become directories and directories can become files", async (t) => {
  const f = await fixture(t);
  await f.write("was-file", "original file"); await f.write("was-dir/asset.bin", Buffer.from([0, 255])); await f.before();
  await fs.unlink(path.join(f.root, "was-file")); await f.write("was-file/asset.txt", "new nested file");
  await fs.unlink(path.join(f.root, "was-dir/asset.bin")); await fs.rmdir(path.join(f.root, "was-dir")); await f.write("was-dir", "replacement");
  await f.after(); await restore(f.args);
  assert.equal((await f.read("was-file")).toString(), "original file");
  assert.deepEqual(await f.read("was-dir/asset.bin"), Buffer.from([0, 255]));
});

test("interrupted file-directory replacement resumes from durable deletion intent", async (t) => {
  const f = await fixture(t);
  await f.write("was-directory/asset.bin", Buffer.from([0, 99])); await f.before();
  await fs.unlink(path.join(f.root, "was-directory/asset.bin")); await fs.rmdir(path.join(f.root, "was-directory")); await f.write("was-directory", "replacement"); await f.after();
  await assert.rejects(restore({ ...f.args, onProgress: () => { throw new Error("interrupted after removal"); } }), /interrupted/);
  assert.deepEqual((await preview(f.args)).conflicts, []);
  await restore(f.args);
  assert.deepEqual(await f.read("was-directory/asset.bin"), Buffer.from([0, 99]));
});

test("files edited while a checkpoint is captured abort without committing a partial manifest", async (t) => {
  const f = await fixture(t);
  await f.write("a.bin", Buffer.alloc(1024, 42));
  await assert.rejects(create({ ...f.args, phase: "before", onProgress: () => f.write("a.bin", "changed while saving") }), /während der Sicherung verändert/);
  await assert.rejects(fs.readFile(path.join(f.storageRoot, "checkpoints", f.id, "before.json")), { code: "ENOENT" });
  await f.before();
});

test("an in-flight later edit is detected before replacing the next file", async (t) => {
  const f = await fixture(t);
  await f.write("a.txt", "before a"); await f.write("b.txt", "before b"); await f.before();
  await f.write("a.txt", "agent a"); await f.write("b.txt", "agent b"); await f.after();
  await assert.rejects(restore({ ...f.args, onProgress: () => f.write("b.txt", "concurrent user edit") }), /während der Rücknahme verändert/);
  assert.equal((await f.read("b.txt")).toString(), "concurrent user edit");
  assert.deepEqual((await restore(f.args)).conflicts, ["b.txt"]);
});

test("storage inside project is excluded exactly; private appdata exclusion is explicit", async (t) => {
  const f = await fixture(t, true);
  await f.write("source.txt", "original");
  const before = await f.before();
  assert.ok(before.excluded.includes("data/checkpoints"));
  await f.write("source.txt", "after"); await f.after(); await restore(f.args);
  assert.equal((await f.read("source.txt")).toString(), "original");
  await f.write("data/account-state.json", "private");
  const safe = await create({ ...f.args, id: randomUUID(), phase: "before", excludedRoots: [path.join(f.root, "data")] });
  assert.deepEqual(safe.excluded, ["data"]);
  assert.equal(safe.files, 1);
  await assert.rejects(create({ ...f.args, id: randomUUID(), storageRoot: f.root, phase: "before" }), /Sicherungsordner/);
  await assert.rejects(create({ ...f.args, id: randomUUID(), storageRoot: f.base, phase: "before" }), /Sicherungsordner/);
});

test("external directory junctions/symlinks are never traversed during capture or restore", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.base, "outside"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "untouched.txt"), "outside");
  const link = path.join(f.root, "linked");
  try { await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir"); } catch (e) { if (e.code === "EPERM") { t.skip("symlink privilege unavailable"); return; } throw e; }
  await assert.rejects(f.before(), /Verknüpfung/);
  await fs.unlink(link);
  await f.write("linked/untouched.txt", "project before"); await f.before(); await f.write("linked/untouched.txt", "project after"); await f.after();
  await fs.unlink(path.join(link, "untouched.txt")); await fs.rmdir(link); await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(restore(f.args), /Verknüpfung/);
  assert.equal(await fs.readFile(path.join(outside, "untouched.txt"), "utf8"), "outside");
});

test("corrupt blobs and unsafe manifest paths fail before mutation", async (t) => {
  const f = await fixture(t);
  await f.write("a.txt", "before"); await f.before(); await f.write("a.txt", "after"); await f.after();
  const manifestPath = path.join(f.storageRoot, "checkpoints", f.id, "before.json");
  const m = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  await fs.writeFile(path.join(f.storageRoot, "blobs", m.entries["a.txt"].hash), "corrupt");
  await assert.rejects(restore(f.args), /Beschädigte Sicherung/);
  assert.equal((await f.read("a.txt")).toString(), "after");
  m.entries["../outside.txt"] = m.entries["a.txt"];
  await fs.writeFile(manifestPath, JSON.stringify(m));
  await assert.rejects(restore(f.args), /Unsicherer Pfad/);
  assert.equal((await f.read("a.txt")).toString(), "after");
});

test("manifests are immutable and unchanged blobs deduplicate across checkpoints", async (t) => {
  const f = await fixture(t);
  await f.write("unchanged.bin", Buffer.alloc(1024 * 1024 + 9, 127));
  await f.before(); const second = { ...f.args, id: randomUUID(), phase: "before" }; await create(second);
  assert.equal((await fs.readdir(path.join(f.storageRoot, "blobs"))).length, 1);
  await f.write("unchanged.bin", "new"); await f.before(); await f.after(); await restore(f.args);
  assert.equal((await f.read("unchanged.bin")).length, 1024 * 1024 + 9);
});

test("non-portable Windows names and case collisions are rejected on filesystems that permit them", async (t) => {
  if (process.platform === "win32") { t.skip("Windows rejects these names at filesystem boundary"); return; }
  const f = await fixture(t);
  await f.write("CON.txt", "x"); await assert.rejects(f.before(), /Nicht portabler/); await fs.unlink(path.join(f.root, "CON.txt"));
  await f.write("Asset", "x"); await f.write("asset", "y"); await assert.rejects(f.before(), /kollidiert/);
});

test("editor reload preserves PNG and opaque binary bytes, UTF8/BOM text, missing files and more than 64 paths", async (t) => {
  const f = await fixture(t);
  const png = Buffer.from([137, 80, 78, 71, 0, 255, 10]);
  await f.write("asset.png", png); await f.write("asset.bin", Buffer.from([0, 255, 128])); await f.write("note.txt", "\ufeffGrüße 🌍\r\n");
  const names = Array.from({ length: 80 }, (_, i) => `text-${i}.txt`);
  for (const name of names) await f.write(name, name);
  await f.before();
  const actual = await readFiles({ ...f.args, paths: ["asset.png", "asset.bin", "note.txt", "missing.txt", ...names] });
  assert.equal(actual["asset.png"], `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(actual["asset.bin"], "data:application/octet-stream;base64,AP+A");
  assert.equal(actual["note.txt"], "\ufeffGrüße 🌍\r\n");
  assert.equal(actual["missing.txt"], null);
  assert.equal(Object.keys(actual).length, 84);
  assert.equal(actual["text-79.txt"], "text-79.txt");
  await f.write("asset.png", "agent changed"); await f.write("new.txt", "new"); await f.after();
  const staged = await readFiles({ ...f.args, source: "before", paths: ["asset.png", "new.txt"] });
  assert.equal(staged["asset.png"], actual["asset.png"]); assert.equal(staged["new.txt"], null);
  assert.equal((await f.read("asset.png")).toString(), "agent changed");
});

test("editor reload fails explicitly on size limits and excluded files without changing disk", async (t) => {
  const f = await fixture(t); await f.write("small.txt", "keep"); await f.before();
  const large = path.join(f.root, "large.bin"); const handle = await fs.open(large, "w");
  try { await handle.truncate(PROJECT_CHECKPOINT_READ_LIMITS.fileBytes + 1); } finally { await handle.close(); }
  await assert.rejects(readFiles({ ...f.args, paths: ["small.txt", "large.bin"] }), /Ladelimit/);
  await fs.truncate(large, PROJECT_CHECKPOINT_READ_LIMITS.fileBytes);
  const aliases = ["large.bin"];
  for (let i = 0; i < 8; i++) { const name = `linked-bytes-${i}.bin`; await fs.link(large, path.join(f.root, name)); aliases.push(name); }
  await assert.rejects(readFiles({ ...f.args, paths: aliases }), /Ladelimit/);
  await f.write(".env", "private"); await assert.rejects(readFiles({ ...f.args, paths: [".env"] }), /Ausgenommener/);
  await assert.rejects(readFiles({ ...f.args, paths: ["../outside"] }), /ungültiger/);
  assert.equal((await f.read("small.txt")).toString(), "keep");
});

test("editor reload refuses a linked path outside the project", async (t) => {
  const f = await fixture(t); await f.before();
  const outside = path.join(f.base, "outside-read"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "private.txt"), "outside");
  try { await fs.symlink(outside, path.join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir"); } catch (e) { if (e.code === "EPERM") { t.skip("symlink privilege unavailable"); return; } throw e; }
  await assert.rejects(readFiles({ ...f.args, paths: ["linked/private.txt"] }), /Verknüpfung/);
});
