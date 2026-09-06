export type McpServer = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  context?: Record<string, string>;
  timeoutMs?: number;
};

export type { McpTool, McpResource } from "./mcp-parse";
import { ANVIL_VERSION } from "./version";
import {
  parseMcpBody,
  unwrapMcp,
  mcpCatalogText,
  catalogServerKey,
  isMcpLoopback,
  parseMcpUrl,
  serversFingerprint,
  nextListCursor,
  MCP_PROTOCOL_PREFER,
  type McpTool,
  type McpResource,
} from "./mcp-parse";
import { loadSecrets } from "./secrets";
import { mergeMcpArgs } from "./surface";
import { withCompanion } from "./companion-life";

export {
  parseMcpBody,
  unwrapMcp,
  mcpCatalogText,
  parseMcpUrl,
  uniqueMcpName,
  encodeMcpPick,
  decodeMcpPick,
  catalogServerKey,
  schemaHint,
  mcpIsError,
} from "./mcp-parse";

type Rpc = { jsonrpc: "2.0"; id: number; method: string; params?: unknown };

type Sess = { url: string; sid: string; inited: boolean; caps: string[]; proto: string };

const sessions = new Map<string, Sess>();
const listErrors = new Map<string, string>();
let catalog: McpTool[] = [];
let catalogAt = 0;
let catalogFp = "";
let resources: McpResource[] = [];
const caps = new Map<string, string[]>();
let rpcSeq = 1;
let catalogGeneration = 0;
const catalogServers = new Map<string, string>();
const resourceKeys = new Map<string, Set<string>>();
const requestedServers = new Map<string, string>();
type ServerCatalog = { tools: McpTool[]; resources: McpResource[] };
const serverRequests = new Map<string, { fingerprint: string; promise: Promise<ServerCatalog> }>();
let refresh: { fingerprint: string; promise: Promise<McpTool[]> } | null = null;

export function mcpSnapshot(servers: McpServer[]) {
  const valid = servers.filter(
    (s) => s.enabled && catalogServers.get(s.id) === serversFingerprint([s]),
  );
  const ids = new Set(valid.map((s) => s.id));
  const names = new Set(valid.flatMap((s) => [s.id, s.name]));
  return {
    tools: catalog.filter((tool) => ids.has(tool.serverId ?? tool.server)),
    resources: resources.filter((resource) => names.has(resource.server)),
    ready: ids,
  };
}

function nextRpcId(): number {
  rpcSeq = (rpcSeq % 1_000_000_000) + 1;
  return rpcSeq;
}

export function mcpToolsCached(): McpTool[] {
  return catalog;
}

export function mcpResourcesCached(): McpResource[] {
  return resources;
}

export function mcpCaps(id: string): string[] {
  return caps.get(id) ?? [];
}

export function mcpListError(id: string): string | undefined {
  return listErrors.get(id);
}

export function mcpCatalogNow(): string {
  return mcpCatalogText(catalog);
}

export function mcpForget(id: string): void {
  catalogServers.delete(id);
  sessions.delete(id);
  caps.delete(id);
  listErrors.delete(id);
}

function findServer(servers: McpServer[], want: string): McpServer | undefined {
  const enabled = servers.filter((x) => x.enabled);
  const exactId = enabled.find((x) => x.id === want);
  if (exactId) return exactId;
  const named = enabled.filter((x) => x.name === want);
  if (named.length === 1) return named[0];
  if (named.length > 1) return named[0];
  return enabled.find((x) => x.name === want || x.id === want);
}

