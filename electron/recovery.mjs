import { BrowserWindow, dialog } from "electron";
import { handleOnce } from "./ipc.mjs";
import { saveRecovery } from "./recovery-files.mjs";

export function bindRecoveryIpc(allowUrl) {
  handleOnce("workspace-recovery", async (event, snapshot) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !allowUrl(event.senderFrame.url)) throw new Error("Projektsicherung nicht erlaubt.");
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = { title: "Ordner für die Projektsicherung wählen", properties: ["openDirectory", "createDirectory"] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { path: await saveRecovery(result.filePaths[0], snapshot) };
  });
}
