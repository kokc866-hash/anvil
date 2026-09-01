import type { LspHit } from "./lsp";

function hit(path: string, line: number, col: number, message: string, source: string, severity: LspHit["severity"] = "error"): LspHit {
  return { path, line: Math.max(1, line), col: Math.max(1, col), message: message.slice(0, 240), source, severity };
}

export async function tscWorkspace(files: Record<string, string>): Promise<LspHit[]> {
  let ts: typeof import("typescript");
  try {
    ts = await import("typescript");
  } catch {
    return [];
  }
  const roots = Object.keys(files)
    .filter((p) => /\.(ts|tsx|mts|cts|js|jsx)$/.test(p) && !p.includes("node_modules"))
    .slice(0, 32);
  if (!roots.length) return [];
  const hits: LspHit[] = [];
  for (const path of roots) {
    const src = files[path];
    if (!src || src.length > 200_000) continue;
    const kind = path.endsWith("tsx") || path.endsWith("jsx") ? ts.ScriptKind.TSX : path.endsWith("js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, kind);
    const diags = (sf as unknown as { parseDiagnostics?: import("typescript").Diagnostic[] }).parseDiagnostics ?? [];
    const extra = ts.transpileModule(src, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        noEmit: true,
        skipLibCheck: true,
        allowJs: true,
      },
    }).diagnostics ?? [];
    for (const d of [...diags, ...extra]) {
      const pos = d.start ?? 0;
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      hits.push(hit(path, line + 1, character + 1, msg, "tsc", d.category === ts.DiagnosticCategory.Warning ? "warning" : "error"));
      if (hits.length > 80) return hits;
    }
  }
  return hits;
}

export async function pyCompileWorkspace(files: Record<string, string>): Promise<LspHit[]> {
  const py = Object.entries(files).filter(([p, c]) => p.endsWith(".py") && c.length < 200_000).slice(0, 24);
  if (!py.length) return [];
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
    return list.map((d) => hit(d.path, d.line, d.col, d.message, "py"));
  } catch {
    return [];
  }
}

export async function lintDeep(files: Record<string, string>): Promise<LspHit[]> {
  const [a, b] = await Promise.all([tscWorkspace(files), pyCompileWorkspace(files)]);
  return [...a, ...b];
}
