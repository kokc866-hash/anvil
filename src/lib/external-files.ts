import { useIde } from "@/store/ide";
import { captureDiskTarget, noteDiskFile } from "./disk-sync";
import { readDiskFiles } from "./disk";
import { companionReadFiles } from "./companion";
let reading = false;
/** Refresh on focus or explicit request; dirty buffers are offered as a conflict diff. */
export async function refreshExternalFiles(): Promise<void> {
  const before = useIde.getState(), target = captureDiskTarget();
  if (reading || before.agentBusy || before.running || (!target.cwd && !target.handle)) return;
  const paths = [...new Set([...before.openPaths, ...Object.keys(before.dirty).filter((p) => before.dirty[p])])];
  if (!paths.length) return;
  reading = true;
  try {
    const disk = target.cwd ? await companionReadFiles(paths, target.cwd, target.base || undefined) : await readDiskFiles(paths, target.handle);
    const cur = useIde.getState();
    if (cur.workspaceEpoch !== before.workspaceEpoch || captureDiskTarget().handle !== target.handle) return;
    const files = { ...cur.files }, dirty = { ...cur.dirty }, bases = { ...cur.editBases }, diffs = [...cur.pendingDiffs];
    let changed = false, conflicts = 0;
    for (const [path, value] of Object.entries(disk)) {
      if (cur.files[path] !== before.files[path] || cur.pendingDiffs.some((d) => d.path === path)) continue;
      // A save completed during this read; a subsequent focus can refresh that revision.
      if (before.dirty[path] && !cur.dirty[path]) continue;
      if (value === cur.files[path]) { noteDiskFile(path, value, target); continue; }
      if (cur.dirty[path]) {
        if (path in bases && value === bases[path]) continue;
        diffs.push({ path, before: value ?? "", after: cur.files[path], existedBefore: value !== null, dirtyBefore: false, backupVersion: 2, source: "external" });
        conflicts++;
      } else {
        if (value === null) delete files[path]; else files[path] = value;
        delete dirty[path]; delete bases[path];
      }
      noteDiskFile(path, value, target); changed = true;
    }
    if (changed) useIde.setState({ files, dirty, editBases: bases, pendingDiffs: diffs,
      openPaths: cur.openPaths.filter((p) => p in files), activePath: cur.activePath && cur.activePath in files ? cur.activePath : cur.openPaths.find((p) => p in files) ?? null });
    if (conflicts) cur.setNotice(`${conflicts} externe Änderung(en): Übernehmen behält den Editorstand; Zurücknehmen lädt den Plattenstand.`);
  } catch (error) { useIde.getState().setNotice(error instanceof Error ? error.message : "Dateien konnten nicht aktualisiert werden."); }
  finally { reading = false; }
}
