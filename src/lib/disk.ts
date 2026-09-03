import { isSourcePath, skipDirName } from "./ws-skip";

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
  await pickLocation("workspace");
  return loadSlotAll("workspace");
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

async function workspaceHandle(): Promise<DirHandle | null> {
  const handle = slots.workspace;
  if (!handle) return null;
  if (!(await ensurePerm(handle, "readwrite"))) return null;
  return handle;
}

async function dirFor(path: string, create: boolean): Promise<{ dir: DirHandle; name: string } | null> {
  const handle = await workspaceHandle();
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

export async function writeDiskFile(path: string, content: string): Promise<void> {
  const loc = await dirFor(path, true);
  if (!loc) return;
  const fh = await loc.dir.getFileHandle(loc.name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

export async function mkdirDisk(path: string): Promise<void> {
  const handle = await workspaceHandle();
  if (!handle) return;
  let dir = handle;
  for (const part of path.split("/").filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
}

export async function removeDiskPath(path: string): Promise<void> {
  const loc = await dirFor(path, false);
  if (!loc) return;
  try {
    await loc.dir.removeEntry(loc.name, { recursive: true });
  } catch {
    /* missing */
  }
}

type ReadAcc = { n: number; bytes: number; skipped: number };

const TEXT_OK =
  /\.(py|js|ts|tsx|jsx|mjs|cjs|json|md|html|css|go|rs|java|c|cc|cpp|h|hpp|cs|php|rb|txt|toml|yml|yaml|xml|svg|sh|vue|svelte|sql)$/i;

async function readFolder(dir: DirHandle, prefix = "", dirs: string[] = [], acc: ReadAcc): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (prefix) dirs.push(prefix);
  for await (const [child, handle] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (child.startsWith(".") && child !== ".gitignore" && child !== ".env.example" && child !== ".anvil") continue;
    if (skipDirName(child)) continue;
    if (handle.kind === "directory") {
      Object.assign(out, await readFolder(handle as DirHandle, prefix ? `${prefix}/${child}` : child, dirs, acc));
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      const path = prefix ? `${prefix}/${child}` : child;
      const source = isSourcePath(path);
      if (file.size > MAX || file.size === 0) {
        acc.skipped += 1;
        continue;
      }
      if (acc.n >= MAX_FILES || acc.bytes + file.size > MAX_TOTAL) {
        acc.skipped += 1;
        continue;
      }
      if (!source && acc.n > MAX_FILES * 0.7) {
        acc.skipped += 1;
        continue;
      }
      if (
        file.type &&
        !file.type.startsWith("text") &&
        !TEXT_OK.test(child)
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
