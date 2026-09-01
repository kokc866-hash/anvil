const JUNK = /python312\.zip|_pyodide|pyodide\/|\/lib\/python|in eval_code|in run_async|CodeRunner/i;

export function missingFromError(text: string): string | null {
  const m =
    text.match(/nicht im Workspace:\s+(\S+)/i) ||
    text.match(/not in workspace:\s+(\S+)/i) ||
    text.match(/No such file or directory:\s*['"]([^'"]+)['"]/i) ||
    text.match(/FileNotFoundError:[^\n]*['"]([^'"]+\.\w+)['"]/i) ||
    text.match(/ENOENT[^\n]*['"]([^'"]+)['"]/i);
  if (!m) return null;
  return m[1].replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

export function scrubRunError(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trimEnd());
  const keep = lines.filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (JUNK.test(t) && /File "|File <|line \d+/i.test(t)) return false;
    if (/^File "<exec>"/.test(t)) return false;
    return true;
  });
  const err = [...keep].reverse().find((l) => /Error|Errno|not found|fehlt|SyntaxError|Exception/i.test(l));
  const files = keep.filter((l) => /^\s*File "/.test(l) && !JUNK.test(l));
  const bits = [...files.slice(-2), err].filter((x): x is string => Boolean(x));
  const out = (bits.length ? bits : keep).join("\n").trim();
  return (out || text.trim()).slice(0, 800);
}

export function runFailHint(stderr: string, files: string[]): string {
  const clean = scrubRunError(stderr);
  const miss = missingFromError(stderr) || missingFromError(clean);
  if (!miss) return `Run failed:\n${clean}\nFix it, then run_file.`;
  const base = miss.split("/").pop() ?? miss;
  const similar = files.filter((p) => p === miss || p.endsWith("/" + base) || p.split("/").pop() === base).slice(0, 6);
  const extra = similar.length ? ` Similar: ${similar.join(", ")}.` : " Not in the workspace.";
  return `Run: "${miss}" is missing.${extra}\nwrite_file for it or drop it from the bundler/ORDER, then run_file.`;
}