async function rpc(
  s: McpServer,
  method: string,
  params?: unknown,
  onChunk?: (t: string) => void,
): Promise<unknown> {
  const parsed = parseMcpUrl(s.url);
  const loopback = isMcpLoopback(parsed.hostname);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": sessions.get(s.id)?.proto || MCP_PROTOCOL_PREFER,
  };
  const sess = sessions.get(s.id);
  if (sess?.sid && sess.url === parsed.toString()) headers["mcp-session-id"] = sess.sid;
  if (loopback) {
    const t = loadSecrets().companionToken.trim();
    if (t) headers["x-anvil-token"] = t;
  }
  const bearer =
    loadSecrets().keys[`mcp:${s.id}`]?.trim() || loadSecrets().keys[`mcp:${s.name}`]?.trim();
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const isNote = method.startsWith("notifications/");
  const id = nextRpcId();
  const body = isNote
    ? { jsonrpc: "2.0" as const, method, params }
    : ({ jsonrpc: "2.0", id, method, params } satisfies Rpc);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(8_000, s.timeoutMs || 120_000)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED/i.test(msg)) {
      throw new Error(
        loopback
          ? "Companion-MCP nicht erreichbar. Helfer starten, in Einstellungen koppeln, dann erneut pingen."
          : "MCP nicht erreichbar (Netz/CORS).",
      );
    }
    throw e;
  }
  const nextSid = res.headers.get("mcp-session-id");
  if (nextSid) {
    const prev = sessions.get(s.id);
    sessions.set(s.id, {
      url: parsed.toString(),
      sid: nextSid,
      inited: prev?.inited ?? false,
      caps: prev?.caps ?? [],
      proto: prev?.proto || MCP_PROTOCOL_PREFER,
    });
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    return readMcpSse(res, onChunk, isNote ? undefined : id);
  }
  const text = await res.text();
  if (isNote) return {};
  if (!res.ok) {
    if (res.status === 404 || res.status === 400) mcpForget(s.id);
    throw new Error(`MCP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = parseMcpBody(text);
  if (json.error) throw new Error(json.error.message || "MCP error");
  return json.result;
}

async function initialize(s: McpServer): Promise<void> {
  const url = parseMcpUrl(s.url).toString();
  const prev = sessions.get(s.id);
  if (prev?.inited && prev.url === url) {
    caps.set(s.id, prev.caps);
    return;
  }
  if (prev && prev.url !== url) mcpForget(s.id);
  const init = (await rpc(s, "initialize", {
    protocolVersion: MCP_PROTOCOL_PREFER,
    capabilities: { resources: {}, tools: {} },
    clientInfo: { name: "anvil", version: ANVIL_VERSION },
  })) as { capabilities?: Record<string, unknown>; protocolVersion?: string };
  const capKeys = Object.keys(init?.capabilities ?? {});
  const proto = String(init?.protocolVersion || MCP_PROTOCOL_PREFER);
  const cur = sessions.get(s.id);
  sessions.set(s.id, {
    url,
    sid: cur?.sid || "",
    inited: true,
    caps: capKeys,
    proto,
  });
  caps.set(s.id, capKeys);
  try {
    await rpc(s, "notifications/initialized", {});
  } catch {
    /* notification */
  }
}

async function listPaged<T>(s: McpServer, method: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor = "";
  for (let i = 0; i < 8; i++) {
    const r = (await rpc(s, method, cursor ? { cursor } : {})) as Record<string, unknown>;
    const rows = r?.[key];
    if (Array.isArray(rows)) out.push(...(rows as T[]));
    cursor = nextListCursor(r);
    if (!cursor) break;
  }
  return out;
}

export async function mcpClose(s: McpServer): Promise<void> {
  const sess = sessions.get(s.id);
  const sid = sess?.sid;
  mcpForget(s.id);
  if (!sid || !s.url.trim()) return;
  try {
    const parsed = parseMcpUrl(s.url);
    await fetch(parsed.toString(), {
      method: "DELETE",
      headers: {
        "mcp-session-id": sid,
        "mcp-protocol-version": sess?.proto || MCP_PROTOCOL_PREFER,
      },
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* best-effort */
  }
}

async function loadServer(s: McpServer, live: McpServer[]): Promise<ServerCatalog> {
  const key = catalogServerKey(s, live);
  const toolsOut: McpTool[] = [];
  const resOut: McpResource[] = [];
  await initialize(s);
  const tools = await listPaged<{
    name: string;
    description?: string;
    inputSchema?: McpTool["inputSchema"];
  }>(s, "tools/list", "tools");
  for (const t of tools) {
    toolsOut.push({
      server: key,
      serverId: s.id,
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
    });
  }
  const cap = caps.get(s.id) ?? [];
  if (cap.includes("resources") || cap.length === 0) {
    try {
      const rr = await listPaged<{ uri: string; name?: string; mimeType?: string }>(
        s,
        "resources/list",
        "resources",
      );
      for (const x of rr) {
        resOut.push({
          server: key,
          uri: x.uri,
          name: x.name || x.uri,
          mimeType: x.mimeType,
        });
      }
    } catch {
      /* */
    }
  }
  return { tools: toolsOut, resources: resOut };
}

async function ingestServer(s: McpServer, live: McpServer[]): Promise<ServerCatalog> {
  const fingerprint = `${serversFingerprint([s])}|${catalogServerKey(s, live)}`;
  const pending = serverRequests.get(s.id);
  if (pending?.fingerprint === fingerprint) return pending.promise;
  const promise = withCompanion(() => loadServer(s, live), s.url);
  serverRequests.set(s.id, { fingerprint, promise });
  try {
    return await promise;
  } finally {
    if (serverRequests.get(s.id)?.promise === promise) serverRequests.delete(s.id);
  }
}

function clearCatalog(id: string) {
  const keys = new Set(catalog.filter((t) => t.serverId === id).map((t) => t.server));
  for (const key of resourceKeys.get(id) ?? []) keys.add(key);
  keys.add(id);
  catalog = catalog.filter((t) => t.serverId !== id);
  resources = resources.filter((r) => !keys.has(r.server));
  catalogServers.delete(id);
  resourceKeys.delete(id);
}

function acceptCatalog(s: McpServer, got: ServerCatalog) {
  clearCatalog(s.id);
  catalogServers.set(s.id, serversFingerprint([s]));
  resourceKeys.set(s.id, new Set(got.resources.map((r) => r.server)));
  listErrors.delete(s.id);
  catalog = [...catalog, ...got.tools];
  resources = [...resources, ...got.resources];
}

export async function mcpList(servers: McpServer[]): Promise<McpTool[]> {
  const generation = ++catalogGeneration;
  const live = servers.filter((s) => s.enabled && s.url.trim());
  const ids = new Set(live.map((s) => s.id));
  for (const id of requestedServers.keys())
    if (!ids.has(id)) {
      requestedServers.delete(id);
      clearCatalog(id);
      mcpForget(id);
    }
  for (const server of live) requestedServers.set(server.id, serversFingerprint([server]));
  const results: { tools: McpTool[]; resources: McpResource[]; error?: string }[] = new Array(
    live.length,
  );
  let index = 0;
  // Independent servers share a bounded pool, not a serial chain of timeouts.
  await Promise.all(
    Array.from({ length: Math.min(4, live.length) }, async () => {
      while (index < live.length) {
        const i = index++;
        try {
          results[i] = await ingestServer(live[i], live);
        } catch (error) {
          results[i] = {
            tools: [],
            resources: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }),
  );
  if (generation !== catalogGeneration) return catalog;
  for (let i = 0; i < live.length; i++) {
    const server = live[i];
    if (requestedServers.get(server.id) !== serversFingerprint([server])) continue;
    if (results[i].error) {
      clearCatalog(server.id);
      mcpForget(server.id);
      listErrors.set(server.id, results[i].error!);
    } else acceptCatalog(server, results[i]);
  }
  catalogAt = Date.now();
  catalogFp = live.every((s) => requestedServers.get(s.id) === serversFingerprint([s]))
    ? serversFingerprint(servers)
    : "";
  return catalog;
}

export async function mcpProbe(s: McpServer, all: McpServer[]): Promise<McpTool[]> {
  const fingerprint = serversFingerprint([s]);
  requestedServers.set(s.id, fingerprint);
  listErrors.delete(s.id);
  try {
    const got = await ingestServer(
      s,
      all.filter((x) => x.enabled && x.url.trim()),
    );
    if (requestedServers.get(s.id) !== fingerprint) return got.tools;
    acceptCatalog(s, got);
    catalogAt = Date.now();
    catalogFp = "";
    return catalog;
  } catch (e) {
    if (requestedServers.get(s.id) === fingerprint) {
      clearCatalog(s.id);
      mcpForget(s.id);
      listErrors.set(s.id, e instanceof Error ? e.message : String(e));
    }
    throw e;
  }
}

export async function mcpReadResource(
  servers: McpServer[],
  server: string,
  uri: string,
): Promise<unknown> {
  const s = findServer(servers, server);
  if (!s) throw new Error(`MCP-Server nicht gefunden: ${server}`);
  return withCompanion(async () => {
    await initialize(s);
    return unwrapMcp(await rpc(s, "resources/read", { uri }));
  }, s.url);
}

export async function mcpRefresh(servers: McpServer[], maxAgeMs = 60_000): Promise<McpTool[]> {
  const fp = serversFingerprint(servers);
  if (catalogFp === fp && Date.now() - catalogAt < maxAgeMs) return catalog;
  if (refresh?.fingerprint === fp) return refresh.promise;
  const promise = mcpList(servers);
  refresh = { fingerprint: fp, promise };
  try {
    return await promise;
  } finally {
    if (refresh?.promise === promise) refresh = null;
  }
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
  const params =
    o.params && typeof o.params === "object" ? (o.params as Record<string, unknown>) : null;
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

async function readMcpSse(
  res: Response,
  onChunk?: (t: string) => void,
  wantId?: number,
): Promise<unknown> {
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
          const json = JSON.parse(data) as {
            result?: unknown;
            error?: { message?: string };
            id?: unknown;
          };
          if (json.error && (wantId == null || json.id == null || json.id === wantId)) {
            throw new Error(json.error.message || "MCP error");
          }
          const piece = mcpEventText(json);
          if (piece) onChunk?.(piece);
          const idOk = wantId == null || json.id == null || json.id === wantId;
          if (idOk && json && "result" in json) result = json.result;
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
  extra?: { cwd?: string },
): Promise<unknown> {
  const s = findServer(servers, server);
  if (!s) throw new Error(`MCP-Server nicht gefunden: ${server}`);
  return withCompanion(async () => {
    await initialize(s);
    const merged = mergeMcpArgs(s.context, args);
    if (extra?.cwd && merged.cwd == null) merged.cwd = extra.cwd;
    const raw = await rpc(s, "tools/call", { name, arguments: merged }, onChunk);
    return unwrapMcp(raw);
  }, s.url);
}

export function newMcpId(): string {
  return `mcp-${Date.now().toString(36)}`;
}
