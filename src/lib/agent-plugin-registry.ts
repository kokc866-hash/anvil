import { inspectAgentPlugin, normalizePluginPath, type AgentPluginPackage } from "./agent-plugin-package.ts";

export const IMPORTED_PLUGIN_PREFIX = ".anvil/skills/package-";
export type ImportedAgentPlugin = Omit<AgentPluginPackage, "files"> & { schema: 1; enabled: boolean; source: string };
export const pluginRoot = (id: string) => `${IMPORTED_PLUGIN_PREFIX}${id}`;
export const pluginRecord = (id: string) => `.anvil/plugin-imports/${id}.json`;

export function importedAgentPlugins(files: Record<string, string>): ImportedAgentPlugin[] {
  const records: ImportedAgentPlugin[] = [];
  for (const [path, source] of Object.entries(files)) {
    const match = /^\.anvil\/plugin-imports\/([a-z0-9-]+)\.json$/.exec(path);
    if (!match) continue;
    try {
      const record = JSON.parse(source) as ImportedAgentPlugin;
      if (record.schema !== 1 || record.id !== match[1] || typeof record.enabled !== "boolean" || !["agent", "codex", "cursor"].includes(record.format) || typeof record.name !== "string" || !Array.isArray(record.skills) || !Array.isArray(record.servers) || !Array.isArray(record.components) || !Array.isArray(record.warnings)) continue;
      if (!record.skills.every(skill => typeof skill === "string" && normalizePluginPath(skill) === skill && /(^|\/)SKILL\.md$/.test(skill))) continue;
      if (typeof record.description !== "string" || typeof record.source !== "string" || typeof record.manifest !== "string" || normalizePluginPath(record.manifest) !== record.manifest || !record.warnings.every(value => typeof value === "string")) continue;
      if (!record.components.every(part => part && typeof part.kind === "string" && typeof part.label === "string" && typeof part.path === "string" && typeof part.detail === "string" && typeof part.supported === "boolean")) continue;
      if (!record.servers.every(server => server && typeof server.name === "string" && typeof server.url === "string" && (server.auth === undefined || server.auth === "oauth" || server.auth === "bearer"))) continue;
      records.push(record);
    } catch { /* Invalid records never activate package contents. */ }
  }
  return records;
}

const skillCache = new WeakMap<Record<string, string>, Set<string>>();
export function importedSkillPaths(files: Record<string, string>): Set<string> {
  const cached = skillCache.get(files);
  if (cached) return cached;
  const paths = new Set<string>();
  for (const record of importedAgentPlugins(files).filter(record => record.enabled)) {
    const root = pluginRoot(record.id) + "/";
    try {
      const source = Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(root)).map(([path, body]) => [path.slice(root.length), body]));
      const checked = inspectAgentPlugin(source, record.manifest);
      if (checked.id !== record.id || JSON.stringify(checked.skills) !== JSON.stringify(record.skills) || JSON.stringify(checked.servers) !== JSON.stringify(record.servers)) continue;
      for (const path of checked.skills) paths.add(root + path);
    } catch { /* Edited, incomplete or invalid packages cannot introduce new skills. */ }
  }
  skillCache.set(files, paths);
  return paths;
}

export function agentPluginInstallFiles(pack: AgentPluginPackage, source: string, existing: Record<string, string>, dirs: string[] = []): Record<string, string> {
  if (!/^[a-z0-9-]+$/.test(pack.id)) throw new Error("Ungültige Paketkennung.");
  if (!pack.skills.length && !pack.servers.length) throw new Error("Dieses Paket enthält noch keine in Anvil unterstützten Skills oder Dienstverbindungen.");
  const root = pluginRoot(pack.id), recordPath = pluginRecord(pack.id);
  const occupied = [...Object.keys(existing), ...dirs].map(path => path.toLowerCase());
  const existingFiles = new Set(Object.keys(existing).map(path => path.toLowerCase()));
  if (occupied.some(path => path === recordPath || path.startsWith(recordPath + "/") || path === root || path.startsWith(root + "/") || (root.startsWith(path + "/") || recordPath.startsWith(path + "/")) && existingFiles.has(path))) throw new Error("Dieses Paket oder sein Zielordner existiert bereits. Entferne es vor einem erneuten Import; vorhandene Dateien werden nicht überschrieben.");
  const { files, ...metadata } = pack;
  const record: ImportedAgentPlugin = { ...metadata, schema: 1, enabled: false, source };
  return { ...Object.fromEntries(Object.entries(files).map(([path, body]) => [`${root}/${normalizePluginPath(path)}`, body])), [recordPath]: JSON.stringify(record, null, 2) + "\n" };
}

export function pluginOwnedPaths(files: Record<string, string>, id: string): string[] {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Ungültige Paketkennung.");
  const root = pluginRoot(id);
  return Object.keys(files).filter(path => path.startsWith(root + "/") || path === pluginRecord(id));
}
