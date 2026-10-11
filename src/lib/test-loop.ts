import { loadProjectHarness } from "./harness-project";
import { testsPrompt, fileHasInlineTests, isTestExt, isTestFile, isTestStepText, type TestHit } from "./test-parse";
import type { FileChange } from "./diff";
import type { AgentStep } from "@/store/ide";
import { useIde } from "@/store/ide";
import type { AgentRun } from "./agent-run";
import type { Verification } from "./agent-evidence";
import { workflowInputPaths } from "./workflow-inputs";

export function alreadyRanTests(steps?: AgentStep[]): boolean {
  return (steps ?? []).some((s) => isTestStepText(s.name, s.detail, s.status));
}

export function shouldTestAfterRound(changes: FileChange[], files: Record<string, string>, _steps?: AgentStep[], verification?: Verification): boolean {
  const st = useIde.getState();
  const proj = loadProjectHarness(files);
  const loop = proj?.testLoop ?? st.testLoop;
  if (!loop || st.testsRunning) return false;
  if (!Object.keys(files).some(path => isTestExt(path) && (isTestFile(path) || fileHasInlineTests(path, files[path] || "")))) return false;
  // Step labels have no input version. A test mentioned before a later edit is
  // not a current check; only the runner's versioned test evidence can skip it.
  if (verification?.state === "passed" && verification.tests === true) return false;
  const inputs=workflowInputPaths({ ...files, ...Object.fromEntries(changes.filter(c=>!(c.path in files)).map(c=>[c.path, ""])) });
  return changes.some(c=>inputs.has(c.path));
}

export function summarizeHits(hits: TestHit[]): { ok: boolean; pass: number; fail: number } {
  const fail = hits.filter((h) => !h.ok && !h.skip).length;
  const pass = hits.filter((h) => h.ok && !h.skip).length;
  return { ok: fail === 0 && pass > 0, pass, fail };
}

export async function testAfterRound(run?: AgentRun): Promise<void> {
  run?.assertCurrent();
  const st = useIde.getState();
  const current = () => {
    const live = useIde.getState();
    return (!run || run.current()) && live.workspaceEpoch === st.workspaceEpoch && live.chat.at(-1)?.id === st.chat.at(-1)?.id;
  };
  st.setChatLastTests({ ok: false, pass: 0, fail: 0, running: true });
  try {
    const { runAllTests } = await import("./run-tests");
    run?.assertCurrent();
    if (!current()) return;
    const r = await runAllTests(undefined, run);
    if (!current()) return;
    const sum = summarizeHits(Object.values(useIde.getState().testResults));
    useIde.getState().setChatLastTests({ ...sum, ok: r.ok && sum.fail === 0 && sum.pass > 0, running: false });
    if (sum.fail) {
      useIde.getState().setNotice(`${sum.fail} Tests rot`);
    }
  } catch {
    if (current()) useIde.getState().setChatLastTests({ ok: false, pass: 0, fail: 0, running: false });
  }
}

export function roundTestsPrompt(hits: TestHit[]): string {
  return testsPrompt(hits);
}
