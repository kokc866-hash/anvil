#!/usr/bin/env node
/** Copy Nitro `.output` to `ui-build` so electron-builder packs a non-dot folder. */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, ".output");
const dest = join(root, "ui-build");
const entry = join(src, "server", "index.mjs");

if (!existsSync(entry)) {
  console.error("UI-Build fehlt. Zuerst: ANVIL_ELECTRON_BUILD=1 npm run build");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
const monaco = join(dest, "public", "monaco", "vs", "loader.js");
if (!existsSync(monaco)) {
  console.error("Monaco fehlt im UI-Build:", monaco);
  process.exit(1);
}
console.log("ui-build bereit");
