import { companionDeleteFile, companionMkdir, companionWriteFile } from "./companion";
import { diskWorkspaceHandle, mkdirDisk, removeDiskPath, writeDiskFile } from "./disk";
import { withCompanion } from "./companion-life";
import { WriteQueue } from "./write-queue";
import { useIde } from "@/store/ide";

export type DiskTarget = { cwd: string; handle: FileSystemDirectoryHandle | null; base: string };
const handles = new WeakMap<FileSystemDirectoryHandle, number>();
let handleId = 0;
let noticeAt = 0;

export function captureDiskTarget(): DiskTarget {
  const state = useIde.getState();
  return { cwd: state.workspaceCwd, handle: diskWorkspaceHandle(), base: state.companionUrl };
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

async function write(path: string, content: string, target: DiskTarget) {
  if (/^data:image\//i.test(content.trim())) return;
  try {
    const jobs: Promise<unknown>[] = [writeDiskFile(path, content, target.handle)];
    if (target.cwd)
      jobs.push(
        withCompanion(
          () => companionWriteFile(path, content, target.cwd, target.base || undefined),
          target.base,
        ).then((ok) => {
          if (!ok) throw new Error(`Nicht auf Platte: ${path}`);
        }),
      );
    // Settle both destinations before a subsequent write can start.
    const results = await Promise.allSettled(jobs);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  } catch (error) {
    noteFail(path);
    throw error;
  }
}

export function scheduleSyncWrite(
  path: string,
  content: string,
  target = captureDiskTarget(),
): void {
  queue.schedule(targetKey(target) + path, () => write(path, content, target));
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
