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

export async function refreshProblems(): Promise<void> {
  const { useIde } = await import("@/store/ide");
  const st = useIde.getState();
  const { rebuildIndex } = await import("./ws-index");
  const { lintWorkspace } = await import("./lsp");
  rebuildIndex(st.files);
  const local = lintWorkspace(st.files, st.openPaths);
  st.setLspProblems(local);
  try {
    const { lintDeep } = await import("./lsp-compile");
    const deep = await lintDeep(st.files, st.openPaths);
    if (st.files !== useIde.getState().files || st.workspaceEpoch !== useIde.getState().workspaceEpoch) return;
    noteCompileChecked(deep.checked);
    useIde.getState().setCompileProblems(deep.hits);
  } catch {
    /* */
  }
}
