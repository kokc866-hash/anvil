import { app } from "electron";
import path from "node:path";
import { handleOnce } from "./ipc.mjs";
import { createProjectCheckpoint, previewProjectCheckpoint, restoreProjectCheckpoint, readProjectCheckpointFiles } from "./project-checkpoints.mjs";

export function bindProjectCheckpointIpc(allowUrl) {
  const busy = new Set();
  handleOnce("project-checkpoint", async (event, request) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !allowUrl(event.senderFrame.url)) throw new Error("Projektsicherung nur im Anvil-Hauptfenster verfügbar.");
    if (!request || !["before", "after", "preview", "restore", "read"].includes(request.action) || typeof request.root !== "string" || !path.isAbsolute(request.root)) throw new Error("Ungültige Projektsicherung.");
    const key = path.resolve(request.root).toLowerCase();
    if (busy.has(key)) throw new Error("Eine Projektsicherung oder Rücknahme läuft bereits.");
    busy.add(key);
    try {
      const data = app.getPath("userData");
      const args = { root: request.root, storageRoot: path.join(data, "project-checkpoints"), id: request.id, excludedRoots: [data] };
      if (request.action === "read") return await readProjectCheckpointFiles({ ...args, paths: request.paths, source: request.source });
      if (request.action === "preview") return await previewProjectCheckpoint(args);
      if (request.action === "restore") return await restoreProjectCheckpoint(args);
      return await createProjectCheckpoint({ ...args, phase: request.action });
    } finally { busy.delete(key); }
  });
}
