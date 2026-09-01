export const READ_CHAR_CAP = 200_000;
export const READ_LINE_CAP = 2500;

export function readWindow(src: string, startLine = 1, endLine = 0): {
  body: string;
  from: number;
  to: number;
  total: number;
  truncated: boolean;
} {
  const lines = src.split("\n");
  const total = lines.length;
  const from = Math.max(1, Math.floor(startLine) || 1);
  let to = endLine >= from ? Math.min(total, Math.floor(endLine)) : total;
  if (!endLine && src.length > READ_CHAR_CAP) {
    to = Math.min(total, from + READ_LINE_CAP - 1);
  }
  let body = lines.slice(from - 1, to).join("\n");
  while (to > from && body.length > READ_CHAR_CAP) {
    to -= 1;
    body = lines.slice(from - 1, to).join("\n");
  }
  return { body, from, to, total, truncated: to < total };
}

export function packToolContent(name: string, result: unknown): string {
  if (name === "read_file" && result && typeof result === "object") {
    const r = result as {
      path?: string;
      content?: string;
      error?: string;
      truncated?: boolean;
      start_line?: number;
      end_line?: number;
      total_lines?: number;
    };
    if (r.error) return JSON.stringify({ error: r.error, path: r.path });
    const numbered = String(r.content ?? "")
      .split("\n")
      .map((line, i) => `${String((r.start_line ?? 1) + i).padStart(5)}|${line}`)
      .join("\n");
    const head = `${r.path ?? ""}  Zeile ${r.start_line ?? 1}–${r.end_line ?? "?"} / ${r.total_lines ?? "?"}`;
    const more = r.truncated
      ? `\n\n[continue: read_file path="${r.path}" start_line=${(r.end_line ?? 0) + 1}]`
      : "";
    const out = `${head}\n${numbered}${more}`;
    return out.length > READ_CHAR_CAP + 4000 ? `${out.slice(0, READ_CHAR_CAP)}\n\n[continue: start_line]` : out;
  }
  if (name === "write_file" && result && typeof result === "object") {
    const r = result as { path?: string; truncated?: boolean; bytes?: number; error?: string; hint?: string };
    if (r.truncated) {
      return JSON.stringify({
        ok: true,
        path: r.path,
        bytes: r.bytes,
        truncated: true,
        hint: r.hint || "truncated — edit_file at the end, do not rewrite",
      });
    }
  }
  const raw = JSON.stringify(result ?? {});
  if (raw.length <= 80_000) return raw;
  return `${raw.slice(0, 80_000)}\n… [tool output truncated]`;
}
