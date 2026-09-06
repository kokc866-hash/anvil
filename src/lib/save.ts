import { formatCode } from "./format";
import { hasLocation, saveSlot, diskWorkspaceHandle } from "./disk";
import { emitPlugin } from "./plugins/events";
import { captureDiskTarget, scheduleSyncWrite, flushDiskSync } from "./disk-sync";
import { flushSecrets } from "./secrets";
import { flushPersistence } from "./persist-storage";
import { useIde } from "@/store/ide";

type SaveRequest = { all?: boolean; path?: string; format?: boolean };
let saving: Promise<unknown> = Promise.resolve();
export function saveNow(request: SaveRequest = {}): Promise<boolean> {
  const target = captureDiskTarget();
  const path = request.path ?? useIde.getState().activePath;
  const job = saving.catch(() => undefined).then(() => saveCurrent(request, path, target));
  saving = job;
  return job;
}

async function saveCurrent(request: SaveRequest, path: string | null, target: ReturnType<typeof captureDiskTarget>): Promise<boolean> {
  const sameTarget = () => {
    const s = useIde.getState();
    return s.workspaceEpoch === target.epoch && s.workspaceCwd === target.cwd && s.companionUrl === target.base && diskWorkspaceHandle() === target.handle;
  };
  if (!sameTarget()) return false;
  let note = "Gespeichert";
  try {
    const initial = useIde.getState();
    const paths = request.all ? Object.keys(initial.dirty).filter((p) => initial.dirty[p] && p in initial.files) : path && path in initial.files ? [path] : [];
    if (paths.some((p) => initial.pendingDiffs.some((d) => d.path === p && d.source !== "round"))) {
      initial.setNotice("Änderungsvorschläge zuerst übernehmen oder zurücknehmen."); return false;
    }
    if (initial.formatOnSave && request.format !== false) for (const p of paths) {
      const before = useIde.getState().files[p];
      try {
        const next = await formatCode(p, before);
        if (!sameTarget()) return false;
        if (useIde.getState().files[p] === before && next !== before) useIde.getState().setContent(p, next);
      } catch { note = "Format fehlgeschlagen — ursprünglichen Text gespeichert"; }
    }
    if (!sameTarget()) return false;
    const st = useIde.getState(), files = st.files;
    emitPlugin("save", path ?? "");
    for (const p of paths) if (p in files) scheduleSyncWrite(p, files[p], target);
    await flushDiskSync();
    await Promise.all([flushPersistence(), flushSecrets()]);
    if (hasLocation("backup")) await saveSlot("backup", files, st.dirs);
    if (!sameTarget()) return false;
    useIde.getState().setNotice(note);
    return !paths.some((p) => Boolean(useIde.getState().dirty[p]));
  } catch (error) {
    useIde.getState().setNotice(error instanceof Error ? error.message : "Speichern fehlgeschlagen");
    return false;
  }
}

/** Used by both the tab button and keyboard command. */
export async function closeTabs(paths: string[]): Promise<void> {
  const before = useIde.getState();
  const dirty = paths.filter((p) => before.dirty[p]);
  if (dirty.length) {
    const { saveChoice } = await import("./confirm");
    const choice = await saveChoice(dirty.join("\n"));
    if (choice === "cancel" || before.workspaceEpoch !== useIde.getState().workspaceEpoch) return;
    if (dirty.some((p) => before.files[p] !== useIde.getState().files[p])) { useIde.getState().setNotice("Dateien inzwischen geändert. Schließen erneut wählen."); return; }
    if (choice === "save") { for (const p of dirty) if (!(await saveNow({ path: p }))) return; }
    else for (const p of dirty) await useIde.getState().discardFile(p);
    if (dirty.some((p) => useIde.getState().dirty[p])) return;
  }
  if (before.workspaceEpoch === useIde.getState().workspaceEpoch) for (const p of paths) useIde.getState().closeFile(p);
}

export async function prepareWorkspaceSwitch(): Promise<boolean> {
  const before = useIde.getState();
  const paths = Object.keys(before.dirty).filter((p) => before.dirty[p]);
  if (paths.length) {
    const { saveChoice } = await import("./confirm");
    const choice = await saveChoice(`${paths.length} Datei(en) vor dem Projektwechsel`);
    if (choice === "cancel" || before.workspaceEpoch !== useIde.getState().workspaceEpoch) return false;
    if (paths.some((p) => before.files[p] !== useIde.getState().files[p])) return false;
    if (choice === "save") { if (!(await saveNow({ all: true }))) return false; }
    else for (const p of paths) await useIde.getState().discardFile(p);
    if (Object.values(useIde.getState().dirty).some(Boolean)) return false;
  }
  await flushDiskSync();
  await flushPersistence();
  return before.workspaceEpoch === useIde.getState().workspaceEpoch;
}

export function focusAgent() {
  const st = useIde.getState();
  st.setPanels({ ...st.panels, agent: true });
  window.setTimeout(() => {
    document.getElementById("anvil-chat")?.focus();
  }, 30);
}
