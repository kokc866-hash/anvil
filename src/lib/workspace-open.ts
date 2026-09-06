import { companionMkdir, companionTree, companionWorkspace, companionWriteFile } from "./companion";
import { holdCompanion, releaseCompanion } from "./companion-life";
import { nativeHelper } from "./helper-local";
import { useIde } from "@/store/ide";

export function canOpenOsWorkspace(): boolean {
  return Boolean(nativeHelper()?.workspacePick);
}

/** ZIP/Clone: Dateien in den gewählten Ordner schreiben. */
export async function writeTreeToDisk(files: Record<string, string>, cwd: string): Promise<number> {
  const dirs = new Set<string>();
  for (const p of Object.keys(files)) {
    const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  for (const d of [...dirs].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    await companionMkdir(d, cwd);
  }
  let n = 0;
  for (const [p, c] of Object.entries(files)) {
    if (await companionWriteFile(p, c, cwd)) n += 1;
  }
  return n;
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
  if (!(await import("./save").then((s) => s.prepareWorkspaceSwitch()))) return { ok: false, error: "Projektwechsel abgebrochen" };
  const initial = useIde.getState();
  await holdCompanion();
  try {
    const w = await companionWorkspace(picked);
    if (!w.ok) return { ok: false, error: w.error || "Ordner nicht gesetzt" };
    const cwd = w.cwd || picked;
    const tree = await companionTree(cwd);
    const ide = useIde.getState();
    if (initial.workspaceEpoch !== ide.workspaceEpoch || initial.files !== ide.files) {
      if (ide.workspaceCwd) await companionWorkspace(ide.workspaceCwd);
      return { ok: false, error: "Projekt inzwischen geändert; Ordner erneut öffnen." };
    }
    if (tree.ok && tree.files) {
      const { abortAgent } = await import("./abort");
      abortAgent("Projekt gewechselt");
      await import("./disk").then((d) => d.clearLocation("workspace"));
      ide.setWorkspaceCwd(cwd);
      ide.applyFiles(tree.files, tree.dirs);
      const name = cwd.replace(/\\/g, "/").split("/").pop() || cwd;
      ide.setDiskName(name);
      const first = Object.keys(tree.files).sort()[0];
      if (first) ide.openFile(first);
    } else {
      if (initial.workspaceCwd) await companionWorkspace(initial.workspaceCwd);
      return { ok: false, error: tree.error || "Ordner konnte nicht gelesen werden" };
    }
    return { ok: true, cwd, n: tree.n, skipped: tree.skipped };
  } finally {
    if (!useIde.getState().companionKeep) await releaseCompanion();
  }
}
