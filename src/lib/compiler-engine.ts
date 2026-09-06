import type { LspHit } from "./lsp";

const STUB_NAME = "anvil-lib.d.ts";
const STUB = `
interface Array<T> { length: number; push(...a: T[]): number; pop(): T | undefined; map<U>(f: (v: T, i: number) => U): U[]; filter(f: (v: T) => unknown): T[]; forEach(f: (v: T, i: number) => void): void; join(s?: string): string; slice(a?: number, b?: number): T[]; includes(v: T): boolean; find(f: (v: T) => unknown): T | undefined; }
interface Boolean { valueOf(): boolean; }
interface Function { apply(this: Function, thisArg: unknown, argArray?: unknown): unknown; call(this: Function, thisArg: unknown, ...argArray: unknown[]): unknown; bind(this: Function, thisArg: unknown, ...argArray: unknown[]): any; prototype: unknown; length: number; arguments: unknown; caller: unknown; }
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { length: number; callee: Function; [index: number]: unknown; }
interface Number { valueOf(): number; toFixed(n?: number): string; }
interface Object { toString(): string; }
interface RegExp { test(s: string): boolean; source: string; exec(s: string): string[] | null; }
interface String { length: number; charAt(i: number): string; slice(a?: number, b?: number): string; split(s: string): string[]; includes(s: string): boolean; indexOf(s: string): number; replace(a: string | RegExp, b: string): string; toLowerCase(): string; toUpperCase(): string; trim(): string; }
interface Promise<T> { then<U>(f: (v: T) => U | Promise<U>): Promise<U>; catch<U>(f: (e: unknown) => U | Promise<U>): Promise<U | T>; }
declare const Promise: { new <T>(f: (res: (v: T) => void, rej: (e?: unknown) => void) => void): Promise<T>; resolve<T>(v: T | Promise<T>): Promise<T>; }
interface Date { getTime(): number; toISOString(): string; }
declare const Date: { new (): Date; now(): number; }
declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void; warn(...a: unknown[]): void; }
declare const Math: { max(...a: number[]): number; min(...a: number[]): number; abs(n: number): number; floor(n: number): number; ceil(n: number): number; round(n: number): number; random(): number; PI: number; }
declare const JSON: { parse(s: string): unknown; stringify(v: unknown): string; }
declare const Object: { keys(o: object): string[]; values(o: object): unknown[]; entries(o: object): [string, unknown][]; assign<T>(a: T, ...b: object[]): T; }
declare const Array: { isArray(v: unknown): v is unknown[]; from<T>(v: ArrayLike<T>): T[]; }
interface ArrayLike<T> { length: number; [n: number]: T; }
declare function parseInt(s: string, r?: number): number;
declare function parseFloat(s: string): number;
declare function isNaN(n: number): boolean;
declare function Number(v?: unknown): number;
declare function String(v?: unknown): string;
declare function Boolean(v?: unknown): boolean;
declare const NaN: number;
declare const Infinity: number;
declare const document: { getElementById(id: string): unknown; querySelector(s: string): unknown; body: unknown; }
declare const window: unknown;
declare const localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; }
declare function fetch(url: string, init?: unknown): Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string>; status: number }>;
declare function setTimeout(f: () => void, ms?: number): number;
declare function clearTimeout(n: number): void;
declare function requestAnimationFrame(f: (t: number) => void): number;
`;

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
type Bundle = { revision: number; versions: Map<string, number>; options: import("typescript").CompilerOptions; ls: import("typescript").LanguageService; files: Record<string, string>; roots: string[]; ts: TsMod };
let bundle: Bundle | null = null;
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

