import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffStats, snapshotDiff } from "./diff.ts";

describe("diff", () => {
  it("counts add and del", () => {
    const s = diffStats("a\nb\nc\n", "a\nx\nc\n");
    assert.equal(s.del, 1);
    assert.equal(s.add, 1);
  });
  it("snapshot kinds and line counts", () => {
    const d = snapshotDiff({ "a.ts": "one\n", "gone.ts": "x\n" }, { "a.ts": "one\ntwo\n", "b.ts": "new\n" });
    const by = Object.fromEntries(d.map((x) => [x.path, x]));
    assert.equal(by["a.ts"]?.kind, "edit");
    assert.ok((by["a.ts"]?.add ?? 0) >= 1);
    assert.equal(by["b.ts"]?.kind, "add");
    assert.equal(by["gone.ts"]?.kind, "del");
  });
});
