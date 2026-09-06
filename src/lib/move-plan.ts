import { ancestorDirs, isInside, remapPath } from "./fs.ts";

export function planMove(files: Record<string, string>, dirs: string[], from: string, to: string) {
  const valid = (p: string) => Boolean(p) && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => !s || s === "." || s === "..") && !/[:\x00-\x1f]/.test(p);
  if (!valid(from) || !valid(to) || isInside(to, from)) throw new Error("Ungültiges Verschiebeziel.");
  const allDirs = new Set([...dirs, ...Object.keys(files).flatMap(ancestorDirs)]);
  const paths = Object.keys(files).filter((p) => isInside(p, from));
  if (!paths.length && !allDirs.has(from)) throw new Error("Quelle nicht gefunden.");
  const occupied = new Set([...Object.keys(files), ...allDirs].filter((p) => !isInside(p, from)).map((p) => p.toLocaleLowerCase("en")));
  // Never merge directories implicitly; on Windows names are case insensitive.
  if (occupied.has(to.toLocaleLowerCase("en")) || ancestorDirs(to).some((p) => Object.keys(files).some((f) => f.toLowerCase() === p.toLowerCase())))
    throw new Error(`Ziel existiert bereits: ${to}`);
  const mapping = Object.fromEntries(paths.map((p) => [p, remapPath(p, from, to)]));
  const movedDirs = [...allDirs].filter((p) => isInside(p, from)).map((p) => remapPath(p, from, to));
  return { from, to, mapping, movedDirs, directories: [...new Set([...allDirs].filter((p) => !isInside(p, from)).concat(ancestorDirs(to), movedDirs))] };
}
