import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tscWorkspace } from "./lsp-compile.ts";

describe("lsp-compile", () => {
  it("flags a typescript syntax error", async () => {
    const hits = await tscWorkspace({
      "src/a.ts": "export function hi(\n",
    });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.source, "tsc");
    assert.equal(hits[0]?.path, "src/a.ts");
  });
  it("accepts valid ts", async () => {
    const hits = await tscWorkspace({ "src/ok.ts": "export const n: number = 1;\n" });
    assert.equal(hits.length, 0);
  });
});
