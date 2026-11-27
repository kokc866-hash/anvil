export type WorktreeAction = 'list' | 'create' | 'open' | 'compare' | 'integrate' | 'remove';
export type ManagedWorktree = {
  id: string;
  name: string;
  path: string;
  source: string;
  baseRevision: string;
  baseBranch: string;
  branch: string;
  createdAt: number;
  sourceDirty?: boolean;
  state: 'creating' | 'ready' | 'incomplete';
  dirty?: boolean;
  committed?: boolean;
  unavailable?: boolean;
  error?: string;
};
export type WorktreeChange = {
  path: string;
  kind: 'A' | 'D' | 'M';
  bytes: number;
  conflict: boolean;
  alreadyApplied: boolean;
  beforeText?: string;
  afterText?: string;
  currentText?: string;
  binary?: boolean;
  previewTruncated?: boolean;
};
export type WorktreeReply = {
  ok: boolean;
  error?: string;
  aborted?: boolean;
  cwd?: string;
  worktree?: ManagedWorktree;
  worktrees?: ManagedWorktree[];
  sourceDirty?: boolean;
  revision?: string;
  baseRevision?: string;
  changes?: WorktreeChange[];
  conflicts?: { path: string; reason: string }[];
  applied?: string[];
  receipt?: string;
  recoveryConflicts?: string[];
};

function normalizedRoot(root: string): string {
  const slashed = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^(?:[a-z]:|\/\/)/i.test(slashed) ? slashed.toLowerCase() : slashed;
}
export function worktreeRootsOverlap(a: string, b: string): boolean {
  const left = normalizedRoot(a), right = normalizedRoot(b);
  return Boolean(left && right && (left === right || left.startsWith(right + '/') || right.startsWith(left + '/')));
}
export function worktreeIsCurrent(worktree: ManagedWorktree, current: string): boolean {
  return normalizedRoot(worktree.path) === normalizedRoot(current);
}
export function worktreeSameRoot(a: string, b: string): boolean { return normalizedRoot(a) === normalizedRoot(b); }
export function worktreeActionProblem(action: WorktreeAction, state: { agentBusy: boolean; pathOperation: unknown; dirty: Record<string, unknown>; pendingDiffs?: unknown[] }, worktree?: ManagedWorktree, current = ''): string {
  if (action === 'list' || action === 'compare') return '';
  if (state.agentBusy) return 'Laufenden Vordergrundauftrag zuerst abschließen lassen.';
  if (state.pathOperation) return 'Laufende Dateiaktion zuerst abschließen lassen.';
  if (action !== 'create' && (Object.values(state.dirty).some(Boolean) || state.pendingDiffs?.length)) return 'Dateien und offene Änderungsvorschläge vor dieser Aktion speichern oder abgleichen.';
  if (action === 'remove' && worktree && worktreeIsCurrent(worktree, current)) return 'Zum Hauptprojekt wechseln, bevor dieser Arbeitsstand entfernt wird.';
  if (action === 'remove' && worktree && (worktree.dirty || worktree.committed)) return 'Arbeitsstand enthält Änderungen, eigene Commits oder ignorierte Dateien und bleibt erhalten.';
  return '';
}

type WorkspaceNative = { agentJob?: (action: string, payload?: unknown) => Promise<{ leaseId?: string }> };
/** A manual return is a writer too. Keep its roots reserved until the real operation settles. */
export async function withWorktreeProjectLease<T>(projects: string[], operation: () => Promise<T>): Promise<T> {
  const native = typeof window === 'undefined' ? undefined : (window as unknown as { anvilNative?: WorkspaceNative }).anvilNative;
  if (!native?.agentJob || !projects.length) return operation();
  const owner = `worktree:${crypto.randomUUID()}`;
  const lease = await native.agentJob('workspace-acquire', { projects, owner });
  if (!lease.leaseId) throw Error('Projektbindung konnte nicht bestätigt werden. Dateiaktion wurde nicht ausgeführt.');
  try { return await operation(); }
  finally { await native.agentJob('workspace-release', { leaseId: lease.leaseId, owner }); }
}
