import type { LspHit } from "./lsp";

function junkFrame(path: string, message: string): boolean {
  if (/about:srcdoc|blob:|native code|^eval$|anonymous/i.test(path)) return true;
  if (/Cannot use import statement outside a module/i.test(message)) return true;
  return false;
}
function guessPath(name: string, files: Record<string, string>): string {
  const n = name.replace(/\\/g, "/").replace(/^\.\//, "");
  if (n in files) return n;
  const base = n.split("/").pop() ?? n;
  const hit = Object.keys(files).find((p) => p === base || p.endsWith(`/${base}`));
  return hit ?? n;
}

export function parseRunTrace(stderr: string, fallback: string, files: Record<string, string> = {}): LspHit[] {
  const blob = stderr.replace(/\r/g, "");
  if (!blob.trim()) return [];
  const hits: LspHit[] = [];
  const seen = new Set<string>();
  const push = (path: string, line: number, message: string) => {
    const p = guessPath(path, files);
    const key = `${p}:${line}:${message.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      path: p,
      line: Math.max(1, line),
      col: 1,
      message: message.slice(0, 220),
      source: "run",
      severity: "error",
    });
  };

  for (const raw of blob.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let m =
      line.match(/^File "([^"]+)", line (\d+)/) ||
      line.match(/^-->\s+([^:\s]+):(\d+)/) ||
      line.match(/^([^:\s]+\.\w+):(\d+):(?:\d+:)?\s*(.*)$/) ||
      line.match(/\(([^()]+\.\w+):(\d+)(?::\d+)?\)/) ||
      line.match(/at\s+\S+\s+\(([^()]+\.\w+):(\d+)/) ||
      line.match(/([^:\s]+\.\w+):(\d+)/);
    if (!m) continue;
    const path = m[1];
    const ln = Number(m[2]);
    const msg = (m[3] || line).trim();
    if (!path || !ln) continue;
    if (junkFrame(path, msg) || junkFrame(path, line)) continue;
    push(path, ln, msg);
    if (hits.length >= 40) break;
  }

  if (!hits.length) {
    const err = blob.split("\n").map((l) => l.trim()).find((l) => /Error|error|panic|Exception|FAIL/.test(l));
    if (err && !junkFrame(fallback, err)) push(fallback, 1, err.slice(0, 220));
  }
  return hits;
}
