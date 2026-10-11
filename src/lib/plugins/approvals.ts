import { pluginTrustFromHead } from "./util.ts";

/** Application storage only. Never hydrate consent from a project's files/settings. */
export const PLUGIN_APPROVAL_KEY = "anvil-workspace-plugin-approvals-v1";
export const PLUGIN_PERMISSION_POLICY = "renderer-full-access-v1";
type Approval = { project: string; path: string; digest: string; trust: boolean; policy: string };
type ApprovalStorage = Pick<Storage, "getItem" | "setItem">;

function storage(): ApprovalStorage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}

function records(store = storage()): Approval[] {
  try {
    const raw = store?.getItem(PLUGIN_APPROVAL_KEY);
    if (!raw || raw.length > 2_000_000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Approval => item && typeof item.project === "string"
      && typeof item.path === "string" && /^[a-f0-9]{64}$/.test(item.digest)
      && typeof item.trust === "boolean" && item.policy === PLUGIN_PERMISSION_POLICY).slice(-2000);
  } catch { return []; }
}

async function fingerprint(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Path + companion origin identify desktop projects; folder names alone do not. */
export function approvalProject(cwd: string, base: string): string | null {
  if (!cwd.trim()) return null;
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(cwd);
  const path = cwd.replaceAll("\\", "/").replace(/\/$/, "");
  return JSON.stringify([base.replace(/\/$/, ""), windows ? path.toLowerCase() : path]);
}

export function revokeStoredApproval(project: string | null, path: string, store = storage()): void {
  if (!project || !store) return;
  try { store.setItem(PLUGIN_APPROVAL_KEY, JSON.stringify(records(store).filter(item => item.project !== project || item.path !== path))); } catch { /* Denial remains effective in memory. */ }
}

export async function hasStoredApproval(project: string | null, path: string, code: string, store = storage()): Promise<boolean> {
  if (!project || !store) return false;
  const approval = records(store).find(item => item.project === project && item.path === path);
  if (!approval) return false;
  const valid = approval.trust === pluginTrustFromHead(code) && approval.digest === await fingerprint(code);
  if (!valid) revokeStoredApproval(project, path, store);
  return valid;
}

/** Returns false if persistence is unavailable; the caller can still grant this session. */
export async function storeApproval(project: string | null, path: string, code: string, store = storage()): Promise<boolean> {
  if (!project || !store) return false;
  const digest = await fingerprint(code);
  const approval: Approval = { project, path, digest, trust: pluginTrustFromHead(code), policy: PLUGIN_PERMISSION_POLICY };
  try {
    store.setItem(PLUGIN_APPROVAL_KEY, JSON.stringify([...records(store).filter(item => item.project !== project || item.path !== path), approval].slice(-2000)));
    return true;
  } catch { return false; }
}
