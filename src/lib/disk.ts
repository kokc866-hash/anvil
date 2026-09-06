import { isSourcePath, skipDirName, skipPath, keepDotName, keepBareFile } from "./ws-skip";
import { bytesToDataUrl } from "./archive";
import { isRefPath } from "./ref";

const MAX = 1_500_000;
const MAX_FILES = 4000;
const MAX_TOTAL = 96_000_000;
const DB = "anvil-disk";
const STORE = "handles";

export type DiskSlot = "workspace" | "backup";

type DirHandle = FileSystemDirectoryHandle;

const slots: Partial<Record<DiskSlot, DirHandle>> = {};
const names: Record<DiskSlot, string> = { workspace: "", backup: "" };

export function diskSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function locationName(slot: DiskSlot): string {
  return names[slot];
}

export function diskFolderName(): string {
  return names.workspace;
}

export function hasLocation(slot: DiskSlot): boolean {
  return Boolean(slots[slot]);
}

export function hasDiskFolder(): boolean {
  return hasLocation("workspace");
}

/** Capture the destination before a delayed write or an async permission request. */
export function diskWorkspaceHandle(): FileSystemDirectoryHandle | null {
  return slots.workspace ?? null;
}

function picker(): Promise<DirHandle> {
  const w = window as unknown as { showDirectoryPicker: (o?: { mode?: string }) => Promise<DirHandle> };
  return w.showDirectoryPicker({ mode: "readwrite" });
}

async function ensurePerm(handle: DirHandle, mode: "read" | "readwrite"): Promise<boolean> {
  const q = handle as DirHandle & {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  if (q.queryPermission) {
    const now = await q.queryPermission({ mode });
    if (now === "granted") return true;
    if (q.requestPermission) return (await q.requestPermission({ mode })) === "granted";
  }
  return true;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistHandle(slot: DiskSlot, handle: DirHandle | null) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      if (handle) tx.objectStore(STORE).put({ handle, name: handle.name }, slot);
      else tx.objectStore(STORE).delete(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* private mode / iframe */
  }
}

export async function restoreLocations(): Promise<Record<DiskSlot, string>> {
  try {
    const db = await openDb();
    const read = (slot: DiskSlot) =>
      new Promise<{ handle?: DirHandle; name?: string } | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(slot);
        req.onsuccess = () => resolve(req.result as { handle?: DirHandle; name?: string } | undefined);
        req.onerror = () => reject(req.error);
      });
    for (const slot of ["workspace", "backup"] as DiskSlot[]) {
      const row = await read(slot);
      if (row?.handle) {
        slots[slot] = row.handle;
        names[slot] = row.name || row.handle.name;
      }
    }
    db.close();
  } catch {
    /* ignore */
  }
  return { ...names };
}

export async function pickLocation(slot: DiskSlot): Promise<string> {
  if (!diskSupported()) throw new Error("Ordnerwahl braucht Chrome oder Edge.");
  const handle = await picker();
  if (!(await ensurePerm(handle, "readwrite"))) throw new Error("Keine Berechtigung für den Ordner.");
  slots[slot] = handle;
  names[slot] = handle.name;
  await persistHandle(slot, handle);
  return handle.name;
}

export async function clearLocation(slot: DiskSlot): Promise<void> {
  delete slots[slot];
  names[slot] = "";
  await persistHandle(slot, null);
}

export async function loadSlot(slot: DiskSlot): Promise<Record<string, string>> {
  const { files } = await loadSlotAll(slot);
  return files;
}

export type DiskPack = { files: Record<string, string>; dirs: string[]; skipped: number };

export async function loadSlotAll(slot: DiskSlot): Promise<DiskPack> {
  const handle = slots[slot];
  if (!handle) throw new Error("Kein Ordner gewählt.");
  if (!(await ensurePerm(handle, "read"))) throw new Error("Keine Leserechte. Ordner erneut wählen.");
  const dirs: string[] = [];
  const acc = { n: 0, bytes: 0, skipped: 0 };
  const files = await readFolder(handle, "", dirs, acc);
  return { files, dirs, skipped: acc.skipped };
}

