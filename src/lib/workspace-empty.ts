import { useIde } from "@/store/ide";
import { detachEmptyWorkspaceJob } from "./background-agent";
import { workspaceDisk } from "./native-workspace";
import { useRequestState } from "./request-state";

const checking = new Set<number>();

/** A filtered file tree can look empty even when the folder contains files. */
export async function checkEmptyLocalWorkspace(): Promise<void> {
  const initial = useIde.getState();
  const root = initial.workspaceCwd;
  if (checking.has(initial.workspaceEpoch) || !root || !initial.workspaceNative) return;
  const sameProject = () => {
    const state = useIde.getState();
    return state.workspaceEpoch === initial.workspaceEpoch && state.workspaceCwd === root && state.workspaceNative;
  };
  const safeToReset = () => {
    const state = useIde.getState();
    return sameProject() && !state.workspaceEmpty && !state.agentBusy && !state.running && !state.testsRunning
      && !state.pathOperation && !state.agentDraft.trim() && !state.pendingAsk && !state.agentInbox && !state.agentQueue.length
      && !Object.values(state.dirty).some(Boolean) && !state.pendingDiffs.length
      && !state.checkpoints.some(checkpoint => checkpoint.restoreIntent && (!checkpoint.workspace || checkpoint.workspace === root));
  };
  checking.add(initial.workspaceEpoch);
  try {
    const result = await workspaceDisk({ action: "empty", root });
    if (!sameProject()) return;
    if (result.empty === false) {
      if (useIde.getState().workspaceEmpty) useIde.setState({ workspaceEmpty: false });
      return;
    }
    if (result.empty !== true || !safeToReset() || !await detachEmptyWorkspaceJob(root, safeToReset) || !safeToReset()) return;
    // The folder may have changed while the local job registry was being read.
    const confirmed = await workspaceDisk({ action: "empty", root });
    if (confirmed.empty !== true || !safeToReset()) return;
    useIde.getState().startEmptyWorkspaceSession();
    useRequestState.setState({ phase: "done", detail: "", at: 0 });
  } catch { /* Unavailable folders and incomplete checks leave the session intact. */ }
  finally { checking.delete(initial.workspaceEpoch); }
}
