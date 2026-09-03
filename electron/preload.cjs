const { contextBridge, ipcRenderer } = require("electron");

function sync(ch, fallback) {
  try {
    const v = ipcRenderer.sendSync(ch);
    if (v && typeof v === "object" && v.error) return fallback;
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

const pipe = sync("llm-pipe-sync", null);
const helperPort = Number(sync("helper-port-sync", 7847)) || 7847;
const companionToken = String(sync("companion-token-sync", "") || "");

contextBridge.exposeInMainWorld("anvilCompanionToken", companionToken);
contextBridge.exposeInMainWorld("anvilNative", {
  helperDir: () => ipcRenderer.invoke("helper-dir"),
  helperPort: () => Promise.resolve(helperPort),
  helperList: () => ipcRenderer.invoke("helper-list"),
  helperHas: (id) => ipcRenderer.invoke("helper-has", id),
  helperDelete: (id) => ipcRenderer.invoke("helper-delete", id),
  helperDownload: (job) => ipcRenderer.invoke("helper-download", job),
  helperJson: (url) => ipcRenderer.invoke("helper-json", url),
  llmPipe: () => (pipe && pipe.port ? Promise.resolve(pipe) : ipcRenderer.invoke("llm-pipe-info")),
  companionToken: () => Promise.resolve(companionToken),
  onHelperProgress: (fn) => {
    const wrap = (_e, p) => fn(p);
    ipcRenderer.on("helper-progress", wrap);
    return () => ipcRenderer.removeListener("helper-progress", wrap);
  },
  openChild: (path, opts) => ipcRenderer.invoke("child-open", path, opts),
  focusChild: (path) => ipcRenderer.invoke("child-focus", path),
  closeChild: (path) => ipcRenderer.invoke("child-close", path),
  childAlive: (path) => ipcRenderer.invoke("child-alive", path),
  pathsGet: () => ipcRenderer.invoke("paths-get"),
  pathsPick: (kind) => ipcRenderer.invoke("paths-pick", kind),
  pathsWrite: (name, text) => ipcRenderer.invoke("paths-write", name, text),
  pathsRead: (name) => ipcRenderer.invoke("paths-read", name),
  workspacePick: () => ipcRenderer.invoke("workspace-pick"),
  subLoad: (kind) => ipcRenderer.invoke("sub-load", kind),
  subLogin: (kind) => ipcRenderer.invoke("sub-login", kind),
  subScan: () => ipcRenderer.invoke("sub-scan"),
  clipboardRead: () => ipcRenderer.invoke("clipboard-read"),
  companionEnsure: () => ipcRenderer.invoke("companion-ensure"),
  companionRelease: (keep) => ipcRenderer.invoke("companion-release", keep),
});
