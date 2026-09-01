#!/usr/bin/env node
/**
 * Schreibt Anvils Icon in eine Kopie von electron.exe (Windows-Taskleiste).
 * Ohne rcedit bleibt nur das Fenster-Icon über nativeImage.
 */
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "node_modules", "electron", "dist");
const srcExe = join(dist, "electron.exe");
const dstExe = join(dist, "Anvil.exe");
const ico = join(root, "public", "icon.ico");
const stamp = join(dist, ".anvil-branded");

if (process.platform !== "win32") process.exit(0);
if (!existsSync(srcExe) || !existsSync(ico)) process.exit(0);

try {
  copyFileSync(srcExe, dstExe);
} catch (err) {
  console.warn("[anvil] Anvil.exe nicht kopierbar:", err instanceof Error ? err.message : err);
  process.exit(0);
}

try {
  const mod = await import("rcedit");
  const fn = typeof mod.default === "function" ? mod.default : mod;
  await fn(dstExe, {
    icon: ico,
    "version-string": {
      CompanyName: "Anvil",
      FileDescription: "Anvil",
      ProductName: "Anvil",
      InternalName: "Anvil",
      OriginalFilename: "Anvil.exe",
      LegalCopyright: "",
    },
    "file-version": "1.1.1",
    "product-version": "1.1.1",
  });
  writeFileSync(stamp, String(Date.now()));
  console.log("Anvil.exe Icon gesetzt.");
} catch (err) {
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(dstExe);
  } catch {
    /* */
  }
  console.warn("[anvil] rcedit fehlt — Taskleiste bleibt Electron. Einmal: npm i rcedit");
  process.exit(0);
}