function readVirtual(files: Record<string, string>, name: string): string | undefined {
  const p = name.replace(/\\/g, "/").replace(/^\//, "");
  if (p === STUB_NAME || name.endsWith(STUB_NAME)) return STUB;
  return files[p] ?? files[name];
}

function resolveRel(fromPath: string, spec: string, files: Record<string, string>): string | undefined {
  const raw = spec.replace(/\\/g, "/").replace(/^['"]|['"]$/g, "");
  if (!raw.startsWith(".")) return undefined;
  const dir = fromPath.replace(/^\//, "").split("/").slice(0, -1);
  const stack = [...dir];
  for (const p of raw.split("/")) {
    if (p === "." || p === "") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  const joined = stack.join("/");
  const cands = [joined, `${joined}.ts`, `${joined}.tsx`, `${joined}.js`, `${joined}.jsx`, `${joined}/index.ts`, `${joined}/index.js`];
  return cands.find((p) => p in files);
}

const standardLibs: Record<string, string> = typeof import.meta.glob === "function"
  ? Object.fromEntries(Object.entries(import.meta.glob("../../node_modules/typescript/lib/lib*.d.ts", { query: "?raw", import: "default", eager: true })).map(([path, content]) => [path.split("/").pop()!, String(content)])) : {};

export function disposeTs(): void { bundle?.ls.dispose(); bundle = null; }

export async function ensureTs(files: Record<string, string>, open: string[] = []): Promise<Bundle | null> {
  const ts = await loadTs();
  if (!ts) return null;
  const roots = tsRoots(files, open);
  let config: Record<string, unknown> = {};
  const readConfig = (path: string, seen = new Set<string>()): Record<string, unknown> => {
    if (seen.has(path) || !files[path]) return {};
    seen.add(path);
    const parsed = ts.parseConfigFileTextToJson(path, files[path]).config ?? {};
    const parent = typeof parsed.extends === "string" ? resolveRel(path, parsed.extends, files) ?? (parsed.extends.replace(/^\.\//, "") + ".json") : "";
    const inherited = parent ? readConfig(parent, seen) : {};
    return { ...inherited, ...parsed, compilerOptions: { ...(inherited.compilerOptions as object ?? {}), ...parsed.compilerOptions } };
  };
  config = readConfig(files["tsconfig.json"] ? "tsconfig.json" : "jsconfig.json");
  const options: import("typescript").CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, allowJs: true, checkJs: false, strict: false,
    ...ts.convertCompilerOptionsFromJson(config.compilerOptions ?? {}, "").options,
    noEmit: true, skipLibCheck: true, noLib: Object.keys(standardLibs).length === 0,
  };
  const glob = (pattern: string, path: string) => {
    const expr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "@@").replace(/\*\*/g, "##").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/@@/g, "(?:.*/)?").replace(/##/g, ".*");
    return new RegExp(`^${expr}(?:/.*)?$`).test(path);
  };
  const selected = roots.filter((path) => {
    if (open.includes(path)) return true;
    if (Array.isArray(config.files) && !(config.files as string[]).includes(path)) return false;
    if (Array.isArray(config.exclude) && (config.exclude as string[]).some((p) => glob(p, path))) return false;
    return !Array.isArray(config.include) || (config.include as string[]).some((p) => glob(p, path));
  });
  if (bundle) {
    const b = bundle;
    let changed = JSON.stringify(b.roots) !== JSON.stringify(selected) || JSON.stringify(b.options) !== JSON.stringify(options);
    if (b.files !== files) for (const name of new Set([...Object.keys(b.files), ...Object.keys(files)])) {
      if (b.files[name] !== files[name]) { b.versions.set(name, (b.versions.get(name) ?? 0) + 1); changed = true; }
    }
    b.files = files; b.roots = selected; b.options = options;
    if (changed) b.revision++;
    return b;
  }
  const b = { revision: 1, versions: new Map(Object.keys(files).map((p) => [p, 1])), files, roots: selected, options, ts } as Bundle;
  const read = (name: string) => {
    const normal = name.replace(/\\/g, "/").replace(/^\//, "");
    return b.files[normal] ?? standardLibs[normal.split("/").pop()!] ?? (normal === STUB_NAME ? STUB : undefined);
  };
  const snapshots = new Map<string, { content: string; snapshot: import("typescript").IScriptSnapshot }>();
  const host: import("typescript").LanguageServiceHost = {
    getCompilationSettings: () => b.options,
    getProjectVersion: () => String(b.revision),
    getScriptFileNames: () => b.options.noLib ? [STUB_NAME, ...b.roots] : b.roots,
    getScriptVersion: (fn) => String(b.versions.get(fn.replace(/^\//, "")) ?? 1),
    getScriptSnapshot: (fn) => {
      const content = read(fn); if (content == null) { snapshots.delete(fn); return undefined; }
      const old = snapshots.get(fn); if (old?.content === content) return old.snapshot;
      const snapshot = ts.ScriptSnapshot.fromString(content); snapshots.set(fn, { content, snapshot }); return snapshot;
    },
    getCurrentDirectory: () => "", getDefaultLibFileName: () => ts.getDefaultLibFileName(b.options),
    fileExists: (fn) => read(fn) !== undefined, readFile: read,
    readDirectory: () => Object.keys(b.files), directoryExists: () => true, getDirectories: () => [],
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    resolveModuleNameLiterals: (lits, containingFile) => lits.map((lit) => ({
      resolvedModule: ts.resolveModuleName(lit.text, containingFile, b.options, { fileExists: host.fileExists!, readFile: read }).resolvedModule,
    })),
  };
  b.ls = ts.createLanguageService(host);
  bundle = b;
  return b;
}

function diagHits(b: Bundle, d: import("typescript").Diagnostic, source: string): LspHit | null {
  const file = d.file;
  if (!file || file.fileName === STUB_NAME || !(file.fileName.replace(/^\//, "") in b.files)) return null;
  const path = file.fileName.replace(/^\//, "");
  const pos = d.start ?? 0;
  const { line, character } = file.getLineAndCharacterOfPosition(pos);
  const msg = b.ts.flattenDiagnosticMessageText(d.messageText, "\n");
  const sev = d.category === b.ts.DiagnosticCategory.Warning ? "warning" : d.category === b.ts.DiagnosticCategory.Message ? "info" : "error";
  return hit(path, line + 1, character + 1, msg, source, sev);
}

export async function tscWorkspace(files: Record<string, string>, open: string[] = []): Promise<LspHit[]> {
  const b = await ensureTs(files, open);
  if (!b) return [];
  const hits: LspHit[] = [];
  const seen = new Set<string>();
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
  return hits;
}

export function tsChecked(): string[] {
  return bundle?.roots ?? [];
}

export function tsQuickInfoSync(path: string, offset: number): string | null {
  if (!bundle || !bundle.roots.includes(path)) return null;
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
  if (!bundle || !bundle.roots.includes(path)) return [];
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
  const b = await ensureTs(files, [...new Set([path, ...open])]);
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
