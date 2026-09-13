import { useIde, type Checkpoint } from "@/store/ide";
import { captureDiskTarget, flushDiskSync, noteDiskFile, cancelSyncWrite } from "./disk-sync";
import { checkpointRestorePlan } from "./restore-plan";
import { flushPersistence } from "./persist-storage";
import { omitSecrets } from "./ref";

export type ProjectCheckpointPlan = { files: { path: string; action: "restore" | "delete"; bytes: number }[]; mkdir: string[]; rmdir: string[]; conflicts: string[]; excluded: string[] };
type Capture = { files: number; bytes: number; excluded: string[] };
type Native = { projectCheckpoint: (request: { action: "before" | "after" | "preview" | "restore" | "read"; root: string; id: string; paths?: string[]; source?: "before" }) => Promise<unknown> };
const native = () => typeof window === "undefined" ? undefined : (window as unknown as { anvilNative?: Native }).anvilNative;
let roundLease: { id: string; done: Promise<void>; release: () => void } | undefined;
function update(id: string, patch: Partial<NonNullable<Checkpoint["disk"]>>) {
  useIde.setState((s) => ({ checkpoints: s.checkpoints.map((c) => c.id === id && c.disk ? { ...c, disk: { ...c.disk, ...patch } } : c) }));
}
function sameProject(disk: NonNullable<Checkpoint["disk"]>) {
  const s = useIde.getState();
  return s.workspaceCwd === disk.root && s.workspaceEpoch === disk.epoch;
}
function localProject() {
  const target = captureDiskTarget();
  if (!target.cwd || target.handle || !native()?.projectCheckpoint) return false;
  try { const u = new URL(target.base || "http://127.0.0.1:7845"); return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && u.port === "7845"; }
  catch { return false; }
}

export function projectEditorRestorePlan(ck: Checkpoint, files = useIde.getState().files, dirs = useIde.getState().dirs) {
  const ignored = (p: string) => ck.disk?.excluded?.some((x) => p.toLowerCase() === x.toLowerCase() || p.toLowerCase().startsWith(x.toLowerCase() + "/"));
  const keep = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).filter(([p]) => !ignored(p)));
  return checkpointRestorePlan({ ...ck, files: keep(ck.files), dirs: ck.dirs.filter((p) => !ignored(p)), endFiles: ck.endFiles ? keep(ck.endFiles) : undefined, endDirs: ck.endDirs?.filter((p) => !ignored(p)) }, keep(files), dirs.filter((p) => !ignored(p)));
}

/** Save existing edits before the agent can change either loaded files or assets on disk. */
export async function beginProjectCheckpoint(id: string): Promise<void> {
  if (!localProject()) return;
  while (roundLease && roundLease.id !== id) await roundLease.done;
  let release!: () => void;
  const done = new Promise<void>((resolve) => { release = resolve; });
  roundLease = { id, done, release };
  const initial = useIde.getState();
  const disk: NonNullable<Checkpoint["disk"]> = { id: crypto.randomUUID(), root: initial.workspaceCwd, epoch: initial.workspaceEpoch, status: "capturing" };
  useIde.setState((s) => ({ checkpoints: s.checkpoints.map((c) => c.id === id ? { ...c, disk } : c) }));
  try {
    const { saveNow } = await import("./save");
    if (!await saveNow({ all: true, format: false })) throw new Error(useIde.getState().notice || "Projekt vor der Runde nicht vollständig gespeichert.");
    if (!sameProject(disk)) throw new Error("Projekt während der Sicherung gewechselt.");
    const saved = useIde.getState();
    const result = await native()!.projectCheckpoint({ action: "before", root: disk.root, id: disk.id }) as Capture;
    if (!sameProject(disk)) throw new Error("Projekt während der Sicherung gewechselt.");
    if (saved.files !== useIde.getState().files) throw new Error("Dateien während der Sicherung im Editor geändert. Auftrag erneut senden.");
    useIde.setState((s) => ({ checkpoints: s.checkpoints.map((c) => c.id === id ? { ...c, files: omitSecrets(saved.files), dirs: [...saved.dirs] } : c) }));
    update(id, { status: "before", files: result.files, bytes: result.bytes, excluded: result.excluded });
    await flushPersistence();
  } catch (error) {
    update(id, { status: "error", error: String(error) });
    if (roundLease?.id === id) { roundLease.release(); roundLease = undefined; }
    throw new Error(`Projektsicherung fehlgeschlagen; Auftrag wurde nicht gestartet. ${error instanceof Error ? error.message : error}`);
  }
}

