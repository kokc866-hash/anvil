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

const SYNTAX = /syntax|unexpected|unmatched|parse error|invalid syntax|expected|indent|unterminated|import statement outside a module|about:srcdoc/i;

export function localLintHits(hits: LspHit[]): LspHit[] {
  return hits.filter((h) => !LSP_BUCKET.has(h.source));
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
  st.setLspProblems(lintWorkspace(st.files, st.openPaths));
  try {
    const { lintDeep } = await import("./lsp-compile");
    const hits = await lintDeep(useIde.getState().files);
    useIde.getState().setCompileProblems(hits);
  } catch {
    /* */
  }
}
