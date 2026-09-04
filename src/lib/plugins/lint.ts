export type LintHit = { path: string; line: number; text: string };

export function lintFile(path: string, content: string): LintHit[] {
  const hits: LintHit[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  let line = 1;
  let inStr: string | null = null;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (ch === "\n") {
      line += 1;
      continue;
    }
    if (inStr) {
      if (ch === "\\" && inStr !== "`") {
        i += 1;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (pairs[ch]) stack.push(pairs[ch]!);
    else if (ch === ")" || ch === "]" || ch === "}") {
      const want = stack.pop();
      if (want !== ch) hits.push({ path, line, text: `unerwartete ${ch}` });
    }
  }
  if (stack.length) hits.push({ path, line, text: `fehlende ${stack.join(" ")}` });
  if (path.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (err) {
      hits.push({ path, line: 1, text: err instanceof Error ? err.message : "JSON" });
    }
  }
  if (/^\t/m.test(content) && /^ {2,}/m.test(content)) {
    hits.push({ path, line: 1, text: "Tabs und Spaces gemischt" });
  }
  return hits.slice(0, 20);
}

export function lintWorkspace(files: Record<string, string>): LintHit[] {
  const hits: LintHit[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (hits.length >= 80) break;
    hits.push(...lintFile(path, content));
  }
  return hits.slice(0, 80);
}
