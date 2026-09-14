import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Only numerical diagnostics cross this boundary. Never serialize store state,
// tool arguments, URLs, process command lines, or renderer error messages.
const rendererProbe = `(() => {
  const m = performance.memory;
  const s = window.__anvilIde?.getState();
  return { at: Date.now(), heapUsedBytes: m?.usedJSHeapSize ?? null,
    heapTotalBytes: m?.totalJSHeapSize ?? null, heapLimitBytes: m?.jsHeapSizeLimit ?? null,
    agentBusy: s ? Boolean(s.agentBusy) : null };
})()`;

export function startWatchdog({ app, getWindow, logs, mode = "unknown", intervalMs = 10000, graceSeconds = 120 }) {
  if (process.platform !== "win32" || process.env.ANVIL_WATCHDOG === "0") return null;
  const base = join(logs, "waechter");
  if (existsSync(join(base, "disabled"))) return null;
  const directory = join(base, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const mainFile = join(directory, "main.json");
  const configFile = join(directory, "config.json");
  writeFileSync(configFile, JSON.stringify({ parentPid: process.pid, directory,
    intervalSeconds: Math.max(1, intervalMs / 1000), graceSeconds,
    version: app.getVersion(), mode, electron: process.versions.electron, chrome: process.versions.chrome }));
  const child = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      join(dirname(fileURLToPath(import.meta.url)), "watchdog-launch.ps1"), "-ConfigFile", configFile],
    // The short-lived launcher gives the watcher its own hidden Windows console.
    { windowsHide: true, stdio: "ignore" });
  const event = (name, details = {}) => {
    try { appendFileSync(join(directory, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), event: name, ...details }) + "\n"); } catch { /* diagnostics must not stop Anvil */ }
  };
  child.on("error", e => event("watchdog-launch-failed", { code: e.code || "spawn-failed" }));
  child.on("exit", code => { if (code !== 0) event("watchdog-launch-failed", { code }); });
  child.unref();
  let probing = null, renderer = null, writing = false, stopped = false;
  const sample = async () => {
    if (stopped || writing) return;
    writing = true;
    try {
      const wc = getWindow()?.webContents;
      if (wc && !wc.isDestroyed() && !wc.isCrashed() && probing !== wc) {
        probing = wc;
        // Never accumulate requests when a renderer's event loop is hung.
        void wc.executeJavaScript(rendererProbe).then(value => { if (!stopped) renderer = value; }, () => {})
          .finally(() => { if (probing === wc) probing = null; });
      }
      const processes = app.getAppMetrics().map(p => ({ pid: p.pid, type: p.type,
        cpuPercent: p.cpu?.percentCPUUsage, workingSetKB: p.memory?.workingSetSize,
        privateKB: p.memory?.privateBytes, peakWorkingSetKB: p.memory?.peakWorkingSetSize }));
      const value = { at: Date.now(), parentPid: process.pid, renderer,
        rendererPid: wc && !wc.isDestroyed() ? wc.getOSProcessId() : null,
        rendererCrashed: wc && !wc.isDestroyed() ? wc.isCrashed() : null, processes };
      await writeFile(mainFile + ".tmp", JSON.stringify(value));
      await rename(mainFile + ".tmp", mainFile);
    } catch { /* the independent watcher records stale or missing telemetry */ }
    finally { writing = false; }
  };
  void sample();
  const timer = setInterval(() => void sample(), intervalMs); timer.unref();
  const gone = (_e, d) => event("child-process-gone", { type: d.type, reason: d.reason, exitCode: d.exitCode });
  app.on("child-process-gone", gone);
  app.once("will-quit", () => { stopped = true; clearInterval(timer); event("app-will-quit"); app.removeListener("child-process-gone", gone); });
  event("watchdog-launch-requested", { launcherPid: child.pid });
  return { directory, event };
}
