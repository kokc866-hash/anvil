import { acceptanceMeasurements } from '../../electron/task-acceptance.mjs';
import type { AgentRun } from './agent-run';

/** Native file checks belong to the captured project and request, never the next chat. */
export async function verifyForegroundArtifacts(result: Record<string, unknown>, project: string, run: AgentRun): Promise<Record<string, unknown>> {
  run.assertCurrent();
  const rows = acceptanceMeasurements(result).rows as { artifact?: unknown; sha256?: unknown }[];
  if (!rows.length) return { ...result, anvilArtifactChecks: [] };
  const native = typeof window === 'undefined' ? undefined : (window as unknown as {
    anvilNative?: { agentJob?: (action: string, payload: unknown) => Promise<{ result?: Record<string, unknown> }> };
  }).anvilNative;
  if (project && native?.agentJob) {
    try {
      const reply = await run.wait(native.agentJob('artifact-check', { project, result }), 16000);
      run.assertCurrent();
      if (reply.result && Array.isArray(reply.result.anvilArtifactChecks)) return reply.result;
    } catch { run.assertCurrent(); }
  }
  return { ...result, anvilArtifactChecks: rows.map(row => ({ artifact: row.artifact, sha256: row.sha256, ok: false,
    reason: 'Datei und Prüfsumme konnten nicht unabhängig geprüft werden. Einen lokalen Projektordner in der Desktop-Version verwenden.',
    reasonEn: 'The file and digest could not be checked independently. Use a local project folder in the desktop version.',
  })) };
}
