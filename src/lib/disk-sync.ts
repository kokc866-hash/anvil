import { companionDeleteFile, companionMkdir, companionWriteFile } from "./companion";
import { mkdirDisk, removeDiskPath, writeDiskFile } from "./disk";
import { useIde } from "@/store/ide";

const queued = new Map<string, string>();
let timer = 0;
let noticeAt = 0;

function noteFail(path: string) {
  const n = Date.now();
  if (n - noticeAt < 4000) return;
  noticeAt = n;
  try {
    useIde.getState().setNotice(`Nicht auf Platte: ${path}`);
  } catch {
    /* */
  }
}

export async function syncWrite(path: string, content: string): Promise<void> {
  queued.delete(path);
  if (/^data:image\//i.test(content.trim())) return;
  const cwd = useIde.getState().workspaceCwd;
  const jobs: Promise<unknown>[] = [writeDiskFile(path, content)];
  let companionOk = true;
  if (cwd) {
    jobs.push(
      companionWriteFile(path, content, cwd).then((ok) => {
        companionOk = ok;
      }),
    );
  }
  await Promise.all(jobs);
  if (cwd && !companionOk) noteFail(path);
}

export async function syncRemove(path: string): Promise<void> {
  queued.delete(path);
  const cwd = useIde.getState().workspaceCwd;
  await Promise.all([
    removeDiskPath(path),
    cwd ? companionDeleteFile(path, cwd).then(() => undefined) : Promise.resolve(),
  ]);
}

export async function syncMkdir(path: string): Promise<void> {
  const cwd = useIde.getState().workspaceCwd;
  await Promise.all([
    mkdirDisk(path),
    cwd ? companionMkdir(path, cwd).then(() => undefined) : Promise.resolve(),
  ]);
}

export function scheduleSyncWrite(path: string, content: string): void {
  queued.set(path, content);
  if (typeof window === "undefined") return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = 0;
    void flushDiskSync();
  }, 800);
}

export async function flushDiskSync(): Promise<void> {
  if (typeof window !== "undefined") window.clearTimeout(timer);
  timer = 0;
  const batch = [...queued.entries()];
  queued.clear();
  for (const [path, content] of batch) await syncWrite(path, content);
}
