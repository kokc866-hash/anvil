import { getIndex, lineAtOffset, lookupSymbol, rebuildIndex, resolveImport, sourceLines } from "./ws-index.ts";
import { skipPath } from "./ws-skip.ts";
import { hoverCode } from "./hover-markdown.ts";

export type LspSeverity = "error" | "warning" | "info";

export type LspHit = {
  path: string;
  line: number;
  col: number;
  message: string;
  source: string;
  severity: LspSeverity;
};

export type LspDef = { path: string; line: number; text: string };

export { lintWorkspace } from "./lsp-lint.ts";
import { DEF_RE } from "./lsp-lint.ts";

export function findDefinition(files: Record<string, string>, name: string, fromPath?: string): LspDef[] {
  const n = name.trim();
  if (!n || !/^[A-Za-z_]\w*$/.test(n)) return [];
  rebuildIndex(files);
  if (fromPath && files[fromPath]) {
    const row = getIndex().find((r) => r.path === fromPath);
    const im = row?.imports.find((i) => i.names.includes(n) || i.spec.split("/").pop() === n);
    if (im) {
      const dest = resolveImport(fromPath, im.spec, files);
      if (dest) {
        const inner = lookupSymbol(n, dest).filter((d) => d.path === dest);
        if (inner.length) return inner;
        return [{ path: dest, line: 1, text: dest }];
      }
    }
  }
  const indexed = lookupSymbol(n, fromPath);
  if (indexed.length) return indexed;
  const hits: LspDef[] = [];
  const order = fromPath ? [fromPath, ...Object.keys(files).filter((p) => p !== fromPath)] : Object.keys(files);
  for (const path of order) {
    const src = files[path] ?? "";
    let locations: ReturnType<typeof sourceLines> | undefined;
    for (const re of DEF_RE) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (m[1] !== n) continue;
        locations ??= sourceLines(src);
        const line = lineAtOffset(locations.starts, m.index + 1);
        const text = locations.lines[line - 1]?.trim() ?? n;
        hits.push({ path, line, text });
        if (hits.length >= 12) return hits;
      }
    }
  }
  return hits;
}

const symbolCache = new Map<string, { source: string; hits: LspDef[] }>();
const SYMBOL_CACHE_CHARS = 4_000_000;
let symbolCacheChars = 0;

export function listSymbols(src: string, path: string): LspDef[] {
  const cached = symbolCache.get(path);
  if (cached?.source === src) {
    symbolCache.delete(path);
    symbolCache.set(path, cached);
    return cached.hits;
  }
  if (cached) {
    symbolCacheChars -= cached.source.length;
    symbolCache.delete(path);
  }
  const hits = parseFileLocal(path, src);
  if (src.length <= SYMBOL_CACHE_CHARS) {
    symbolCache.set(path, { source: src, hits });
    symbolCacheChars += src.length;
    while (symbolCache.size > 32 || symbolCacheChars > SYMBOL_CACHE_CHARS) {
      const oldest = symbolCache.keys().next().value!;
      symbolCacheChars -= symbolCache.get(oldest)!.source.length;
      symbolCache.delete(oldest);
    }
  }
  return hits;
}

