import { useIde } from "@/store/ide";
import { captureDiskTarget, flushDiskSync, syncRestore, type DiskTarget } from "../disk-sync";
import { flushPersistence } from "../persist-storage";
import { ancestorDirs } from "../fs";
import { dropTestPaths } from "../test-parse";
import { normalizePluginPath } from "../agent-plugin-package";

export type ImportTarget = Readonly<{ epoch: number; target: Readonly<DiskTarget>; files: Readonly<Record<string, string>>;
  dirs: readonly string[]; fileRevision: Record<string, string>; dirRevision: string[] }>;

/** Capture before file reads, network, decompression or dialogs. Never recapture after an await. */
export function captureImportTarget(): ImportTarget {
  const state = useIde.getState();
  if (state.agentBusy || state.pathOperation) throw new Error("Das Projekt wird gerade bearbeitet. Import danach erneut starten.");
  return Object.freeze({ epoch: state.workspaceEpoch, target: Object.freeze(captureDiskTarget()),
    files: Object.freeze({ ...state.files }), dirs: Object.freeze([...state.dirs]), fileRevision: state.files, dirRevision: state.dirs });
}

export function assertImportTarget(snapshot: ImportTarget, lock?: { from: string; to: string }): void {
  const state = useIde.getState(), now = captureDiskTarget();
  if (state.workspaceEpoch !== snapshot.epoch || now.cwd !== snapshot.target.cwd || now.base !== snapshot.target.base
    || now.handle !== snapshot.target.handle || state.files !== snapshot.fileRevision || state.dirs !== snapshot.dirRevision
    || Object.keys(state.files).length !== Object.keys(snapshot.files).length || Object.keys(snapshot.files).some(path => state.files[path] !== snapshot.files[path])
    || state.dirs.length !== snapshot.dirs.length || snapshot.dirs.some((dir, index) => state.dirs[index] !== dir)
    || state.agentBusy || (state.pathOperation && state.pathOperation !== lock)) {
    throw new Error("Projekt oder Dateien wurden inzwischen geändert oder werden bearbeitet. Import erneut starten.");
  }
}

function checkedChanges(changes: Record<string, string | null>, snapshot: ImportTarget, replace: boolean): Record<string, string | null> {
  const clean = Object.create(null) as Record<string, string | null>;
  const existingFiles = new Map(Object.keys(snapshot.files).map(path => [path.toLowerCase(), path]));
  const existingDirs = new Set(snapshot.dirs.flatMap(path => [path, ...ancestorDirs(path)]).map(path => path.toLowerCase()));
  const seen = new Set<string>();
  for (const [raw, content] of Object.entries(changes)) {
    const path = normalizePluginPath(raw), key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`Doppelter Importpfad: ${path}`);
    if ((!replace && existingFiles.has(key)) || existingDirs.has(key)
      || (existingFiles.has(key) && existingFiles.get(key) !== path)) throw new Error(`Bereits vorhanden, nicht überschrieben: ${path}`);
    if (content !== null && ancestorDirs(path).some(parent => existingFiles.has(parent.toLowerCase()))) throw new Error(`Eine Datei blockiert den Importordner: ${path}`);
    if (content !== null && Object.keys(snapshot.files).some(other => other.toLowerCase().startsWith(key + "/"))) throw new Error(`Ein Ordner blockiert die Importdatei: ${path}`);
    seen.add(key);
    clean[path] = content;
  }
  for (const path of seen) if (ancestorDirs(path).some(parent => seen.has(parent))) throw new Error("Ein Importpfad ist zugleich Datei und Ordner.");
  return clean;
}

async function commitChanges(snapshot: ImportTarget, changes: Record<string, string | null>, replace: boolean): Promise<number> {
  assertImportTarget(snapshot);
  const checked = checkedChanges(changes, snapshot, replace), paths = Object.keys(checked);
  if (!paths.length) return 0;
  const lock = { from: "", to: "" };
  useIde.setState({ pathOperation: lock });
  try {
    await flushDiskSync();
    assertImportTarget(snapshot, lock);
    // New imports explicitly expect absence on disk too: do not reuse a stale knownDisk base.
    await syncRestore({ files: paths.map(path => ({ path, before: snapshot.files[path] ?? null,
      expected: replace ? snapshot.files[path] ?? null : null, after: checked[path] })), mkdir: [], rmdir: [] }, snapshot.target);
    assertImportTarget(snapshot, lock);
    const removed = new Set(paths.filter(path => checked[path] === null));
    useIde.setState(state => {
      const files = { ...state.files }, dirty = { ...state.dirty }, editBases = { ...state.editBases };
      for (const path of paths) {
        const content = checked[path];
        if (content === null) { delete files[path]; delete editBases[path]; }
        else { files[path] = content; editBases[path] = content; }
        delete dirty[path];
      }
      const openPaths = state.openPaths.filter(path => !removed.has(path));
      return { files, dirty, editBases, openPaths,
        dirs: [...new Set([...state.dirs, ...paths.filter(path => checked[path] !== null).flatMap(ancestorDirs)])],
        activePath: state.activePath && removed.has(state.activePath) ? openPaths.at(-1) ?? null : state.activePath,
        undo: Object.fromEntries(Object.entries(state.undo).filter(([path]) => !removed.has(path))),
        breakpoints: Object.fromEntries(Object.entries(state.breakpoints).filter(([path]) => !removed.has(path))),
        attached: state.attached.filter(path => !removed.has(path)), recentPaths: state.recentPaths.filter(path => !removed.has(path)),
        pendingDiffs: state.pendingDiffs.filter(diff => !paths.includes(diff.path)),
        testResults: dropTestPaths(state.testResults, path => removed.has(path)),
      };
    });
    await flushPersistence();
    const now = captureDiskTarget();
    if (useIde.getState().workspaceEpoch !== snapshot.epoch || now.cwd !== snapshot.target.cwd || now.base !== snapshot.target.base || now.handle !== snapshot.target.handle) {
      throw new Error("Import im vorherigen Projekt gespeichert. Das aktuelle Projekt wurde nicht geändert.");
    }
    return paths.length;
  } finally {
    if (useIde.getState().pathOperation === lock) useIde.setState({ pathOperation: null });
  }
}

/** Add-only by default; disk transaction must succeed before editor state or success. */
export function commitImportedFiles(snapshot: ImportTarget, files: Record<string, string>): Promise<number> {
  return commitChanges(snapshot, files, false);
}

/** Dragged patches intentionally replace/delete files, but still require the captured version. */
export function commitImportedPatch(snapshot: ImportTarget, write: Record<string, string>, del: string[]): Promise<number> {
  return commitChanges(snapshot, Object.fromEntries([...del.map(path => [path, null] as const), ...Object.entries(write)]), true);
}
