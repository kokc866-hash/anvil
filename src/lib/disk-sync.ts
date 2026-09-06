import { companionDeleteFile, companionMoveFile, companionMkdir, companionWriteChecked } from "./companion";
import { diskWorkspaceHandle, moveDiskPath, mkdirDisk, removeDiskPath, writeDiskFile } from "./disk";
import { withCompanion } from "./companion-life";
import { WriteQueue } from "./write-queue";
import { useIde } from "@/store/ide";

export type DiskTarget = { cwd: string; handle: FileSystemDirectoryHandle | null; base: string; epoch?: number };
const handles = new WeakMap<FileSystemDirectoryHandle, number>();
let handleId = 0;
let noticeAt = 0;

export function captureDiskTarget(): DiskTarget {
  const state = useIde.getState();
  return { cwd: state.workspaceCwd, handle: diskWorkspaceHandle(), base: state.companionUrl, epoch: state.workspaceEpoch };
}

function targetKey(target: DiskTarget): string {
  if (target.handle && !handles.has(target.handle)) handles.set(target.handle, ++handleId);
  return (
    JSON.stringify([target.base, target.cwd, target.handle ? handles.get(target.handle) : 0]) + "\t"
  );
}

function noteFail(path: string) {
  if (Date.now() - noticeAt < 4000) return;
  noticeAt = Date.now();
  useIde.getState().setNotice(`Nicht vollständig gespeichert: ${path}`);
}

const queue = new WriteQueue(() => noteFail("Arbeitsbereich"));

const knownDisk = new Map<string, string | null>();
export function noteDiskFile(path: string, content: string | null, target = captureDiskTarget()) { knownDisk.set(targetKey(target) + path, content); }
export function noteDiskContents(files: Record<string, string>, target = captureDiskTarget()) {
  const prefix = targetKey(target);
  for (const key of knownDisk.keys()) if (key.startsWith(prefix)) knownDisk.delete(key);
  for (const [path, content] of Object.entries(files)) knownDisk.set(prefix + path, content);
}
async function write(path: string, content: string, target: DiskTarget, baseContent?: string | null) {
  const key = targetKey(target) + path;
  const expected = knownDisk.has(key) ? knownDisk.get(key) : baseContent;
  if (/^data:image\//i.test(content.trim())) return;
  try {
    const jobs: Promise<unknown>[] = [writeDiskFile(path, content, target.handle, expected)];
    if (target.cwd)
      jobs.push(
        withCompanion(
          () => companionWriteChecked(path, content, target.cwd, target.base || undefined, expected),
          target.base,
        ),
      );
    // Settle both destinations before a subsequent write can start.
    const results = await Promise.allSettled(jobs);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    knownDisk.set(key, content);
    const s = useIde.getState();
    if (s.workspaceEpoch === target.epoch && s.workspaceCwd === target.cwd && diskWorkspaceHandle() === target.handle && !s.pendingDiffs.some((d) => d.path === path)) {
      const dirty = { ...s.dirty }, editBases = { ...s.editBases };
      if (s.files[path] === content) { delete dirty[path]; delete editBases[path]; }
      else if (path in s.files) editBases[path] = content;
      useIde.setState({ dirty, editBases });
    }
  } catch (error) {
    noteFail(path);
    if (error instanceof Error && /extern geändert/.test(error.message)) useIde.getState().setNotice(error.message);
    throw error;
  }
}

const writeVersions = new Map<string, number>();
export function cancelSyncWrite(path: string, target = captureDiskTarget()) {
  const key = targetKey(target) + path;
  writeVersions.set(key, (writeVersions.get(key) ?? 0) + 1);
  queue.cancel((p) => p === key);
}

export async function syncMove(from: string, to: string, target = captureDiskTarget(), moved?: () => void): Promise<void> {
  await queue.flush();
  await queue.run(async () => {
    // A workspace has one authoritative destination. Dual destinations require explicit migration.
    if (target.cwd && target.handle) throw new Error("Zwei Workspace-Ziele aktiv. Ordner erneut öffnen.");
    if (target.cwd) await withCompanion(() => companionMoveFile(from, to, target.cwd, target.base || undefined), target.base);
    else if (target.handle) await moveDiskPath(from, to, target.handle);
    const prefix = targetKey(target);
    for (const [key, content] of [...knownDisk]) if (key === prefix + from || key.startsWith(prefix + from + "/")) {
      knownDisk.delete(key); knownDisk.set(prefix + to + key.slice(prefix.length + from.length), content);
    }
    moved?.();
  });
}

export function scheduleSyncWrite(
  path: string,
  content: string,
  target = captureDiskTarget(),
): void {
  const key = targetKey(target) + path;
  const version = (writeVersions.get(key) ?? 0) + 1;
  writeVersions.set(key, version);
  const before = useIde.getState().editBases[path];
  queue.schedule(key, async () => { if (writeVersions.get(key) === version) await write(path, content, target, before); });
}

export function syncWrite(
  path: string,
  content: string,
  target = captureDiskTarget(),
): Promise<void> {
  scheduleSyncWrite(path, content, target);
  return queue.flush();
}

export function syncRemove(path: string, target = captureDiskTarget()): Promise<void> {
  const key = targetKey(target) + path;
  queue.cancel((pending) => pending === key || pending.startsWith(key + "/"));
  void queue.flush().catch(() => undefined);
  return queue.run(async () => {
    const results = await Promise.allSettled([
      removeDiskPath(path, target.handle),
      target.cwd
        ? withCompanion(
            () => companionDeleteFile(path, target.cwd, target.base || undefined),
            target.base,
          ).then((ok) => {
            if (!ok) throw new Error(`Nicht gelöscht: ${path}`);
          })
        : Promise.resolve(),
    ]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") {
      noteFail(path);
      throw failed.reason;
    }
    const prefix = targetKey(target) + path;
    for (const key of knownDisk.keys()) if (key === prefix || key.startsWith(prefix + "/")) knownDisk.delete(key);
  });
}

export function syncMkdir(path: string, target = captureDiskTarget()): Promise<void> {
  void queue.flush().catch(() => undefined);
  return queue.run(async () => {
    const results = await Promise.allSettled([
      mkdirDisk(path, target.handle),
      target.cwd
        ? withCompanion(
            () => companionMkdir(path, target.cwd, target.base || undefined),
            target.base,
          ).then((ok) => {
            if (!ok) throw new Error(`Ordner nicht angelegt: ${path}`);
          })
        : Promise.resolve(),
    ]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") {
      noteFail(path);
      throw failed.reason;
    }
  });
}

export function flushDiskSync(): Promise<void> {
  return queue.flush();
}
