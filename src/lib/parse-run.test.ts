import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRunTrace } from "./parse-run.ts";

describe("parse-run", () => {
  it("reads python traceback", () => {
    const hits = parseRunTrace(
      `Traceback (most recent call last):\n  File "src/app.py", line 12, in main\n    clip(1)\nNameError: name 'clip' is not defined`,
      "src/app.py",
      { "src/app.py": "" },
    );
    assert.equal(hits[0]?.path, "src/app.py");
    assert.equal(hits[0]?.line, 12);
    assert.equal(hits[0]?.source, "run");
  });
  it("ignores srcdoc module noise", () => {
    const hits = parseRunTrace(
      "SyntaxError: Cannot use import statement outside a module\n    at eval (anonymous)\n    at about:srcdoc:12:19",
      "js/actions.js",
      { "js/actions.js": "import x from './y.js'" },
    );
    assert.equal(hits.length, 0);
  });
  it("reads rust and go", () => {
    const rs = parseRunTrace(" --> main.rs:3:5\nerror[E0425]: cannot find value `x`", "main.rs", { "main.rs": "" });
    assert.equal(rs[0]?.line, 3);
    const go = parseRunTrace("main.go:8:2: undefined: clip", "main.go", { "main.go": "" });
    assert.equal(go[0]?.line, 8);
  });
});
