import type { WorkflowSnapshot } from "./agent-workflow";
import { toolCallFingerprint } from "./tool-call-fingerprint";
import { validWorkflowSnapshot } from "../../electron/workflow-validation.mjs";

/** Native storage is outside the renderer. A browser-only session uses local storage. */
export async function persistAgentWorkflow(project: string, snapshot: WorkflowSnapshot): Promise<void> {
  if (!validWorkflowSnapshot(snapshot)) throw Error("Ungültiger Ablaufzustand.");
  const native = (globalThis as typeof globalThis & { anvilNative?: { agentJob?: (action: string, payload: unknown) => Promise<{ ok?: boolean }> } }).anvilNative;
  if (native?.agentJob) {
    const result = await native.agentJob("workflow-write", { project, snapshot });
    if (result?.ok !== true) throw Error("Der Ablaufzustand konnte nicht gesichert werden. Auftrag angehalten.");
    return;
  }
  const scope = await toolCallFingerprint("workflow-project", { project });
  localStorage.setItem(`anvil-workflow:${scope}:${snapshot.id}`, JSON.stringify(snapshot));
}
