import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { isAnvilTempName, sweepAnvilTemp } from "./tmp.mjs";

describe("anvil temp sweep", () => {
  it("names only anvil prefixes", () => {
    assert.equal(isAnvilTempName("anvil-run-abc"), true);
    assert.equal(isAnvilTempName("anvil-fmt-x"), true);
    assert.equal(isAnvilTempName("anvil-tc-zig"), false);
    assert.equal(isAnvilTempName("anvil-tc-zig", { toolchain: true }), true);
    assert.equal(isAnvilTempName("chrome-abc"), false);
  });

  it("deletes leftover run dirs", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "anvil-sweep-"));
    try {
      const a = path.join(root, "anvil-run-old");
      const other = path.join(root, "not-ours");
      mkdirSync(a);
      mkdirSync(other);
      writeFileSync(path.join(a, "out.exe"), "x");
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(a, old, old);
      assert.equal(sweepAnvilTemp({ root, keep: 1, maxAgeMs: 30 * 60 * 1000 }), 1);
      assert.equal(existsSync(a), false);
      assert.equal(existsSync(other), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keep 0 wipes all run dirs", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "anvil-sweep-"));
    try {
      mkdirSync(path.join(root, "anvil-run-1"));
      mkdirSync(path.join(root, "anvil-fmt-2"));
      mkdirSync(path.join(root, "keep-me"));
      const n = sweepAnvilTemp({ root, keep: 0, maxAgeMs: 0 });
      assert.equal(n, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
