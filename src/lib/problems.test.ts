import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropStaleRun, localLintHits } from "./problems.ts";
import type { LspHit } from "./lsp.ts";

function h(path: string, message: string, source: string): LspHit {
  return { path, line: 1, col: 1, message, source, severity: "error" };
}

describe("problems", () => {
  it("keeps local lint, drops bucket sources", () => {
    const local = localLintHits([h("a.js", "brace", "js"), h("a.js", "fail", "run"), h("a.ts", "t", "tsc")]);
    assert.equal(local.length, 1);
    assert.equal(local[0].source, "js");
  });
  it("drops syntax run hits when the file lints clean", () => {
    const run = [h("a.py", "SyntaxError: invalid syntax", "run"), h("b.py", "NameError: x", "run")];
    const next = dropStaleRun(run, []);
    assert.equal(next.length, 1);
    assert.equal(next[0].path, "b.py");
  });
  it("always drops module-sandbox run noise", () => {
    const run = [h("a.js", "SyntaxError: Cannot use import statement outside a module", "run")];
    const next = dropStaleRun(run, [h("a.js", "brace", "js")]);
    assert.equal(next.length, 0);
  });
  it("keeps syntax run hit while local still errors", () => {
    const run = [h("a.py", "invalid syntax", "run")];
    const next = dropStaleRun(run, [h("a.py", "indent", "py")]);
    assert.equal(next.length, 1);
  });
});
