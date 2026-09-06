import type { LspHit } from "./lsp";
const OPEN_MAX = 1_000_000, CLOSED_MAX = 200_000;
function hit(path: string, line: number, col: number, message: string, source: string): LspHit { return { path, line, col, message, source, severity: "error" }; }
let engine: typeof import("./compiler-engine.ts") | null = null;
const local = async () => engine ??= await import("./compiler-engine.ts");
const useWorker = () => typeof window !== "undefined" && typeof Worker !== "undefined";
export async function ensureTs(files: Record<string, string>, open: string[] = []) { return (await local()).ensureTs(files, open); }
export function disposeTs() { engine?.disposeTs(); }
export function tsChecked() { return engine?.tsChecked() ?? []; }
export function tsQuickInfoSync(path: string, offset: number) { return engine?.tsQuickInfoSync(path, offset) ?? null; }
export function tsDefinitionSync(path: string, offset: number) { return engine?.tsDefinitionSync(path, offset) ?? []; }
export async function tscWorkspace(files: Record<string, string>, open: string[] = []): Promise<LspHit[]> {
  if (useWorker()) return (await import("./compiler-client").then((c) => c.compilerJob("lint", files, open))).hits as LspHit[];
  return (await local()).tscWorkspace(files, open);
}
export async function tsQuickInfo(files: Record<string, string>, path: string, offset: number, open: string[] = []): Promise<string | null> {
  if (useWorker()) return (await import("./compiler-client").then((c) => c.compilerJob("hover", files, open, { path, offset }))).value as string | null;
  await ensureTs(files, open); return tsQuickInfoSync(path, offset);
}
export async function tsDefinition(files: Record<string, string>, path: string, offset: number, open: string[] = []): Promise<ReturnType<typeof tsDefinitionSync>> {
  if (useWorker()) return (await import("./compiler-client").then((c) => c.compilerJob("definition", files, open, { path, offset }))).value as ReturnType<typeof tsDefinitionSync>;
  await ensureTs(files, open); return tsDefinitionSync(path, offset);
}
export async function tsRename(files: Record<string, string>, path: string, offset: number, nextName: string, open: string[] = []): Promise<Record<string, string>> {
  if (useWorker()) return (await import("./compiler-client").then((c) => c.compilerJob("rename", files, open, { path, offset, nextName }))).value as Record<string, string>;
  return (await local()).tsRename(files, path, offset, nextName, open);
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
    const { pythonCheck } = await import("./python-check");
    const list = await pythonCheck(py.map(([path, content]) => ({ path, content })));
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
  const [tsResult, pyResult] = await Promise.all([
    typeof window !== "undefined" && typeof Worker !== "undefined"
      ? import("./compiler-client").then((c) => c.compilerJob("lint", files, open)).then((r) => ({ hits: r.hits as LspHit[], checked: r.checked as string[] }))
      : tscWorkspace(files, open).then((hits) => ({ hits, checked: tsChecked() })),
    pyCompileWorkspace(files, open),
  ]);
  lastChecked = [...tsResult.checked, ...pyResult.checked];
  return { hits: [...tsResult.hits, ...pyResult.hits], checked: lastChecked };
}
