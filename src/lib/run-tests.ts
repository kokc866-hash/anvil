import { runFile } from "./run-client";
import { throwIfAborted, agentGen } from "./abort";
import type { AgentRun } from "./agent-run";
import { discoverTests, isTestFile, isTestExt, parseTests, pruneTestMap, fileHasInlineTests, type TestHit } from "./test-parse";
import { prepared, nodeTestInput } from "./test-wrap";
import { useIde, type RunResult } from "@/store/ide";
import { isSecretPath } from "./ref";
import { workflowInputPaths } from "./workflow-inputs";

export { wrapPy, wrapJs, wrapPhp, wrapRb, hasRealPyRunner, hasRealJsRunner, prepared } from "./test-wrap";

const FILE_MS = 30_000;

export function testFilesOf(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((p) => (isTestFile(p) || fileHasInlineTests(p, files[p] ?? "")) && isTestExt(p))
    .sort();
}

function suiteGroups(paths: string[]): { entry: string; members: string[] }[] {
  const go = paths.filter((p) => /_test\.go$/i.test(p));
  const rs = paths.filter((p) => /\.rs$/i.test(p));
  const cs = paths.filter((p) => /\.cs$/i.test(p));
  const used = new Set<string>([...go, ...rs, ...cs]);
  const out: { entry: string; members: string[] }[] = [];
  if (go.length) out.push({ entry: go[0], members: go });
  if (rs.length) out.push({ entry: rs[0], members: rs });
  if (cs.length) out.push({ entry: cs[0], members: cs });
  for (const p of paths) {
    if (!used.has(p)) out.push({ entry: p, members: [p] });
  }
  return out;
}

function withTimeout(p: Promise<RunResult>, ms: number, label: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      resolve({ ok: false, stdout: "", stderr: `Zeitüberschreitung nach ${Math.round(ms / 1000)}s`, duration: ms / 1000, label });
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function runTestFiles(paths: string[], onlyName?: string, run?: AgentRun, input?: { files: Record<string, string>; node?: boolean }): Promise<RunResult> {
  const st = useIde.getState();
  const sourceFiles = input?.files ?? st.files;
  const editorBefore = input ? { ...st.files } : undefined;
  const matches = (left: Record<string, string>, right: Record<string, string>) => {
    const inputs = (files: Record<string, string>) => workflowInputPaths(Object.fromEntries(Object.entries(files).filter(([path]) => !isSecretPath(path))));
    const leftPaths = inputs(left), rightPaths = inputs(right);
    return leftPaths.size === rightPaths.size && [...leftPaths].every(path => rightPaths.has(path) && left[path] === right[path]);
  };
  const current = () => useIde.getState().workspaceEpoch === st.workspaceEpoch && (!run || run.current());
  const assertCurrent = () => {
    run?.assertCurrent();
    if (!current()) throw new Error("Projekt inzwischen gewechselt. Testergebnis gehört zum vorherigen Projekt.");
    if (editorBefore && !matches(editorBefore, useIde.getState().files)) throw new Error("Editor während der Tests geändert. Geprüft wurde nur der übergebene Dateistand; der aktuelle Editorstand ist nicht bestätigt.");
  };
  assertCurrent();
  if (st.testsRunning) {
    return { ok: false, stdout: "", stderr: "Tests laufen schon.", duration: 0, label: "tests" };
  }
  st.setTestsRunning(true);
  const started = performance.now();
  const parts: string[] = [];
  let ok = true;
  const allHits: TestHit[] = [];
  const ran: string[] = [];
  try {
    const list = (paths.length ? paths : testFilesOf(sourceFiles)).filter(
      (p) => isTestFile(p) || isTestExt(p) || fileHasInlineTests(p, sourceFiles[p] ?? ""),
    );
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
    for (const g of suiteGroups(list)) {
      assertCurrent();
      throwIfAborted();
      ran.push(...g.members);
      const scope: Record<string, string> = {};
      for (const p of g.members) scope[p] = sourceFiles[p] ?? "";
      const preparedInput = input?.node ? nodeTestInput(sourceFiles, g.entry) : { entry: g.entry, files: prepared(sourceFiles, g.entry, onlyName) };
      const r = await withTimeout(runFile(preparedInput.entry, preparedInput.files, { asTest: true, run }), FILE_MS, g.entry);
      assertCurrent();
      parts.push(`${r.ok ? "PASS" : "FAIL"} ${g.entry}\n${[r.stdout, r.stderr].filter(Boolean).join("\n")}`.trim());
      if (!r.ok) ok = false;
      const hits = parseTests(r.stdout, r.stderr, scope);
      if (hits.length) allHits.push(...hits);
      else if (r.html) {
        for (const h of discoverTests(scope)) {
          allHits.push({ ...h, ok: false, skip: false, text: "Testdatei als Vorschau, nicht als Tests." });
        }
      } else if (!r.ok) {
        allHits.push(
          ...discoverTests(scope).map((h) => ({
            ...h,
            ok: false,
            skip: false,
            text: (r.stderr || r.stdout).slice(0, 200),
          })),
        );
      } else {
        allHits.push(
          ...discoverTests(scope).map((h) => ({
            ...h,
            ok: false,
            skip: true,
            text: "kein PASS/FAIL im Output",
          })),
        );
      }
    }
    assertCurrent();
    const snapshotMismatch = Boolean(input && !matches(sourceFiles, useIde.getState().files));
    if (!snapshotMismatch) {
      const prev = pruneTestMap(useIde.getState().testResults, useIde.getState().files, ran);
      useIde.setState({ testResults: prev });
      st.mergeTestResults(allHits);
    }
    const result: RunResult = {
      ok: ok && !snapshotMismatch,
      stdout: parts.join("\n\n"),
      stderr: snapshotMismatch ? "Tests wurden im übergebenen Dateistand ausgeführt. Der Editor enthält andere Inhalte; der aktuelle Stand ist nicht bestätigt. Nicht automatisch mit den anderen Dateien wiederholen." : ok ? "" : "Tests fehlgeschlagen",
      duration: (performance.now() - started) / 1000,
      label: "tests",
    };
    st.pushOutput(result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const result: RunResult = {
      ok: false,
      stdout: parts.join("\n\n"),
      stderr: msg,
      duration: (performance.now() - started) / 1000,
      label: "tests",
    };
    if (current()) useIde.getState().pushOutput(result);
    return result;
  } finally {
    // A replacement request owns its own UI; stopAgent releases a stopped flag.
    if (useIde.getState().workspaceEpoch === st.workspaceEpoch && (!run || run.generation === agentGen())) useIde.getState().setTestsRunning(false);
  }
}

export function runAllTests(onlyName?: string, run?: AgentRun, files?: Record<string, string>): Promise<RunResult> {
  return runTestFiles(testFilesOf(files ?? useIde.getState().files), onlyName, run, files ? { files } : undefined);
}

export function runNodeTestFiles(paths: string[], files: Record<string, string>, run?: AgentRun): Promise<RunResult> {
  return runTestFiles(paths, undefined, run, { files, node: true });
}

export function runFailedTests(): Promise<RunResult> {
  const st = useIde.getState();
  const fails = Object.values(st.testResults).filter((h) => !h.ok && !h.skip);
  const paths = [...new Set(fails.map((h) => h.path))];
  return runTestFiles(paths.length ? paths : testFilesOf(st.files));
}
