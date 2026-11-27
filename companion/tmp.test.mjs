import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { makeAnvilTemp, sweepAnvilTemp } from "./tmp.mjs";

function fixture(t) {
  const tempRoot = path.resolve(os.tmpdir());
  const root = mkdtempSync(path.join(tempRoot, "anvil-sweep-"));
  assert.equal(path.dirname(root), tempRoot);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function age(directory, hours) {
  const timestamp = new Date(Date.now() - hours * 60 * 60 * 1000);
  utimesSync(directory, timestamp, timestamp);
}

describe("Anvil temporary directory ownership", () => {
  it("allocates unique directories outside the legacy sweep prefixes", t => {
    const root = fixture(t);
    const first = makeAnvilTemp("tc", root);
    const second = makeAnvilTemp("tc", root);
    assert.notEqual(first, second);
    assert.equal(path.dirname(first), root);
    assert.match(path.basename(first), new RegExp(`^anvil-owned-tc-p${process.pid}-[a-zA-Z0-9]{6}$`));
  });

  it("keeps concurrent work from a live owner even when directories are old", t => {
    const root = fixture(t);
    const work = [makeAnvilTemp("dbg", root), makeAnvilTemp("fmt", root), makeAnvilTemp("lint", root), makeAnvilTemp("tc", root)];
    for (const directory of work) {
      writeFileSync(path.join(directory, "live.txt"), "active");
      age(directory, 30);
    }
    assert.equal(sweepAnvilTemp({ root, maxAgeMs: 0, toolchain: true, toolchainAgeMs: 0 }), 0);
    for (const directory of work) assert.equal(existsSync(path.join(directory, "live.txt")), true);
  });

  it("cleans expired work from exited owners and preserves recent or unowned directories", t => {
    const root = fixture(t);
    const child = spawnSync(process.execPath, ["-e", ""], { windowsHide: true });
    assert.ifError(child.error);
    assert.equal(child.status, 0);
    assert.ok(child.pid);
    const orphan = path.join(root, `anvil-owned-lint-p${child.pid}-Older1`);
    const fresh = path.join(root, `anvil-owned-dbg-p${child.pid}-Fresh1`);
    const toolchain = path.join(root, `anvil-owned-tc-p${child.pid}-Older2`);
    const legacy = path.join(root, "anvil-dbg-legacy");
    const nsis = path.join(root, "nsn408A.tmp");
    const unrelated = path.join(root, "not-ours");
    for (const directory of [orphan, fresh, toolchain, legacy, nsis, unrelated]) mkdirSync(directory);
    mkdirSync(path.join(nsis, "app"));
    writeFileSync(path.join(nsis, "app", "Anvil.exe"), "portable fixture");
    for (const directory of [orphan, toolchain, legacy, nsis, unrelated]) age(directory, 30);
    assert.equal(sweepAnvilTemp({ root }), 1);
    assert.equal(existsSync(orphan), false);
    assert.equal(existsSync(toolchain), true);
    assert.equal(sweepAnvilTemp({ root, toolchain: true }), 1);
    assert.equal(existsSync(toolchain), false);
    for (const directory of [fresh, legacy, nsis, unrelated]) assert.equal(existsSync(directory), true);
  });
});