/** Seal only the original project's completed round; a missing end state never authorizes reversal. */
export async function sealProjectCheckpoint(id: string): Promise<void> {
  const ck = useIde.getState().checkpoints.find((c) => c.id === id);
  const disk = ck?.disk;
  if (ck) useIde.setState((s) => ({ checkpoints: s.checkpoints.map((c) => c.id === id ? { ...c, externalCalls: s.mcpLog.filter((e) => e.at >= ck.at).map(({ server, name, ok }) => ({ server, name, ok })) } : c) }));
  if (!disk || disk.status !== "before") {
    if (roundLease?.id === id) { roundLease.release(); roundLease = undefined; }
    return;
  }
  try {
    if (!sameProject(disk)) throw new Error("Projekt gewechselt; kein sicherer Endstand der Runde.");
    await flushDiskSync();
    if (!sameProject(disk)) throw new Error("Projekt gewechselt; kein sicherer Endstand der Runde.");
    const end = useIde.getState();
    const result = await native()!.projectCheckpoint({ action: "after", root: disk.root, id: disk.id }) as Capture;
    if (!sameProject(disk) || end.files !== useIde.getState().files) throw new Error("Projekt während der abschließenden Sicherung geändert; Endstand nicht eindeutig.");
    useIde.setState((s) => ({ checkpoints: s.checkpoints.map((c) => c.id === id ? { ...c, endFiles: omitSecrets(end.files), endDirs: [...end.dirs] } : c) }));
    update(id, { status: "sealed", excluded: [...new Set([...(disk.excluded ?? []), ...result.excluded])] });
  } catch (error) {
    update(id, { status: "error", error: String(error) });
    useIde.getState().setNotice(`Projektsicherung unvollständig: ${error instanceof Error ? error.message : error}`);
  }
  try { await flushPersistence(); }
  catch (error) {
    update(id, { status: "error", error: `Sicherungsstatus nicht gespeichert: ${String(error)}` });
    useIde.getState().setNotice("Sicherungsstatus konnte nicht gespeichert werden. Die Runde ist beendet; Rücknahme ist noch nicht freigegeben.");
  }
  finally { if (roundLease?.id === id) { roundLease.release(); roundLease = undefined; } }
}

export async function previewProjectRestore(id: string): Promise<ProjectCheckpointPlan | null> {
  const ck = useIde.getState().checkpoints.find((c) => c.id === id);
  if (!ck?.disk) return null;
  if (ck.disk.status !== "sealed") throw new Error(ck.disk.error || "Der vollständige Endstand dieser Runde fehlt. Keine Dateirücknahme ausgeführt.");
  if (useIde.getState().workspaceCwd !== ck.disk.root || !localProject()) throw new Error("Diese Sicherung gehört zu einem anderen lokalen Projekt.");
  return await native()!.projectCheckpoint({ action: "preview", root: ck.disk.root, id: ck.disk.id }) as ProjectCheckpointPlan;
}

