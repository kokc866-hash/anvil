import { joinPath, unusedFilePath } from "./fs";
import { readDroppedFile } from "./ref";
import { ARCHIVE_MAX_COMPRESSED, ARCHIVE_MAX_EXPANDED, ARCHIVE_MAX_FILES, unzipFiles } from "./archive";
import { useIde } from "@/store/ide";
import { assertImportTarget, captureImportTarget, commitImportedFiles, commitImportedPatch } from "./plugins/import";

export type DragKind = "path" | "tab";
export type DragPayload = { kind: DragKind; path: string };

export function setDrag(dt: DataTransfer, payload: DragPayload): void {
  dt.setData("text/plain", `${payload.kind}:${payload.path}`);
  dt.effectAllowed = payload.kind === "tab" ? "move" : "copyMove";
}

export function getDrag(dt: DataTransfer): DragPayload | null {
  const raw = dt.getData("text/plain") || "";
  const m = raw.match(/^(path|tab):(.+)$/);
  if (m) return { kind: m[1] as DragKind, path: m[2] };
  if (raw && !raw.includes("\n") && !raw.includes(":")) return { kind: "path", path: raw };
  if (raw && /^[\w./-]+$/.test(raw)) return { kind: "path", path: raw };
  return null;
}

export function hasOsFiles(dt: DataTransfer): boolean {
  return [...dt.types].includes("Files");
}

export function uniqueDest(files: Record<string, string>, dir: string, name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "datei";
  const clean = base.replace(/[^\w.äöüÄÖÜß-]+/g, "_").replace(/^\.+/, "") || "datei";
  const prefix = dir ? `${dir}/` : "";
  return unusedFilePath(`${prefix}${clean}`, Object.keys(files));
}

export async function importDropped(list: File[], destDir = ""): Promise<number> {
  try {
    const target = captureImportTarget(), staged: Record<string, string> = Object.create(null), del = new Set<string>();
    let hasPatch = false;
    let stagedUnits = 0;
    const occupied = new Set([...Object.keys(target.files), ...target.dirs].map(path => path.toLowerCase())), stagedNames = new Set<string>();
    const add = (path: string, content: string) => {
      const key = path.toLowerCase();
      if (occupied.has(key) || stagedNames.has(key)) throw new Error(`Bereits vorhanden, nicht überschrieben: ${path}`);
      stagedNames.add(key);
      stagedUnits += content.length;
      if (stagedNames.size > ARCHIVE_MAX_FILES || stagedUnits > ARCHIVE_MAX_EXPANDED * 1.4) throw new Error("Import überschreitet die Datei-/Größenbegrenzung.");
      staged[path] = content;
    };
    for (const file of list) {
      if (/\.(vsix|zip)$/i.test(file.name)) {
        if (file.size > ARCHIVE_MAX_COMPRESSED) throw new Error("Archiv zu groß (höchstens 64 MiB).");
        const buf = await file.arrayBuffer();
        assertImportTarget(target);
        if (/\.vsix$/i.test(file.name)) {
          const { importVsix } = await import("@/lib/plugins/vscode");
          assertImportTarget(target);
          const slug = file.name.replace(/\.vsix$/i, "").replace(/[^\w.-]+/g, "-") || "ext";
          const got = await importVsix(buf, `plugins/${slug}`);
          assertImportTarget(target);
          if (!Object.keys(got.files).length) throw new Error("Das Paket enthält keine unterstützten Editor-Beiträge.");
          for (const [path, content] of Object.entries(got.files)) add(path, content);
        } else {
          const pack = await unzipFiles(buf);
          assertImportTarget(target);
          for (const [path, content] of Object.entries(pack)) add(destDir ? `${destDir}/${path}` : path, content);
        }
        continue;
      }
      if (/\.(patch|diff|anvil-patch)$/i.test(file.name) || /-patch\.json$/i.test(file.name)) {
        if (file.size > 8_000_000) throw new Error("Patch zu groß.");
        const { parsePatch } = await import("./patch");
        assertImportTarget(target);
        const text = await file.text();
        assertImportTarget(target);
        const current = Object.fromEntries(Object.entries({ ...target.files, ...staged }).filter(([path]) => !del.has(path)));
        const plan = parsePatch(text, current);
        if (plan.errors.length) throw new Error(plan.errors[0]);
        hasPatch = true;
        for (const path of plan.del) { del.add(path); stagedUnits -= staged[path]?.length ?? 0; delete staged[path]; stagedNames.delete(path.toLowerCase()); }
        for (const [path, content] of Object.entries(plan.write)) {
          stagedUnits += content.length - (staged[path]?.length ?? 0); staged[path] = content; del.delete(path); stagedNames.add(path.toLowerCase());
        }
        if (stagedNames.size > ARCHIVE_MAX_FILES || stagedUnits > ARCHIVE_MAX_EXPANDED * 1.4) throw new Error("Import überschreitet die Datei-/Größenbegrenzung.");
        continue;
      }
      const got = await readDroppedFile(file);
      assertImportTarget(target);
      if (got) add(unusedFilePath(uniqueDest({ ...target.files, ...staged }, destDir, got.name), [...Object.keys(target.files), ...Object.keys(staged)], [...target.dirs]), got.content);
    }
    assertImportTarget(target);
    return await (hasPatch ? commitImportedPatch(target, staged, [...del]) : commitImportedFiles(target, staged));
  } catch (error) {
    useIde.getState().setNotice(error instanceof Error ? error.message : "Import nicht gespeichert.");
    return 0;
  }
}

export function dropDir(path: string, type: "file" | "dir"): string {
  return type === "dir" ? path : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function canMove(from: string, toDir: string): boolean {
  if (!from) return false;
  if (from === toDir) return false;
  if (toDir === from || toDir.startsWith(`${from}/`)) return false;
  const dest = toDir ? joinPath(toDir, from.split("/").pop() ?? from) : from.split("/").pop() ?? from;
  return dest !== from;
}
