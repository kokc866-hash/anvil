import type { McpServer } from "./mcp";

import { SERVICE_PROVIDERS } from "./service-providers";
export { SERVICE_PROVIDERS } from "./service-providers";

export function isMcpService(s: Pick<McpServer, "id" | "service">) {
  return Boolean(s.service || s.id.startsWith("anvil-service:"));
}
export function serviceAddress(value: string) {
  const url = new URL(value.trim());
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  )
    throw new Error(
      "Eine HTTPS-MCP-Adresse ohne Zugangsdaten eingeben. HTTP ist nur lokal erlaubt.",
    );
  return url.href;
}
export function validateService(s: McpServer) {
  if (!isMcpService(s)) return;
  if (!s.service || s.auth !== "oauth" || s.transport !== "http")
    throw new Error("Ungültige Dienstverbindung. Neu hinzufügen.");
  const url = serviceAddress(s.url);
  const provider = SERVICE_PROVIDERS.find((p) => p.id === s.service);
  if ((s.service !== "custom" && !provider) || (provider && url !== provider.url))
    throw new Error("Die Anbieteradresse wurde verändert. Dienst neu hinzufügen.");
  if (
    !Array.isArray(s.allowedTools) ||
    s.allowedTools.some((t) => typeof t !== "string" || !t.trim())
  )
    throw new Error("Ungültige Werkzeugfreigabe. Dienst neu hinzufügen.");
}
export function serviceConnectionKey(s: McpServer) {
  return JSON.stringify([s.id, s.service, s.url, s.auth, s.transport, s.oauthClientId || ""]);
}
export function assertServiceRequest(
  s: McpServer,
  live: McpServer | undefined,
  method: string,
  params: unknown,
) {
  if (!isMcpService(s) && !live?.service) return;
  validateService(s);
  if (!live || !live.enabled || serviceConnectionKey(live) !== serviceConnectionKey(s))
    throw new Error("Dienst entfernt, deaktiviert oder inzwischen verändert.");
  validateService(live);
  if (method === "tools/call") {
    const name = (params as { name?: unknown } | null)?.name;
    if (typeof name !== "string" || !live.allowedTools?.includes(name))
      throw new Error("Dieses Werkzeug ist für Anvil nicht freigegeben.");
  }
  if (method === "resources/read" && !live.allowResources)
    throw new Error("Ressourcen dieses Dienstes sind für Anvil nicht freigegeben.");
}
