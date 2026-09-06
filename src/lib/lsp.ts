import { getIndex, lookupSymbol, rebuildIndex, resolveImport } from "./ws-index.ts";
import { skipPath } from "./ws-skip.ts";

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
import { lintWorkspace, DEF_RE } from "./lsp-lint.ts";

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
    for (const re of DEF_RE) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (m[1] !== n) continue;
        const line = src.slice(0, m.index + 1).split("\n").length;
        const text = src.split("\n")[line - 1]?.trim() ?? n;
        hits.push({ path, line, text });
        if (hits.length >= 12) return hits;
      }
    }
  }
  return hits;
}

export function listSymbols(src: string, path: string): LspDef[] {
  return parseFileLocal(path, src);
}

function parseFileLocal(path: string, src: string): LspDef[] {
  const hits: LspDef[] = [];
  const seen = new Set<string>();
  for (const re of DEF_RE) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const name = m[1];
      const line = src.slice(0, m.index + 1).split("\n").length;
      const key = `${name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ path, line, text: src.split("\n")[line - 1]?.trim() ?? name });
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

export function hoverFor(files: Record<string, string>, path: string, src: string, offset: number): string | null {
  const w = wordAt(src, offset);
  if (!w) return null;
  const defs = findDefinition(files, w, path);
  if (!defs.length) return w.length > 1 ? `\`${w}\` · Näherung` : null;
  const d = defs[0];
  const more = defs.length > 1 ? ` · ${defs.length} Treffer` : "";
  return `**${w}** · Näherung — ${d.path}:${d.line}${more}\n\n\`${d.text}\``;
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
  hits: { path: string; line: number; message?: string; text?: string }[],
  files?: Record<string, string>,
): string {
  if (!hits.length) return "";
  const lines = hits.slice(0, 24).map((h) => `${h.path}:${h.line} ${h.message ?? h.text ?? ""}`);
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
  return `Behebe diese Probleme im Workspace. Nutze write_file oder edit_file — die Tools sind aktiv. Nur die genannten Stellen, dann kurz sagen, was du geändert hast.\n\n${lines.join("\n")}${bodies}`;
}
