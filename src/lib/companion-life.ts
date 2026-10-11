import { nativeHelper } from "./helper-local";
import { companionWorkspace, setCompanionToken } from "./companion";
import { useIde } from "@/store/ide";
import { jobKeepsCompanion } from "./agent-ask";
import type { AgentRun } from "./agent-run";

function nativeBase(base: string): boolean {
  try { const u = new URL(base); return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && u.port === "7845"; }
  catch { return false; }
}

export async function holdCompanion(cwd = useIde.getState().workspaceCwd, base = useIde.getState().companionUrl || "http://127.0.0.1:7845", run?: AgentRun): Promise<boolean> {
  run?.assertCurrent();
  const n = nativeHelper();
  let held = false;
  try {
    if (nativeBase(base) && n?.companionEnsure) {
      const r = await n.companionEnsure();
      // Even a cancelled preparation must release the lease it just acquired.
      held = true;
      run?.assertCurrent();
      if (!r.ok) throw new Error("Companion konnte nicht gestartet werden.");
      if (r.token) setCompanionToken(r.token);
    }
    run?.assertCurrent();
    // A restarted Companion has forgotten the selected root. Register the captured target before use.
    if (cwd) {
      const result = await companionWorkspace(cwd, base, run?.signal);
      run?.assertCurrent();
      if (!result.ok) throw new Error(`Workspace ${cwd}: ${result.error || "Ordner konnte nicht verbunden werden."}`);
    }
    return held;
  } catch (error) {
    if (held) await releaseCompanion().catch(() => undefined);
    throw error;
  }
}

export async function releaseCompanion(): Promise<void> {
  const n = nativeHelper();
  if (!n?.companionRelease) return;
  const st = useIde.getState();
  const keep = st.companionKeep || st.runPopout || jobKeepsCompanion(st.agentJob);
  await n.companionRelease(keep);
}

export async function withCompanion<T>(fn: () => Promise<T>, base = "", cwd = useIde.getState().workspaceCwd, run?: AgentRun): Promise<T> {
  run?.assertCurrent();
  const configured = useIde.getState().companionUrl || "http://127.0.0.1:7845";
  const target = base || configured;
  try {
    // Other MCP servers have no Anvil workspace endpoint.
    if (new URL(target).origin !== new URL(configured).origin && !nativeBase(target)) return fn();
  } catch { return fn(); }
  const held = await holdCompanion(cwd, target.replace(/\/mcp\/?$/, ""), run);
  try { run?.assertCurrent(); return await fn(); }
  finally { if (held) await releaseCompanion().catch(() => undefined); }
}

/** Reconsider idling without releasing another operation's lease. */
export async function idleCompanion(): Promise<void> {
  const n = nativeHelper();
  const st = useIde.getState();
  await n?.companionIdle?.(st.companionKeep || st.runPopout || jobKeepsCompanion(st.agentJob));
}
