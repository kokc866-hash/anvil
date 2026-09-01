import { app, dialog } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleOnce } from "./ipc.mjs";

export const PATH_KINDS = ["data", "helper", "logs"];

function pointer() {
  return join(app.getPath("userData"), "anvil-paths.json");
}

function defaults() {
  const user = app.getPath("userData");
  return {
    data: user,
    helper: join(user, "helper-models"),
    logs: user,
  };
}

export function loadPaths() {
  const def = defaults();
  try {
    const j = JSON.parse(readFileSync(pointer(), "utf8"));
    return {
      data: String(j.data || def.data),
      helper: String(j.helper || def.helper),
      logs: String(j.logs || def.logs),
    };
  } catch {
    return def;
  }
}

export function savePaths(next) {
  const cur = { ...loadPaths(), ...next };
  mkdirSync(cur.data, { recursive: true });
  mkdirSync(cur.helper, { recursive: true });
  mkdirSync(cur.logs, { recursive: true });
  writeFileSync(pointer(), JSON.stringify(cur, null, 2), "utf8");
  return cur;
}

export function helperDir() {
  const p = loadPaths().helper;
  mkdirSync(p, { recursive: true });
  return p;
}

export function logFile() {
  return join(loadPaths().logs, "anvil-desktop.log");
}

export function bindPathsIpc() {
  handleOnce("paths-get", () => loadPaths());
  handleOnce("paths-pick", async (_e, kind) => {
    const k = PATH_KINDS.includes(kind) ? kind : "data";
    const titles = { data: "Anvil-Daten", helper: "Helfer-Modelle", logs: "Logs" };
    const r = await dialog.showOpenDialog({
      title: titles[k] || "Ordner",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return loadPaths();
    const cur = loadPaths();
    const next = { ...cur, [k]: r.filePaths[0] };
    if (k === "data" && cur.helper === join(cur.data, "helper-models")) {
      next.helper = join(next.data, "helper-models");
    }
    return savePaths(next);
  });
  handleOnce("paths-write", (_e, name, text) => {
    const file = String(name || "").replace(/[^a-zA-Z0-9._-]/g, "");
    if (!file) throw new Error("Dateiname fehlt");
    const p = join(loadPaths().data, file);
    writeFileSync(p, String(text ?? ""), "utf8");
    return p;
  });
  handleOnce("paths-read", (_e, name) => {
    const file = String(name || "").replace(/[^a-zA-Z0-9._-]/g, "");
    const p = join(loadPaths().data, file);
    if (!existsSync(p)) return null;
    return readFileSync(p, "utf8");
  });
}
