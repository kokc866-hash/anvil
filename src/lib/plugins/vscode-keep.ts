export function shouldKeepVsixPath(p: string): boolean {
  if (/(^|\/)node_modules\//.test(p)) return false;
  return (
    /(^|\/)package\.json$/.test(p) ||
    /\.code-snippets$/.test(p) ||
    /language-configuration\.json$/.test(p) ||
    /snippets?\/.+\.json$/i.test(p) ||
    /\.tmLanguage(\.json)?$/i.test(p) ||
    /\/syntaxes\//i.test(p) ||
    /\.vsixmanifest$/i.test(p)
  );
}

/** Pull identifier lists out of a TextMate grammar so unknown langs aren't empty plaintext. */
export function keywordsFromTm(data: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const name = String(rec.name ?? rec.scopeName ?? "");
    if (/keyword/.test(name) && typeof rec.match === "string") {
      const inner = rec.match.match(/\(([^)]+)\)/);
      const list = inner?.[1];
      if (list && !/[?*+]/.test(list.replace(/\|/g, ""))) {
        for (const part of list.split("|")) {
          const w = part.replace(/\\[bBAZz]|\\/g, "");
          if (/^[A-Za-z_][\w-]*$/.test(w)) out.add(w);
        }
      }
    }
    if (rec.patterns) walk(rec.patterns);
    if (rec.repository) walk(Object.values(rec.repository as object));
  };
  walk(data);
  return [...out].slice(0, 80);
}
