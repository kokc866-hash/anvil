import type { LspHit } from "./lsp";

const OPEN_MAX = 1_000_000;
const CLOSED_MAX = 200_000;

function hit(path: string, line: number, col: number, message: string, source: string, severity: LspHit["severity"] = "error"): LspHit {
  return { path, line: Math.max(1, line), col: Math.max(1, col), message: message.slice(0, 240), source, severity };
}

function tsRoots(files: Record<string, string>, open: string[] = []): string[] {
  const all = Object.keys(files).filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p) && !p.includes("node_modules") && !p.includes("anvil-lib"));
  const prefer = open.filter((p) => all.includes(p));
  const rest = all.filter((p) => !prefer.includes(p));
  const ok = (p: string) => {
    const n = files[p]?.length ?? 0;
    return n > 0 && n < (prefer.includes(p) ? OPEN_MAX : CLOSED_MAX);
  };
  return [...prefer, ...rest].filter(ok).slice(0, 64);
}

type TsMod = typeof import("typescript");
type Bundle = { revision: number; versions: Map<string, number>; options: import("typescript").CompilerOptions; ls: import("typescript").LanguageService; files: Record<string, string>; roots: string[]; ts: TsMod; config: string; configErrors: import("typescript").Diagnostic[] };
const bundles = new Map<string, Bundle>();
let tsMod: TsMod | null | undefined;

async function loadTs(): Promise<TsMod | null> {
  if (tsMod !== undefined) return tsMod;
  try {
    tsMod = await import("typescript");
    return tsMod;
  } catch {
    tsMod = null;
    return null;
  }
}

function normalPath(name: string): string {
  const parts: string[] = [];
  for (const part of name.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return parts.join("/");
}

let standardLibs: Record<string, string> = {};
try {
  // Vite replaces the call itself. A runtime typeof import.meta.glob guard is false in a built worker.
  standardLibs = Object.fromEntries(Object.entries(import.meta.glob("../../node_modules/typescript/lib/lib*.d.ts", { query: "?raw", import: "default", eager: true })).map(([path, content]) => [path.split("/").pop()!, String(content)]));
} catch { /* Direct Node consumers load the same installed TypeScript libraries below. */ }

function configFor(path: string, files: Record<string, string>): string {
  const parts = path.split("/"); parts.pop();
  while (true) {
    const prefix = parts.length ? parts.join("/") + "/" : "";
    for (const name of ["tsconfig.json", "jsconfig.json"]) if (prefix + name in files) return prefix + name;
    if (!parts.length) return "";
    parts.pop();
  }
}

function matches(pattern: string, path: string): boolean {
  const expr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "@@").replace(/\*\*/g, "##").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/@@/g, "(?:.*/)?").replace(/##/g, ".*");
  return new RegExp(`^${expr}(?:/.*)?$`).test(path);
}

export function disposeTs(): void { for (const b of bundles.values()) b.ls.dispose(); bundles.clear(); }

export async function ensureTs(files: Record<string, string>, open: string[] = []): Promise<Bundle | null> {
  const ts = await loadTs();
  if (!ts) throw new Error("TypeScript-Sprachdienst nicht verfügbar.");
  if (!Object.keys(standardLibs).length && ts.sys?.readDirectory) {
    const dir = ts.getDefaultLibFilePath({}).replace(/[^/\\]+$/, "");
    for (const path of ts.sys.readDirectory(dir, [".ts"], undefined, ["lib*.d.ts"])) {
      const content = ts.sys.readFile(path);
      if (content != null) standardLibs[path.split(/[/\\]/).pop()!] = content;
    }
  }
  if (!standardLibs["lib.es5.d.ts"]) throw new Error("TypeScript-Standardbibliotheken fehlen. Installation reparieren.");
  const groups = new Map<string, string[]>();
  for (const path of tsRoots(files, open)) {
    const config = configFor(path, files);
    const roots = groups.get(config) ?? []; roots.push(path); groups.set(config, roots);
  }
  for (const [key, b] of bundles) if (!groups.has(key)) { b.ls.dispose(); bundles.delete(key); }
  for (const [config, roots] of groups) {
    const defaults: import("typescript").CompilerOptions = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX, allowJs: true, checkJs: false, strict: false,
    };
    const errors: import("typescript").Diagnostic[] = [];
    const parsed = config ? ts.getParsedCommandLineOfConfigFile("/" + config, undefined, {
      useCaseSensitiveFileNames: true, getCurrentDirectory: () => "/",
      fileExists: (name) => normalPath(name) in files,
      readFile: (name) => files[normalPath(name)],
      onUnRecoverableConfigFileDiagnostic: (d) => errors.push(d),
      readDirectory: (root, extensions, excludes, includes) => Object.keys(files).filter((name) => {
        const base = normalPath(root), prefix = base ? base + "/" : "";
        return name.startsWith(prefix) && extensions.some((ext) => name.endsWith(ext))
          && !(excludes ?? []).some((p) => matches(normalPath(p.startsWith("/") ? p : root + "/" + p), name))
          && (includes ?? ["**/*"]).some((p) => matches(normalPath(p.startsWith("/") ? p : root + "/" + p), name));
      }).map((name) => "/" + name),
    }) : undefined;
    errors.push(...(parsed?.errors ?? []));
    const options = { ...defaults, ...parsed?.options, noEmit: true, skipLibCheck: true };
    delete (options as import("typescript").CompilerOptions).configFile;
    const included = new Set(parsed?.fileNames.map(normalPath));
    const selected = roots.filter((path) => !config || open.includes(path) || included.has(path));
    const b = bundles.get(config);
    if (b) {
      let changed = JSON.stringify(b.roots) !== JSON.stringify(selected) || JSON.stringify(b.options) !== JSON.stringify(options);
      if (b.files !== files) for (const name of new Set([...Object.keys(b.files), ...Object.keys(files)])) {
        if (b.files[name] !== files[name]) { b.versions.set(name, (b.versions.get(name) ?? 0) + 1); changed = true; }
      }
      b.files = files; b.roots = selected; b.options = options; b.configErrors = errors;
      if (changed) b.revision++;
    } else bundles.set(config, createBundle(ts, files, selected, options, errors, config));
  }
  return bundles.values().next().value ?? null;
}

