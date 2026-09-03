import { companionTree, companionWorkspace } from "./companion";
import { holdCompanion, releaseCompanion } from "./companion-life";
import { nativeHelper } from "./helper-local";
import { useIde } from "@/store/ide";

export function canOpenOsWorkspace(): boolean {
  return Boolean(nativeHelper()?.workspacePick);
}

export async function openOsWorkspace(dir?: string): Promise<{
  ok: boolean;
  cwd?: string;
  n?: number;
  skipped?: number;
  error?: string;
}> {
  const native = nativeHelper();
  const picked = dir || (await native?.workspacePick?.());
  if (!picked) return { ok: false, error: "Kein Ordner" };
  await holdCompanion();
  try {
    const w = await companionWorkspace(picked);
    if (!w.ok) return { ok: false, error: w.error || "Ordner nicht gesetzt" };
    const cwd = w.cwd || picked;
    const tree = await companionTree(cwd);
    const ide = useIde.getState();
    ide.setWorkspaceCwd(cwd);
    if (tree.ok && tree.files) {
      ide.applyFiles(tree.files, tree.dirs);
      const name = cwd.replace(/\\/g, "/").split("/").pop() || cwd;
      ide.setDiskName(name);
      const first = Object.keys(tree.files).sort()[0];
      if (first) ide.openFile(first);
    } else if (tree.error) {
      return { ok: false, cwd, error: tree.error };
    }
    return { ok: true, cwd, n: tree.n, skipped: tree.skipped };
  } finally {
    if (!useIde.getState().companionKeep) await releaseCompanion();
  }
}
