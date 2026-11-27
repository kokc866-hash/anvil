import { useIde } from "@/store/ide";
import { mcpLogout, uniqueMcpName, type McpServer } from "./mcp";
import { flushPersistence } from "./persist-storage";
import { flushSecrets, saveSecrets } from "./secrets";
import {
  SERVICE_PROVIDERS,
  isMcpService,
  serviceAddress,
  validateService,
  serviceConnectionKey,
} from "./mcp-service-policy";
export { SERVICE_PROVIDERS } from "./mcp-service-policy";

export function createService(
  providerId: string,
  name?: string,
  url?: string,
  clientId?: string,
): McpServer {
  const provider = SERVICE_PROVIDERS.find((p) => p.id === providerId);
  if (!provider && providerId !== "custom") throw new Error("Unbekannter Dienst.");
  if (provider?.setupRequired) throw new Error(provider.setupRequired);
  const server: McpServer = {
    id: `anvil-service:${crypto.randomUUID()}`,
    service: providerId,
    name: provider?.name || name?.trim() || "Eigener Dienst",
    url: serviceAddress(provider?.url || url || ""),
    transport: "http",
    auth: provider?.auth || "oauth",
    oauthClientId: clientId?.trim() || undefined,
    enabled: false,
    allowedTools: [],
    allowResources: false,
  };
  validateService(server);
  server.name = uniqueMcpName(useIde.getState().mcpServers, server.name, server.id);
  return server;
}

export function updateService(id: string, patch: Partial<McpServer>) {
  const st = useIde.getState(),
    previous = st.mcpServers.find((s) => s.id === id);
  if (!previous || !isMcpService(previous)) throw new Error("Dienst nicht mehr vorhanden.");
  // Identity and endpoint are immutable: a different account target is added separately.
  if (
    Object.keys(patch).some(
      (k) => !["enabled", "allowedTools", "allowResources", "name"].includes(k),
    )
  )
    throw new Error("Die Dienstadresse lässt sich nur durch eine neue Verbindung ändern.");
  const next = { ...previous, ...patch };
  validateService(next);
  st.setMcpServers(st.mcpServers.map((s) => (s.id === id ? next : s)));
}

export async function saveServiceApiKey(id: string, raw: string) {
  const server = useIde.getState().mcpServers.find((s) => s.id === id);
  if (!server || !isMcpService(server)) throw new Error("Dienst nicht mehr vorhanden.");
  validateService(server);
  if (server.auth !== "bearer") throw new Error("Dieser Dienst verwendet die Browser-Anmeldung.");
  const key = raw.trim();
  if (
    !key ||
    key.length > 512 ||
    /\s/.test(key) ||
    [...key].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    (server.service === "sorceress" && !key.startsWith("sk_sorc_"))
  )
    throw new Error("Gültigen Sorceress-API-Schlüssel eintragen (beginnt mit sk_sorc_).");
  saveSecrets({ keys: { [`mcp:${id}`]: key, [`mcp-target:${id}`]: server.url } });
  await flushSecrets();
}

export async function disconnectService(id: string, remove = false) {
  const st = useIde.getState(),
    server = st.mcpServers.find((s) => s.id === id);
  if (!server || !isMcpService(server)) throw new Error("Dienst nicht mehr vorhanden.");
  updateService(id, { enabled: false, allowedTools: [], allowResources: false });
  await mcpLogout(server);
  if (remove) {
    const latest = useIde.getState();
    const current = latest.mcpServers.find((s) => s.id === id);
    if (current && serviceConnectionKey(current) !== serviceConnectionKey(server))
      throw new Error(
        "Die Verbindung wurde während der Abmeldung ersetzt. Die neue Verbindung bleibt erhalten.",
      );
    latest.setMcpServers(latest.mcpServers.filter((s) => s.id !== id));
  }
  await flushPersistence();
}
