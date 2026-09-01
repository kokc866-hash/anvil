#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, "utf8"));
        if (j.name === "anvil") return dir;
      } catch {
        /* */
      }
    }
    const nested = join(dir, "anvil", "package.json");
    if (existsSync(nested)) return join(dir, "anvil");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function findPatch(here, cwd) {
  const names = ["grok.anvil-patch", "next.anvil-patch"];
  const dirs = [here, cwd, join(here, "patches"), join(cwd, "patches"), dirname(here)];
  for (const d of dirs) {
    for (const n of names) {
      const p = join(d, n);
      if (existsSync(p)) return p;
    }
  }
  return "";
}

const here = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const root = findRoot(cwd) || findRoot(here);
const patchPath = findPatch(here, cwd);
if (!patchPath) {
  console.error("Keine grok.anvil-patch gefunden.");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(patchPath, "utf8"));
let n = 0;
for (const [rel, content] of Object.entries(plan.files || {})) {
  if (typeof content !== "string") continue;
  const path = join(root, rel.replace(/\\/g, "/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log("schreibe", rel);
  n += 1;
}
console.log("");
console.log("Patch:", patchPath);
console.log("Anvil-Ordner:", root);
console.log((plan.note || "Patch") + " — " + n + " Dateien.");
console.log("Jetzt stop.bat, dann start.bat.");
