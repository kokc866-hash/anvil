import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasRealJsRunner, hasRealPyRunner, wrapJs, wrapPy, prepared, nodeTestInput } from "./test-wrap.ts";
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
  it("preserves real CJS and MJS node:test sources in ordinary and explicit Node modes", () => {
    for (const [path, source] of [["test.cjs", "const {test}=require('node:test');test('cjs',()=>{});"], ["test.mjs", "import {test} from 'node:test';test('mjs',async()=>{});"]]) {
      const files = { [path]: source };
      assert.equal(prepared(files, path)[path], source);
      const node = nodeTestInput(files, path);
      assert.equal(node.files[path], source);
      assert.match(node.files[node.entry], /spawn\(process\.execPath,\['--test'/);
      assert.doesNotMatch(node.files[node.entry], /await import\(/);
    }
  });
});
