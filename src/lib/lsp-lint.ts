import { getIndex, rebuildIndex, resolveImport } from "./ws-index.ts";
import { skipPath } from "./ws-skip.ts";
import type { LspHit, LspSeverity } from "./lsp";

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

export const DEF_RE: RegExp[] = [
  /(?:^|\n)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g,
  /(?:^|\n)class\s+([A-Za-z_]\w*)/g,
  /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/g,
  /(?:^|\n)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/g,
  /(?:^|\n)func\s+([A-Za-z_]\w*)\s*\(/g,
  /(?:^|\n)fn\s+([A-Za-z_]\w*)\s*[<(]/g,
];

