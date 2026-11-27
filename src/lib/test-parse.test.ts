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
  summarizeTests,
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
  it("merges three Node spec results with their discovered tests instead of displaying six", () => {
    const names = ["manual body color remains exact", "unrelated header edit is applied", "other files progress after blocked writes"];
    const files = { "preserve.test.cjs": names.map((name) => `test('${name}', () => {})`).join("\n") };
    const output = [...names.map((name) => `✔ ${name} (0.8141ms)`), "ℹ tests 3", "ℹ suites 0", "ℹ pass 3"].join("\r\n");
    const tests = mergeTests(discoverTests(files), parseTests(output, "", files));
    assert.deepEqual(tests.map((hit) => hit.name), names);
    assert.ok(tests.every((hit) => hit.ok && !hit.skip && hit.path === "preserve.test.cjs"));
    assert.deepEqual(summarizeTests(tests), { passed: 3, total: 3 });
  });
  it("keeps Node failures and marks skip and todo separately from passes and suites", () => {
    const files = { "fixture.test.cjs": "describe('suite', () => {\n  test('working', () => {});\n  test.skip('not run', () => {});\n  test.todo('later');\n  test('breaks', () => {});\n});" };
    const output = ["▶ suite", "  ✔ working (0.4386ms)", "  ﹣ not run (0.1043ms) # SKIP", "  ✔ later (0.074ms) # pending", "  ✖ breaks (0.1651ms)", "✖ suite (2.1228ms)", "ℹ tests 4", "ℹ suites 1", "ℹ pass 1", "ℹ fail 1", "✖ failing tests:", "✖ breaks (0.1651ms)"].join("\n");
    const tests = mergeTests(discoverTests(files), parseTests(output, "", files));
    assert.deepEqual(tests.filter((hit) => hit.ok && !hit.skip).map((hit) => hit.name), ["working"]);
    assert.deepEqual(tests.filter((hit) => hit.skip).map((hit) => hit.name), ["not run", "later"]);
    assert.deepEqual(tests.filter((hit) => !hit.ok && !hit.skip).map((hit) => hit.name), ["breaks"]);
    assert.deepEqual(summarizeTests(tests), { passed: 1, total: 4 });
  });
  it("does not merge an unresolved Node spec name into similarly named tests in two files", () => {
    const files = { "a.test.cjs": "test('same name', () => {})", "b.test.cjs": "test('same name', () => {})" };
    const hits = parseTests("✔ same name (0.1ms)\nℹ tests 1\nℹ suites 0", "", files);
    const merged = mergeTests(discoverTests(files), hits);
    assert.equal(hits[0].path, "");
    assert.deepEqual(merged.filter((hit) => hit.skip).map((hit) => hit.path), ["a.test.cjs", "b.test.cjs"]);
    assert.deepEqual(summarizeTests(merged), { passed: 1, total: 2 });
    const explicit = parseTests("PASS a.test.cjs:1 same name\nFAIL b.test.cjs:1 same name", "", files);
    assert.deepEqual(mergeTests(discoverTests(files), explicit).map((hit) => [hit.path, hit.ok]), [["a.test.cjs", true], ["b.test.cjs", false]]);
    assert.deepEqual(summarizeTests(mergeTests(discoverTests(files), [...explicit, ...hits])), { passed: 1, total: 2 });
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
  it("recognizes explicit Node builtin test files without opening discovery, loaders or escaping paths", () => {
    assert.deepEqual(parseTestCommand('node --test ./adder.test.cjs "nested/test file.mjs"')?.paths, ["adder.test.cjs", "nested/test file.mjs"]);
    assert.equal(isTestStepText("shell", "node --test adder.test.cjs", "ok"), true);
    assert.equal(isTestStepText("write_file", "mentioned node --test in documentation", "ok"), false);
    for (const command of ["node --test", "node --test ../outside.test.cjs", "node --test /outside.test.cjs", "node --test C:/outside.test.cjs", "node --test --import setup.mjs adder.test.cjs", "node --test -e 'process.exit(0)'", "node --test --test-reporter ./reporter.mjs adder.test.cjs"])
      assert.equal(parseTestCommand(command), null, command);
  });
});
