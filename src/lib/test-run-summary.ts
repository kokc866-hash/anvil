/** Small, bounded facts from actual test process output. Never model prose. */
export type TestRunCounts = { total: number; passed: number; failed: number; skipped: number; cancelled: number; todo: number };
export type TestRunSummary = { tests?: TestRunCounts; checks?: { passed: number; failed: number; skipped: number } };
const MAX_COUNT = 1_000_000;
const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_COUNT;

export function validTestRunSummary(value: unknown): value is TestRunSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => key !== "tests" && key !== "checks") || !row.tests && !row.checks) return false;
  if (row.tests !== undefined) {
    if (!row.tests || typeof row.tests !== "object" || Array.isArray(row.tests)) return false;
    const counts = row.tests as Record<string, unknown>;
    const keys = ["total", "passed", "failed", "skipped", "cancelled", "todo"];
    if (Object.keys(counts).some(key => !keys.includes(key)) || keys.some(key => !validCount(counts[key]))) return false;
    const total = counts.total as number;
    if (keys.slice(1).reduce((sum, key) => sum + Number(counts[key]), 0) !== total) return false;
  }
  if (row.checks !== undefined) {
    if (!row.checks || typeof row.checks !== "object" || Array.isArray(row.checks)) return false;
    const counts = row.checks as Record<string, unknown>;
    if (Object.keys(counts).some(key => !["passed", "failed", "skipped"].includes(key))
      || ["passed", "failed", "skipped"].some(key => !validCount(counts[key]))) return false;
    const total = Number(counts.passed) + Number(counts.failed) + Number(counts.skipped);
    if (total <= 0 || total > MAX_COUNT) return false;
  }
  return true;
}

export function summarizeTestRun(stdout: unknown, stderr: unknown): TestRunSummary | undefined {
  // Keep the final framework summary without retaining raw process output.
  const raw = [stdout, stderr].filter((v): v is string => typeof v === "string").map(v => v.slice(-65536)).join("\n");
  const lines = raw.split(String.fromCharCode(27)).map((part, index) => index ? part.replace(/^\[[0-?]*[ -/]*[@-~]/, "") : part).join("").split(/\r?\n/);
  const values: Record<string, number> = {};
  const checks = { passed: 0, failed: 0, skipped: 0 };
  for (const line of lines) {
    // Do not consume nested TAP output or indented log excerpts as root totals.
    const match = /^(?:#|ℹ)\s+(tests|pass|fail|skipped|cancelled|todo)\s+(\d+)\s*$/.exec(line);
    if (match && validCount(Number(match[2]))) {
      if (match[1] === "tests") for (const key of Object.keys(values)) delete values[key];
      values[match[1]] = Number(match[2]);
    }
    const check = /^(PASS|FAIL|SKIP) - \S/.exec(line);
    if (check) checks[check[1] === "PASS" ? "passed" : check[1] === "FAIL" ? "failed" : "skipped"]++;
  }
  const candidate: TestRunSummary = {};
  if (values.tests !== undefined && values.pass !== undefined && values.fail !== undefined) {
    const counts = { total: values.tests, passed: values.pass, failed: values.fail, skipped: values.skipped ?? 0, cancelled: values.cancelled ?? 0, todo: values.todo ?? 0 };
    if (validTestRunSummary({ tests: counts })) candidate.tests = counts;
  }
  if (checks.passed + checks.failed + checks.skipped > 0 && validTestRunSummary({ checks })) candidate.checks = checks;
  return validTestRunSummary(candidate) ? candidate : undefined;
}

export function describeTestRun(summary?: TestRunSummary): string {
  if (!summary) return "Testausführung ohne gemeldeten Fehler; keine verlässliche Einzeltest-Anzahl verfügbar";
  const details: string[] = [];
  if (summary.tests) {
    const c = summary.tests;
    details.push(c.passed + "/" + c.total + " Tests bestanden"
      + (c.failed ? ", " + c.failed + " fehlgeschlagen" : "")
      + (c.skipped ? ", " + c.skipped + " übersprungen" : "")
      + (c.cancelled ? ", " + c.cancelled + " abgebrochen" : "")
      + (c.todo ? ", " + c.todo + " noch offen" : ""));
  }
  if (summary.checks) {
    const c = summary.checks;
    details.push(c.passed + " gemeldete Einzelprüfungen bestanden"
      + (c.failed ? ", " + c.failed + " fehlgeschlagen" : "")
      + (c.skipped ? ", " + c.skipped + " übersprungen" : ""));
  }
  return details.join("; ");
}

