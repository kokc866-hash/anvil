export const REF_DIR = "ref";

export function isRefPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  return norm === REF_DIR || norm.startsWith(`${REF_DIR}/`);
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

export function safeRefRel(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((p) => safeRefName(p));
  return parts.join("/") || "datei";
}

export function uniqueRefPath(files: Record<string, string>, name: string): string {
  const rel = safeRefRel(name);
  let path = `${REF_DIR}/${rel}`;
  if (!(path in files)) return path;
  const segs = rel.split("/");
  const base = segs.pop() ?? "datei";
  const dir = segs.join("/");
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  const prefix = dir ? `${REF_DIR}/${dir}/` : `${REF_DIR}/`;
  for (let i = 2; i < 50; i++) {
    path = `${prefix}${stem}-${i}${ext}`;
    if (!(path in files)) return path;
  }
  return `${prefix}${stem}-${Date.now().toString(36)}${ext}`;
}

export function isRefImage(content: string): boolean {
  const t = content.trim();
  return /^data:image\//i.test(t) || /^<svg[\s>]/i.test(t) || /^\s*\[image /i.test(t);
}

export function isRefImageFile(path: string, content?: string): boolean {
  if (/\.(png|jpe?g|gif|webp|ico|bmp)$/i.test(path)) return true;
  return Boolean(content && isRefImage(content));
}

export function refImageSrc(content: string): string {
  const t = content.trim();
  if (/^data:image\//i.test(t)) return t;
  if (/^<svg[\s>]/i.test(t)) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(t)}`;
  return t;
}

export function imageStub(path: string, content: string): string {
  const mime = content.match(/^data:([^;,]+)/i)?.[1] ?? (/\.svg$/i.test(path) || /^<svg/i.test(content) ? "image/svg+xml" : "image");
  return `[image ${path} ${mime} ${content.length} chars — vision / ref index, not text]`;
}

export function copyIntoRef(
  files: Record<string, string>,
  fromPath: string,
): { path: string } | { error: string } {
  if (isSecretPath(fromPath)) return { error: "Geheimnis bleibt außerhalb von ref/" };
  if (isRefPath(fromPath)) return { error: "liegt schon in ref/" };
  const dest = uniqueRefPath(files, fromPath.split("/").pop() ?? fromPath);
  if (isSecretPath(dest)) return { error: "Geheimnis bleibt außerhalb von ref/" };
  return { path: dest };
}

const REF_OK_NEW = /\.(md|txt|json|csv|html|svg|ya?ml|xml)$/i;
const REF_CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|rb|vue|svelte)$/i;

/** Block new source files in ref/. Edits of existing specs and md/images stay. */
export function refWriteBlocked(path: string, content: string, exists: boolean): string | null {
  if (!isRefPath(path) || path === REF_DIR) return null;
  if (exists) return null;
  if (isRefImage(content) || /^data:image\//i.test(content)) return null;
  if (REF_OK_NEW.test(path)) return null;
  if (REF_CODE.test(path)) return "ref/ is references, not source. Write code outside ref/.";
  return null;
}

export function modelSeesImages(provider: string, model: string): boolean {
  const p = (provider || "").toLowerCase();
  const m = (model || "").toLowerCase();
  if (/ollama|lmstudio|llamacpp|gpt4all|jan|kobold|textgen|vllm|localai|openwebui/.test(p)) {
    return /llava|moondream|vision|minicpm|qwen2.?vl|qwen-vl|pixtral|gemma-3|llama-?3\.2.*vision|gpt-4o/.test(m);
  }
  if (/anthropic|grok|openai|gemini|openrouter|codex|xai/.test(p)) return true;
  return /gpt-4o|gpt-4\.1|claude|gemini|grok|vision|llava/.test(m);
}

const SECRET_SRC = /\.(md|ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i;

export function isSecretPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  const base = norm.split("/").pop() ?? "";
  if (/\.env\.(example|sample|template)$/i.test(base)) return false;
  if (/(^|\/)\.env($|\.(?!example|sample|template))/i.test(norm)) return true;
  if (/(^|\/)(\.git-credentials|id_rsa|credentials)$/i.test(norm)) return true;
  if (/\.(pem|p12|pfx)$/i.test(base)) return true;
  if (SECRET_SRC.test(base)) return false;
  if (/^(secrets?|password|token)(\.|$)/i.test(base)) return true;
  if (/api[_-]?key/i.test(base)) return true;
  if (/(^|\/)(secrets?|vault)(\.|\/|$)/i.test(norm)) return true;
  return false;
}

export function omitSecrets(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) if (!isSecretPath(p)) out[p] = c;
  return out;
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

const STOP = new Set([
  "und",
  "oder",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "ein",
  "eine",
  "einer",
  "ist",
  "nicht",
  "mit",
  "von",
  "für",
  "auf",
  "aus",
  "im",
  "in",
  "zu",
  "the",
  "and",
  "or",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "was",
  "wie",
  "als",
  "auch",
  "noch",
  "nur",
  "bitte",
]);

function queryWords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9äöüß_-]+/i)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const INDEX_CAP = 24;
const FULL_CAP = 20_000;

export function packRefContext(
  files: Record<string, string>,
  query = "",
  prefer: string[] = [],
  opts?: { vision?: boolean },
): { text: string; images: string[] } {
  const paths = refFiles(files).filter((p) => !isSecretPath(p));
  if (!paths.length) return { text: "", images: [] };
  const q = query.trim().toLowerCase();
  const preferAll = prefer.some((p) => p === REF_DIR || p === `${REF_DIR}/`);
  const preferSet = new Set(prefer.filter((p) => p !== REF_DIR && p !== `${REF_DIR}/` && isRefPath(p) && paths.includes(p)));
  if (preferAll) for (const p of paths) preferSet.add(p);
  const ranked = [...paths].sort((a, b) => {
    const pa = preferSet.has(a) ? 50 : 0;
    const pb = preferSet.has(b) ? 50 : 0;
    if (pa !== pb) return pb - pa;
    if (!q) return a.localeCompare(b);
    return score(b, files[b] ?? "", q) - score(a, files[a] ?? "", q);
  });
  const index = ranked
    .slice(0, INDEX_CAP)
    .map((p) => `- ${p} — ${refIndexLine(p, files[p] ?? "")}`)
    .join("\n");
  const more = ranked.length > INDEX_CAP ? `\n… ${ranked.length - INDEX_CAP} weitere — list_files prefix=${REF_DIR}` : "";
  const images: string[] = [];
  const vision = opts?.vision !== false;
  const blocks: string[] = [`Referenzen in ${REF_DIR}/:\n${index}${more}`];
  let used = 0;
  const deep = ranked.filter((p) => preferSet.has(p) || (q && score(p, files[p] ?? "", q) > 0)).slice(0, 8);
  const take = deep.length ? deep : ranked.slice(0, 4);
  for (const path of take) {
    const raw = files[path] ?? "";
    if (isRefImage(raw) && !/^\s*\[image /i.test(raw)) {
      if (vision && images.length < 3) images.push(refImageSrc(raw));
      else blocks.push(`### ${path}\nBild — dieses Modell sieht keine Bilder. Nicht als Text lesen.`);
      continue;
    }
    if (/^\s*\[image /i.test(raw)) {
      blocks.push(`### ${path}\n${raw}`);
      continue;
    }
    const full = preferSet.has(path) || (q && score(path, raw, q) > 0);
    const cap = full ? Math.min(raw.length, FULL_CAP) : used < 5000 ? 800 : 160;
    const excerpt = raw.slice(0, cap).trim();
    const rest = raw.length > excerpt.length ? `\n[continue: read_file path="${path}"]` : "";
    blocks.push(`### ${path}\n${excerpt}${rest}`);
    used += excerpt.length;
    if (used > 24_000) break;
  }
  blocks.push("Spec in ref/ — read_file der passenden Datei, nicht raten.");
  return { text: blocks.join("\n\n"), images };
}

