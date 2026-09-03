export function modelsToDrop(uris: string[], keep: string[]): string[] {
  const k = new Set(keep.map((p) => p.replace(/^\/+/, "").replace(/\\/g, "/")));
  return uris
    .map((u) => String(u || "").replace(/^\/+/, "").replace(/\\/g, "/"))
    .filter((p) => p && !k.has(p));
}
