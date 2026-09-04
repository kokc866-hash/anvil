/** Top-level workspace plugins only (`plugins/foo.js`), never nested VSIX JS. */
export function isWorkspacePluginPath(path: string): boolean {
  return /^plugins\/[^/]+\.js$/.test(path);
}

export function pluginTrustFromHead(code: string): boolean {
  const head = String(code ?? "")
    .split("\n")
    .slice(0, 8)
    .join("\n");
  return /@trust\b/.test(head);
}

export function pluginWatchPath(path: string): boolean {
  return path.startsWith("plugins/") || path.startsWith(".vscode/") || path.endsWith(".code-snippets");
}

export function prunePluginIds(ids: string[], prefix: "ws:" | "vs:", live: Iterable<string>): string[] {
  const keep = new Set(live);
  return ids.filter((id) => !id.startsWith(prefix) || keep.has(id));
}

export function vsPackPluginId(packId: string): string {
  return packId.startsWith("vs:") ? packId : `vs:${packId}`;
}
