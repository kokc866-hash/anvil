import { contentSig, isSourcePath, rankPaths, skipPath } from "./ws-skip.ts";
import { isSecretPath } from "./ref.ts";

export type IdxKind = "fn" | "class" | "var" | "type";

export type IdxSym = { name: string; kind: IdxKind; line: number; text: string };

export type IdxImport = { spec: string; names: string[]; line: number };

export type IdxFile = {
  path: string;
  lang: string;
  lines: number;
  hint: string;
  symbols: IdxSym[];
  imports: IdxImport[];
};

export type IdxHit = { kind: "file" | "symbol"; path: string; line: number; label: string };

function secret(path: string): boolean {
  return isSecretPath(path);
}

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function langOf(path: string): string {
  const e = extOf(path);
  if (e === "py") return "py";
  if (e === "ts" || e === "tsx" || e === "js" || e === "jsx" || e === "mjs" || e === "cjs") return "js";
  if (e === "go") return "go";
  if (e === "rs") return "rs";
  if (e === "java") return "java";
  if (e === "cs") return "cs";
  if (e === "php") return "php";
  if (e === "rb") return "rb";
  return e;
}

function oneLine(src: string): string {
  const m = src.match(/^\s*(?:\/\/|#|\/\*\*?\s*)(.{8,90})/m);
  if (!m) return "";
  return m[1].replace(/\*\/$/, "").replace(/\s+/g, " ").trim();
}

const SYM: { re: RegExp; kind: IdxKind }[] = [
  { re: /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/g, kind: "fn" },
  { re: /(?:^|\n)(?:export\s+)?class\s+([A-Za-z_]\w*)/g, kind: "class" },
  { re: /(?:^|\n)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/g, kind: "var" },
  { re: /(?:^|\n)(?:export\s+)?(?:type|interface|enum)\s+([A-Za-z_]\w*)/g, kind: "type" },
  { re: /(?:^|\n)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g, kind: "fn" },
  { re: /(?:^|\n)class\s+([A-Za-z_]\w*)\s*[:(]/g, kind: "class" },
  { re: /(?:^|\n)func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g, kind: "fn" },
  { re: /(?:^|\n)fn\s+([A-Za-z_]\w*)\s*[<(]/g, kind: "fn" },
  { re: /(?:^|\n)(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g, kind: "type" },
];

function parseSymbols(src: string): IdxSym[] {
  const out: IdxSym[] = [];
  const seen = new Set<string>();
  const lines = src.split("\n");
  for (const { re, kind } of SYM) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const name = m[1];
      const line = src.slice(0, m.index + 1).split("\n").length;
      const key = `${name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, kind, line, text: (lines[line - 1] ?? name).trim() });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function parseImports(src: string): IdxImport[] {
  const out: IdxImport[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    let spec = "";
    let names: string[] = [];
    let m = t.match(/^import\s+(?:type\s+)?(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?\s+from\s+['"]([^'"]+)['"]/);
    if (m) {
      spec = m[3];
      if (m[1]) names.push(m[1]);
      if (m[2]) names.push(...m[2].split(",").map((s) => (s.trim().split(/\s+as\s+/).pop() ?? "").trim()).filter(Boolean));
    } else if ((m = t.match(/^import\s+['"]([^'"]+)['"]/))) {
      spec = m[1];
      names = [spec.split("/").pop() ?? spec];
    } else if ((m = t.match(/^from\s+(\S+)\s+import\s+(.+)$/))) {
      spec = m[1].replace(/,/g, "");
      names = m[2]
        .replace(/[()]/g, "")
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter((n) => n && n !== "*");
    } else if ((m = t.match(/^import\s+([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?/))) {
      spec = m[1];
      names = [m[2] || m[1].split(".").pop() || m[1]];
    }
    if (spec) out.push({ spec, names, line: i + 1 });
    if (out.length > 80) break;
  }
  return out;
}

export function parseFile(path: string, src: string): IdxFile {
  const binary = !src || /^data:/i.test(src.slice(0, 12));
  return {
    path,
    lang: langOf(path),
    lines: binary ? 0 : src.split("\n").length,
    hint: binary ? "binär" : oneLine(src),
    symbols: binary ? [] : parseSymbols(src.slice(0, 120_000)),
    imports: binary ? [] : parseImports(src.slice(0, 40_000)),
  };
}

type IdxRef = IdxSym & { path: string };
type FileCache = { sig: string; row: IdxFile };

let cache: { files: Map<string, FileCache>; rows: IdxFile[]; byName: Map<string, IdxRef[]> } | null = null;

function rebuildByName(rows: IdxFile[]): Map<string, IdxRef[]> {
  const byName = new Map<string, IdxRef[]>();
  for (const row of rows) {
    for (const s of row.symbols) {
      const list = byName.get(s.name) ?? [];
      list.push({ ...s, path: row.path });
      byName.set(s.name, list.length > 24 ? list.slice(0, 24) : list);
    }
  }
  return byName;
}

export function rebuildIndex(files: Record<string, string>): IdxFile[] {
  const prev = cache?.files ?? new Map<string, FileCache>();
  const next = new Map<string, FileCache>();
  const rows: IdxFile[] = [];
  let dirty = !cache;
  const paths = Object.keys(files).sort();
  for (const path of paths) {
    if (skipPath(path) || secret(path)) continue;
    const src = files[path];
    if (src == null) continue;
    if (/^data:image\//i.test(src) || /^\s*\[image /i.test(src)) continue;
    const sig = contentSig(src);
    const hit = prev.get(path);
    const row = hit && hit.sig === sig ? hit.row : parseFile(path, src);
    if (!hit || hit.sig !== sig) dirty = true;
    next.set(path, { sig, row });
    rows.push(row);
    if (rows.length >= 2500) break;
  }
  if (cache && !dirty && cache.files.size === next.size) return cache.rows;
  cache = { files: next, rows, byName: rebuildByName(rows) };
  return rows;
}

export function getIndex(files?: Record<string, string>): IdxFile[] {
  if (files) return rebuildIndex(files);
  return cache?.rows ?? [];
}

export function lookupSymbol(name: string, fromPath?: string): { path: string; line: number; text: string }[] {
  const n = name.trim();
  if (!n || !/^[A-Za-z_]\w*$/.test(n) || !cache) return [];
  const list = cache.byName.get(n) ?? [];
  const ordered = fromPath ? [...list.filter((x) => x.path === fromPath), ...list.filter((x) => x.path !== fromPath)] : list;
  return ordered.slice(0, 12).map((x) => ({ path: x.path, line: x.line, text: x.text }));
}

export function resolveImport(fromPath: string, spec: string, files: Record<string, string>): string | null {
  const raw = spec.replace(/\\/g, "/").replace(/^['"]|['"]$/g, "");
  if (!raw || raw.startsWith("node:") || raw.startsWith("http")) return null;
  const dir = fromPath.split("/").slice(0, -1);
  const parts = raw.split("/");
  const stack = raw.startsWith(".") ? [...dir] : [];
  if (!raw.startsWith(".")) {
    const base = raw.replace(/^\.+/, "");
    const hits = [
      `${base}.py`,
      `${base}/__init__.py`,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.go`,
      ...Object.keys(files).filter((p) => p === base || p.endsWith(`/${base}`) || p.endsWith(`/${base}.py`) || p.endsWith(`/${base}.ts`)),
    ];
    return hits.find((p) => p in files) ?? null;
  }
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  const joined = stack.join("/");
  const cands = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.mjs`,
    `${joined}.py`,
    `${joined}.go`,
    `${joined}/index.ts`,
    `${joined}/index.js`,
    `${joined}/__init__.py`,
  ];
  return cands.find((p) => p in files) ?? null;
}

export function searchIndex(q: string, files?: Record<string, string>, limit = 40): IdxHit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const rows = files ? rebuildIndex(files) : cache?.rows ?? [];
  const out: IdxHit[] = [];
  for (const row of rows) {
    if (row.path.toLowerCase().includes(needle) || row.hint.toLowerCase().includes(needle)) {
      out.push({ kind: "file", path: row.path, line: 1, label: row.hint ? `${row.path} — ${row.hint}` : row.path });
    }
    for (const s of row.symbols) {
      if (s.name.toLowerCase().includes(needle)) {
        out.push({ kind: "symbol", path: row.path, line: s.line, label: `${s.name}  ${row.path}:${s.line}` });
      }
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

export function summarizeFile(path: string, src: string): string {
  const row = parseFile(path, src);
  const ns = row.symbols.slice(0, 6).map((s) => s.name);
  const bits = [row.hint, ns.join(", "), row.lines ? `${row.lines} Z.` : ""].filter(Boolean);
  return bits.join(" · ").slice(0, 140) || "—";
}

export function workspaceIndex(files: Record<string, string>, limit = 120, prefer: string[] = []): string {
  const rows = rebuildIndex(files);
  const byPath = new Map(rows.map((r) => [r.path, r]));
  const order = rankPaths(
    rows.map((r) => r.path),
    prefer,
  );
  return order
    .slice(0, limit)
    .map((p) => {
      const r = byPath.get(p);
      if (!r) return p;
      const ns = r.symbols.slice(0, 6).map((s) => s.name).join(", ");
      const bits = [r.hint, ns, `${r.lines} Z.`].filter(Boolean);
      return `${r.path} — ${bits.join(" · ")}`;
    })
    .join("\n");
}

export function workspaceTree(files: Record<string, string>, prefer: string[] = [], limit = 180): string {
  const paths = Object.keys(files).filter((p) => !skipPath(p) && !secret(p)).sort();
  if (!paths.length) return "(empty)";
  if (paths.length <= limit) return paths.join("\n");
  const preferSet = new Set(prefer.filter((p) => p in files && !skipPath(p)));
  const rest = paths.filter((p) => !preferSet.has(p));
  const shown = [...preferSet, ...rest.filter(isSourcePath), ...rest].filter((p, i, a) => a.indexOf(p) === i).slice(0, limit);
  const hidden = paths.length - shown.length;
  const folders = new Map<string, number>();
  const shownSet = new Set(shown);
  for (const p of paths) {
    if (shownSet.has(p)) continue;
    const top = p.split("/")[0] ?? p;
    folders.set(top, (folders.get(top) ?? 0) + 1);
  }
  const extra = [...folders.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([k, n]) => `${k}/  (${n})`)
    .join("\n");
  return `${shown.join("\n")}\n… ${hidden} weitere — list_files / grep${extra ? `\n${extra}` : ""}`;
}

const ENTRY = [
  "package.json",
  "README.md",
  "AGENTS.md",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "index.html",
  "src/main.ts",
  "src/index.ts",
  "src/app.ts",
  "main.py",
  "app.py",
  "tsconfig.json",
  "Makefile",
];

/** Folder-first map for medium projects. Cheaper than dumping every path. */
export function workspaceMap(files: Record<string, string>, prefer: string[] = []): string {
  const paths = Object.keys(files).filter((p) => !skipPath(p) && !secret(p)).sort();
  if (!paths.length) return "(empty)";
  const folders = new Map<string, string[]>();
  let loc = 0;
  for (const p of paths) {
    loc += (files[p] ?? "").split("\n").length;
    const top = p.includes("/") ? `${p.split("/")[0]}/` : ".";
    const list = folders.get(top) ?? [];
    list.push(p);
    folders.set(top, list);
  }
  const folderLines = [...folders.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 28)
    .map(([k, kids]) => {
      const samples = rankPaths(kids, prefer)
        .slice(0, 3)
        .map((p) => (k === "." ? p : p.slice(k.length)));
      return `${k.padEnd(18)} ${String(kids.length).padStart(3)}  ${samples.join(", ")}`;
    });
  const entries = ENTRY.filter((p) => p in files && !skipPath(p));
  const focus = uniq(prefer.filter((p) => p in files && !skipPath(p))).slice(0, 12);
  const focusLines = focus.map((p) => `  ${p} — ${summarizeFile(p, files[p] ?? "")}`);
  const n = paths.length;
  return [
    `${n} Dateien · ${folders.size} Ordner · ${loc} Zeilen`,
    entries.length ? `Einstieg: ${entries.join(", ")}` : "",
    folderLines.join("\n"),
    focusLines.length ? `Fokus:\n${focusLines.join("\n")}` : "",
    n > 60 ? "Mittleres/großes Projekt: list_files, grep, read_file in Fenstern. edit_file statt ganzer Datei." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

