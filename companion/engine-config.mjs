import path from "node:path";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { toolHome } from "./paths.mjs";

const SETTINGS = { godot: "ANVIL_GODOT_BIN", unity: "ANVIL_UNITY_BIN", unreal: "ANVIL_UNREAL_BIN" };
const configFile = () => path.join(toolHome(), "engine-paths.json");

export function readEngineConfig(file = configFile()) {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return Object.fromEntries(Object.keys(SETTINGS).map((key) => [key, typeof saved[key] === "string" ? saved[key] : ""]));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Die gespeicherten Engine-Pfade können nicht gelesen werden. engine-paths.json prüfen.");
    return { godot: "", unity: "", unreal: "" };
  }
}

export function saveEngineConfig(patch, file = configFile()) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Engine-Pfade fehlen.");
  const next = readEngineConfig(file);
  for (const [key, raw] of Object.entries(patch)) {
    if (!Object.hasOwn(SETTINGS, key) || typeof raw !== "string") throw new Error("Ungültige Engine-Pfadeinstellung.");
    const value = raw.trim().replace(/^"|"$/g, "");
    if (!value) { next[key] = ""; continue; }
    if (!path.isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error(`${key}: Vollständigen Programmpfad angeben.`);
    let valid = false;
    try { valid = statSync(value).isFile(); } catch { /* Report the setting with the failed path. */ }
    if (!valid || (process.platform === "win32" && !/\.exe$/i.test(value))) throw new Error(`${key}: Die ausführbare Datei wurde nicht gefunden (unter Windows eine .exe wählen).`);
    if (key === "unity" && process.platform === "win32" && path.basename(path.dirname(value)).toLowerCase() !== "editor") {
      throw new Error("Unity: Unity.exe im Editor-Ordner wählen. Unity Hub und die Unity CLI können kein Projekt als Editor öffnen.");
    }
    next[key] = path.resolve(value);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
  renameSync(temporary, file);
  return next;
}

export function engineEnvironment(env = process.env, configured = readEngineConfig()) {
  const next = { ...env };
  for (const [key, setting] of Object.entries(SETTINGS)) {
    if (!String(next[setting] || "").trim() && configured[key]) next[setting] = configured[key];
  }
  return next;
}