export async function pickFolder(): Promise<DiskPack> {
  const handle = await picker();
  if (!(await import("./save").then((s) => s.prepareWorkspaceSwitch()))) throw new Error("Projektwechsel abgebrochen");
  const { useIde } = await import("@/store/ide");
  const initial = useIde.getState();
  const epoch = initial.workspaceEpoch;
  if (!(await ensurePerm(handle, "readwrite"))) throw new Error("Keine Berechtigung für den Ordner.");
  const dirs: string[] = [], acc = { n: 0, bytes: 0, skipped: 0 };
  const files = await readFolder(handle, "", dirs, acc);
  if (useIde.getState().workspaceEpoch !== epoch || useIde.getState().files !== initial.files) throw new Error("Projekt inzwischen geändert; Ordner erneut öffnen.");
  const { abortAgent } = await import("./abort"); abortAgent("Projekt gewechselt");
  slots.workspace = handle; names.workspace = handle.name;
  useIde.getState().setWorkspaceCwd("");
  void persistHandle("workspace", handle);
  return { files, dirs, skipped: acc.skipped };
}

export async function saveSlot(slot: DiskSlot, files: Record<string, string>, dirs: string[] = []): Promise<void> {
  const handle = slots[slot];
  if (!handle) throw new Error(slot === "backup" ? "Kein Backup-Ordner." : "Kein Workspace-Ordner.");
  if (!(await ensurePerm(handle, "readwrite"))) throw new Error("Keine Schreibrechte.");
  for (const d of dirs) {
    let dir = handle;
    for (const part of d.split("/").filter(Boolean)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
  }
  for (const [path, content] of Object.entries(files)) {
    if (/^data:image\//i.test(content.trim())) continue;
    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let dir = handle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }
}

export async function saveFolder(files: Record<string, string>, dirs: string[] = []): Promise<void> {
  await saveSlot("workspace", files, dirs);
}

async function workspaceHandle(handle = diskWorkspaceHandle()): Promise<DirHandle | null> {
  if (!handle) return null;
  if (!(await ensurePerm(handle, "readwrite"))) throw new Error("Keine Schreibrechte für den Workspace-Ordner.");
  return handle;
}

async function dirFor(path: string, create: boolean, target = diskWorkspaceHandle()): Promise<{ dir: DirHandle; name: string } | null> {
  const handle = await workspaceHandle(target);
  if (!handle) return null;
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  let dir = handle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return { dir, name };
}

export async function writeDiskFile(path: string, content: string, target = diskWorkspaceHandle(), expected?: string | null): Promise<void> {
  if (/^data:image\//i.test(content.trim())) return;
  const loc = await dirFor(path, true, target);
  if (!loc) return;
  if (expected !== undefined) {
    let actual: string | null = null;
    try { actual = await (await (await loc.dir.getFileHandle(loc.name)).getFile()).text(); }
    catch (e) { if ((e as DOMException).name !== "NotFoundError") throw e; }
    if (actual !== expected && actual !== content) throw new Error(`Datei extern geändert: ${path}. Neu laden oder Änderungen abgleichen.`);
  }
  const fh = await loc.dir.getFileHandle(loc.name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

export async function mkdirDisk(path: string, target = diskWorkspaceHandle()): Promise<void> {
  const handle = await workspaceHandle(target);
  if (!handle) return;
  let dir = handle;
  for (const part of path.split("/").filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
}

export async function moveDiskPath(from: string, to: string, target: FileSystemDirectoryHandle): Promise<void> {
  const src = await dirFor(from, false, target), dest = await dirFor(to, true, target);
  if (!src || !dest) throw new Error("Workspace fehlt.");
  const child = async (dir: DirHandle, name: string): Promise<FileSystemHandle | null> => {
    try { return await dir.getFileHandle(name); } catch (e) { if ((e as DOMException).name !== "TypeMismatchError" && (e as DOMException).name !== "NotFoundError") throw e; }
    try { return await dir.getDirectoryHandle(name); } catch (e) { if ((e as DOMException).name !== "NotFoundError") throw e; }
    return null;
  };
  if (await child(dest.dir, dest.name)) throw new Error("Ziel existiert bereits.");
  const source = await child(src.dir, src.name);
  if (!source) throw new Error("Quelle nicht gefunden.");
  const copy = async (entry: FileSystemHandle, parent: DirHandle, name: string): Promise<void> => {
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      const handle = await parent.getFileHandle(name, { create: true });
      const writer = await handle.createWritable();
      try { await writer.write(file); await writer.close(); } catch (e) { await writer.abort().catch(() => undefined); throw e; }
    } else {
      const directory = await parent.getDirectoryHandle(name, { create: true });
      for await (const [name, handle] of (entry as DirHandle).entries()) await copy(handle, directory, name);
    }
  };
  try { await copy(source, dest.dir, dest.name); }
  catch (e) { await dest.dir.removeEntry(dest.name, { recursive: true }).catch(() => undefined); throw e; }
  await src.dir.removeEntry(src.name, { recursive: true });
}

export async function removeDiskPath(path: string, target = diskWorkspaceHandle()): Promise<void> {
  const loc = await dirFor(path, false, target);
  if (!loc) return;
  try {
    await loc.dir.removeEntry(loc.name, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
}

type ReadAcc = { n: number; bytes: number; skipped: number };

const TEXT_OK =
  /\.(py|js|ts|tsx|jsx|mjs|cjs|json|md|html|css|go|rs|java|c|cc|cpp|h|hpp|cs|php|rb|txt|toml|yml|yaml|xml|svg|sh|vue|svelte|sql|gd|csproj)$/i;

const IMG_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

async function readFolder(dir: DirHandle, prefix = "", dirs: string[] = [], acc: ReadAcc): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (prefix) dirs.push(prefix);
  for await (const [child, handle] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (child.startsWith(".") && !keepDotName(child)) continue;
    if (skipDirName(child)) continue;
    const path = prefix ? `${prefix}/${child}` : child;
    if (skipPath(path)) {
      if (handle.kind === "directory") continue;
      acc.skipped += 1;
      continue;
    }
    if (handle.kind === "directory") {
      Object.assign(out, await readFolder(handle as DirHandle, path, dirs, acc));
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      const source = isSourcePath(path) || keepBareFile(child);
      const ext = (child.split(".").pop() ?? "").toLowerCase();
      const imgMime = isRefPath(path) ? IMG_MIME[ext] : undefined;
      if (acc.n >= MAX_FILES || acc.bytes + file.size > MAX_TOTAL) {
        acc.skipped += 1;
        continue;
      }
      if (imgMime) {
        if (file.size > 4_000_000) {
          acc.skipped += 1;
          continue;
        }
        out[path] = bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), imgMime);
        acc.n += 1;
        acc.bytes += file.size;
        continue;
      }
      if (file.size > MAX) {
        acc.skipped += 1;
        continue;
      }
      if (!source && acc.n > MAX_FILES * 0.7) {
        acc.skipped += 1;
        continue;
      }
      if (
        file.size > 0 &&
        file.type &&
        !file.type.startsWith("text") &&
        !TEXT_OK.test(child) &&
        !keepBareFile(child)
      ) {
        acc.skipped += 1;
        continue;
      }
      out[path] = await file.text();
      acc.n += 1;
      acc.bytes += file.size;
    }
  }
  return out;
}

export async function readDiskFiles(paths: string[], target = diskWorkspaceHandle()): Promise<Record<string, string | null>> {
  const files: Record<string, string | null> = {};
  for (const path of paths.slice(0, 64)) {
    try {
      const loc = await dirFor(path, false, target); if (!loc) continue;
      const file = await (await loc.dir.getFileHandle(loc.name)).getFile();
      if (file.size <= MAX) files[path] = await file.text();
    } catch (e) { if ((e as DOMException).name === "NotFoundError") files[path] = null; else throw e; }
  }
  return files;
}
