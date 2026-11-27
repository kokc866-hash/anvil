/** Reload uses a fresh renderer after a crash. Bound the wait for Chromium to finish. */
function reloadRenderer(contents, timeout) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(deadline);
      contents.removeListener('did-finish-load', onLoad);
      contents.removeListener('did-fail-load', onFail);
      contents.removeListener('destroyed', onDestroyed);
      if (error) reject(error);
      else resolve();
    };
    const onLoad = () => finish();
    const onFail = (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) finish(Object.assign(new Error(description), { code: 'renderer-reload-failed' }));
    };
    const onDestroyed = () => finish(Object.assign(new Error('Renderer window was closed'), { code: 'renderer-reload-closed' }));
    const deadline = setTimeout(() => finish(Object.assign(new Error('Renderer reload timed out'), { code: 'renderer-reload-timeout' })), timeout);
    contents.once('did-finish-load', onLoad);
    contents.on('did-fail-load', onFail);
    contents.once('destroyed', onDestroyed);
    try { contents.reload(); } catch (error) { finish(error); }
  });
}

/** Recovery runs in the main process, even when the editor renderer is gone. */
export function bindRendererRecovery({ window, dialog, log, stopJobs, resetClose, close, backgroundActive = () => false, recoveryTimeout = 10000 }) {
  const contents = window.webContents;
  let handling = false;
  const gone = (_event, details) => {
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    log("renderer-gone", { reason: details.reason, exitCode: details.exitCode });
    if (handling) return;
    handling = true;
    resetClose();
    const stopped = Promise.resolve().then(stopJobs);
    void stopped.catch(() => {}); // The dialog may stay open before we await it.
    // Never reload synchronously inside Chromium's process-exit notification.
    setImmediate(async () => {
      try {
        if (window.isDestroyed()) return;
        const memory = details.reason === "oom";
        const answer = await dialog.showMessageBox(window, {
          type: "error", title: "Anvil – Oberfläche unterbrochen",
          message: memory ? "Der Oberfläche ist der Arbeitsspeicher ausgegangen." : "Die Oberfläche wurde unerwartet beendet.",
          detail: backgroundActive()
            ? "Der Hintergrundauftrag läuft weiter. Nach der Wiederherstellung verbindet sich die Oberfläche wieder mit seinem aktuellen Stand. Schließen beendet Anvil und stoppt auch den Hintergrundauftrag.\n\nDer Absturzgrund steht in anvil-desktop.log."
            : "Der Agentenauftrag wurde unterbrochen. Du kannst den zuletzt gespeicherten Stand wieder öffnen. Noch nicht gespeicherte Änderungen können fehlen. Externe Aktionen werden nicht automatisch wiederholt.\n\nDer Absturzgrund steht in anvil-desktop.log.",
          buttons: ["Oberfläche wiederherstellen", "Schließen"], defaultId: 0, cancelId: 1, noLink: true,
        });
        if (window.isDestroyed()) return;
        if (answer.response === 0) {
          let deadline;
          try {
            await Promise.race([stopped, new Promise((_, reject) => {
              deadline = setTimeout(() => reject(Object.assign(new Error("Shutdown timed out"), { code: "shutdown-timeout" })), 10000);
            })]);
          } finally { clearTimeout(deadline); }
          await reloadRenderer(contents, recoveryTimeout); log("renderer-restored", {});
        }
        else close();
      } catch (error) {
        log("renderer-recovery-failed", { code: error?.code || "restore-failed" });
        if (!window.isDestroyed()) {
          dialog.showErrorBox("Anvil", "Die Oberfläche konnte nicht wiederhergestellt werden. Bitte Anvil erneut starten. Details: anvil-desktop.log.");
          close();
        }
      } finally { handling = false; }
    });
  };
  contents.on("render-process-gone", gone);
  window.on("closed", () => contents.removeListener("render-process-gone", gone));
}
