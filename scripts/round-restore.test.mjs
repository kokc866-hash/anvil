import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { restoreRel } from "../companion/restore.mjs";

test("round restoration is complete, conflict checked, durable, and isolated", async (t) => {
  const globals = new Map(["window", "document", "localStorage", "fetch", "roundRestoreArchive"].map((key) => [key, globalThis[key]]));
  const values = new Map(), archive = new Map();
  globalThis.roundRestoreArchive = archive;
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout, clearTimeout });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", plugins: [{ name: "isolated-round-archive", transform(code, id) {
    if (id.endsWith("/src/lib/persist-db.ts")) return `
      export async function saveArchive(name, next) { globalThis.roundRestoreArchive.set(name, structuredClone(next)); }
      export async function loadArchive(name) { const a = globalThis.roundRestoreArchive.get(name) || {}; return { ...a, files: a.files ?? null, chat: a.chat ?? null, recovery: a.recovery ?? null }; }
      export async function removeArchive(name) { globalThis.roundRestoreArchive.delete(name); }
    `;
  } }] });
  let sync, persist;
  t.after(async () => {
    try {
      await sync?.flushDiskSync().catch(() => {}); await persist?.flushPersistence().catch(() => {});
      if (persist) await (await server.ssrLoadModule("/src/lib/persist-storage.ts")).flushPersistence();
      if (persist) await server.ssrLoadModule("/src/lib/intern.ts");
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      await server.close();
      for (const [key, value] of globals) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  await useIde.persist.rehydrate();
  const { useIntern } = await server.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  sync = await server.ssrLoadModule("/src/lib/disk-sync.ts");
  persist = await server.ssrLoadModule("/src/lib/persist-storage.ts");
  const output = path.resolve("artifacts/round-restore");
  mkdirSync(output, { recursive: true });
  const cwd = mkdtempSync(path.join(output, "project-"));
  let interrupt = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith("/v1/workspace")) return Response.json({ ok: true });
    if (String(url).endsWith("/v1/restore")) {
      assert.ok(archive.get("anvil-ide")?.state.checkpoints.some((c) => c.restoreIntent), "exact recovery intent is durable before file mutations");
      if (interrupt) {
        interrupt = false;
        const request = JSON.parse(opts.body);
        restoreRel(cwd, { ...request, files: request.files.slice(0, 1), mkdir: [], rmdir: [] });
        throw new Error("connection lost after first file fixture");
      }
      try { return Response.json(restoreRel(cwd, JSON.parse(opts.body))); }
      catch (e) { return Response.json({ ok: false, error: e.message }, { status: 400 }); }
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  useIde.setState({ files: {}, dirs: [], dirty: {}, editBases: {}, pendingDiffs: [], checkpoints: [], workspaceCwd: "", autoSaveDisk: false, agentBusy: false });
  const id = useIde.getState().pushCheckpoint("empty before first round");
  useIde.setState({ files: { "new.txt": "created" }, dirs: [] });
  // A completed round must remember its own end, not whatever exists when restored later.
  useIde.setState({ checkpoints: useIde.getState().checkpoints.map((c) => ({ ...c, endFiles: { "new.txt": "created" }, endDirs: [] })) });
  assert.equal(await useIde.getState().restoreCheckpoint(id), true, "an empty checkpoint is a valid restore target");
  assert.deepEqual(useIde.getState().files, {}, "files created in the round are removed");

  const before = { "edit.txt": "before", "deleted.txt": "restore me", "old/name.txt": "rename me" };
  const end = { "edit.txt": "after", "new.txt": "new", "renamed/name.txt": "rename me" };
  for (const [name, content] of Object.entries(end)) { mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true }); writeFileSync(path.join(cwd, name), content); }
  writeFileSync(path.join(cwd, "later.txt"), "user later");
  useIde.setState({ workspaceCwd: cwd, files: { ...end, "later.txt": "user later" }, dirs: ["renamed"], checkpoints: [{ id: "round", at: 0, label: "round", files: before, dirs: ["old"], endFiles: end, endDirs: ["renamed"] }], dirty: {}, editBases: {} });
  sync.noteDiskContents({ ...end, "later.txt": "user later" });
  assert.equal(await useIde.getState().restoreCheckpoint("round"), true, useIde.getState().notice);
  assert.deepEqual(useIde.getState().files, { ...before, "later.txt": "user later" });
  assert.equal(existsSync(path.join(cwd, "new.txt")), false);
  assert.equal(existsSync(path.join(cwd, "renamed")), false);
  for (const [name, content] of Object.entries(before)) assert.equal(readFileSync(path.join(cwd, name), "utf8"), content);
  assert.equal(readFileSync(path.join(cwd, "later.txt"), "utf8"), "user later");
  assert.deepEqual(useIde.getState().dirty, {});

  useIde.setState({ files: { ...end, "edit.txt": "later own edit" }, checkpoints: [{ id: "conflict", at: 0, label: "round", files: before, dirs: [], endFiles: end, endDirs: [] }] });
  assert.equal(await useIde.getState().restoreCheckpoint("conflict"), false);
  assert.equal(useIde.getState().files["edit.txt"], "later own edit");
  assert.match(useIde.getState().notice, /nach der Runde/);

  // Complete store and persistence rehydration after an interrupted disk batch.
  writeFileSync(path.join(cwd, "restart-a.txt"), "a"); writeFileSync(path.join(cwd, "restart-b.txt"), "b");
  useIde.setState({ files: { "restart-a.txt": "a", "restart-b.txt": "b" }, dirs: [], checkpoints: [{ id: "restart", at: 0, label: "restart", files: {}, dirs: [], endFiles: { "restart-a.txt": "a", "restart-b.txt": "b" }, endDirs: [] }], dirty: {}, editBases: {} });
  sync.noteDiskContents(useIde.getState().files);
  interrupt = true;
  assert.equal(await useIde.getState().restoreCheckpoint("restart"), false);
  assert.equal(existsSync(path.join(cwd, "restart-a.txt")), false);
  assert.equal(existsSync(path.join(cwd, "restart-b.txt")), true);
  assert.ok(archive.get("anvil-ide").state.checkpoints[0].restoreIntent);
  await persist.flushPersistence();
  server.moduleGraph.invalidateAll();
  const { useIde: fresh } = await server.ssrLoadModule("/src/store/ide.ts");
  await fresh.persist.rehydrate();
  assert.ok(fresh.getState().checkpoints[0].restoreIntent, "restored state retains unfinished exact intent");
  assert.equal(await fresh.getState().restoreCheckpoint("restart"), true, fresh.getState().notice);
  assert.deepEqual(fresh.getState().files, {});
  assert.equal(existsSync(path.join(cwd, "restart-b.txt")), false);
  assert.equal(archive.get("anvil-ide").state.checkpoints[0].restoreIntent, undefined);

  fresh.setState({ workspaceCwd: "", files: { "own.txt": "round before" }, dirs: [], checkpoints: [], chat: [] });
  const sealed = fresh.getState().pushCheckpoint("seal once per message");
  fresh.setState({ files: { "own.txt": "round after" }, agentBusy: true, chat: [{ id: "assistant-round", role: "assistant", content: "done", checkpointId: sealed }] });
  fresh.getState().setAgentBusy(false);
  assert.equal(fresh.getState().checkpoints[0].endFiles["own.txt"], "round after");
  fresh.setState({ files: { "own.txt": "later editor change" }, agentBusy: true });
  fresh.getState().setAgentBusy(false);
  assert.equal(fresh.getState().checkpoints[0].endFiles["own.txt"], "round after", "an editor-only AI action must not change the old round boundary");
  assert.equal(await fresh.getState().restoreCheckpoint(sealed), false);
  assert.equal(fresh.getState().files["own.txt"], "later editor change");
  fresh.getState().openRoundDiff("own.txt", sealed);
  await fresh.getState().rejectDiff("own.txt");
  assert.equal(fresh.getState().files["own.txt"], "later editor change", "single-file round diff must also protect later edits");
  fresh.setState({ files: { ".env": "PRIVATE=keep out of snapshots", "safe.txt": "public" }, checkpoints: [], chat: [] });
  const privateId = fresh.getState().pushCheckpoint("privacy");
  fresh.setState({ agentBusy: true, chat: [{ id: "privacy-round", role: "assistant", content: "done", checkpointId: privateId }] });
  fresh.getState().setAgentBusy(false);
  assert.equal(".env" in fresh.getState().checkpoints[0].files, false);
  assert.equal(".env" in fresh.getState().checkpoints[0].endFiles, false);
  fresh.setState({ files: { ".env": "PRIVATE=keep out of snapshots", "safe.txt": "public", "token.txt": "created later" } });
  assert.equal(await fresh.getState().restoreCheckpoint(privateId), true);
  assert.equal(fresh.getState().files[".env"], "PRIVATE=keep out of snapshots");
  assert.equal(fresh.getState().files["token.txt"], "created later", "omitted secrets never become deletion candidates");
  fresh.setState({ files: { "legacy.txt": "later own work" }, pendingDiffs: [], checkpoints: [{ id: "legacy", files: { "legacy.txt": "old" }, dirs: [], at: 0, label: "legacy" }] });
  fresh.getState().openRoundDiff("legacy.txt", "legacy");
  assert.deepEqual(fresh.getState().pendingDiffs, [], "legacy snapshot cannot turn later own work into a rejectable round diff");
});

