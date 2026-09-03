export type McpServer = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  context?: Record<string, string>;
  timeoutMs?: number;
};

export type { McpTool, McpResource } from "./mcp-parse";
import { parseMcpBody, unwrapMcp, mcpCatalogText, type McpTool, type McpResource } from "./mcp-parse";
import { isPrivateHost } from "./net-guard";
import { loadSecrets } from "./secrets";
import { mergeMcpArgs } from "./surface";

export { parseMcpBody, unwrapMcp, mcpCatalogText };

type Rpc = { jsonrpc: "2.0"; id: number; method: string; params?: unknown };

const sessions = new Map<string, string>();
let catalog: McpTool[] = [];
let catalogAt = 0;
let resources: McpResource[] = [];
const caps = new Map<string, string[]>();

export function mcpToolsCached(): McpTool[] {
  return catalog;
}

export function mcpResourcesCached(): McpResource[] {
  return resources;
}

export function mcpCaps(id: string): string[] {
  return caps.get(id) ?? [];
}

export function mcpCatalogNow(): string {
  return mcpCatalogText(catalog);
}

function assertMcpUrl(raw: string): URL {
  const url = new URL(raw.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("MCP nur http(s)");
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!local && isPrivateHost(url.hostname)) throw new Error("Privater MCP-Host gesperrt");
  return url;
}

async function rpc(s: McpServer, method: string, params?: unknown, onChunk?: (t: string) => void): Promise<unknown> {
  const parsed = assertMcpUrl(s.url);
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  const key = parsed.toString();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2024-11-05",
  };
  const sid = sessions.get(key);
  if (sid) headers["mcp-session-id"] = sid;
  if (local) {
    const t = loadSecrets().companionToken.trim();
    if (t) headers["x-anvil-token"] = t;
  }
  const bearer = loadSecrets().keys[`mcp:${s.id}`]?.trim() || loadSecrets().keys[`mcp:${s.name}`]?.trim();
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const isNote = method.startsWith("notifications/");
  const body = isNote
    ? { jsonrpc: "2.0" as const, method, params }
    : ({ jsonrpc: "2.0", id: Date.now() % 1_000_000, method, params } satisfies Rpc);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(20_000, s.timeoutMs || 120_000)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED/i.test(msg)) {
      throw new Error(
        local
          ? "Companion-MCP nicht erreichbar. Helfer starten, in Einstellungen koppeln, dann erneut pingen."
          : "MCP nicht erreichbar (Netz/CORS).",
      );
    }
    throw e;
  }
  const nextSid = res.headers.get("mcp-session-id");
  if (nextSid) sessions.set(key, nextSid);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    return readMcpSse(res, onChunk);
  }
  const text = await res.text();
  if (isNote) return {};
  if (!res.ok) throw new Error(`MCP ${res.status}: ${text.slice(0, 200)}`);
  const json = parseMcpBody(text);
  if (json.error) throw new Error(json.error.message || "MCP error");
  return json.result;
}

export async function mcpList(servers: McpServer[]): Promise<McpTool[]> {
  const out: McpTool[] = [];
  const resOut: McpResource[] = [];
  for (const s of servers.filter((x) => x.enabled && x.url.trim())) {
    try {
      const init = (await rpc(s, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: { resources: {}, tools: {} },
        clientInfo: { name: "anvil", version: "1" },
      })) as { capabilities?: Record<string, unknown> };
      const capKeys = Object.keys(init?.capabilities ?? {});
      caps.set(s.id, capKeys);
      try {
        await rpc(s, "notifications/initialized", {});
      } catch {
        /* notification, some servers have no reply */
      }
      const r = (await rpc(s, "tools/list", {})) as { tools?: { name: string; description?: string }[] };
      for (const t of r.tools ?? []) {
        out.push({ server: s.name || s.id, name: t.name, description: t.description ?? "" });
      }
      if (init?.capabilities && "resources" in init.capabilities) {
        try {
          const rr = (await rpc(s, "resources/list", {})) as {
            resources?: { uri: string; name?: string; mimeType?: string }[];
          };
          for (const x of rr.resources ?? []) {
            resOut.push({
              server: s.name || s.id,
              uri: x.uri,
              name: x.name || x.uri,
              mimeType: x.mimeType,
            });
          }
        } catch {
          /* server advertised resources but list failed */
        }
      }
    } catch (e) {
      caps.set(s.id, []);
      out.push({
        server: s.name || s.id,
        name: "(fehler)",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }
  catalog = out;
  resources = resOut;
  catalogAt = Date.now();
  return out;
}

export async function mcpReadResource(servers: McpServer[], server: string, uri: string): Promise<unknown> {
  const s = servers.find((x) => x.enabled && (x.id === server || x.name === server));
  if (!s) throw new Error(`MCP-Server nicht gefunden: ${server}`);
  return unwrapMcp(await rpc(s, "resources/read", { uri }));
}

export async function mcpRefresh(servers: McpServer[], maxAgeMs = 60_000): Promise<McpTool[]> {
  if (catalog.length && Date.now() - catalogAt < maxAgeMs) return catalog;
  return mcpList(servers);
}

function mcpEventText(obj: unknown): string {
  if (!obj || typeof obj !== "object") return typeof obj === "string" ? obj : "";
  const o = obj as Record<string, unknown>;
  const bits: string[] = [];
  const take = (v: unknown) => {
    if (typeof v === "string" && v.trim()) bits.push(v);
  };
  take(o.message);
  take(o.text);
  const params = o.params && typeof o.params === "object" ? (o.params as Record<string, unknown>) : null;
  if (params) {
    take(params.message);
    take(params.text);
    if (typeof params.progress === "number") bits.push(`${Math.round(params.progress * 100)}%`);
  }
  const content = o.content ?? params?.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === "object") take((c as { text?: string }).text);
      else take(c);
    }
  } else take(content);
  const result = o.result;
  if (result && typeof result === "object") bits.push(mcpEventText(result));
  return bits.filter(Boolean).join("");
}

async function readMcpSse(res: Response, onChunk?: (t: string) => void): Promise<unknown> {
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`MCP ${res.status}: ${t.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("MCP-Stream leer");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: unknown;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as { result?: unknown; error?: { message?: string } };
          if (json.error) throw new Error(json.error.message || "MCP error");
          const piece = mcpEventText(json);
          if (piece) onChunk?.(piece);
          if (json && "result" in json) result = json.result;
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* */
    }
  }
  return result;
}

export async function mcpCall(
  servers: McpServer[],
  server: string,
  name: string,
  args: unknown,
  onChunk?: (t: string) => void,
): Promise<unknown> {
  const s = servers.find((x) => x.enabled && (x.id === server || x.name === server));
  if (!s) throw new Error(`MCP-Server nicht gefunden: ${server}`);
  const raw = await rpc(s, "tools/call", { name, arguments: mergeMcpArgs(s.context, args) }, onChunk);
  return unwrapMcp(raw);
}

export function newMcpId(): string {
  return `mcp-${Date.now().toString(36)}`;
}
