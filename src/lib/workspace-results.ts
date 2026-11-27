import { create } from "zustand";
import { useIde } from "@/store/ide";
import { workspaceDisk, type WorkspaceResults } from "./native-workspace";
import { companionWorkspaceResults } from "./companion";
import { captureDiskTarget, noteDiskFile, readDiskTargetFiles, type DiskTarget } from "./disk-sync";
import { validWorkspaceResultPath } from '../../scripts/workspace-results.mjs';
import { WorkspaceConflictError } from './workspace-conflict';

type WorkspaceScope = Pick<ReturnType<typeof useIde.getState>, "workspaceCwd" | "workspaceNative" | "workspaceEpoch" | "companionUrl">;
type ResultView = { scope: WorkspaceScope | null; index: WorkspaceResults | null };

export const useWorkspaceResults = create<ResultView>(() => ({ scope: null, index: null }));

function sameScope(a: WorkspaceScope | null, b: WorkspaceScope) {
  return a?.workspaceEpoch === b.workspaceEpoch && a.workspaceCwd === b.workspaceCwd &&
    a.workspaceNative === b.workspaceNative && (b.workspaceNative || a.companionUrl === b.companionUrl);
}

let pending: { scope: WorkspaceScope; promise: Promise<WorkspaceResults> } | null = null;
let known: { scope: WorkspaceScope; files: Set<string> } | undefined;

export function seedWorkspaceResultFiles(paths: Iterable<string>, target: WorkspaceScope = useIde.getState()) {
  if (!target.workspaceCwd || !sameScope(target, useIde.getState())) return;
  if (!known || !sameScope(known.scope, target)) {
    const { workspaceCwd, workspaceNative, workspaceEpoch, companionUrl } = target;
    known = { scope: { workspaceCwd, workspaceNative, workspaceEpoch, companionUrl }, files: new Set() };
  }
  for (const path of paths) if (validWorkspaceResultPath(path)) known.files.add(path);
}

export function knownWorkspaceResultFiles(target: WorkspaceScope): Iterable<string> {
  return known && sameScope(known.scope, target) ? known.files : [];
}

export function workspaceBufferProtected(path: string, state = useIde.getState()) {
  return Boolean(state.dirty[path] || state.pendingDiffs.some(diff => diff.path === path));
}

/** Read through the current disk target without replacing edited buffers. */
export async function readWorkspaceFile(path: string, target = captureDiskTarget(), loadEditor = false) {
  const before = useIde.getState();
  const assertTarget = () => {
    const current = captureDiskTarget();
    if (target.epoch !== current.epoch || target.cwd !== current.cwd || target.local !== current.local ||
        target.handle !== current.handle || !target.local && target.base !== current.base) {
      throw new Error('Der Arbeitsbereich wurde inzwischen gewechselt.');
    }
  };
  assertTarget();
  if (workspaceBufferProtected(path, before)) {
    if (loadEditor) before.openFile(path);
    return { content: before.files[path] ?? null, user_changes_protected: true };
  }
  const disk = await readDiskTargetFiles([path], target);
  assertTarget();
  const current = useIde.getState();
  if (workspaceBufferProtected(path, current) || before.files[path] !== current.files[path] || current.pathOperation) {
    if (loadEditor) current.openFile(path);
    return { content: current.files[path] ?? null, user_changes_protected: true };
  }
  if (!Object.hasOwn(disk, path)) throw new Error(`Datei konnte nicht als Text eingelesen werden: ${path}`);
  const content = disk[path];
  if (content !== null) seedWorkspaceResultFiles([path], current);
  if (content !== null) {
    noteDiskFile(path, content, target);
    if (current.files[path] !== content) useIde.setState({ files: { ...current.files, [path]: content } });
    if (loadEditor) current.openFile(path);
  }
  return { content };
}

