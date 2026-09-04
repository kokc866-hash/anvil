import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoverTests,
  dropTestPaths,
  isTestFile,
  isTestStepText,
  mergeTests,
  parseTestCommand,
  parseTests,
  pruneTestMap,
  remapTestMap,
  testsPrompt,
} from "./test-parse.ts";

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
  it("discovers rust #[test] fn and java *Test.java", () => {
    const d = discoverTests({
      "src/lib.rs": "#[test]\nfn it_works() {\n  assert!(true);\n}\n",
      "src/FooTest.java": "public class FooTest { @Test public void adds() {} }\n",
      "src/BarTests.java": "class BarTests { @Test void holds() {} }\n",
    });
    assert.equal(d.some((h) => h.name === "it_works"), true);
    assert.equal(isTestFile("src/FooTest.java"), true);
    assert.equal(isTestFile("src/BarTests.java"), true);
    assert.equal(isTestFile("src/Main.java"), false);
  });
  it("skips conftest, node_modules, tsx is a test file", () => {
    assert.equal(isTestFile("tests/conftest.py"), false);
    assert.equal(isTestFile("node_modules/pkg/foo.test.js"), false);
    assert.equal(isTestFile("src/add.spec.tsx"), true);
  });
  it("parses pytest and pass/fail lines", () => {
    const files = { "tests/test_add.py": "def test_add():\n  pass\n" };
    const hits = parseTests("tests/test_add.py::test_add PASSED\nFAIL tests/test_add.py · other", "", files);
    assert.ok(hits.some((h) => h.name === "test_add" && h.ok));
    assert.ok(hits.some((h) => !h.ok));
  });
  it("parses go test -v and cargo test lines", () => {
    const files = {
      "add_test.go": "func TestAdd(t *testing.T) {}\n",
      "src/lib.rs": "#[test]\nfn it_works() {}\n",
    };
    const go = parseTests("--- PASS: TestAdd (0.00s)\n--- FAIL: TestSub (0.00s)", "", files);
    assert.ok(go.some((h) => h.name === "TestAdd" && h.ok));
    assert.ok(go.some((h) => h.name === "TestSub" && !h.ok));
    const rs = parseTests("test tests::it_works ... ok\ntest tests::boom ... FAILED", "", files);
    assert.ok(rs.some((h) => h.name.includes("it_works") && h.ok));
    assert.ok(rs.some((h) => h.name.includes("boom") && !h.ok));
  });
  it("fallback fail is scoped to the file in the blob", () => {
    const files = {
      "a.test.js": "it('one', () => {})\n",
      "b.test.js": "it('two', () => {})\n",
    };
    const hits = parseTests("Error: assert in a.test.js:1", "", files);
    assert.ok(hits.some((h) => h.path === "a.test.js" && !h.ok));
    assert.equal(hits.some((h) => h.path === "b.test.js"), false);
  });
  it("merges discovery with results", () => {
    const d = discoverTests({ "a.test.js": "it('one', () => {})\n" });
    const m = mergeTests(d, [{ path: "a.test.js", line: 1, name: "one", ok: false, text: "boom" }]);
    assert.equal(m[0]?.ok, false);
    assert.equal(m[0]?.skip, false);
  });
  it("prompt is idle vs green vs red", () => {
    assert.match(testsPrompt([{ path: "a.py", line: 1, name: "t", ok: true, text: "", skip: true }]), /noch nicht/);
    assert.match(testsPrompt([{ path: "a.py", line: 1, name: "t", ok: true, text: "", skip: false }]), /grün/);
    assert.match(testsPrompt([{ path: "a.py", line: 1, name: "t", ok: false, text: "x", skip: false }]), /rot/);
  });
  it("prunes deleted paths and remaps rename", () => {
    const map = {
      "a.py:t": { path: "a.py", line: 1, name: "t", ok: false, text: "" },
      "b.py:t": { path: "b.py", line: 1, name: "t", ok: true, text: "" },
    };
    const pruned = pruneTestMap(map, { "b.py": "" });
    assert.equal("a.py:t" in pruned, false);
    assert.equal("b.py:t" in pruned, true);
    const dropped = dropTestPaths(map, (p) => p === "a.py");
    assert.equal("a.py:t" in dropped, false);
    const remapped = remapTestMap(map, "a.py", "c.py");
    assert.ok(remapped["c.py:t"]);
    assert.equal(remapped["c.py:t"]?.path, "c.py");
  });
  it("parses pytest -q and python -m pytest and go test ./...", () => {
    assert.ok(parseTestCommand("pytest -q"));
    assert.ok(parseTestCommand("python -m pytest tests/test_add.py"));
    assert.equal(parseTestCommand("pytest -k test_add")?.filter, "test_add");
    assert.deepEqual(parseTestCommand("pytest tests/test_add.py")?.paths, ["tests/test_add.py"]);
    assert.ok(parseTestCommand("go test ./..."));
    assert.ok(parseTestCommand("cargo test"));
    assert.ok(parseTestCommand("dotnet test"));
    assert.ok(parseTestCommand("npx vitest"));
    assert.equal(parseTestCommand("ls -la"), null);
  });
  it("already-ran only counts successful shell test steps", () => {
    assert.equal(isTestStepText("shell", "pytest -q", "ok"), true);
    assert.equal(isTestStepText("shell", "pytest -q", "err"), false);
    assert.equal(isTestStepText("shell", "dotnet test", "ok"), true);
    assert.equal(isTestStepText("write_file", "mentioned pytest in a comment", "ok"), false);
  });
});
