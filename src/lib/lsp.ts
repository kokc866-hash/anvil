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

const OPEN_MAX = 1_000_000;
const CLOSED_MAX = 400_000;

export function lintWorkspace(files: Record<string, string>, open: string[] = []): LspHit[] {
  const out: LspHit[] = [];
  const seen = new Set<string>();
  const openSet = new Set(open.filter((p) => p in files));
  const order = [...open.filter((p) => p in files), ...Object.keys(files).filter((p) => !openSet.has(p))];
  for (const path of order) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (skipPath(path)) continue;
    const src = files[path];
    if (!src) continue;
    const cap = openSet.has(path) ? OPEN_MAX : CLOSED_MAX;
    if (src.length >= cap) continue;
    if (!openSet.has(path) && seen.size > 120) break;
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "json") out.push(...lintJson(path, src));
    else if (ext === "py") out.push(...lintPython(path, src));
    else if (ext === "js" || ext === "mjs" || ext === "cjs" || ext === "ts" || ext === "tsx" || ext === "jsx") {
      out.push(...lintBraces(path, src, "js"));
    } else if (ext === "go" || ext === "rs" || ext === "c" || ext === "cpp" || ext === "h" || ext === "java" || ext === "cs" || ext === "php") {
      out.push(...lintBraces(path, src, "c"));
    }
    out.push(...lintImports(path, src, files));
    if (out.length > 200) break;
  }
  return out;
}

function hit(path: string, line: number, message: string, source: string, severity: LspSeverity = "error", col = 1): LspHit {
  return { path, line: Math.max(1, line), col, message, source, severity };
}

function lintJson(path: string, src: string): LspHit[] {
  try {
    JSON.parse(src);
    return [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : "JSON ungültig";
    const m = msg.match(/position\s+(\d+)/i);
    let line = 1;
    if (m) {
      const pos = Number(m[1]);
      line = src.slice(0, pos).split("\n").length;
    }
    const lm = msg.match(/line\s+(\d+)/i);
    if (lm) line = Number(lm[1]);
    return [hit(path, line, msg, "json")];
  }
}

function lintPython(path: string, src: string): LspHit[] {
  const hits: LspHit[] = [];
  const lines = src.split("\n");
  let indent = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const m = raw.match(/^(\s*)/);
    const spaces = (m?.[1] ?? "").replace(/\t/g, "    ").length;
    if (raw.includes("\t") && raw.startsWith(" ")) {
      hits.push(hit(path, i + 1, "Mischung Tab/Leerzeichen", "python", "warning"));
    }
    if (/^\s*(def|class|if|elif|else|for|while|try|except|finally|with|async def)\b/.test(raw) && !raw.trimEnd().endsWith(":") && !raw.trimEnd().endsWith("\\")) {
      hits.push(hit(path, i + 1, "Blockkopf ohne Doppelpunkt", "python"));
    }
    if (spaces > indent + 8) hits.push(hit(path, i + 1, "Sprung in der Einrückung", "python", "warning"));
    indent = spaces;
  }
  hits.push(...lintBraces(path, src, "py"));
  return hits;
}

function lintBraces(path: string, src: string, mode: "js" | "c" | "py"): LspHit[] {
  const hits: LspHit[] = [];
  const stack: { ch: string; line: number }[] = [];
  const open: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const close = new Set([")", "]", "}"]);
  let line = 1;
  let i = 0;
  let str: string | null = null;
  let triple = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (mode === "py" && !str && src.startsWith('"""', i)) {
      str = '"""';
      triple = true;
      i += 3;
      continue;
    }
    if (str) {
      if (str === '"""' && src.startsWith('"""', i)) {
        str = null;
        triple = false;
        i += 3;
        continue;
      }
      if (!triple && c === str && src[i - 1] !== "\\") str = null;
      i += 1;
      continue;
    }
    if (c === "#" && mode === "py") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if ((c === "/" && src[i + 1] === "/") || (mode !== "py" && c === "/" && src[i + 1] === "*")) {
      if (src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i += 1;
        continue;
      }
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      i += 1;
      continue;
    }
    if (open[c]) stack.push({ ch: c, line });
    else if (close.has(c)) {
      const last = stack.pop();
      if (!last || open[last.ch] !== c) hits.push(hit(path, line, `Unerwartetes ${c}`, mode === "py" ? "python" : "syntax"));
    }
    i += 1;
  }
  if (str) hits.push(hit(path, line, "String nicht geschlossen", "syntax"));
  for (const s of stack) hits.push(hit(path, s.line, `${s.ch} nicht geschlossen`, "syntax"));
  return hits;
}

function wordCount(src: string, name: string): number {
  if (!name || name.length < 2) return 0;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  return src.match(re)?.length ?? 0;
}

function lintImports(path: string, src: string, files: Record<string, string>): LspHit[] {
  const hits: LspHit[] = [];
  rebuildIndex(files);
  const row = getIndex().find((r) => r.path === path);
  if (!row) return hits;
  const seen = new Set<string>();
  for (const s of row.symbols) {
    const k = `${s.kind}:${s.name}`;
    if (seen.has(k) && s.kind === "fn") hits.push(hit(path, s.line, `Doppeltes ${s.name}`, "index", "warning"));
    seen.add(k);
  }
  for (const im of row.imports) {
    for (const n of im.names) {
      if (n === "React" || n === "self" || n.length < 2) continue;
      if (wordCount(src, n) <= 1) {
        const col = Math.max(1, (src.split("\n")[im.line - 1] ?? "").indexOf(n) + 1);
        hits.push(hit(path, im.line, `Import ${n} unbenutzt`, "index", "warning", col));
      }
    }
  }
  return hits;
}

const DEF_RE: RegExp[] = [
  /(?:^|\n)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g,
  /(?:^|\n)class\s+([A-Za-z_]\w*)/g,
  /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/g,
  /(?:^|\n)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/g,
  /(?:^|\n)func\s+([A-Za-z_]\w*)\s*\(/g,
  /(?:^|\n)fn\s+([A-Za-z_]\w*)\s*[<(]/g,
];

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