function createBundle(ts: TsMod, files: Record<string, string>, roots: string[], options: import("typescript").CompilerOptions, configErrors: import("typescript").Diagnostic[], config: string): Bundle {
  const b = { revision: 1, versions: new Map(Object.keys(files).map((p) => [p, 1])), files, roots, options, ts, configErrors, config } as Bundle;
  const read = (name: string) => {
    const normal = normalPath(name);
    return normal.startsWith("__anvil_typescript__/") ? standardLibs[normal.split("/").pop()!] : b.files[normal];
  };
  const snapshots = new Map<string, { content: string; snapshot: import("typescript").IScriptSnapshot }>();
  const host: import("typescript").LanguageServiceHost = {
    getCompilationSettings: () => b.options,
    getProjectVersion: () => String(b.revision),
    getScriptFileNames: () => b.roots,
    getScriptVersion: (fn) => String(b.versions.get(normalPath(fn)) ?? 1),
    getScriptSnapshot: (fn) => {
      const content = read(fn); if (content == null) { snapshots.delete(fn); return undefined; }
      const old = snapshots.get(fn); if (old?.content === content) return old.snapshot;
      const snapshot = ts.ScriptSnapshot.fromString(content); snapshots.set(fn, { content, snapshot }); return snapshot;
    },
    getCurrentDirectory: () => "/", getDefaultLibFileName: () => "/__anvil_typescript__/" + ts.getDefaultLibFileName(b.options),
    fileExists: (fn) => read(fn) !== undefined, readFile: read,
    readDirectory: () => Object.keys(b.files), directoryExists: (dir) => normalPath(dir) === "__anvil_typescript__" || Object.keys(b.files).some((p) => p.startsWith(normalPath(dir) + "/")) || !normalPath(dir), getDirectories: () => [],
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    resolveModuleNameLiterals: (lits, containingFile) => lits.map((lit) => ({
      resolvedModule: ts.resolveModuleName(lit.text, containingFile, b.options, { fileExists: host.fileExists!, readFile: read, directoryExists: host.directoryExists }).resolvedModule,
    })),
  };
  b.ls = ts.createLanguageService(host);
  return b;
}

function bundleFor(path: string): Bundle | undefined { return [...bundles.values()].find((b) => b.roots.includes(path)); }

