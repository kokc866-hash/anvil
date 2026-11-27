import { inspectAgentPlugin, type AgentPluginPackage, type PluginComponent, type PluginComponentStatus } from "./agent-plugin-package.ts";

type PackageView = Omit<AgentPluginPackage, "files"> & { files?: Record<string, string>; enabled?: boolean };
export type PluginServiceReadiness = { url: string; auth?: "oauth" | "bearer"; transport?: "http" | "stdio"; enabled: boolean; ready?: boolean; tools?: number; resources?: number };
export type PluginCompatibilityOptions = { files?: Record<string, string>; services?: PluginServiceReadiness[]; skillPaths?: ReadonlySet<string> };
export type PluginCompatibilityPart = PluginComponent & { status: PluginComponentStatus; state: "not-imported" | "disabled" | "available" | "unverified" | "unsupported"; reason: string };
export type PluginCompatibility = { parts: PluginCompatibilityPart[]; usable: number; setupRequired: number; unsupported: number; partial: boolean; valid: boolean; installed: boolean };

/** Reinspect current package files; a saved compatibility label is not authority. */
export function pluginCompatibility(pack: PackageView, options: PluginCompatibilityOptions = {}): PluginCompatibility {
  const installed = options.files !== undefined;
  const root = `.anvil/skills/package-${pack.id}/`;
  let checked: AgentPluginPackage | undefined;
  try {
    const source = installed
      ? Object.fromEntries(Object.entries(options.files!).filter(([path]) => path.startsWith(root)).map(([path, body]) => [path.slice(root.length), body]))
      : pack.files;
    if (source) checked = inspectAgentPlugin(source, pack.manifest);
    if (!checked || checked.id !== pack.id || JSON.stringify(checked.skills) !== JSON.stringify(pack.skills) || JSON.stringify(checked.servers) !== JSON.stringify(pack.servers)) checked = undefined;
  } catch { /* Incomplete, edited and invalid sources remain visible but unusable. */ }
  const valid = checked !== undefined;
  const parts: PluginCompatibilityPart[] = (checked?.components || pack.components).map(part => {
    if (!valid) return { ...part, supported: false, status: "unsupported", state: "unverified", reason: "Die aktuellen Paketdateien passen nicht zur geprüften Importdefinition. Paket prüfen und erneut importieren; gespeicherte Statusangaben gelten nicht als Freigabe." };
    if (!part.supported) return { ...part, status: part.status === "setup-required" ? "setup-required" : "unsupported", state: part.status === "setup-required" ? "unverified" : "unsupported", reason: part.detail };
    if (part.kind === "skill") {
      if (!installed) return { ...part, status: "usable", state: "not-imported", reason: "Als Projekt-Skill nutzbar. Wird deaktiviert importiert; die Aktivierung führt keine Skripte aus und erteilt keine Werkzeugrechte." };
      if (!pack.enabled) return { ...part, status: "setup-required", state: "disabled", reason: "Paket-Skills sind deaktiviert. Bei Bedarf im bestehenden Skill-System aktivieren; Skripte bleiben unausgeführt." };
      if (options.skillPaths && !options.skillPaths.has(root + part.path)) return { ...part, status: "setup-required", state: "unverified", reason: "Der Skill ist in der aktuellen Skill-Auswahl nicht verfügbar. Skill-Einstellungen und Paketdateien prüfen." };
      return { ...part, status: "usable", state: "available", reason: "Der Projekt-Skill ist zur Auswahl verfügbar. Er wird nur passend zum Auftrag geladen; Skripte und externe Aktionen erhalten dadurch keine Freigabe." };
    }
    if (part.kind === "mcp") {
      const definition = checked!.servers.find(server => server.name === part.label);
      const matching = definition ? options.services?.filter(service => service.url === definition.url && service.transport !== "stdio" && (service.auth || "oauth") === (definition.auth || "oauth")) || [] : [];
      const usable = matching.find(service => service.enabled && service.ready && ((service.tools || 0) > 0 || (service.resources || 0) > 0));
      if (installed && usable) return { ...part, status: "usable", state: "available", reason: "Eine vorhandene Dienstverbindung ist bereit und stellt freigegebene Werkzeuge oder Ressourcen bereit. Die jeweiligen Ausführungsrechte gelten weiterhin." };
      const reason = !installed ? "Die HTTPS-Dienstdefinition ist importierbar. Anschließend Verbindung, Anmeldung und Werkzeugfreigabe in den vorhandenen Diensten einrichten."
        : !matching.length ? "Noch keine passende Dienstverbindung eingerichtet. Import und Skill-Aktivierung verbinden den Dienst nicht."
        : !matching.some(service => service.enabled) ? "Die passende Dienstverbindung ist deaktiviert. In den vorhandenen Diensten aktivieren und anmelden."
        : !matching.some(service => service.ready) ? "Die Dienstverbindung ist noch nicht als bereit bestätigt. Verbindung und Anmeldung in den vorhandenen Diensten prüfen."
        : "Die Dienstverbindung ist bereit, bietet hier aber noch keine freigegebenen Werkzeuge oder Ressourcen. Die Freigaben in den vorhandenen Diensten prüfen.";
      return { ...part, status: "setup-required", state: "unverified", reason };
    }
    return { ...part, status: part.status || "unsupported", state: "unverified", reason: part.detail };
  });
  const usable = parts.filter(part => part.status === "usable").length;
  const setupRequired = parts.filter(part => part.status === "setup-required").length;
  const unsupported = parts.filter(part => part.status === "unsupported").length;
  return { parts, usable, setupRequired, unsupported, partial: unsupported > 0 && usable + setupRequired > 0, valid, installed };
}
