import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverTests, mergeTests, parseTests } from "./test-parse.ts";

describe("test-parse", () => {
  it("discovers python and jest names with lines", () => {
    const d = discoverTests({
      "tests/test_add.py": "def helper():\n  pass\ndef test_add():\n  assert 1\n",
      "src/add.test.ts": "it('adds', () => {})\ntest('empty', () => {})\n",
      "main.py": "def test_not_here():\n  pass\n",
    });
    assert.equal(d.some((h) => h.name === "test_add" && h.line === 3), true);
    assert.equal(d.some((h) => h.name === "adds"), true);
    assert.equal(d.some((h) => h.path === "main.py"), false);
  });
  it("parses pytest and pass/fail lines", () => {
    const files = { "tests/test_add.py": "def test_add():\n  pass\n" };
    const hits = parseTests("tests/test_add.py::test_add PASSED\nFAIL tests/test_add.py · other", "", files);
    assert.ok(hits.some((h) => h.name === "test_add" && h.ok));
    assert.ok(hits.some((h) => !h.ok));
  });
  it("merges discovery with results", () => {
    const d = discoverTests({ "a.test.js": "it('one', () => {})\n" });
    const m = mergeTests(d, [{ path: "a.test.js", line: 1, name: "one", ok: false, text: "boom" }]);
    assert.equal(m[0]?.ok, false);
    assert.equal(m[0]?.skip, false);
  });
});