test("disk restore preflights external conflicts and rolls back a partial failure", () => {
  const output = path.resolve("artifacts/round-restore");
  mkdirSync(output, { recursive: true });
  const cwd = mkdtempSync(path.join(output, "disk-"));
  writeFileSync(path.join(cwd, "a.txt"), "a"); writeFileSync(path.join(cwd, "b.txt"), "external");
  const request = { files: [{ path: "a.txt", expected: "a", after: null }, { path: "b.txt", expected: "b", after: "before" }], mkdir: [], rmdir: [] };
  assert.throws(() => restoreRel(cwd, request), /extern geändert/);
  assert.equal(readFileSync(path.join(cwd, "a.txt"), "utf8"), "a");
  writeFileSync(path.join(cwd, "b.txt"), "b");
  assert.throws(() => restoreRel(cwd, request, { beforeWrite: (i) => { if (i === 1) throw new Error("disk full fixture"); } }), /disk full/);
  assert.equal(readFileSync(path.join(cwd, "a.txt"), "utf8"), "a");
  assert.equal(readFileSync(path.join(cwd, "b.txt"), "utf8"), "b");
  // Simulate interruption after the first operation. Retry must safely complete the same persisted intent.
  restoreRel(cwd, { files: request.files.slice(0, 1), mkdir: [], rmdir: [] });
  restoreRel(cwd, request);
  assert.equal(existsSync(path.join(cwd, "a.txt")), false);
  assert.equal(readFileSync(path.join(cwd, "b.txt"), "utf8"), "before");
  assert.throws(() => restoreRel(cwd, { ...request, files: [{ path: "../outside", expected: null, after: null }] }), /Pfad/);
});
