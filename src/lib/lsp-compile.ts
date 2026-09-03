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

function mix(s: string): number {
  let h = s.length | 0;
  const step = s.length > 8000 ? Math.ceil(s.length / 8000) : 1;
  for (let i = 0; i < s.length; i += step) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  if (s.length) h = Math.imul(h, 33) ^ s.charCodeAt(s.length - 1);
  return h >>> 0;
}

function stampOf(files: Record<string, string>, open: string[] = []): string {
  let n = 0;
  let len = 0;
  let h = 0;
  for (const p of Object.keys(files)) {
    const s = files[p] ?? "";
    n += 1;
    len += s.length;
    h = Math.imul(h, 31) ^ mix(s);
  }
  return `${n}:${len}:${h >>> 0}:${open.join(",")}`;
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
type Bundle = { stamp: string; ls: import("typescript").LanguageService; files: Record<string, string>; roots: string[]; ts: TsMod };
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

export async function ensureTs(files: Record<string, string>, open: string[] = []): Promise<Bundle | null> {
  const ts = await loadTs();
  if (!ts) return null;
  const stamp = stampOf(files, open);
  if (bundle && bundle.stamp === stamp) return bundle;
  const roots = tsRoots(files, open);
  const host = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      noLib: true,
      strict: false,
      allowNonTsExtensions: true,
    }),
    getScriptFileNames: () => [STUB_NAME, ...roots],
    getScriptVersion: (fn: string) => (fn === STUB_NAME ? "1" : String(files[fn.replace(/^\//, "")]?.length ?? 0)),
    getScriptSnapshot: (fn: string) => {
      const src = readVirtual(files, fn);
      return src == null ? undefined : ts.ScriptSnapshot.fromString(src);
    },
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => STUB_NAME,
    fileExists: (fn: string) => readVirtual(files, fn) != null,
    readFile: (fn: string) => readVirtual(files, fn),
    readDirectory: () => [],
    directoryExists: () => true,
    getDirectories: () => [],
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f: string) => f.replace(/\\/g, "/"),
    getNewLine: () => "\n",
    resolveModuleNameLiterals: (lits: readonly { text: string }[], containingFile: string) =>
      lits.map((lit) => {
        const spec = String(lit.text);
        const dest = resolveRel(containingFile.replace(/^\//, ""), spec, files);
        if (!dest) return { resolvedModule: undefined };
        const ext = dest.endsWith(".tsx")
          ? ts.Extension.Tsx
          : dest.endsWith(".ts")
            ? ts.Extension.Ts
            : dest.endsWith(".jsx")
              ? ts.Extension.Jsx
              : ts.Extension.Js;
        return { resolvedModule: { resolvedFileName: dest, extension: ext, isExternalLibraryImport: false } };
      }),
  };
  bundle = { stamp, ls: ts.createLanguageService(host as import("typescript").LanguageServiceHost), files, roots, ts };
  return bundle;
}

function diagHits(b: Bundle, d: import("typescript").Diagnostic, source: string): LspHit | null {
  const file = d.file;
  if (!file || file.fileName === STUB_NAME) return null;
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
      if (!d.fileName || d.fileName === STUB_NAME) continue;
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

export async function tsQuickInfo(files: Record<string, string>, path: string, offset: number, open: string[] = []): Promise<string | null> {
  await ensureTs(files, open);
  return tsQuickInfoSync(path, offset);
}

export async function tsDefinition(files: Record<string, string>, path: string, offset: number, open: string[] = []): Promise<{ path: string; line: number; col: number; text: string }[]> {
  await ensureTs(files, open);
  return tsDefinitionSync(path, offset);
}

export async function pyCompileWorkspace(files: Record<string, string>, open: string[] = []): Promise<{ hits: LspHit[]; checked: string[] }> {
  const prefer = open.filter((p) => p.endsWith(".py"));
  const rest = Object.keys(files).filter((p) => p.endsWith(".py") && !prefer.includes(p));
  const py = [...prefer, ...rest]
    .filter((p) => {
      const c = files[p] ?? "";
      const cap = prefer.includes(p) ? OPEN_MAX : CLOSED_MAX;
      return c.length > 0 && c.length < cap;
    })
    .slice(0, 40)
    .map((path) => [path, files[path] ?? ""] as const);
  if (!py.length) return { hits: [], checked: [] };
  try {
    const { getPyodide } = await import("./run-client");
    const rt = await getPyodide();
    const payload = JSON.stringify(py.map(([path, content]) => ({ path, content })));
    const raw = await rt.runPythonAsync(`
import json
out = []
for item in json.loads(${JSON.stringify(payload)}):
    try:
        compile(item["content"], item["path"], "exec")
    except SyntaxError as e:
        out.append({"path": item["path"], "line": e.lineno or 1, "col": e.offset or 1, "message": str(e.msg or e)})
json.dumps(out)
`);
    const list = JSON.parse(String(raw || "[]")) as { path: string; line: number; col: number; message: string }[];
    return { hits: list.map((d) => hit(d.path, d.line, d.col, d.message, "py")), checked: py.map(([p]) => p) };
  } catch {
    return { hits: [], checked: [] };
  }
}

export type LintDeep = { hits: LspHit[]; checked: string[] };

let lastChecked: string[] = [];

export function lastDeepChecked(): string[] {
  return lastChecked;
}

export async function lintDeep(files: Record<string, string>, open: string[] = []): Promise<LintDeep> {
  const [a, b] = await Promise.all([tscWorkspace(files, open), pyCompileWorkspace(files, open)]);
  lastChecked = [...tsChecked(), ...b.checked];
  return { hits: [...a, ...b.hits], checked: lastChecked };
}