function parseFileLocal(path: string, src: string): LspDef[] {
  const hits: LspDef[] = [];
  const seen = new Set<string>();
  const { lines, starts } = sourceLines(src);
  for (const re of DEF_RE) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const name = m[1];
      const line = lineAtOffset(starts, m.index + 1);
      const key = `${name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ path, line, text: lines[line - 1]?.trim() ?? name });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

export function wordAt(src: string, offset: number): string {
  const is = (c: string) => /[A-Za-z0-9_]/.test(c);
  let a = offset;
  let b = offset;
  while (a > 0 && is(src[a - 1])) a -= 1;
  while (b < src.length && is(src[b])) b += 1;
  return src.slice(a, b);
}

export async function defsAt(
  files: Record<string, string>,
  path: string,
  offset: number,
  open: string[] = [],
): Promise<LspDef[]> {
  try {
    const { tsDefinition } = await import("./lsp-compile.ts");
    const ts = await tsDefinition(files, path, offset, open);
    if (ts.length) return ts.map((d) => ({ path: d.path, line: d.line, text: d.text }));
  } catch {
    /* */
  }
  return findDefinition(files, wordAt(files[path] ?? "", offset), path);
}

export function hoverFor(files: Record<string, string>, path: string, src: string, offset: number, locale = "de"): string | null {
  const w = wordAt(src, offset);
  if (!w) return null;
  const defs = findDefinition(files, w, path);
  // A repeated word without a definition adds no useful information.
  if (!defs.length) return null;
  const d = defs[0];
  const en = locale === "en";
  const more = defs.length > 1 ? (en ? ` ${defs.length} matching declarations; showing the first.` : ` ${defs.length} passende Deklarationen; angezeigt wird die erste.`) : "";
  const note = en
    ? "Found by symbol name. The reference and type have not been verified by a language service."
    : "Über den Symbolnamen gefunden. Die Zuordnung und der Typ wurden nicht durch einen Sprachdienst geprüft.";
  return `**${en ? "Possible declaration" : "Mögliche Deklaration"}**\n\n${hoverCode(`${d.path}:${d.line}`)}\n\n${hoverCode(d.text)}\n\n${note}${more}`;
}

export function renameSymbol(
  files: Record<string, string>,
  path: string,
  offset: number,
  nextName: string,
): { files: Record<string, string>; n: number } | { error: string } {
  const from = wordAt(files[path] ?? "", offset);
  const to = nextName.trim();
  if (!from) return { error: "Kein Symbol" };
  if (!/^[A-Za-z_]\w*$/.test(to)) return { error: "Ungültiger Name" };
  if (from === to) return { files: {}, n: 0 };
  rebuildIndex(files);
  const defs = findDefinition(files, from, path);
  const paths = new Set<string>([path]);
  for (const d of defs) paths.add(d.path);
  for (const row of getIndex()) {
    if (row.imports.some((i) => i.names.includes(from))) paths.add(row.path);
    if (row.symbols.some((s) => s.name === from)) paths.add(row.path);
  }
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const out: Record<string, string> = {};
  let n = 0;
  for (const p of paths) {
    if (skipPath(p)) continue;
    const src = files[p];
    if (src == null) continue;
    const next = src.replace(re, to);
    if (next === src) continue;
    n += src.match(re)?.length ?? 0;
    out[p] = next;
  }
  if (!n) return { error: "Nichts zu ersetzen" };
  return { files: out, n };
}

export function problemsPrompt(
  hits: { path: string; line: number; message?: string; text?: string; source?: string; severity?: LspSeverity }[],
  files?: Record<string, string>,
): string {
  if (!hits.length) return "";
  const lines = hits.slice(0, 24).map((h) => `${h.path}:${h.line} [${h.severity ?? "error"} · ${h.source ?? "unbekannte Quelle"}] ${h.message ?? h.text ?? ""}`);
  const paths = [...new Set(hits.map((h) => h.path))].slice(0, 6);
  const bodies = files
    ? paths
        .map((p) => {
          const src = files[p];
          if (!src) return "";
          return `\n${p}:\n\`\`\`${p}\n${src.slice(0, 5000)}\n\`\`\``;
        })
        .filter(Boolean)
        .join("\n")
    : "";
  return `Behebe diese Probleme im Workspace. Nutze write_file oder edit_file — die Tools sind aktiv. Beachte Quelle und Schweregrad: Näherungen sind Hinweise, kein Compilerbeweis. Behalte korrekten Code bei. Prüfe nach der letzten Änderung die betroffenen Diagnosen und gegebenenfalls den Run erneut. Ein fehlgeschlagener oder früherer Run bestätigt keine Korrektur. Nenne offen verbliebene Fehler und nicht mögliche Prüfungen.\n\n${lines.join("\n")}${bodies}`;
}
