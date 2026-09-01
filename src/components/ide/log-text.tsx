import { gotoFile } from "@/lib/goto";
import { useIde } from "@/store/ide";

export function LogText({ text, tone = "fg" }: { text: string; tone?: "fg" | "danger" }) {
  const files = useIde((s) => s.files);
  const blob = text.slice(0, 24_000);
  const re = /([\w./-]+\.(?:py|js|ts|tsx|jsx|mjs|cjs|go|rs)):(\d+)/g;
  const parts: { t: string; path?: string; line?: number }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob))) {
    const raw = m[1];
    const resolved =
      raw in files ? raw : Object.keys(files).find((p) => p.endsWith(`/${raw.split("/").pop()}`)) ?? "";
    if (!resolved) continue;
    if (m.index > last) parts.push({ t: blob.slice(last, m.index) });
    parts.push({ t: m[0], path: resolved, line: Number(m[2]) });
    last = m.index + m[0].length;
  }
  if (last < blob.length) parts.push({ t: blob.slice(last) });
  if (!parts.length) parts.push({ t: blob });
  const cls = tone === "danger" ? "whitespace-pre-wrap text-danger" : "whitespace-pre-wrap text-fg";
  return (
    <pre className={cls}>
      {parts.map((p, i) =>
        p.path ? (
          <button
            key={i}
            type="button"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            onClick={() => gotoFile(p.path!, p.line ?? 1)}
          >
            {p.t}
          </button>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </pre>
  );
}
