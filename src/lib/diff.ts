export type DiffRow = { type: "eq" | "add" | "del"; text: string };

export function lineDiff(before: string, after: string): DiffRow[] {
  const A = before.split("\n");
  const B = after.split("\n");
  const n = A.length;
  const m = B.length;
  if (n + m > 4000) {
    return [
      ...A.slice(0, 80).map((text) => ({ type: "del" as const, text })),
      ...B.slice(0, 80).map((text) => ({ type: "add" as const, text })),
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: "eq", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: A[i] });
      i++;
    } else {
      out.push({ type: "add", text: B[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: A[i++] });
  while (j < m) out.push({ type: "add", text: B[j++] });
  return out;
}

/** Changed hunks plus `ctx` equal lines, capped. */
export function diffPreview(before: string, after: string, ctx = 2, max = 80): DiffRow[] {
  const rows = lineDiff(before, after);
  const keep = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === "eq") continue;
    for (let k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) keep.add(k);
  }
  const out: DiffRow[] = [];
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (out.length >= max) break;
    out.push(rows[i]);
  }
  return out;
}

export type Hunk = { index: number; rows: DiffRow[] };

export function diffHunks(rows: DiffRow[]): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type === "eq") {
      i += 1;
      continue;
    }
    const chunk: DiffRow[] = [];
    while (i < rows.length && rows[i].type !== "eq") chunk.push(rows[i++]);
    out.push({ index: out.length, rows: chunk });
  }
  return out;
}

export function rejectHunk(before: string, after: string, hunkIndex: number): string {
  const rows = lineDiff(before, after);
  const hs = diffHunks(rows);
  const target = hs[hunkIndex];
  if (!target) return after;
  const lines: string[] = [];
  let hi = 0;
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type === "eq") {
      lines.push(rows[i].text);
      i += 1;
      continue;
    }
    const h = hs[hi++];
    const drop = h.index === target.index;
    for (const r of h.rows) {
      if (drop) {
        if (r.type === "del") lines.push(r.text);
      } else if (r.type === "add") lines.push(r.text);
    }
    i += h.rows.length;
  }
  return lines.join("\n");
}

export function parseProblems(stderr: string, fallback: string) {
  const hits: { path: string; line: number; text: string }[] = [];
  for (const raw of stderr.split("\n")) {
    const m = raw.match(/([^:\s]+\.\w+):(\d+)/);
    if (m) hits.push({ path: m[1], line: Number(m[2]), text: raw.trim() });
  }
  if (!hits.length && stderr.trim()) hits.push({ path: fallback, line: 1, text: stderr.trim().slice(0, 240) });
  return hits;
}

export function diffStats(before: string, after: string): { add: number; del: number } {
  if (before.length + after.length > 120_000) {
    const a = before.split("\n").length;
    const b = after.split("\n").length;
    return { add: Math.max(0, b - a), del: Math.max(0, a - b) };
  }
  let add = 0;
  let del = 0;
  for (const r of lineDiff(before, after)) {
    if (r.type === "add") add += 1;
    else if (r.type === "del") del += 1;
  }
  return { add, del };
}

export type FileChange = { path: string; kind: "add" | "del" | "edit"; add: number; del: number };

export function snapshotDiff(before: Record<string, string>, after: Record<string, string>): FileChange[] {
  const out: FileChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const path of [...keys].sort()) {
    const a = before[path];
    const b = after[path];
    if (a == null && b != null) {
      const n = b.split("\n").length;
      out.push({ path, kind: "add", add: n, del: 0 });
    } else if (a != null && b == null) {
      out.push({ path, kind: "del", add: 0, del: a.split("\n").length });
    } else if (a !== b) {
      const s = diffStats(a ?? "", b ?? "");
      out.push({ path, kind: "edit", add: s.add, del: s.del });
    }
  }
  return out;
}
