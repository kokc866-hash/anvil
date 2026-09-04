import { loadProjectHarness } from "./harness-project";
import { testsPrompt, type TestHit } from "./test-parse";
import { testFilesOf, runAllTests } from "./run-tests";
import { isTestStepText } from "./test-parse";
import type { FileChange } from "./diff";
import type { AgentStep } from "@/store/ide";
import { useIde } from "@/store/ide";

export function alreadyRanTests(steps?: AgentStep[]): boolean {
  return (steps ?? []).some((s) => isTestStepText(s.name, s.detail, s.status));
}

export function shouldTestAfterRound(changes: FileChange[], files: Record<string, string>, steps?: AgentStep[]): boolean {
  const st = useIde.getState();
  const proj = loadProjectHarness(files);
  const loop = proj?.testLoop ?? st.testLoop;
  if (!loop || st.testsRunning) return false;
  if (!testFilesOf(files).length) return false;
  if (alreadyRanTests(steps)) return false;
  return changes.some((c) => {
    if (c.path === "ref" || c.path.startsWith("ref/") || c.path.startsWith(".anvil/") || /\.md$/i.test(c.path)) return false;
    return true;
  });
}

export function summarizeHits(hits: TestHit[]): { ok: boolean; pass: number; fail: number } {
  const fail = hits.filter((h) => !h.ok && !h.skip).length;
  const pass = hits.filter((h) => h.ok && !h.skip).length;
  return { ok: fail === 0 && pass > 0, pass, fail };
}

export async function testAfterRound(): Promise<void> {
  const st = useIde.getState();
  st.setChatLastTests({ ok: false, pass: 0, fail: 0, running: true });
  try {
    const r = await runAllTests();
    const sum = summarizeHits(Object.values(useIde.getState().testResults));
    useIde.getState().setChatLastTests({ ...sum, ok: r.ok && sum.fail === 0 && sum.pass > 0, running: false });
    if (sum.fail) {
      useIde.getState().setNotice(`${sum.fail} Tests rot`);
    }
  } catch {
    useIde.getState().setChatLastTests({ ok: false, pass: 0, fail: 0, running: false });
  }
}

export function roundTestsPrompt(hits: TestHit[]): string {
  return testsPrompt(hits);
}
