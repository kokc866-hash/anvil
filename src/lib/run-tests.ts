import { runFile } from "./run-client";
import { discoverTests, isTestFile, parseTests, type TestHit } from "./test-parse";
import { useIde, type RunResult } from "@/store/ide";

function wrapPy(path: string, src: string): string {
  if (/\bif __name__\s*==/.test(src) || /pytest|unittest/.test(src)) return src;
  return `${src}

_anvil_fails = 0
for _n, _fn in list(globals().items()):
    if not _n.startswith("test_") or not callable(_fn):
        continue
    try:
        _fn()
        print("PASS ${path} ::", _n)
    except Exception as _e:
        _anvil_fails += 1
        print("FAIL ${path} ::", _n, _e)
if _anvil_fails:
    raise SystemExit(1)
`;
}

function wrapJs(path: string, src: string): string {
  if (/\bnode:test\b|\bvitest\b/.test(src)) return src;
  if (/^function (?:it|test)\b/m.test(src) || /\b(?:it|test)\s*=/.test(src)) return src;
  return `let __anvil_fail = 0;
function test(name, fn) {
  try { fn(); console.log("PASS ${path} · " + name); }
  catch (e) { __anvil_fail += 1; console.error("FAIL ${path} · " + name + " " + e); }
}
const it = test;
${src}
if (__anvil_fail) throw new Error(__anvil_fail + " Tests fehlgeschlagen");`;
}

function prepared(files: Record<string, string>, path: string): Record<string, string> {
  const src = files[path] ?? "";
  if (path.endsWith(".py")) return { ...files, [path]: wrapPy(path, src) };
  if (/\.(js|ts|mjs|cjs)$/.test(path)) return { ...files, [path]: wrapJs(path, src) };
  return files;
}

export function testFilesOf(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((p) => isTestFile(p) && /\.(py|js|ts|mjs|cjs|go|rs|cs|php|rb|java)$/.test(p))
    .sort();
}

export async function runTestFiles(paths: string[]): Promise<RunResult> {
  const st = useIde.getState();
  if (st.testsRunning) {
    return { ok: false, stdout: "", stderr: "Tests laufen schon.", duration: 0, label: "tests" };
  }
  st.setTestsRunning(true);
  const started = performance.now();
  const parts: string[] = [];
  let ok = true;
  const allHits: TestHit[] = [];
  try {
    const list = paths.length ? paths : testFilesOf(st.files);
    if (!list.length) {
      const r: RunResult = {
        ok: false,
        stdout: "",
        stderr: "Keine Testdateien. Lege tests/ oder *.test.js / test_*.py an.",
        duration: 0,
        label: "tests",
      };
      st.pushOutput(r);
      return r;
    }
    for (const p of list) {
      const r = await runFile(p, prepared(st.files, p));
      parts.push(`${r.ok ? "PASS" : "FAIL"} ${p}\n${[r.stdout, r.stderr].filter(Boolean).join("\n")}`.trim());
      if (!r.ok) ok = false;
      const hits = parseTests(r.stdout, r.stderr, st.files);
      if (hits.length) allHits.push(...hits);
      else {
        const found = discoverTests({ [p]: st.files[p] ?? "" });
        allHits.push(...found.map((h) => ({ ...h, ok: r.ok, skip: false, text: r.ok ? "" : r.stderr.slice(0, 200) })));
      }
    }
    st.mergeTestResults(allHits);
    const result: RunResult = {
      ok,
      stdout: parts.join("\n\n"),
      stderr: ok ? "" : "Tests fehlgeschlagen",
      duration: (performance.now() - started) / 1000,
      label: "tests",
    };
    st.pushOutput(result);
    return result;
  } finally {
    useIde.getState().setTestsRunning(false);
  }
}

export function runAllTests(): Promise<RunResult> {
  return runTestFiles(testFilesOf(useIde.getState().files));
}

export function runFailedTests(): Promise<RunResult> {
  const st = useIde.getState();
  const fails = Object.values(st.testResults).filter((h) => !h.ok && !h.skip);
  const paths = [...new Set(fails.map((h) => h.path))];
  return runTestFiles(paths.length ? paths : testFilesOf(st.files));
}
