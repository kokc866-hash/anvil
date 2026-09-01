import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listToolchains, pullToolchain, removeToolchain, abortPull, toolchainProgress, TOOLS } from "./toolchain.mjs";

describe("toolchain", () => {
  it("catalog has go rust jdk zig php", () => {
    assert.ok(TOOLS.go);
    assert.equal(TOOLS.rustc.kind, TOOLS.cargo.kind);
    assert.equal(TOOLS.cc.kind, "zig");
    assert.equal(TOOLS.javac.kind, TOOLS.java.kind);
  });
  it("list returns unique kinds", () => {
    const list = listToolchains();
    const kinds = list.map((x) => x.kind);
    assert.equal(new Set(kinds).size, kinds.length);
    assert.ok(list.every((x) => typeof x.ready === "boolean"));
    assert.ok(list.every((x) => "via" in x && Array.isArray(x.ids)));
  });
  it("unknown pull fails", async () => {
    const r = await pullToolchain("rm");
    assert.equal(r.ok, false);
  });
  it("unknown remove fails", () => {
    const r = removeToolchain("rm");
    assert.equal(r.ok, false);
  });
  it("progress idle and abort idle", () => {
    const p = toolchainProgress();
    assert.equal(p.busy, false);
    assert.equal(typeof p.pct, "number");
    const a = abortPull();
    assert.equal(a.ok, false);
  });
});
