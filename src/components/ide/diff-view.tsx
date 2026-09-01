import { diffHunks, lineDiff } from "@/lib/diff";
import { cn } from "@/lib/cn";
import { useIde } from "@/store/ide";

export function DiffView({ path, before, after }: { path: string; before: string; after: string }) {
  const rows = lineDiff(before, after);
  const hunks = diffHunks(rows);
  const rejectHunk = useIde((s) => s.rejectHunk);
  let hi = 0;
  const blocks: { kind: "eq" | "hunk"; rows: typeof rows; hunk?: number }[] = [];
  for (let i = 0; i < rows.length; ) {
    if (rows[i].type === "eq") {
      const chunk = [];
      while (i < rows.length && rows[i].type === "eq") chunk.push(rows[i++]);
      blocks.push({ kind: "eq", rows: chunk });
    } else {
      const h = hunks[hi++];
      blocks.push({ kind: "hunk", rows: h.rows, hunk: h.index });
      i += h.rows.length;
    }
  }

  return (
    <pre className="min-h-0 flex-1 overflow-auto font-mono text-[length:var(--editor-size,13px)] leading-[1.7]">
      {blocks.map((b, bi) => (
        <div key={bi}>
          {b.kind === "hunk" && b.hunk != null ? (
            <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-border bg-surface px-2 py-0.5 font-sans text-[11px] text-muted">
              <span>Änderung {b.hunk + 1}/{hunks.length}</span>
              <button
                type="button"
                className="ml-auto text-danger hover:underline"
                onClick={() => rejectHunk(path, b.hunk!)}
              >
                Hunk verwerfen
              </button>
            </div>
          ) : null}
          {b.rows.map((r, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                r.type === "add" && "bg-ok/15 text-ok",
                r.type === "del" && "bg-danger/15 text-danger",
                r.type === "eq" && "text-muted",
              )}
            >
              <span className="w-8 shrink-0 select-none pr-2 text-right text-subtle tabular-nums">
                {r.type === "add" ? "+" : r.type === "del" ? "−" : " "}
              </span>
              <span className="whitespace-pre">{r.text || " "}</span>
            </div>
          ))}
        </div>
      ))}
    </pre>
  );
}
