import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LSP_CATALOG, listLsp } from "./lsp.mjs";

describe("free LSP catalog", () => {
  it("only known free packs, pull by id", () => {
    const ids = LSP_CATALOG.map((p) => p.id);
    assert.ok(ids.includes("pyright"));
    assert.ok(ids.includes("typescript"));
    assert.ok(ids.includes("html"));
    assert.ok(ids.includes("gopls"));
    assert.ok(!ids.includes("intelephense"));
  });
  it("list has ready flags", () => {
    const rows = listLsp();
    assert.ok(rows.length >= 5);
    for (const r of rows) {
      assert.equal(typeof r.ready, "boolean");
      assert.ok(r.license);
    }
  });
});
