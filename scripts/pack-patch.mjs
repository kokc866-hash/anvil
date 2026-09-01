#!/usr/bin/env node
/** Schreibt grok.anvil-patch — nur Text. Keine PNG/ICO-Objekte. */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const SKIP_DIR = new Set(["node_modules", "dist", ".git", "screenshots", "artifacts"]);
const TEXT = /\.(ts|tsx|mjs|js|cjs|css|json|md|svg|html|bat|vbs|txt|sql)$/i;
const ROOT_FILES = [
  "package.json",
  "package-lock.json",
  "patch.bat",
  "grok.mjs",
  "grok.bat",
  "start.bat",
  "stop.bat",
  "Anvil.vbs",
  "install.bat",
  "build-win.bat",
  "vite.config.ts",
  "tsconfig.json",
  "eslint.config.mjs",
  "TESTEN.txt",
];
const DIRS = ["src", "companion", "electron", "public", "scripts", "anleitungen", "migrations"];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = {};
for (const r of DIRS) {
  const dir = join(root, r);
  try {
    for (const p of walk(dir)) {
      const rel = relative(root, p).replaceAll("\\", "/");
      if (!TEXT.test(rel)) continue;
      files[rel] = readFileSync(p, "utf8");
    }
  } catch {
    /* ordner fehlt */
  }
}
for (const rel of ROOT_FILES) {
  try {
    files[rel] = readFileSync(join(root, rel), "utf8");
  } catch {
    /* */
  }
}

const note = process.argv[2] || "Anvil — Vollpatch, nur Text.";
const body = JSON.stringify({ v: 1, note, files });
writeFileSync(join(root, "grok.anvil-patch"), body);
mkdirSync(join(root, "patches"), { recursive: true });
writeFileSync(join(root, "patches", "grok.anvil-patch"), body);
console.log("Dateien", Object.keys(files).length, "Bytes", body.length);
