import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasRealJsRunner, hasRealPyRunner, wrapJs, wrapPy } from "./test-wrap.ts";
import { isTestFile, fileHasInlineTests } from "./test-parse.ts";

describe("run-tests wrap", () => {
  it("does not skip wrap on a pytest comment", () => {
    assert.equal(hasRealPyRunner("# using pytest later\ndef test_a():\n  pass\n"), false);
    assert.equal(hasRealPyRunner("import unittest\nif __name__ == '__main__':\n  unittest.main()\n"), true);
    const w = wrapPy("tests/t.py", "def test_a():\n  pass\n");
    assert.match(w, /_anvil_run/);
    assert.match(w, /tests\/t\.py/);
  });
  it("wraps describe/it and does not treat vitest import as a runner", () => {
    assert.equal(hasRealJsRunner("import { test } from 'vitest'\ntest('x', () => {})\n"), false);
    assert.equal(hasRealJsRunner("import { test } from 'node:test'\n"), true);
    const w = wrapJs("a.test.js", "describe('g', () => { it('one', () => {}) })");
    assert.match(w, /function describe/);
    assert.match(w, /__anvil_pending/);
  });
  it("test file filters include tsx spec and skip conftest / node_modules", () => {
    assert.equal(isTestFile("src/add.spec.tsx"), true);
    assert.equal(isTestFile("tests/conftest.py"), false);
    assert.equal(isTestFile("node_modules/pkg/foo.test.js"), false);
    assert.equal(isTestFile("tests/test_add.py"), true);
    assert.equal(fileHasInlineTests("src/lib.rs", "#[test]\nfn it_works() {}"), true);
  });
});
