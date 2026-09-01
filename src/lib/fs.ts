export function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function cleanPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\./g, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .trim();
}

export function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function joinPath(dir: string, name: string): string {
  const n = cleanPath(name);
  if (!dir) return n;
  return `${cleanPath(dir)}/${n}`;
}

export function ancestorDirs(path: string): string[] {
  const out: string[] = [];
  let d = parentDir(path);
  while (d) {
    out.push(d);
    d = parentDir(d);
  }
  return out;
}

export function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

export function dupPath(path: string, taken: Set<string>): string {
  const i = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const hasExt = i > slash;
  const stem = hasExt ? path.slice(0, i) : path;
  const ext = hasExt ? path.slice(i) : "";
  let n = 2;
  let next = `${stem}-2${ext}`;
  while (taken.has(next)) {
    n += 1;
    next = `${stem}-${n}${ext}`;
  }
  return next;
}

export type FsNode = { path: string; type: "dir" | "file"; depth: number };

/** System folders stay at the top of the explorer, with their files. */
export const PINNED_ROOTS = [".anvil", "ref"] as const;

export function pinRank(path: string): number {
  const root = path.split("/")[0] ?? "";
  const i = PINNED_ROOTS.indexOf(root as (typeof PINNED_ROOTS)[number]);
  return i === -1 ? PINNED_ROOTS.length : i;
}

export function isPinnedPath(path: string): boolean {
  return pinRank(path) < PINNED_ROOTS.length;
}

export function buildTree(files: string[], dirs: string[]): FsNode[] {
  const allDirs = new Set<string>(dirs);
  for (const p of files) {
    for (const d of ancestorDirs(p)) allDirs.add(d);
  }
  const items: FsNode[] = [];
  for (const d of allDirs) items.push({ path: d, type: "dir", depth: d.split("/").length - 1 });
  for (const p of files) items.push({ path: p, type: "file", depth: p.split("/").length - 1 });
  items.sort(compareTree);
  return items;
}

function compareTree(a: FsNode, b: FsNode): number {
  const ra = pinRank(a.path);
  const rb = pinRank(b.path);
  if (ra !== rb) return ra - rb;
  const pa = a.path.split("/");
  const pb = b.path.split("/");
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    if (pa[i] === pb[i]) continue;
    const aDir = i < pa.length - 1 || a.type === "dir";
    const bDir = i < pb.length - 1 || b.type === "dir";
    if (aDir !== bDir) return aDir ? -1 : 1;
    return pa[i].localeCompare(pb[i], "en", { sensitivity: "base" });
  }
  return pa.length - pb.length;
}

export function visibleTree(items: FsNode[], collapsed: string[], query: string): FsNode[] {
  const hide = new Set(collapsed);
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    const parts = item.path.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      if (hide.has(acc)) return false;
    }
    if (!q) return true;
    if (item.path.toLowerCase().includes(q)) return true;
    if (item.type === "dir" && items.some((x) => x.path.startsWith(`${item.path}/`) && x.path.toLowerCase().includes(q))) {
      return true;
    }
    return false;
  });
}
