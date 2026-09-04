import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffPreview, diffStats, snapshotDiff } from "./diff.ts";

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
  it("preview keeps context around edits", () => {
    const rows = diffPreview("a\nb\nc\nd\n", "a\nX\nc\nd\n", 1, 20);
    assert.ok(rows.some((r) => r.type === "eq" && r.text === "a"));
    assert.ok(rows.some((r) => r.type === "del" && r.text === "b"));
    assert.ok(rows.some((r) => r.type === "add" && r.text === "X"));
  });
});