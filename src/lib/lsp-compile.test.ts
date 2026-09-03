import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureTs, tscWorkspace, tsDefinition, tsQuickInfo } from "./lsp-compile.ts";

describe("lsp-compile", () => {
  it("flags a typescript syntax error", async () => {
    const hits = await tscWorkspace({
      "src/a.ts": "export function hi(\n",
    });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.source, "tsc");
    assert.equal(hits[0]?.path, "src/a.ts");
  });
  it("flags a type error", async () => {
    const hits = await tscWorkspace({
      "src/bad.ts": 'export const n: number = "x";\n',
    });
    assert.ok(hits.some((h) => /number|string|Type/i.test(h.message)));
    assert.equal(hits[0]?.source, "tsc");
  });
  it("accepts valid ts", async () => {
    const hits = await tscWorkspace({ "src/ok.ts": "export const n: number = 1;\n" });
    assert.equal(hits.length, 0);
  });
  it("hover shows tsc type", async () => {
    const src = "export const n: number = 1;\n";
    const files = { "src/ok.ts": src };
    await ensureTs(files);
    const md = await tsQuickInfo(files, "src/ok.ts", src.indexOf("n:"));
    assert.ok(md && /tsc|number/i.test(md));
  });
  it("rechecks after a same-length type edit", async () => {
    const a = 'export const n: string = "xx";\n';
    const b = 'export const n: number = "xx";\n';
    assert.equal(a.length, b.length);
    const ok = await tscWorkspace({ "src/x.ts": a });
    assert.equal(ok.length, 0);
    const bad = await tscWorkspace({ "src/x.ts": b });
    assert.ok(bad.some((h) => /number|string|Type/i.test(h.message)));
  });
  it("definition lands on the declaration", async () => {
    const src = "export function ping() { return 1; }\nping();\n";
    const files = { "src/a.ts": src };
    await ensureTs(files);
    const defs = await tsDefinition(files, "src/a.ts", src.lastIndexOf("ping"));
    assert.ok(defs.length >= 1);
    assert.equal(defs[0]?.path, "src/a.ts");
    assert.equal(defs[0]?.line, 1);
  });
  it("typechecks an open file over 200k", async () => {
    const pad = "const x = 1;\n".repeat(16_000);
    const src = `${pad}export const n: number = "x";\n`;
    assert.ok(src.length > 200_000);
    const hits = await tscWorkspace({ "src/big.ts": src }, ["src/big.ts"]);
    assert.ok(hits.some((h) => h.path === "src/big.ts"));
    const closed = await tscWorkspace({ "src/big.ts": src }, []);
    assert.equal(closed.length, 0);
  });
});