function diagHits(b: Bundle, d: import("typescript").Diagnostic, source: string): LspHit | null {
  const file = d.file;
  if (!file || !(file.fileName.replace(/^\//, "") in b.files)) return null;
  const path = file.fileName.replace(/^\//, "");
  const pos = d.start ?? 0;
  const { line, character } = file.getLineAndCharacterOfPosition(pos);
  const msg = b.ts.flattenDiagnosticMessageText(d.messageText, "\n");
  const sev = d.category === b.ts.DiagnosticCategory.Warning ? "warning" : d.category === b.ts.DiagnosticCategory.Message ? "info" : "error";
  return hit(path, line + 1, character + 1, msg, source, sev);
}

export async function tscWorkspace(files: Record<string, string>, open: string[] = []): Promise<LspHit[]> {
  await ensureTs(files, open);
  const hits: LspHit[] = [];
  const seen = new Set<string>();
  for (const b of bundles.values()) {
    for (const d of b.configErrors) hits.push(diagHits(b, d, "tsc") ?? hit(b.config, 1, 1, b.ts.flattenDiagnosticMessageText(d.messageText, "\n"), "tsc"));
    for (const path of b.roots) {
    const list = [...b.ls.getSyntacticDiagnostics(path), ...b.ls.getSemanticDiagnostics(path)];
    for (const d of list) {
      const h = diagHits(b, d, "tsc");
      if (!h) continue;
      const k = `${h.path}:${h.line}:${h.message}`;
      if (seen.has(k)) continue;
      seen.add(k);
      hits.push(h);
      if (hits.length > 120) return hits;
    }
  }
  }
  return hits;
}

export function tsChecked(): string[] {
  return [...new Set([...bundles.values()].flatMap((b) => [...b.roots, ...(b.config ? [b.config] : [])]))];
}

export function tsQuickInfoSync(path: string, offset: number): string | null {
  const bundle = bundleFor(path);
  if (!bundle) return null;
  try {
    const info = bundle.ls.getQuickInfoAtPosition(path, offset);
    const sig = info ? bundle.ts.displayPartsToString(info.displayParts || []) : "";
    const doc = info ? bundle.ts.displayPartsToString(info.documentation || []) : "";
    if (sig) return `**${sig}** · tsc${doc ? `\n\n${doc}` : ""}`;
    const prog = bundle.ls.getProgram();
    const sf = prog?.getSourceFile(path);
    if (!sf || !prog) return null;
    let node: import("typescript").Node = sf;
    const visit = (n: import("typescript").Node) => {
      if (n.getStart(sf) <= offset && offset < n.getEnd()) {
        node = n;
        n.forEachChild(visit);
      }
    };
    sf.forEachChild(visit);
    const t = prog.getTypeChecker().typeToString(prog.getTypeChecker().getTypeAtLocation(node));
    if (!t || t === "any" || t === "error") return null;
    return `**${t}** · tsc`;
  } catch {
    return null;
  }
}

export function tsDefinitionSync(path: string, offset: number): { path: string; line: number; col: number; text: string }[] {
  const bundle = bundleFor(path);
  if (!bundle) return [];
  try {
    const defs = bundle.ls.getDefinitionAtPosition(path, offset) ?? [];
    const out: { path: string; line: number; col: number; text: string }[] = [];
    for (const d of defs) {
      if (!d.fileName || !(d.fileName.replace(/^\//, "") in bundle.files)) continue;
      const snap = bundle.ls.getProgram()?.getSourceFile(d.fileName);
      const pos = d.textSpan.start;
      let line = 1;
      let col = 1;
      if (snap) {
        const lc = snap.getLineAndCharacterOfPosition(pos);
        line = lc.line + 1;
        col = lc.character + 1;
      }
      const text = snap?.getFullText().slice(pos, pos + Math.min(d.textSpan.length, 80)).trim() || d.name || "";
      out.push({ path: d.fileName.replace(/^\//, ""), line, col, text });
    }
    return out;
  } catch {
    return [];
  }
}

export async function tsRename(files: Record<string, string>, path: string, offset: number, nextName: string, open: string[] = []): Promise<Record<string, string>> {
  if (!/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(nextName)) throw new Error("Ungültiger Symbolname.");
  await ensureTs(files, [...new Set([path, ...open])]);
  const b = bundleFor(path);
  if (!b) throw new Error("Sprachdienst nicht verfügbar.");
  const info = b.ls.getRenameInfo(path, offset);
  if (!info.canRename) throw new Error(info.localizedErrorMessage);
  const locations = b.ls.findRenameLocations(path, offset, false, false, true) ?? [];
  const groups = new Map<string, import("typescript").RenameLocation[]>();
  for (const loc of locations) { const name = loc.fileName.replace(/^\//, ""); if (!(name in files)) continue; const list = groups.get(name) ?? []; list.push(loc); groups.set(name, list); }
  const result: Record<string, string> = {};
  for (const [name, list] of groups) {
    let source = files[name];
    for (const loc of list.sort((a, b) => b.textSpan.start - a.textSpan.start)) source = source.slice(0, loc.textSpan.start) + (loc.prefixText ?? "") + nextName + (loc.suffixText ?? "") + source.slice(loc.textSpan.start + loc.textSpan.length);
    if (source !== files[name]) result[name] = source;
  }
  return result;
}
