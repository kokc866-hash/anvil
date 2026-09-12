import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Keep the desktop profile beside Anvil, including Chromium's own storage. */
export function dataHome({ root, execPath, isPackaged, defaultApp, env = {} }) {
  const override = String(env.ANVIL_QA_USER_DATA || env.ANVIL_USER_DATA || "").trim();
  if (override) {
    if (!isAbsolute(override)) throw new Error("ANVIL_USER_DATA muss ein absoluter Ordnerpfad sein.");
    return resolve(override);
  }
  return join(isPackaged && !defaultApp ? dirname(execPath) : root, "data");
}

export function configureDataHome(app, options) {
  const data = dataHome(options);
  // Do this before ready, session creation, or the first GPU cache access.
  // A write failure must not silently send data back to the system drive.
  mkdirSync(data, { recursive: true });
  app.setPath("userData", data);
  app.setPath("sessionData", data);
  const crashes = join(data, "Crashpad");
  mkdirSync(crashes, { recursive: true });
  app.setPath("crashDumps", crashes);
  app.setAppLogsPath(join(data, "logs"));
  return data;
}
