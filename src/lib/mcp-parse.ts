export type McpTool = {
  server: string;
  serverId?: string;
  name: string;
  description: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
};

export type McpResource = {
  server: string;
  uri: string;
  name: string;
  mimeType?: string;
};

export const MCP_PROTOCOL_PREFER = "2025-03-26";
export const MCP_PROTOCOL_FALLBACK = "2024-11-05";

export function parseMcpBody(text: string): { result?: unknown; error?: { message?: string }; id?: unknown } {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as { result?: unknown; error?: { message?: string }; id?: unknown };
    } catch {
      /* SSE */
    }
  }
  const payloads: { result?: unknown; error?: { message?: string }; id?: unknown }[] = [];
  for (const block of trimmed.split(/\n\n+/)) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!data) continue;
    try {
      payloads.push(JSON.parse(data) as { result?: unknown; error?: { message?: string }; id?: unknown });
    } catch {
      /* skip */
    }
  }
  return payloads.find((p) => p.result != null || p.error) ?? payloads.at(-1) ?? {};
}

export function unwrapMcp(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as {
    content?: { type?: string; text?: string; data?: string; mimeType?: string; url?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  const texts = (r.content ?? []).map((c) => c.text).filter(Boolean) as string[];
  const img = (r.content ?? []).find((c) => c.type === "image" && (c.data || c.url));
  const image = img?.url
    ? img.url
    : img?.data
      ? `data:${img.mimeType || "image/png"};base64,${img.data}`
      : undefined;
  if (texts.length || image) {
    return { text: texts.join("\n").slice(0, 12_000), image, isError: Boolean(r.isError) };
  }
  if (r.isError) {
    return { text: JSON.stringify(r.structuredContent ?? r).slice(0, 12_000), isError: true };
  }
  if (r.structuredContent != null) return r.structuredContent;
  return result;
}

export function mcpIsError(r: unknown): r is { isError: true; text?: string } {
  return Boolean(r && typeof r === "object" && (r as { isError?: boolean }).isError);
}

export function schemaHint(schema: McpTool["inputSchema"] | undefined): string {
  const props = schema?.properties;
  if (!props) return "";
  const req = new Set((schema.required ?? []).map(String));
  return Object.keys(props)
    .slice(0, 16)
    .map((k) => (req.has(k) ? `${k}*` : k))
    .join(", ");
}

export function mcpCatalogText(tools: McpTool[]): string {
  const ok = tools.filter((t) => t.name !== "(fehler)").slice(0, 80);
  if (!ok.length) return "";
  const lines = ok.map((t) => {
    const hint = schemaHint(t.inputSchema);
    const desc = t.description ? ` — ${t.description.slice(0, 140)}` : "";
    const args = hint ? ` [${hint}]` : "";
    return `- ${t.server}.${t.name}${desc}${args}`;
  });
  return `MCP-Tools (mcp_call: server = Name oder Id, name = Tool. Pflicht-Args mit *):\n${lines.join("\n")}`;
}

export function encodeMcpPick(serverId: string, tool: string): string {
  return `${serverId}::${tool}`;
}

export function decodeMcpPick(pick: string): { server: string; name: string } {
  const i = pick.indexOf("::");
  if (i >= 0) return { server: pick.slice(0, i), name: pick.slice(i + 2) };
  const dot = pick.indexOf(".");
  if (dot < 0) return { server: pick, name: "" };
  return { server: pick.slice(0, dot), name: pick.slice(dot + 1) };
}

export function uniqueMcpName(servers: Array<{ id: string; name: string }>, want: string, id: string): string {
  const base = want.trim() || "MCP";
  const taken = new Set(servers.filter((s) => s.id !== id).map((s) => s.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function catalogServerKey(
  s: { id: string; name: string },
  all: Array<{ id: string; name: string }>,
): string {
  const name = s.name.trim() || s.id;
  const clash = all.filter((x) => (x.name.trim() || x.id) === name).length > 1;
  return clash ? s.id : name;
}

export function isMcpLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    h.endsWith(".localhost")
  );
}

/** User-configured MCP URL: http(s), including loopback and LAN. */
export function parseMcpUrl(raw: string): URL {
  const url = new URL(String(raw ?? "").trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("MCP nur http(s)");
  if (!url.hostname) throw new Error("MCP-Host fehlt");
  return url;
}

export function serversFingerprint(servers: Array<{ id: string; name: string; url: string; enabled: boolean }>): string {
  return servers
    .filter((s) => s.enabled && s.url.trim())
    .map((s) => `${s.id}\t${s.url.trim()}\t${s.name}`)
    .sort()
    .join("\n");
}

export function nextListCursor(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const c = (result as { nextCursor?: unknown }).nextCursor;
  return typeof c === "string" && c.trim() ? c : "";
}
