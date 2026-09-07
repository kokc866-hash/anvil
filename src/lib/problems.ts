import type { LspHit } from "./lsp";

export const LSP_BUCKET = new Set([
  "run",
  "tsc",
  "py",
  "pyright",
  "html",
  "yaml",
  "gopls",
  "tsls",
  "typescript",
  "companion",
]);

export const HEUR_SOURCE = new Set(["syntax", "python", "index", "json", "js", "c"]);

const SYNTAX = /syntax|unexpected|unmatched|parse error|invalid syntax|expected|indent|unterminated|import statement outside a module|about:srcdoc/i;

let compileChecked: string[] = [];

export function noteCompileChecked(paths: string[]): void {
  compileChecked = paths;
}

export function localLintHits(hits: LspHit[]): LspHit[] {
  return hits.filter((h) => !LSP_BUCKET.has(h.source));
}

export function dropCoveredHeuristics(local: LspHit[]): LspHit[] {
  const has = new Set(compileChecked);
  if (!has.size) return local;
  return local.filter((h) => !HEUR_SOURCE.has(h.source) || h.source === "index" || !has.has(h.path));
}

/** Syntax-Run-Treffer fallen weg, sobald die Datei lokal sauber ist. Sandbox-Modul-Fehler nie anheften. */
export function dropStaleRun(run: LspHit[], local: LspHit[]): LspHit[] {
  const err = new Set(local.filter((h) => h.severity === "error").map((h) => h.path));
  return run.filter((h) => {
    if (/import statement outside a module|about:srcdoc/i.test(h.message)) return false;
    if (SYNTAX.test(h.message)) return err.has(h.path);
    return true;
  });
}

export type ProblemRefresh = { current: boolean; hits: LspHit[]; checked: string[]; errors: string[] };
let refreshId = 0;
let refreshJob: { files: Record<string, string>; epoch: number; open: string; promise: Promise<ProblemRefresh> } | undefined;

/** One snapshot per request. TS and Python publish independently without replacing each other. */
export async function refreshProblems(): Promise<ProblemRefresh> {
  const { useIde } = await import("@/store/ide");
  const st = useIde.getState(), open = JSON.stringify(st.openPaths);
  if (refreshJob?.files === st.files && refreshJob.epoch === st.workspaceEpoch && refreshJob.open === open) return refreshJob.promise;
  const id = ++refreshId;
  const promise = (async (): Promise<ProblemRefresh> => {
    const current = () => id === refreshId && st.files === useIde.getState().files && st.workspaceEpoch === useIde.getState().workspaceEpoch;
    const { lintWorkspace } = await import("./lsp");
    if (!current()) return { current: false, hits: [], checked: [], errors: [] };
    const local = lintWorkspace(st.files, st.openPaths);
    noteCompileChecked([]);
    st.setCompileProblems([]);
    st.setCompanionProblems([]);
    st.setLspProblems(local);
    const results: { hits: LspHit[]; checked: string[] }[] = [];
    const errors: string[] = [];
    const publish = (result: { hits: LspHit[]; checked: string[]; error?: string }) => {
      results.push(result);
      if (result.error) errors.push(result.error);
      if (!current()) return;
      noteCompileChecked(results.flatMap((r) => r.checked));
      st.setLspProblems(local);
      st.setCompileProblems(results.flatMap((r) => r.hits));
      if (result.error) st.pushLspLog(false, result.error);
    };
    const failed = (e: unknown) => publish({ hits: [], checked: [], error: e instanceof Error ? e.message : String(e) });
    const c = await import("./lsp-compile");
    await Promise.all([
      (typeof Worker !== "undefined" && typeof window !== "undefined"
        ? import("./compiler-client").then((w) => w.compilerJob("lint", st.files, st.openPaths)).then((r) => ({ hits: r.hits as LspHit[], checked: r.checked as string[] }))
        : c.tscWorkspace(st.files, st.openPaths).then((hits) => ({ hits, checked: c.tsChecked() })))
        .then(publish, failed),
      c.pyCompileWorkspace(st.files, st.openPaths).then(publish, failed),
    ]);
    return { current: current(), hits: current() ? useIde.getState().lspProblems : [], checked: results.flatMap((r) => r.checked), errors };
  })();
  refreshJob = { files: st.files, epoch: st.workspaceEpoch, open, promise };
  try { return await promise; }
  finally { if (refreshJob?.promise === promise) refreshJob = undefined; }
}
