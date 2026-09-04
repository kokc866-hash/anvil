import { formatCode } from "./format";
import { hasLocation, saveSlot } from "./disk";
import { companionWriteFile } from "./companion";
import { emitPlugin } from "./plugins/events";
import { flushDiskSync } from "./disk-sync";
import { useIde } from "@/store/ide";

let last = 0;

export async function saveNow() {
  const now = Date.now();
  if (now - last < 400) return;
  last = now;
  const st = useIde.getState();
  const path = st.activePath;
  let files = { ...st.files };
  let note = "Gespeichert";
  if (path && st.formatOnSave && files[path] != null) {
    try {
      const next = await formatCode(path, files[path]);
      if (next !== files[path]) {
        st.setContent(path, next);
        files = { ...st.files, [path]: next };
      }
    } catch {
      note = "Format fehlgeschlagen — ungeformt gespeichert";
    }
  }
  emitPlugin("save", path ?? "");
  await flushDiskSync();
  const cwd = st.workspaceCwd;
  const dirty = Object.keys(useIde.getState().dirty).filter((p) => p in files);
  const paths = dirty.length ? dirty : path ? [path] : [];
  if (cwd) {
    await Promise.all(paths.map((p) => companionWriteFile(p, files[p] ?? "", cwd)));
  }
  if (hasLocation("workspace") || st.autoSaveDisk || st.storageMode === "disk") {
    try {
      await saveSlot("workspace", files, st.dirs);
      if (hasLocation("backup")) await saveSlot("backup", files, st.dirs);
      clearDirty(Object.keys(files));
      st.setNotice(note);
    } catch (err) {
      st.setNotice(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
    return;
  }
  if (paths.length) clearDirty(paths);
  st.setNotice(note);
}

function clearDirty(paths: string[]) {
  const dirty = { ...useIde.getState().dirty };
  for (const p of paths) delete dirty[p];
  useIde.setState({ dirty });
}

export function focusAgent() {
  const st = useIde.getState();
  st.setPanels({ ...st.panels, agent: true });
  window.setTimeout(() => {
    document.getElementById("anvil-chat")?.focus();
  }, 30);
}
