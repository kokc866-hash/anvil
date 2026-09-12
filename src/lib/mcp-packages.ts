import type { McpServer } from "./mcp.ts";

// Existing versions are immutable: a changed endpoint or wider tool set needs a
// new ID and an explicit add action. Never migrate an installed grant in place.
const PREFIX = "anvil-pack:";
export const GITHUB_READ_PACKAGE = Object.freeze({
  id: "anvil-pack:github-repos-readonly:v1",
  version: 1,
  name: "GitHub · Projektquelle lesen",
  url: "https://api.githubcopilot.com/mcp/x/repos/readonly",
  source: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
  tools: Object.freeze(["get_file_contents", "list_branches", "list_commits"]),
  probe: Object.freeze({ owner: "github", repo: "github-mcp-server", path: "README.md" }),
});

export function mcpPackage(server: Pick<McpServer, "id">) {
  return server.id === GITHUB_READ_PACKAGE.id ? GITHUB_READ_PACKAGE : undefined;
}

export function createGithubReadPackage(): McpServer {
  return {
    id: GITHUB_READ_PACKAGE.id,
    name: GITHUB_READ_PACKAGE.name,
    url: GITHUB_READ_PACKAGE.url,
    transport: "http",
    auth: "bearer",
    enabled: false,
  };
}

export function assertMcpPackageRequest(server: McpServer, method: string, params: unknown) {
  if (!server.id.startsWith(PREFIX)) return;
  const pack = mcpPackage(server);
  if (!pack)
    throw new Error(
      "Unbekannte MCP-Paketversion. Paket entfernen und eine unterstützte Version hinzufügen.",
    );
  if (server.url !== pack.url || server.transport === "stdio" || server.auth === "oauth")
    throw new Error(
      "Die Verbindung dieses MCP-Pakets wurde verändert. Paket entfernen und erneut hinzufügen.",
    );
  if (method === "tools/call") {
    const name = (params as { name?: unknown } | null)?.name;
    if (typeof name !== "string" || !pack.tools.includes(name))
      throw new Error("Dieses Werkzeug ist für das Lesepaket nicht freigegeben.");
  } else if (!["initialize", "notifications/initialized", "tools/list"].includes(method)) {
    throw new Error("Diese Funktion ist für das Lesepaket nicht freigegeben.");
  }
}

export function mcpPackageTools<T extends { name?: unknown }>(server: McpServer, tools: T[]): T[] {
  const pack = mcpPackage(server);
  return pack
    ? tools.filter((tool) => typeof tool.name === "string" && pack.tools.includes(tool.name))
    : tools;
}

export function assertMcpPackageProbeResult(raw: unknown) {
  const value = raw as {
    isError?: boolean;
    text?: string;
    content?: unknown[];
    structuredContent?: unknown;
  } | null;
  if (!value || value.isError)
    throw new Error("Leseprobe fehlgeschlagen. Die Serverausgabe enthält einen Fehler.");
  const content =
    value.text?.trim() ||
    (value.structuredContent == null ? "" : JSON.stringify(value.structuredContent));
  const embedded = value.content?.some((part) => {
    const item = part as { resource?: { text?: string } };
    return Boolean(item?.resource?.text?.trim());
  });
  if ((!content || ["{}", "[]", "null"].includes(content)) && !embedded)
    throw new Error(
      "Leseprobe ohne Dateiinhalt. Ein geladener Katalog allein bestätigt den Zugriff nicht.",
    );
}
