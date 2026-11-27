import { companionMkdir, companionTree, companionWorkspace, companionWriteFile } from "./companion";
import { holdCompanion, releaseCompanion } from "./companion-life";
import { nativeHelper } from "./helper-local";
import { workspaceDisk } from "./native-workspace";
import { checkEmptyLocalWorkspace } from "./workspace-empty";
import { seedWorkspaceResultFiles } from "./workspace-results";
import { useIde } from "@/store/ide";
import {foregroundAgentRunning} from './background-agent';

export function canOpenOsWorkspace(): boolean {
  return Boolean(nativeHelper()?.workspacePick);
}

/** ZIP/Clone: Dateien in den gewählten Ordner schreiben. */
export async function writeTreeToDisk(files: Record<string, string>, cwd: string): Promise<number> {
  const project = useIde.getState();
  const local = project.workspaceNative && project.workspaceCwd === cwd;
  const base = project.companionUrl || undefined;
  const dirs = new Set<string>();
  for (const p of Object.keys(files)) {
    const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  for (const d of [...dirs].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    if (local) await workspaceDisk({ action: "mkdir", root: cwd, path: d });
    else await companionMkdir(d, cwd, base);
  }
  let n = 0;
  for (const [p, c] of Object.entries(files)) {
    if (local) {
      await workspaceDisk({ action: "write", root: cwd, path: p, content: c });
      n += 1;
    } else if (await companionWriteFile(p, c, cwd, base)) n += 1;
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
  const epoch=useIde.getState().workspaceEpoch,base=useIde.getState().companionUrl||undefined;
  const native = nativeHelper();
  const local = !dir && Boolean(native?.workspaceDisk);
  let opening:{from:string;to:string}|null=null;
  const blocked=()=>foregroundAgentRunning()||Boolean(useIde.getState().pathOperation&&useIde.getState().pathOperation!==opening)||useIde.getState().workspaceEpoch!==epoch||!local&&(useIde.getState().companionUrl||undefined)!==base;
  if(blocked())return {ok:false,error:'Während eines Vordergrundauftrags oder einer Dateiaktion kann das Projekt nicht gewechselt werden.'};
  const picked = dir || (await native?.workspacePick?.());
  if (!picked) return { ok: false, error: "Kein Ordner" };
  if(blocked())return {ok:false,error:'Projekt oder laufender Auftrag inzwischen geändert.'};
  if (!(await import("./save").then((s) => s.prepareWorkspaceSwitch()))) return { ok: false, error: "Projektwechsel abgebrochen" };
  if(blocked())return {ok:false,error:'Ein Vordergrundauftrag wurde gestartet. Projektwechsel abgebrochen.'};
  const initial = useIde.getState();
  opening={from:'',to:picked};useIde.setState({pathOperation:opening});
  let held=false;
  let openedLocal = false;
  try {
    let cwd = picked;
    if (!local) {
      // Connect without reopening the previous folder, which may have moved or disappeared.
      held = await holdCompanion("", base);
      if(blocked())return {ok:false,error:'Projekt oder laufender Auftrag inzwischen geändert.'};
      const w = await companionWorkspace(picked,base);
      if (!w.ok) return { ok: false, error: w.error || "Ordner nicht gesetzt" };
      cwd = w.cwd || picked;
    }
    const tree = local ? await workspaceDisk({ action: "tree", root: cwd }) : await companionTree(cwd,base);
    if (tree.ok && "cwd" in tree) cwd = tree.cwd;
    const ide = useIde.getState();
    if (blocked()||initial.workspaceEpoch !== ide.workspaceEpoch || initial.files !== ide.files) {
      if (!local && !ide.workspaceNative && ide.workspaceCwd) await companionWorkspace(ide.workspaceCwd,base);
      return { ok: false, error: "Projekt inzwischen geändert; Ordner erneut öffnen." };
    }
    if (tree.ok && tree.files) {
      await import("./disk").then((d) => d.clearLocation("workspace"));
      if(blocked()){if(!local&&!initial.workspaceNative&&initial.workspaceCwd)await companionWorkspace(initial.workspaceCwd,base);return {ok:false,error:'Ein Vordergrundauftrag wurde gestartet. Projektwechsel abgebrochen.'};}
      ide.setWorkspaceCwd(cwd, local);
      ide.applyFiles(tree.files, tree.dirs);
      seedWorkspaceResultFiles(Object.keys(tree.files));
      const name = cwd.replace(/\\/g, "/").split("/").pop() || cwd;
      ide.setDiskName(name);
      const first = Object.keys(tree.files).sort()[0];
      if (first) ide.openFile(first);
      openedLocal = local;
    } else {
      if (!local && !initial.workspaceNative && initial.workspaceCwd) await companionWorkspace(initial.workspaceCwd,base);
      return { ok: false, error: ("error" in tree && tree.error) || "Ordner konnte nicht gelesen werden" };
    }
    return { ok: true, cwd, n: tree.n, skipped: tree.skipped };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Ordner konnte nicht gelesen werden" };
  } finally {
    if(useIde.getState().pathOperation===opening)useIde.setState({pathOperation:null});
    if (held) await releaseCompanion().catch(() => undefined);
    if (openedLocal) await checkEmptyLocalWorkspace();
  }
}
