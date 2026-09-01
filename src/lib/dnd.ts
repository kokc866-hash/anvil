import { joinPath } from "./fs";
import { readDroppedFile } from "./ref";
import { unzipFiles } from "./archive";
import { useIde } from "@/store/ide";

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
  if (raw && /^[\w./\-]+$/.test(raw)) return { kind: "path", path: raw };
  return null;
}

export function hasOsFiles(dt: DataTransfer): boolean {
  return [...dt.types].includes("Files");
}

export function uniqueDest(files: Record<string, string>, dir: string, name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "datei";
  const clean = base.replace(/[^\w.\-äöüÄÖÜß]+/g, "_").replace(/^\.+/, "") || "datei";
  const prefix = dir ? `${dir}/` : "";
  let path = `${prefix}${clean}`;
  if (!(path in files)) return path;
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  for (let i = 2; i < 80; i++) {
    path = `${prefix}${stem}-${i}${ext}`;
    if (!(path in files)) return path;
  }
  return `${prefix}${stem}-${Date.now().toString(36)}${ext}`;
}

export async function importDropped(list: File[], destDir = ""): Promise<number> {
  const write = useIde.getState().writeFile;
  let n = 0;
  for (const file of list) {
    if (file.name.endsWith(".vsix") || (file.name.endsWith(".zip") && destDir.startsWith("plugins"))) {
      if (file.name.endsWith(".vsix")) {
        const { importVsix } = await import("@/lib/plugins/vscode");
        const slug = file.name.replace(/\.vsix$/i, "").replace(/[^\w.\-]+/g, "-") || "ext";
        const got = await importVsix(await file.arrayBuffer(), `plugins/${slug}`);
        for (const [path, content] of Object.entries(got.files)) {
          write(path, content);
          n += 1;
        }
        continue;
      }
    }
    if (/\.(patch|diff|anvil-patch)$/i.test(file.name) || /-patch\.json$/i.test(file.name)) {
      const { parsePatch, commitPatch } = await import("./patch");
      const plan = parsePatch(await file.text(), useIde.getState().files);
      if (!Object.keys(plan.write).length && !plan.del.length) {
        useIde.getState().setNotice(plan.errors[0] || "Patch leer");
        continue;
      }
      await commitPatch(plan);
      n += Object.keys(plan.write).length + plan.del.length;
      continue;
    }
    if (file.name.endsWith(".zip")) {
      const pack = await unzipFiles(await file.arrayBuffer());
      for (const [path, content] of Object.entries(pack)) {
        const name = path.split("/").pop() ?? path;
        write(uniqueDest(useIde.getState().files, destDir, name), content);
        n += 1;
      }
      continue;
    }
    const got = await readDroppedFile(file);
    if (!got) continue;
    write(uniqueDest(useIde.getState().files, destDir, got.name), got.content);
    n += 1;
  }
  return n;
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
