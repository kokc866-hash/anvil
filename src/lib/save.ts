import { formatCode } from "./format";
import { hasLocation, saveSlot, diskWorkspaceHandle } from "./disk";
import { emitPlugin } from "./plugins/events";
import { captureDiskTarget, scheduleSyncWrite, flushDiskSync, syncMkdir } from "./disk-sync";
import { flushSecrets } from "./secrets";
import { flushPersistence } from "./persist-storage";
import { useIde } from "@/store/ide";

let saving: Promise<void> | null = null;

export function saveNow(): Promise<void> {
  if (saving) return saving;
  saving = saveCurrent().finally(() => {
    saving = null;
  });
  return saving;
}

async function saveCurrent() {
  const initial = useIde.getState();
  const target = captureDiskTarget();
  const path = initial.activePath;
  let note = "Gespeichert";
  try {
    if (path && initial.formatOnSave && initial.files[path] != null) {
      try {
        const next = await formatCode(path, initial.files[path]);
        const current = useIde.getState();
        if (
          current.workspaceCwd !== target.cwd ||
          current.companionUrl !== target.base ||
          diskWorkspaceHandle() !== target.handle
        )
          return;
        // Never replace edits made while the formatter was running.
        if (next !== initial.files[path] && current.files[path] === initial.files[path])
          current.setContent(path, next);
      } catch {
        note = "Format fehlgeschlagen — ungeformt gespeichert";
      }
    }
    const st = useIde.getState();
    if (
      st.workspaceCwd !== target.cwd ||
      st.companionUrl !== target.base ||
      diskWorkspaceHandle() !== target.handle
    )
      return;
    const files = st.files;
    const fullSave = Boolean(target.handle) || st.autoSaveDisk || st.storageMode === "disk";
    if (fullSave && !target.cwd && !target.handle)
      throw new Error("Kein Workspace-Ordner gewählt.");
    const dirty = Object.keys(st.dirty).filter((p) => p in files);
    const paths = fullSave ? Object.keys(files) : dirty.length ? dirty : path ? [path] : [];
    emitPlugin("save", path ?? "");
    const directories = fullSave ? st.dirs.map((dir) => syncMkdir(dir, target)) : [];
    for (const p of paths) if (p in files) scheduleSyncWrite(p, files[p], target);
    const results = await Promise.allSettled([
      ...directories,
      flushDiskSync(),
      flushPersistence(),
      flushSecrets(),
    ]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    if (hasLocation("backup")) await saveSlot("backup", files, st.dirs);
    const current = useIde.getState();
    if (
      current.workspaceCwd === target.cwd &&
      current.companionUrl === target.base &&
      diskWorkspaceHandle() === target.handle
    ) {
      const remaining = { ...current.dirty };
      for (const p of paths) if (current.files[p] === files[p]) delete remaining[p];
      useIde.setState({ dirty: remaining });
    }
    st.setNotice(note);
  } catch (error) {
    useIde
      .getState()
      .setNotice(error instanceof Error ? error.message : "Speichern fehlgeschlagen");
  }
}

export function focusAgent() {
  const st = useIde.getState();
  st.setPanels({ ...st.panels, agent: true });
  window.setTimeout(() => {
    document.getElementById("anvil-chat")?.focus();
  }, 30);
}