export async function verifyWorkspaceEditBase(path: string, expected: string | null, target: DiskTarget) {
  const { content } = await readWorkspaceFile(path, target);
  if (content === expected) return;
  throw new WorkspaceConflictError(
    content === null ? `${path} wurde inzwischen gelöscht. Änderung wurde verworfen.`
      : `${path} wurde inzwischen geändert. Lies die aktuelle Fassung vor dem Bearbeiten.`,
    { path, kind: content === null ? 'deleted' : 'changed' },
  );
}

function pruneDeletedWorkspaceBuffers(index: WorkspaceResults, before: ReturnType<typeof useIde.getState>, diskTarget: DiskTarget) {
  if (!index.entries || index.truncated) return;
  const current = useIde.getState();
  if (before.pathOperation || current.pathOperation) return;
  const onDisk = new Set(index.entries.map(file => file.path));
  const knownFiles = known && sameScope(known.scope, current) ? known.files : undefined;
  if (!knownFiles) return;
  const missing = [...knownFiles].filter(path =>
    !onDisk.has(path) && Object.hasOwn(current.files, path) && current.files[path] === before.files[path] &&
    !workspaceBufferProtected(path, before) && !workspaceBufferProtected(path, current));
  for (const path of knownFiles) if (!onDisk.has(path) && !Object.hasOwn(current.files, path)) knownFiles.delete(path);
  if (!missing.length) return;
  const files = { ...current.files }, editBases = { ...current.editBases };
  for (const path of missing) {
    delete files[path];
    delete editBases[path];
    knownFiles.delete(path);
    noteDiskFile(path, null, diskTarget);
  }
  const openPaths = current.openPaths.filter(path => Object.hasOwn(files, path));
  useIde.setState({ files, editBases, openPaths,
    activePath: current.activePath && Object.hasOwn(files, current.activePath) ? current.activePath : openPaths[0] ?? null,
    attached: current.attached.filter(path => Object.hasOwn(files, path)),
    recentPaths: current.recentPaths.filter(path => Object.hasOwn(files, path)),
  });
}

function sameEntries(a: WorkspaceResults['entries'], b: WorkspaceResults['entries']) {
  return a === b || Boolean(a && b && a.length === b.length && a.every((file, i) =>
    file.path === b[i].path && file.size === b[i].size && file.modified === b[i].modified));
}

export async function refreshWorkspaceResults(target: WorkspaceScope = useIde.getState()) {
  const before = useIde.getState();
  if (!target.workspaceCwd || !sameScope(target, before)) return;
  if (pending && sameScope(pending.scope, target)) return pending.promise;
  const diskTarget = captureDiskTarget();
  const { workspaceCwd, workspaceNative, workspaceEpoch, companionUrl } = target;
  const scope = { workspaceCwd, workspaceNative, workspaceEpoch, companionUrl };
  const promise = (workspaceNative
    ? workspaceDisk({ action: "results", root: workspaceCwd })
    : companionWorkspaceResults(workspaceCwd, companionUrl || undefined)).then(index => {
    if (sameScope(scope, useIde.getState())) {
      pruneDeletedWorkspaceBuffers(index, before, diskTarget);
      seedWorkspaceResultFiles((index.entries ?? index.results).map(file => file.path), scope);
      const view = useWorkspaceResults.getState();
      const previous = view.index;
      if (!sameScope(view.scope, scope) || !previous || previous.truncated !== index.truncated ||
          previous.outputFolder !== index.outputFolder || !sameEntries(previous.results, index.results) ||
          !sameEntries(previous.entries, index.entries) || previous.directories?.length !== index.directories?.length ||
          index.directories?.some((dir, i) => dir !== previous.directories?.[i])) {
        useWorkspaceResults.setState({ scope, index });
      }
    }
    return index;
  }).finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { scope, promise };
  return promise;
}

export function startWorkspaceResultMonitor() {
  const refresh = () => { void refreshWorkspaceResults().catch(() => undefined); };
  const stop = useIde.subscribe((state, prev) => { if (!sameScope(prev, state)) refresh(); });
  window.addEventListener("focus", refresh);
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, 4000);
  refresh();
  return () => {
    stop();
    clearInterval(timer);
    window.removeEventListener("focus", refresh);
  };
}
