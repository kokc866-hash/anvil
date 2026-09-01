#!/usr/bin/env node
/**
 * Patch anwenden.
 * grok.anvil-patch neben dieses Skript, in patches\, oder: node grok.mjs pfad
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    try {
      if (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "anvil") return dir;
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
  if (arg) {
    const p = resolve(cwd, arg);
    if (existsSync(p)) return p;
  }
  const names = ["grok.anvil-patch", "next.anvil-patch"];
  for (const d of [here, cwd, join(here, "patches"), join(cwd, "patches")]) {
    for (const n of names) {
      const p = join(d, n);
      if (existsSync(p)) return p;
    }
  }
  return "";
}

function toBuf(content) {
  if (typeof content === "string") {
    return content.startsWith("b64:") ? Buffer.from(content.slice(4), "base64") : Buffer.from(content, "utf8");
  }
  if (content && typeof content === "object") {
    if (typeof content.b64 === "string") return Buffer.from(content.b64, "base64");
    if (content.type === "Buffer" && Array.isArray(content.data)) return Buffer.from(content.data);
  }
  return null;
}

const here = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const root = findRoot(cwd) || findRoot(here);
const patchPath = findPatch(here, cwd, process.argv[2]);
if (!patchPath) {
  console.error("Keine grok.anvil-patch gefunden.");
  console.error("Lege sie neben grok.mjs / patch.bat oder in patches\\");
  process.exit(1);
}

const plan = JSON.parse(readFileSync(patchPath, "utf8"));
let n = 0;
let skip = 0;
for (const [rel, content] of Object.entries(plan.files || {})) {
  const buf = toBuf(content);
  if (!buf) {
    skip += 1;
    console.log("überspringe", rel);
    continue;
  }
  const path = join(root, String(rel).replace(/\\/g, "/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log(rel);
  n += 1;
}
for (const [rel, b64] of Object.entries(plan.bin || {})) {
  const path = join(root, String(rel).replace(/\\/g, "/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(String(b64), "base64"));
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
console.log((plan.note || "Patch") + " — " + n + " Dateien" + (skip ? `, ${skip} übersprungen` : "") + ".");
console.log("Jetzt stop.bat, dann start.bat.");
