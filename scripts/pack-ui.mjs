#!/usr/bin/env node
/** Copy Nitro `.output` to `ui-build` so electron-builder packs a non-dot folder. */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, ".output");
const dest = join(root, "ui-build");
const entry = join(src, "server", "index.mjs");
const WIRE_MARK = "x-anvil-target";

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

function hasMark(dir, mark) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const name of readdirSync(d)) {
      const f = join(d, name);
      const st = statSync(f);
      if (st.isDirectory()) {
        stack.push(f);
        continue;
      }
      if (!/\.(mjs|js|cjs)$/i.test(name)) continue;
      if (readFileSync(f, "utf8").includes(mark)) return true;
    }
  }
  return false;
}

if (!hasMark(dest, WIRE_MARK)) {
  console.error("UI-Build ohne Pipe-Wire (x-anvil-target). Bundle unvollständig — Release abbrechen.");
  process.exit(1);
}
console.log("ui-build bereit");
