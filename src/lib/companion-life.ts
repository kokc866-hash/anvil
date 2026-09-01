import { nativeHelper } from "./helper-local";
import { setCompanionToken } from "./companion";
import { useIde } from "@/store/ide";

export async function holdCompanion(): Promise<boolean> {
  const n = nativeHelper();
  if (!n?.companionEnsure) return false;
  const r = await n.companionEnsure();
  if (r.token) setCompanionToken(r.token);
  return Boolean(r.ok);
}

export async function releaseCompanion(): Promise<void> {
  const n = nativeHelper();
  if (!n?.companionRelease) return;
  const keep = useIde.getState().companionKeep || useIde.getState().runPopout;
  await n.companionRelease(keep);
}

export async function withCompanion<T>(fn: () => Promise<T>): Promise<T> {
  const held = await holdCompanion();
  try {
    return await fn();
  } finally {
    if (held) await releaseCompanion();
  }
}
