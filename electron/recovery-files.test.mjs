import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveRecovery } from "./recovery-files.mjs";
import { insideRoot } from "../companion/guard.mjs";
import { writeRel } from "../companion/git.mjs";

test("recovery preserves complete text and binary images without overwriting another backup", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "anvil-recovery-test-"));
  try {
    const snapshot = { files: { "snake/code.ts": "const text = 'ä';\n", "images/test.png": "data:image/png;base64,AQIDBA==" }, dirs: ["empty"] };
    const one = await saveRecovery(parent, snapshot), two = await saveRecovery(parent, snapshot);
    assert.notEqual(one, two);
    assert.equal(await readFile(path.join(one, "snake/code.ts"), "utf8"), snapshot.files["snake/code.ts"]);
    assert.deepEqual([...await readFile(path.join(one, "images/test.png"))], [1, 2, 3, 4]);
    assert.throws(() => writeRel(one, "images/test.png", "data:image/png;base64,BAUG", "data:image/png;base64,AAAA"), /extern geändert/);
    writeRel(one, "images/test.png", "data:image/png;base64,BAUG", snapshot.files["images/test.png"]);
    assert.deepEqual([...await readFile(path.join(one, "images/test.png"))], [4, 5, 6]);
    await assert.rejects(saveRecovery(parent, { files: { "../escape": "bad" } }), /Ungültiger Pfad/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("Windows workspace boundaries accept case differences and reject siblings/drives/traversal", () => {
  assert.equal(insideRoot("I:\\AnvilTest\\tests", "i:\\anviltest\\TESTS\\snake", path.win32), true);
  for (const file of ["I:\\AnvilTest\\tests-other", "J:\\AnvilTest\\tests", "I:\\AnvilTest\\tests\\..\\private"]) assert.equal(insideRoot("I:\\AnvilTest\\tests", file, path.win32), false);
});
