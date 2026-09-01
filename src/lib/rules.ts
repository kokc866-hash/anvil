const RULE_PATHS = [
  ".anvil/rules.md",
  ".anvil/rules",
  "AGENTS.md",
  "Agents.md",
  ".cursorrules",
  "CLAUDE.md",
];

export function workspaceRules(files: Record<string, string>, extra = ""): string {
  const chunks: string[] = [];
  if (extra.trim()) chunks.push(extra.trim());
  for (const p of RULE_PATHS) {
    const t = files[p]?.trim();
    if (t) chunks.push(`# ${p}\n${t.slice(0, 6000)}`);
  }
  return chunks.join("\n\n");
}

export function ruleFilesPresent(files: Record<string, string>): string[] {
  return RULE_PATHS.filter((p) => Boolean(files[p]?.trim()));
}
