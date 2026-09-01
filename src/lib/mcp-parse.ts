export type McpTool = {
  server: string;
  name: string;
  description: string;
};

export type McpResource = {
  server: string;
  uri: string;
  name: string;
  mimeType?: string;
};

export function parseMcpBody(text: string): { result?: unknown; error?: { message?: string } } {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as { result?: unknown; error?: { message?: string } };
    } catch {
      /* SSE */
    }
  }
  const payloads: { result?: unknown; error?: { message?: string } }[] = [];
  for (const block of trimmed.split(/\n\n+/)) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!data) continue;
    try {
      payloads.push(JSON.parse(data) as { result?: unknown; error?: { message?: string } });
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
  if (r.structuredContent != null) return r.structuredContent;
  return result;
}

export function mcpCatalogText(tools: McpTool[]): string {
  const ok = tools.filter((t) => t.name !== "(fehler)").slice(0, 80);
  if (!ok.length) return "";
  const lines = ok.map((t) => `- ${t.server}.${t.name}${t.description ? ` — ${t.description.slice(0, 140)}` : ""}`);
  return `MCP-Tools (mcp_call: server = Name vor dem Punkt, name = Tool):\n${lines.join("\n")}`;
}
