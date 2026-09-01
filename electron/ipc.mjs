import { ipcMain } from "electron";

export function handleOnce(ch, fn) {
  try {
    ipcMain.removeHandler(ch);
  } catch {
    /* */
  }
  ipcMain.handle(ch, fn);
}

export function onSync(ch, fn) {
  ipcMain.removeAllListeners(ch);
  ipcMain.on(ch, (e, ...args) => {
    try {
      e.returnValue = fn(e, ...args);
    } catch (err) {
      e.returnValue = { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
