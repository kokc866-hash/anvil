import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("round restoration touches only changed files and keeps disk conflict bases", async (t) => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  t.after(() => server.close());
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { SEED_FILES, withoutStaleSeedFiles } = await server.ssrLoadModule("/src/lib/seed-files.ts");
  assert.deepEqual(withoutStaleSeedFiles(SEED_FILES, {}, {}), {}, "Old clean template ghosts are removed after a successful disk read");
  assert.deepEqual(withoutStaleSeedFiles(SEED_FILES, SEED_FILES, {}), SEED_FILES, "Real template files stay");
  const retained = withoutStaleSeedFiles({ ...SEED_FILES, "README.md": "My project" }, {}, { "ref/README.md": true });
  assert.deepEqual(retained, { "README.md": "My project", "ref/README.md": SEED_FILES["ref/README.md"] }, "Custom and unsaved buffers stay");
  useIde.setState({
    files: { "index.html": "after", "README.md": "unchanged", "notes.txt": "unsaved" },
    dirty: { "notes.txt": true }, editBases: { "notes.txt": "on disk" }, pendingDiffs: [],
    checkpoints: [{ id: "round", at: 1, files: { "index.html": "before", "README.md": "unchanged", "notes.txt": "unsaved" }, dirs: [], endFiles: { "index.html": "after", "README.md": "unchanged", "notes.txt": "unsaved" }, endDirs: [] }],
  });
  assert.equal(await useIde.getState().restoreCheckpoint("round"), true);
  assert.deepEqual(useIde.getState().dirty, { "notes.txt": true });
  assert.deepEqual(useIde.getState().editBases, { "notes.txt": "on disk" });
  assert.equal(useIde.getState().files["index.html"], "before");
  await useIde.getState().restoreCheckpoint("round");
  assert.equal(useIde.getState().editBases["index.html"], undefined, "Already restored content needs no further disk write");
});
