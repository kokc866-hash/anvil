import { app, BrowserWindow, clipboard, dialog, session, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { bindHelperIpc, startHelperHost } from "./helper-host.mjs";
import { startLlmPipe } from "./llm-pipe.mjs";
import { bindPathsIpc, logFile, loadPaths } from "./paths.mjs";
import { bindHwIpc } from "./hw.mjs";
import { bindSubIpc } from "./sub.mjs";
import { bindUpdateIpc } from "./update.mjs";
import { bindChildWindows } from "./child.mjs";
import { iconPath, loadAppIcon } from "./icon.mjs";
import { handleOnce, onSync } from "./ipc.mjs";
import { isAbortNoise } from "../scripts/llm-agent.mjs";
import { nodeCommand, withNodeEnv } from "./node-cmd.mjs";
import { serverLaunch } from "./ui-boot.mjs";
import { ANVIL_PARTITION, allowAnvilPerm, anvilWebPrefs } from "./session.mjs";
import { sweepAnvilTemp } from "../companion/tmp.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.ANVIL_PORT || 8080);
const URL = `http://127.0.0.1:${PORT}/`;
function appTitle() {
  try {
    const v = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
    return v ? `Anvil ${v}` : "Anvil";
  } catch {
    return "Anvil";
  }
}

app.commandLine.appendSwitch(
  "disable-features",
  "LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults,CalculateNativeWinOcclusion",
);
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("gpu-preference", "2");
try {
  const gpuDir = join(app.getPath("userData"), "gpu-cache");
  mkdirSync(gpuDir, { recursive: true });
  app.commandLine.appendSwitch("disk-cache-dir", gpuDir);
} catch {
  /* first run */
}
app.commandLine.appendSwitch("gpu-program-cache-size-kb", "65536");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096");

try {
  sweepAnvilTemp({ keep: 0, maxAgeMs: 0, toolchain: true });
} catch {
  /* */
}

function hushMain(err) {
  return isAbortNoise(err);
}

process.on("uncaughtException", (err) => {
  if (hushMain(err)) return;
  console.error(err);
});
process.on("unhandledRejection", (err) => {
  if (hushMain(err)) return;
  console.error(err);
});

let server = null;
let companion = null;
let companionOwned = false;
let companionRefs = 0;
let companionIdle = 0;
let bootFail = "";

function companionPort() {
  const n = Number(process.env.ANVIL_COMPANION_PORT || 7845);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.round(n) : 7845;
}
let win = null;
let splash = null;
let helperSrv = null;
let pipeSrv = null;

function showSplash() {
  splash = new BrowserWindow({
    width: 420,
    height: 240,
    frame: false,
    resizable: false,
    backgroundColor: "#0a0a0b",
    show: true,
    alwaysOnTop: true,
    icon: iconPath(ROOT) || undefined,
  });
  let mark = "";
  try {
    const png = join(ROOT, "public", "icon-256.png");
    const src = existsSync(png) ? png : join(ROOT, "public", "icon.png");
    if (existsSync(src)) {
      const b64 = readFileSync(src).toString("base64");
      mark = `<img src="data:image/png;base64,${b64}" width="72" height="72" alt="" style="display:block;object-fit:contain;border:0"/>`;
    }
  } catch {
    /* */
  }
  splash.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<!doctype html><html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0a0b;color:#e8e8ea;font:15px/1.4 system-ui,sans-serif">
        ${mark}
        <div style="margin-top:14px;letter-spacing:.18em;text-transform:uppercase;font-size:12px;opacity:.55">Anvil</div>
        <div style="margin-top:10px">Startet…</div>
        <div style="margin-top:8px;font-size:12px;opacity:.45">Erstes Mal kann etwas dauern</div>
        </body></html>`,
      ),
  );
}

function hideSplash() {
  try {
    splash?.close();
  } catch {
    /* ignore */
  }
  splash = null;
}

function sameApp(url) {
  if (!url || url.startsWith("data:") || url === "about:blank") return true;
  try {
    const u = new URL(url);
    return u.hostname === "127.0.0.1" && Number(u.port || 80) === PORT;
  } catch {
    return false;
  }
}

function hardenContents(wc) {
  try {
    wc.setBackgroundThrottling(false);
  } catch {
    /* */
  }
  wc.on("will-navigate", (e, url) => {
    if (!sameApp(url)) e.preventDefault();
  });
  wc.on("will-redirect", (e, url) => {
    if (!sameApp(url)) e.preventDefault();
  });
}

function stopLocals() {
  try {
    helperSrv?.close();
  } catch {
    /* */
  }
  try {
    pipeSrv?.close();
  } catch {
    /* */
  }
  helperSrv = null;
  pipeSrv = null;
}

function spawnNode() {
  return nodeCommand({ isPackaged: app.isPackaged, execPath: process.execPath });
}

function nodeEnv(electronAsNode = false) {
  const env = { ...process.env };
  try {
    const p = loadPaths().packages;
    if (p) env.ANVIL_HOME = p;
  } catch {
    /* */
  }
  return withNodeEnv(env, electronAsNode);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
}

function waitForServer(ms = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (bootFail) return reject(new Error(bootFail));
      if (await portOpen(PORT)) return resolve();
      if (Date.now() - start > ms) {
        return reject(new Error(bootFail || "Server startet nicht (Port " + PORT + ")."));
      }
      setTimeout(tick, 250);
    };
    void tick();
  });
}

function startChild(args, extraEnv = {}) {
  const cmd = spawnNode();
  const logPath = logFile();
  let stdio = "ignore";
  try {
    const fd = openSync(logPath, "a");
    stdio = ["ignore", fd, fd];
  } catch {
    stdio = "ignore";
  }
  bootFail = "";
  const child = spawn(cmd.file, args, {
    cwd: ROOT,
    windowsHide: true,
    stdio,
    env: { ...nodeEnv(cmd.electronAsNode), ...extraEnv },
  });
  child.on("error", (err) => {
    bootFail = err?.message || String(err);
  });
  child.on("exit", (code, signal) => {
    if (code && !bootFail) bootFail = `Server beendet (${code}${signal ? "/" + signal : ""}).`;
  });
  child.unref?.();
  return child;
}

function startServer() {
  const plan = serverLaunch(ROOT, app.isPackaged, PORT);
  if (plan.error) {
    bootFail = plan.error;
    throw new Error(plan.error);
  }
  return startChild(plan.args, plan.extraEnv);
}

function startCompanion() {
  const script = join(ROOT, "companion", "server.mjs");
  if (!existsSync(script)) return null;
  return startChild([script]);
}

function stopCompanion() {
  if (!companionOwned) {
    companion = null;
    return;
  }
  if (!companion || companion.killed) {
    companion = null;
    companionOwned = false;
    return;
  }
  if (process.platform === "win32" && companion.pid) {
    spawn("taskkill", ["/pid", String(companion.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    companion.kill("SIGTERM");
  }
  companion = null;
  companionOwned = false;
}

function readCompanionToken() {
  try {
    return readFileSync(join(os.homedir(), ".anvil-companion-token"), "utf8").trim();
  } catch {
    return "";
  }
}

function waitPort(port, ms = 8000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await portOpen(port)) return resolve(true);
      if (Date.now() - start > ms) return resolve(false);
      setTimeout(tick, 200);
    };
    void tick();
  });
}

async function ensureCompanion() {
  companionRefs += 1;
  if (companionIdle) {
    clearTimeout(companionIdle);
    companionIdle = 0;
  }
  if (await portOpen(companionPort())) {
    return { ok: true, token: readCompanionToken(), owned: companionOwned };
  }
  companion = startCompanion();
  companionOwned = Boolean(companion);
  if (!companion) return { ok: false, token: "", owned: false };
  const crashed = new Promise((resolve) => {
    companion.once("exit", () => resolve(true));
    companion.once("error", () => resolve(true));
  });
  const ready = waitPort(companionPort(), 10000).then((ok) => !ok);
  const dead = await Promise.race([crashed, ready]);
  if (dead && !(await portOpen(companionPort()))) {
    companion = null;
    companionOwned = false;
    return { ok: false, token: readCompanionToken(), owned: false };
  }
  return { ok: true, token: readCompanionToken(), owned: companionOwned };
}

function releaseCompanion(keep) {
  companionRefs = Math.max(0, companionRefs - 1);
  if (keep || companionRefs > 0 || !companionOwned) return { ok: true, running: Boolean(companion) };
  if (companionIdle) clearTimeout(companionIdle);
  companionIdle = setTimeout(() => {
    companionIdle = 0;
    if (companionRefs === 0) stopCompanion();
  }, 1200);
  return { ok: true, running: true };
}

function stopServer() {
  if (!server || server.killed) return;
  if (process.platform === "win32" && server.pid) {
    spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
  server = null;
}

async function createWindow() {
  app.setName("Anvil");
  const icon = loadAppIcon(ROOT);
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: appTitle(),
    icon: icon || iconPath(ROOT) || undefined,
    backgroundColor: "#0a0a0b",
    autoHideMenuBar: true,
    show: false,
    webPreferences: anvilWebPrefs(join(ROOT, "electron", "preload.cjs")),
  });
  win.setMenuBarVisibility(false);
  if (icon) {
    try {
      win.setIcon(icon);
    } catch {
      /* */
    }
  }
  try {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  } catch {
    /* */
  }
  hardenContents(win.webContents);
  win.webContents.on("context-menu", (e) => {
    e.preventDefault();
  });
  try {
    win.webContents.setBackgroundThrottling(false);
  } catch {
    /* older electron */
  }
  const kids = bindChildWindows({
    root: ROOT,
    port: PORT,
    preload: join(ROOT, "electron", "preload.cjs"),
    icon: icon || iconPath(ROOT) || undefined,
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (kids.intercept(url)) return { action: "deny" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => {
    win = null;
  });
  win.once("ready-to-show", () => {
    hideSplash();
    win.show();
    win.focus();
  });
  await win.loadURL(URL);
  if (!win.isVisible()) {
    hideSplash();
    win.show();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("app.anvil.ide");
    }
    try {
      const ic = loadAppIcon(ROOT);
      if (ic && process.platform === "darwin" && app.dock) app.dock.setIcon(ic);
    } catch {
      /* */
    }
    const allowNet = (_wc, perm, cb) => {
      cb(allowAnvilPerm(perm));
    };
    session.defaultSession.setPermissionRequestHandler(allowNet);
    try {
      session.fromPartition(ANVIL_PARTITION).setPermissionRequestHandler(allowNet);
    } catch {
      /* */
    }
    app.on("web-contents-created", (_e, wc) => {
      let locked = false;
      wc.on("did-navigate", (_ev, url) => {
        if (locked || !sameApp(url)) return;
        locked = true;
        hardenContents(wc);
      });
    });
    helperSrv = await startHelperHost();
    pipeSrv = await startLlmPipe();
    bindPathsIpc();
    bindHwIpc();
    bindSubIpc();
    bindUpdateIpc();
    onSync("companion-token-sync", () => readCompanionToken());
    handleOnce("companion-token", () => readCompanionToken());
    handleOnce("companion-ensure", () => ensureCompanion());
    handleOnce("companion-release", (_e, keep) => releaseCompanion(Boolean(keep)));
    handleOnce("clipboard-read", () => {
      const text = clipboard.readText() || "";
      let image = "";
      try {
        const img = clipboard.readImage();
        if (img && !img.isEmpty()) image = img.toDataURL();
      } catch {
        /* */
      }
      return { text, image };
    });
    bindHelperIpc((p) => win?.webContents.send("helper-progress", p));
    showSplash();
    const up = await portOpen(PORT);
    if (!up) {
      server = startServer();
      await waitForServer(app.isPackaged ? 180000 : 60000);
    }
    await createWindow();
  }).catch((err) => {
    hideSplash();
    const msg = err instanceof Error ? err.message : String(err);
    const hint = app.isPackaged
      ? "Log: anvil-desktop.log (unter AppData\\Roaming\\Anvil\\logs)."
      : "stop.bat, dann start.bat. Log: anvil-desktop.log";
    dialog.showErrorBox("Anvil", msg + "\n\n" + hint);
    stopCompanion();
    stopServer();
    stopLocals();
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  stopCompanion();
  stopServer();
  stopLocals();
  app.quit();
});

app.on("before-quit", () => {
  stopCompanion();
  stopServer();
  stopLocals();
});
