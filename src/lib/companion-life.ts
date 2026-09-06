import { nativeHelper } from "./helper-local";
import { setCompanionToken } from "./companion";
import { useIde } from "@/store/ide";
import { jobKeepsCompanion } from "./agent-ask";

export async function holdCompanion(): Promise<boolean> {
  const n = nativeHelper();
  if (!n?.companionEnsure) return false;
  const r = await n.companionEnsure();
  if (r.token) setCompanionToken(r.token);
  if (!r.ok) await releaseCompanion();
  return Boolean(r.ok);
}

export async function releaseCompanion(): Promise<void> {
  const n = nativeHelper();
  if (!n?.companionRelease) return;
  const st = useIde.getState();
  const keep = st.companionKeep || st.runPopout || jobKeepsCompanion(st.agentJob);
  await n.companionRelease(keep);
}

export async function withCompanion<T>(fn: () => Promise<T>, base = ""): Promise<T> {
  if (base) {
    try {
      const url = new URL(base);
      if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "7845") return fn();
    } catch { return fn(); }
  }
  const held = await holdCompanion();
  try {
    return await fn();
  } finally {
    if (held) await releaseCompanion().catch(() => undefined);
  }
}

/** Reconsider idling without releasing another operation's lease. */
export async function idleCompanion(): Promise<void> {
  const n = nativeHelper();
  const st = useIde.getState();
  await n?.companionIdle?.(st.companionKeep || st.runPopout || jobKeepsCompanion(st.agentJob));
}
