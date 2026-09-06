import { BrowserWindow } from "electron";
import { handleOnce } from "./ipc.mjs";
import { anvilWebPrefs } from "./session.mjs";
import { appOrigin } from "./app-origin.mjs";
import { captureRect } from "./canvas-capture.mjs";

const kids = new Map();

export function bindChildWindows({ root, port, preload, icon }) {
  const origin = `http://127.0.0.1:${port}`;
  const allowed = appOrigin(port);
  handleOnce("canvas-capture", async (event, rect) => {
    if (event.senderFrame !== event.sender.mainFrame || !allowed(event.senderFrame?.url || "")) throw new Error("Canvas-Aufnahme ist nur im Anvil-Hauptfenster erlaubt.");
    const bounds = BrowserWindow.fromWebContents(event.sender)?.getContentBounds();
    if (!bounds) throw new Error("Ausgabefenster wurde geschlossen.");
    const area = captureRect(rect, bounds);
    const shot = await event.sender.capturePage(area);
    if (shot.isEmpty()) throw new Error("Ausgabefenster lieferte kein Bild.");
    const size = shot.getSize(), scale = Math.min(1, 1280 / Math.max(size.width, size.height));
    return (scale < 1 ? shot.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }) : shot).toDataURL();
  });

  function createChild(path, opts = {}) {
    const key = path.startsWith("/console") ? "console" : "run";
    const old = kids.get(key);
    if (old && !old.isDestroyed()) {
      old.focus();
      return old.id;
    }
    const child = new BrowserWindow({
      width: Math.max(480, Number(opts.w) || (key === "run" ? 960 : 780)),
      height: Math.max(360, Number(opts.h) || (key === "run" ? 640 : 520)),
      minWidth: 480,
      minHeight: 360,
      title: opts.title || (key === "run" ? "Run" : "Ausgabe"),
      icon: opts.icon || icon,
      backgroundColor: "#0a0a0b",
      autoHideMenuBar: true,
      show: false,
      webPreferences: anvilWebPrefs(preload),
    });
    child.setMenuBarVisibility(false);
    if (icon && typeof child.setIcon === "function") {
      try {
        child.setIcon(icon);
      } catch {
        /* */
      }
    }
    child.once("ready-to-show", () => child.show());
    child.on("closed", () => kids.delete(key));
    try {
      child.webContents.setBackgroundThrottling(false);
    } catch {
      /* */
    }
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    void child.loadURL(`${origin}${path.startsWith("/") ? path : `/${path}`}`);
    kids.set(key, child);
    return child.id;
  }

  handleOnce("child-open", (_e, path, opts) => createChild(String(path || "/run"), opts || {}));
  handleOnce("child-focus", (_e, path) => {
    const key = String(path || "").includes("console") ? "console" : "run";
    const w = kids.get(key);
    if (w && !w.isDestroyed()) {
      w.focus();
      return true;
    }
    return false;
  });
  handleOnce("child-close", (_e, path) => {
    const key = String(path || "").includes("console") ? "console" : "run";
    const w = kids.get(key);
    if (w && !w.isDestroyed()) w.close();
    kids.delete(key);
    return true;
  });
  handleOnce("child-alive", (_e, path) => {
    const key = String(path || "").includes("console") ? "console" : "run";
    const w = kids.get(key);
    return Boolean(w && !w.isDestroyed());
  });

  return {
    createChild,
    intercept(url) {
      try {
        const u = new URL(url);
        if (u.origin !== origin) return false;
        if (u.pathname === "/run" || u.pathname === "/console") {
          createChild(u.pathname);
          return true;
        }
      } catch {
        return false;
      }
      return false;
    },
  };
}
