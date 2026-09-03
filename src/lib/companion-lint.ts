import { companionLint, companionPing } from "./companion";
import { isSecretPath } from "./ref";
import { useIde } from "@/store/ide";
import type { LspHit } from "./lsp";

const WANT: Record<string, RegExp> = {
  pyright: /\.py$/i,
  typescript: /\.(ts|tsx|mts|cts)$/i,
  tsls: /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i,
  html: /\.(html?|css|json)$/i,
  yaml: /\.ya?ml$/i,
  gopls: /\.go$/i,
  rust: /\.rs$/i,
  clangd: /\.(c|cc|cpp|cxx|h|hpp|hh)$/i,
  java: /\.java$/i,
};
let timer = 0;
let lastPing = 0;
let pingOk = false;

function enabledIds(): string[] {
  const m = useIde.getState().lspEnabled;
  const ids = Object.keys(WANT);
  return ids.filter((id) => m[id] !== false);
}

function wantFile(path: string): boolean {
  const on = enabledIds();
  return on.some((id) => WANT[id].test(path));
}

async function alive(base: string): Promise<boolean> {
  if (Date.now() - lastPing < 20000) return pingOk;
  lastPing = Date.now();
  const p = await companionPing(base);
  pingOk = p.ok;
  return pingOk;
}

export async function refreshCompanionLint(): Promise<void> {
  const st = useIde.getState();
  const base = st.companionUrl || "http://127.0.0.1:7845";
  if (!(await alive(base))) {
    if (st.companionProblems.length) st.setCompanionProblems([]);
    return;
  }
  const max = st.lspMaxFiles || 24;
  const open = new Set(st.openPaths);
  const files = Object.entries(st.files)
    .filter(([p, c]) => wantFile(p) && !isSecretPath(p) && c.length < (open.has(p) ? 1_000_000 : 200_000))
    .sort(([a], [b]) => Number(open.has(b)) - Number(open.has(a)))
    .slice(0, Math.max(max, [...open].filter((p) => wantFile(p)).length))
    .map(([path, content]) => ({ path, content }));
  if (!files.length) {
    st.setCompanionProblems([]);
    return;
  }
  const r = await companionLint(files, base, {
    enabled: enabledIds(),
    lspTimeoutMs: (st.lspTimeout || 8) * 1000,
    maxFiles: max,
  });
  if (!r.ok) {
    st.pushLspLog(false, r.error || "Lint fehlgeschlagen");
    return;
  }
  const hits: LspHit[] = (r.diagnostics || []).map((d) => ({
    path: d.path,
    line: d.line || 1,
    col: d.col || 1,
    message: d.message,
    source: d.source || "tsc",
    severity: d.severity === "warning" ? "warning" : "error",
  }));
  st.setCompanionProblems(hits);
  const bad = (r.tools || []).filter((t) => !t.ok).map((t) => t.name);
  if (bad.length) st.pushLspLog(false, `${bad.join(", ")} mit Fehler · ${hits.length} Meldungen`);
  else st.pushLspLog(true, `${hits.length} Meldungen · ${(r.tools || []).map((t) => t.name).join(", ") || "ok"}`);
}

export function scheduleCompanionLint(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void refreshCompanionLint(), 1600);
}