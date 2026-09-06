import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveRel, writeRel, readRelFiles } from "./git.mjs";

test("native moves preserve binary and ignored entries; failed moves preserve the source", () => {
  const root = mkdtempSync(join(tmpdir(), "anvil-editor-files-"));
  try {
    mkdirSync(join(root, "src/.private"), { recursive: true });
    mkdirSync(join(root, "dest"));
    const binary = Buffer.from([0, 255, 128, 10]);
    writeFileSync(join(root, "src/.private/blob.bin"), binary);
    writeFileSync(join(root, "dest/keep.txt"), "KEEP");
    assert.throws(() => moveRel(root, "src", "dest"), /existiert/);
    assert.ok(existsSync(join(root, "src/.private/blob.bin")));
    moveRel(root, "src", "dest/src");
    assert.deepEqual(readFileSync(join(root, "dest/src/.private/blob.bin")), binary);
    assert.equal(readFileSync(join(root, "dest/keep.txt"), "utf8"), "KEEP");
    assert.equal(existsSync(join(root, "src")), false);
    assert.throws(() => moveRel(root, "dest", "../outside"), /ungültig/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("optimistic writes report external edits and retain the disk version", () => {
  const root = mkdtempSync(join(tmpdir(), "anvil-editor-write-"));
  try {
    writeRel(root, "a.txt", "INITIAL", null);
    writeFileSync(join(root, "a.txt"), "EXTERNAL");
    assert.throws(() => writeRel(root, "a.txt", "EDITOR", "INITIAL"), /extern geändert/);
    assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "EXTERNAL");
    writeRel(root, "a.txt", "EDITOR", "EXTERNAL");
    assert.equal(readRelFiles(root, ["a.txt", "missing.txt"]).files["a.txt"], "EDITOR");
    assert.equal(readRelFiles(root, ["missing.txt"]).files["missing.txt"], null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
