import { companionDeleteFile, companionMkdir, companionWriteFile } from "./companion";
import { mkdirDisk, removeDiskPath, writeDiskFile } from "./disk";
import { useIde } from "@/store/ide";

export async function syncWrite(path: string, content: string): Promise<void> {
  const cwd = useIde.getState().workspaceCwd;
  await Promise.all([
    writeDiskFile(path, content),
    cwd ? companionWriteFile(path, content, cwd).then(() => undefined) : Promise.resolve(),
  ]);
}

export async function syncRemove(path: string): Promise<void> {
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