function score(path: string, content: string, q: string): number {
  const p = path.toLowerCase();
  const c = isRefImage(content) ? p : content.toLowerCase();
  let n = 0;
  if (q.length < 80 && p.includes(q)) n += 5;
  if (q.length < 80 && c.includes(q)) n += 3;
  for (const w of queryWords(q)) {
    if (p.includes(w)) n += 2;
    if (c.includes(w)) n += 1;
  }
  return n;
}

export async function readDroppedFile(file: File): Promise<{ name: string; content: string } | null> {
  if (file.size > 8_000_000) return null;
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|ico|bmp)$/i.test(file.name)) {
    if (file.size > 4_000_000) return null;
    const content = await dataUrl(file);
    return { name: file.name, content };
  }
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const { extractPdfText } = await import("./archive");
    const text = extractPdfText(await file.arrayBuffer());
    if (!text.trim()) return null;
    return { name: file.name.replace(/\.pdf$/i, ".md"), content: text };
  }
  if (/\.docx$/i.test(file.name)) {
    const text = await docxText(await file.arrayBuffer());
    if (!text.trim()) return null;
    return { name: file.name.replace(/\.docx$/i, ".md"), content: text };
  }
  const text =
    /\.(py|js|ts|tsx|jsx|md|json|txt|csv|html|css|go|rs|java|c|cpp|h|cs|php|rb|toml|ya?ml|xml|svg)$/i.test(file.name) ||
    file.type.startsWith("text") ||
    file.type === "application/json" ||
    !file.type;
  if (!text) return null;
  return { name: file.name, content: await file.text() };
}

async function docxText(buf: ArrayBuffer): Promise<string> {
  const { unzipFiles } = await import("./archive");
  const pack = await unzipFiles(buf);
  const xml = pack["word/document.xml"] ?? "";
  return xml
    .replace(/<w:tab\b[^/]*\/>/g, "\t")
    .replace(/<w:br\b[^/]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function mediaSrc(files: Record<string, string>, p: string): string | null {
  const clean = p.replace(/^\.\//, "").replace(/\\/g, "/");
  const raw = files[clean] ?? files[clean.replace(/^\//, "")];
  if (!raw) return null;
  if (isRefImage(raw) && !/^\s*\[image /i.test(raw)) return refImageSrc(raw);
  return null;
}

export function rewriteRefMedia(src: string, files: Record<string, string>): string {
  const swap = (full: string, a: string, p: string, c: string) => {
    const url = mediaSrc(files, p);
    return url ? `${a}${url}${c}` : full;
  };
  return src
    .replace(/(!\[[^\]]*\]\()(\.?\/?ref\/[^)]+)(\))/g, swap)
    .replace(/((?:src|href)=["'])(\.?\/?ref\/[^"']+)(["'])/gi, swap)
    .replace(/(url\(\s*['"]?)(\.?\/?ref\/[^'")\s]+)(['"]?\s*\))/gi, swap);
}
