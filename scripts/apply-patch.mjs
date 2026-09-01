#!/usr/bin/env node
/**
 * node grok.mjs
 * oder: node scripts/apply-patch.mjs [grok.anvil-patch]
 * Schreibt nur Strings. Binär: plan.bin[path] = base64.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    try {
      const j = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (j.name === "anvil") return dir;
    } catch {
      /* */
    }
    if (existsSync(join(dir, "anvil", "package.json"))) return join(dir, "anvil");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function findPatch(here, cwd, arg) {
  if (arg && existsSync(arg)) return resolve(arg);
  const names = ["grok.anvil-patch", "next.anvil-patch"];
  const dirs = [here, cwd, join(here, "patches"), join(cwd, "patches")];
  for (const d of dirs) {
    for (const n of names) {
      const p = join(d, n);
      if (existsSync(p)) return p;
    }
  }
  return "";
}

function writeOne(root, rel, content) {
  const path = join(root, String(rel).replace(/\\/g, "/"));
  mkdirSync(dirname(path), { recursive: true });
  if (typeof content === "string") {
    if (content.startsWith("b64:")) writeFileSync(path, Buffer.from(content.slice(4), "base64"));
    else writeFileSync(path, content, "utf8");
    return;
  }
  if (content && typeof content === "object") {
    if (typeof content.b64 === "string") {
      writeFileSync(path, Buffer.from(content.b64, "base64"));
      return;
    }
    if (content.type === "Buffer" && Array.isArray(content.data)) {
      writeFileSync(path, Buffer.from(content.data));
      return;
    }
  }
  throw new Error(`kein Text: ${rel}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const fromScripts = here.endsWith("scripts") ? resolve(here, "..") : here;
const root = findRoot(cwd) || findRoot(fromScripts);
const patchPath = findPatch(fromScripts, cwd, process.argv[2]);
if (!patchPath) {
  console.error("Keine grok.anvil-patch gefunden.");
  console.error("Datei neben grok.mjs / patch.bat oder in patches\\ legen.");
  process.exit(1);
}

const plan = JSON.parse(readFileSync(patchPath, "utf8"));
const files = plan.files || {};
let n = 0;
for (const [rel, content] of Object.entries(files)) {
  writeOne(root, rel, content);
  console.log(rel);
  n += 1;
}
for (const [rel, b64] of Object.entries(plan.bin || {})) {
  writeOne(root, rel, typeof b64 === "string" ? `b64:${b64}` : b64);
  console.log(rel);
  n += 1;
}
for (const rel of plan.delete || []) {
  try {
    rmSync(join(root, String(rel).replace(/\\/g, "/")));
    console.log("weg", rel);
  } catch {
    /* */
  }
}
console.log("");
console.log("Patch:", patchPath);
console.log("Anvil-Ordner:", root);
console.log((plan.note || "Patch") + " — " + n + " Dateien.");
console.log("Jetzt stop.bat, dann start.bat.");
