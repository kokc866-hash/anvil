import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePyCompile, parseTsc } from "./lint.mjs";

describe("companion lint parse", () => {
  it("parses tsc", () => {
    const hits = parseTsc("src/app.ts(10,5): error TS2304: Cannot find name 'foo'.");
    assert.equal(hits[0]?.line, 10);
    assert.equal(hits[0]?.source, "tsc");
    assert.ok(hits[0]?.message.includes("TS2304"));
  });
  it("parses py_compile", () => {
    const hits = parsePyCompile(`  File "src/app.py", line 3\n    x =\n       ^\nSyntaxError: invalid syntax`);
    assert.equal(hits[0]?.path, "src/app.py");
    assert.equal(hits[0]?.line, 3);
  });
});
