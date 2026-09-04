/** Where Anvil stores downloads: compilers + language servers. Default ~/.anvil */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { homeOk } from "./guard.mjs";

const POINTER = process.env.ANVIL_HOME_FILE || path.join(os.homedir(), ".anvil", "home.txt");
const FALLBACK = path.join(os.homedir(), ".anvil");

function clean(raw) {
  const t = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!t) return "";
  const resolved = path.resolve(t);
  if (resolved.length < 2) return "";
  return resolved;
}

function readPointer() {
  const fromEnv = clean(process.env.ANVIL_HOME);
  if (fromEnv) return fromEnv;
  try {
    const t = clean(readFileSync(POINTER, "utf8"));
    if (t) return t;
  } catch {
    /* */
  }
  return FALLBACK;
}

let home = readPointer();

export function anvilHome() {
  return home;
}

export function toolHome() {
  const override = clean(process.env.ANVIL_TOOLCHAIN_HOME);
  if (override) return override;
  return path.join(home, "toolchains");
}

export function lspHome() {
  const override = clean(process.env.ANVIL_LSP_HOME);
  if (override) return override;
  return path.join(home, "lsp");
}

export function snapshot() {
  return { home: anvilHome(), toolchains: toolHome(), lsp: lspHome() };
}

export function setAnvilHome(raw) {
  const next = clean(raw);
  if (!next) throw new Error("Pfad fehlt");
  if (!homeOk(next)) throw new Error("Home nur unter dem Benutzerordner oder Temp.");
  mkdirSync(path.join(next, "toolchains"), { recursive: true });
  mkdirSync(path.join(next, "lsp"), { recursive: true });
  mkdirSync(path.dirname(POINTER), { recursive: true });
  writeFileSync(POINTER, next, { encoding: "utf8" });
  home = next;
  return snapshot();
}

export function ensureHomes() {
  mkdirSync(toolHome(), { recursive: true });
  mkdirSync(lspHome(), { recursive: true });
  return snapshot();
}
