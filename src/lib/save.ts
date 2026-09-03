import { formatCode } from "./format";
import { hasLocation, saveSlot } from "./disk";
import { companionWriteFile } from "./companion";
import { emitPlugin } from "./plugins/events";
import { useIde } from "@/store/ide";

let last = 0;

export async function saveNow() {
  const now = Date.now();
  if (now - last < 400) return;
  last = now;
  const st = useIde.getState();
  const path = st.activePath;
  let files = { ...st.files };
  if (path && st.formatOnSave && files[path] != null) {
    const next = await formatCode(path, files[path]);
    st.setContent(path, next);
    files = { ...st.files, [path]: next };
  }
  emitPlugin("save", path ?? "");
  const cwd = st.workspaceCwd;
  if (cwd) {
    const dirty = Object.keys(st.dirty).filter((p) => p in files);
    const paths = dirty.length ? dirty : path ? [path] : [];
    await Promise.all(paths.map((p) => companionWriteFile(p, files[p] ?? "", cwd)));
  }
  if (hasLocation("workspace") || st.autoSaveDisk || st.storageMode === "disk") {
    try {
      await saveSlot("workspace", files, st.dirs);
      if (hasLocation("backup")) await saveSlot("backup", files, st.dirs);
      st.setNotice("Gespeichert");
    } catch (err) {
      st.setNotice(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
    return;
  }
  st.setNotice("Gespeichert");
}

export function focusAgent() {
  const st = useIde.getState();
  st.setPanels({ ...st.panels, agent: true });
  window.setTimeout(() => {
    document.getElementById("anvil-chat")?.focus();
  }, 30);
}
