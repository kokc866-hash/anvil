import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileBytes } from "../scripts/file-content.mjs";

/** A fresh directory preserves the original project and never overwrites a previous backup. */
export async function saveRecovery(parent, snapshot) {
  if (!snapshot || !snapshot.files || typeof snapshot.files !== "object" || Array.isArray(snapshot.files)) throw new Error("Ungültige Projektsicherung.");
  const files = Object.entries(snapshot.files);
  const dirs = Array.isArray(snapshot.dirs) ? snapshot.dirs : [];
  const valid = (name) => typeof name === "string" && name.length > 0 && !/[:\\\x00-\x1f]/.test(name) && name.split("/").every((p) => p && p !== "." && p !== "..");
  if (files.length > 10000 || files.some(([name, text]) => !valid(name) || typeof text !== "string") || dirs.some((name) => !valid(name))) throw new Error("Ungültiger Pfad in der Projektsicherung.");
  if (files.reduce((n, [, text]) => n + Buffer.byteLength(text), 0) > 256_000_000) throw new Error("Projektsicherung überschreitet 256 MB.");
  const root = await mkdtemp(path.join(parent, "Anvil-Sicherung-"));
  try {
    for (const dir of dirs) await mkdir(path.join(root, dir), { recursive: true });
    for (const [name, text] of files) {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, fileBytes(text), { flag: "wx" });
    }
    return root;
  } catch (error) {
    throw new Error(`Sicherung unvollständig unter ${root}: ${error instanceof Error ? error.message : error}`);
  }
}
