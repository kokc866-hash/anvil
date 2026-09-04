export const EDITOR_MAX_CHARS = 1_500_000;

export function normModelPath(p: string): string {
  return String(p || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

export function modelUriString(path: string): string {
  const parts = normModelPath(path).split("/").filter(Boolean).map((s) => encodeURIComponent(s));
  return `inmemory://anvil/${parts.join("/")}`;
}

export function pathFromModelUri(uriPath: string): string {
  const raw = String(uriPath || "").replace(/^\/+/, "").replace(/^anvil\//, "");
  return raw
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .filter(Boolean)
    .join("/");
}

export function modelsToDrop(uris: string[], keep: string[]): string[] {
  const k = new Set(keep.map(normModelPath));
  return uris.map((u) => pathFromModelUri(u)).filter((p) => p && !k.has(p));
}

export function markerEndCol(col: number, message: string): number {
  const start = Math.max(1, Number(col) || 1);
  const tok = String(message || "").trim().split(/\s+/)[0] || "";
  const w = Math.min(48, Math.max(2, tok.length || 8));
  return start + w;
}

type ModelLike = {
  getValue: () => string;
  getLineCount?: () => number;
  getLineMaxColumn?: (n: number) => number;
  pushEditOperations?: (before: unknown[], edits: unknown[], after: unknown) => unknown;
  setValue?: (v: string) => void;
};

/** Keep undo. setValue() wipes the stack. */
export function applyModelText(model: ModelLike, next: string): boolean {
  if (model.getValue() === next) return false;
  if (typeof model.pushEditOperations === "function" && model.getLineCount && model.getLineMaxColumn) {
    try {
      const last = Math.max(1, model.getLineCount());
      model.pushEditOperations(
        [],
        [
          {
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: last,
              endColumn: model.getLineMaxColumn(last),
            },
            text: next,
          },
        ],
        () => null,
      );
      return true;
    } catch {
      /* fall through to setValue */
    }
  }
  model.setValue?.(next);
  return true;
}
