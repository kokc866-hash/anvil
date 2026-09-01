export const REF_DIR = "ref";

export function isRefPath(path: string): boolean {
  return path === REF_DIR || path.startsWith(`${REF_DIR}/`);
}

export function refFiles(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((p) => p.startsWith(`${REF_DIR}/`) && p !== `${REF_DIR}/`)
    .sort();
}

export function safeRefName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "datei";
  return base.replace(/[^\w.\-äöüÄÖÜß]+/g, "_").replace(/^\.+/, "") || "datei";
}

export function uniqueRefPath(files: Record<string, string>, name: string): string {
  const clean = safeRefName(name);
  let path = `${REF_DIR}/${clean}`;
  if (!(path in files)) return path;
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  for (let i = 2; i < 50; i++) {
    path = `${REF_DIR}/${stem}-${i}${ext}`;
    if (!(path in files)) return path;
  }
  return `${REF_DIR}/${stem}-${Date.now().toString(36)}${ext}`;
}

export function isRefImage(content: string): boolean {
  return /^data:image\//i.test(content.trim());
}

export function isSecretPath(path: string): boolean {
  return /(^|\/)(\.env($|\.)|\.env\.[^/]+|id_rsa|\.pem$|credentials|secrets?\.|vault)/i.test(path)
    || /(api[_-]?key|token|password)/i.test(path.split("/").pop() ?? "");
}

export type RefIndex = { path: string; title: string; image: boolean };

export function refIndexLine(path: string, content: string): string {
  if (isRefImage(content)) return "Bild";
  const lines = content
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim())
    .filter((l) => l && !l.startsWith("```"));
  return (lines[0] ?? path.slice(REF_DIR.length + 1)).slice(0, 88);
}

export function refIndex(files: Record<string, string>): RefIndex[] {
  return refFiles(files)
    .filter((p) => !isSecretPath(p))
    .map((path) => ({
      path,
      title: refIndexLine(path, files[path] ?? ""),
      image: isRefImage(files[path] ?? ""),
    }));
}

export function packRefContext(
  files: Record<string, string>,
  query = "",
  prefer: string[] = [],
): { text: string; images: string[] } {
  const paths = refFiles(files).filter((p) => !isSecretPath(p));
  if (!paths.length) return { text: "", images: [] };
  const q = query.trim().toLowerCase();
  const preferSet = new Set(prefer.filter(isRefPath));
  const ranked = [...paths].sort((a, b) => {
    const pa = preferSet.has(a) ? 50 : 0;
    const pb = preferSet.has(b) ? 50 : 0;
    if (pa !== pb) return pb - pa;
    if (!q) return a.localeCompare(b);
    return score(b, files[b] ?? "", q) - score(a, files[a] ?? "", q);
  });
  const index = ranked.map((p) => `- ${p} — ${refIndexLine(p, files[p] ?? "")}`).join("\n");
  const images: string[] = [];
  const blocks: string[] = [`Referenzen in ${REF_DIR}/:\n${index}`];
  let used = 0;
  const deep = ranked.filter((p) => preferSet.has(p) || (q && score(p, files[p] ?? "", q) > 0)).slice(0, 6);
  const take = deep.length ? deep : ranked.slice(0, 4);
  for (const path of take) {
    const raw = files[path] ?? "";
    if (isRefImage(raw)) {
      if (images.length < 3) images.push(raw.trim());
      continue;
    }
    const excerpt = raw.slice(0, used < 5000 ? 800 : 160).trim();
    blocks.push(`### ${path}\n${excerpt}${raw.length > excerpt.length ? "\n…" : ""}`);
    used += excerpt.length;
    if (used > 7000) break;
  }
  return { text: blocks.join("\n\n"), images };
}

function score(path: string, content: string, q: string): number {
  const p = path.toLowerCase();
  const c = content.toLowerCase();
  let n = 0;
  if (p.includes(q)) n += 5;
  if (c.includes(q)) n += 3;
  for (const w of q.split(/\s+/).filter((x) => x.length > 2)) {
    if (p.includes(w)) n += 2;
    if (c.includes(w)) n += 1;
  }
  return n;
}

export async function readDroppedFile(file: File): Promise<{ name: string; content: string } | null> {
  if (file.size > 4_000_000) return null;
  if (file.type.startsWith("image/")) {
    const content = await dataUrl(file);
    return { name: file.name, content };
  }
  const text =
    /\.(py|js|ts|tsx|jsx|md|json|txt|csv|html|css|go|rs|java|c|cpp|h|cs|php|rb|toml|ya?ml|xml|svg)$/i.test(file.name) ||
    file.type.startsWith("text") ||
    file.type === "application/json" ||
    !file.type;
  if (!text) return null;
  return { name: file.name, content: await file.text() };
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function rewriteRefMedia(src: string, files: Record<string, string>): string {
  return src
    .replace(/(!\[[^\]]*\]\()(ref\/[^)]+)(\))/g, (full, a: string, p: string, c: string) => {
      const raw = files[p];
      return raw && isRefImage(raw) ? `${a}${raw}${c}` : full;
    })
    .replace(/(src=["'])(ref\/[^"']+)(["'])/gi, (full, a: string, p: string, c: string) => {
      const raw = files[p];
      return raw && isRefImage(raw) ? `${a}${raw}${c}` : full;
    });
}
