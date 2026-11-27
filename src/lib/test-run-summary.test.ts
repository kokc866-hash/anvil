import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTestRun, describeTestRun, validTestRunSummary } from "./test-run-summary.ts";

test("TAP totals and spec reporter totals yield the same bounded counts", () => {
  const tap = "# tests 28\n# suites 0\n# pass 26\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n";
  const spec = "\u001b[32mℹ tests 28\u001b[0m\nℹ pass 26\nℹ fail 1\nℹ skipped 1\n";
  assert.deepEqual(summarizeTestRun(tap, ""), summarizeTestRun(spec, ""));
  assert.equal(summarizeTestRun(tap, "")?.tests?.total, 28);
  assert.match(describeTestRun(summarizeTestRun(tap, "")), /26\/28.*1 fehlgeschlagen.*1 übersprungen/);
});

test("individual checks are reported separately, never added to framework totals", () => {
  const summary = summarizeTestRun("PASS - import\nSKIP - touch hardware\nFAIL - export\n# tests 1\n# pass 0\n# fail 1\n", "");
  assert.deepEqual(summary?.checks, { passed: 1, skipped: 1, failed: 1 });
  assert.equal(summary?.tests?.total, 1);
  assert.match(describeTestRun(summary), /0\/1 Tests bestanden/);
  assert.match(describeTestRun(summary), /1 gemeldete Einzelprüfungen bestanden/);
});

test("partial, impossible and nested summaries do not invent counts", () => {
  for (const output of [
    "# pass 28\n# fail 0\n",
    "# tests 3\n# pass 4\n# fail 0\n",
    "  # tests 28\n  # pass 28\n  # fail 0\n",
    "# ℹ tests 28\n# ℹ pass 28\n# ℹ fail 0\n",
    "The model says 28 tests passed and everything works",
    "# tests 999999999999999999999\n# pass 999999999999999999999\n# fail 0\n",
  ]) assert.equal(summarizeTestRun(output, ""), undefined, output);
});

test("a later complete summary replaces an earlier suite without mixing counters", () => {
  const text = "# tests 5\n# pass 4\n# fail 1\n# tests 2\n# pass 2\n# fail 0\n";
  assert.deepEqual(summarizeTestRun(text, "")?.tests, { total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, todo: 0 });
  assert.equal(summarizeTestRun(text + "# tests 3\n", ""), undefined);
});

test("cancelled, skipped and pending cases stay visibly distinct", () => {
  const text = "# tests 6\n# pass 1\n# fail 1\n# skipped 2\n# cancelled 1\n# todo 1\n";
  const summary = summarizeTestRun(text, "");
  assert.ok(summary);
  assert.match(describeTestRun(summary), /1\/6.*1 fehlgeschlagen.*2 übersprungen.*1 abgebrochen.*1 noch offen/);
});

test("serialized counts reject extra fields, non-integers and counter inconsistencies", () => {
  const base = { total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, todo: 0 };
  assert.equal(validTestRunSummary({ tests: base }), true);
  for (const bad of [
    {},
    { tests: { ...base, token: "PRIVATE" } },
    { tests: { ...base, passed: -1 } },
    { tests: { ...base, total: 3 } },
    { tests: { ...base, total: 2.5 } },
    { tests: { ...base, passed: "2" } },
    { checks: { passed: 0, failed: 0, skipped: 0 } },
    { checks: { passed: 1, failed: 0, skipped: 0, rawOutput: "PRIVATE" } },
  ]) assert.equal(validTestRunSummary(bad), false, JSON.stringify(bad));
});

test("raw process output is bounded while its trailing totals remain readable", () => {
  const summary = summarizeTestRun("PRIVATE".repeat(200000) + "\n# tests 1\n# pass 1\n# fail 0\n", "");
  assert.equal(summary?.tests?.passed, 1);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE/);
  assert.equal(summarizeTestRun(null, {}), undefined);
});