export async function restoreProjectRound(id: string): Promise<boolean> {
  const initial = useIde.getState(), ck = initial.checkpoints.find((c) => c.id === id);
  if (!ck?.disk) return false;
  if (initial.agentBusy || initial.running || initial.pathOperation) { initial.setNotice("Laufende Arbeit zuerst abschließen lassen."); return false; }
  const editor = projectEditorRestorePlan(ck, initial.files, initial.dirs);
  if (editor.conflicts.length) { initial.setNotice(editor.conflicts.join("; ")); return false; }
  useIde.setState({ pathOperation: { from: "", to: "" } });
  try {
    if (ck.projectRestore) for (const p of Object.keys(initial.dirty)) cancelSyncWrite(p);
    await flushDiskSync();
    const diskPlan = await previewProjectRestore(id);
    if (!diskPlan) throw new Error("Projektsicherung fehlt.");
    if (diskPlan.conflicts.length) throw new Error(diskPlan.conflicts.join("; "));
    if (useIde.getState().workspaceEpoch !== initial.workspaceEpoch) throw new Error("Projekt gewechselt. Keine Rücknahme ausgeführt.");
    const pending = ck.projectRestore ?? { paths: diskPlan.files.map((f) => f.path), touched: [...new Set([...diskPlan.files.map((f) => f.path), ...editor.files.map((f) => f.path)])], mkdir: [...new Set([...diskPlan.mkdir, ...editor.mkdir])], rmdir: [...new Set([...diskPlan.rmdir, ...editor.rmdir])] };
    const touched = new Set(pending.touched);
    for (const p of touched) if (useIde.getState().files[p] !== initial.files[p]) throw new Error(`Inzwischen im Editor geändert: ${p}`);
    // Dirty assets loaded after the round are newer work too, even if they were not in its text snapshot.
    for (const p of diskPlan.files.map((f) => f.path)) if (initial.dirty[p] && !editor.files.some((f) => f.path === p)) throw new Error(`Ungespeicherte spätere Änderung: ${p}`);
    const reload = pending.touched.filter((p) => p in initial.files || p in ck.files);
    const restoredFiles = reload.length ? await native()!.projectCheckpoint({ action: "read", source: "before", root: ck.disk.root, id: ck.disk.id, paths: reload }) as Record<string, string | null> : {};
    for (const p of reload) if (!(p in restoredFiles)) throw new Error(`Gesicherter Dateiinhalt fehlt: ${p}`);
    useIde.setState((s) => ({ checkpoints: s.checkpoints.map((c) => c.id === id ? { ...c, projectRestore: pending } : c) }));
    await flushPersistence();
    const result = await native()!.projectCheckpoint({ action: "restore", root: ck.disk.root, id: ck.disk.id }) as ProjectCheckpointPlan;
    if (result.conflicts?.length) throw new Error(result.conflicts.join("; "));
    if (useIde.getState().workspaceEpoch !== initial.workspaceEpoch) throw new Error("Projekt gewechselt. Gesicherte Rücknahme beim nächsten Öffnen abgleichen.");
    const cur = useIde.getState(), files = { ...cur.files }, dirty = { ...cur.dirty }, editBases = { ...cur.editBases };
    for (const p of touched) {
      const value = p in restoredFiles ? restoredFiles[p] : ck.files[p] ?? null;
      if (value !== null) files[p] = value; else delete files[p];
      delete dirty[p]; delete editBases[p];
      if (p in restoredFiles) noteDiskFile(p, restoredFiles[p]);
    }
    const removed = new Set(pending.rmdir);
    const openPaths = cur.openPaths.filter((p) => p in files);
    useIde.setState({ files, dirty, editBases, openPaths,
      activePath: cur.activePath && cur.activePath in files ? cur.activePath : openPaths[0] ?? null,
      dirs: [...new Set([...cur.dirs.filter((p) => !removed.has(p)), ...pending.mkdir])],
      pendingDiffs: cur.pendingDiffs.filter((d) => !touched.has(d.path)),
      checkpoints: cur.checkpoints.map((c) => c.id === id ? { ...c, projectRestore: undefined } : c),
    });
    await flushPersistence();
    cur.setNotice("Projektdateien und Assets dieser Runde zurückgenommen. Externe Dienstaktionen bleiben bestehen.");
    return true;
  } catch (error) { useIde.getState().setNotice(error instanceof Error ? error.message : String(error)); return false; }
  finally { useIde.setState({ pathOperation: null }); }
}
