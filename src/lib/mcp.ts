import { readMcpSse } from "./mcp-stream";
import { ANVIL_VERSION } from "./version";
import {
  parseMcpBody,
  unwrapMcp,
  mcpCatalogText,
  catalogServerKey,
  parseMcpUrl,
  serversFingerprint,
  nextListCursor,
  MCP_PROTOCOL_PREFER,
  type McpTool,
  type McpResource,
} from "./mcp-parse";
import { loadSecrets, saveSecrets } from "./secrets";
import { mcpArguments } from "./mcp-schema";
import { forgetMcpOutputs, modelMcpResult, readMcpOutput } from "./mcp-results";
import { withCompanion } from "./companion-life";
import { assertMcpPackageRequest, mcpPackage, mcpPackageTools } from "./mcp-packages";
import { useIde } from "@/store/ide";
import {
  assertServiceRequest,
  isMcpService,
  serviceConnectionKey,
  validateService,
} from "./mcp-service-policy";
export type { McpTool, McpResource } from "./mcp-parse";
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
export { modelMcpResult } from "./mcp-results";

export type McpServer = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  context?: Record<string, string>;
  timeoutMs?: number;
  transport?: "http" | "stdio";
  command?: string;
  args?: string[];
  cwd?: string;
  auth?: "bearer" | "oauth";
  oauthClientId?: string;
  service?: string;
  allowedTools?: string[];
  allowResources?: boolean;
};
type NativeEvent = {
  id?: string;
  server: string;
  kind: string;
  connectionToken?: string;
  params?: Record<string, unknown>;
};
type Native = {
  mcpRequest: (r: unknown) => Promise<{ ok: boolean; value?: unknown; error?: string }>;
  mcpCancel: (id: string) => Promise<unknown>;
  mcpClose: (id: string) => Promise<unknown>;
  onMcpEvent: (fn: (e: NativeEvent) => void) => () => void;
};
function native(): Native | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as { anvilNative?: Native }).anvilNative;
}
export function hasMcpNative() {
  return typeof native()?.mcpRequest === "function";
}
export function mcpConfigured(s: McpServer) {
  return s.enabled && Boolean(s.transport === "stdio" ? s.command?.trim() : s.url.trim());
}

type Entry = {
  fp: string;
  generation: number;
  tools: McpTool[];
  resources: McpResource[];
  caps: string[];
  at: number;
  error?: string;
  pending?: Promise<void>;
  pendingSignal?: AbortSignal;
  controller: AbortController;
};
type Session = { sid: string; proto: string; caps: string[]; ready: Promise<void> };
const entries = new Map<string, Entry>();
const serviceOffers = new Map<
  string,
  { key: string; tools: McpTool[]; resources: McpResource[]; ready: boolean }
>();
const nativeClosings = new Map<string, Promise<unknown>>();
function queueNativeClose(id: string) {
  const pending = (nativeClosings.get(id) || Promise.resolve())
    .catch(() => {})
    .then(() => native()?.mcpClose(id));
  nativeClosings.set(id, pending);
  void pending
    .finally(() => {
      if (nativeClosings.get(id) === pending) nativeClosings.delete(id);
    })
    .catch(() => {});
  return pending;
}
export function mcpServiceCatalog(s: McpServer) {
  const offer = serviceOffers.get(s.id);
  const live = useIde.getState().mcpServers.find((x) => x.id === s.id);
  if (!live?.enabled || !offer || offer.key !== serviceConnectionKey(live))
    return { tools: [] as McpTool[], resources: [] as McpResource[], ready: false };
  return { tools: offer.tools, resources: offer.resources, ready: offer.ready };
}
const sessions = new Map<string, Session>();
const configured = new Map<string, string>();
const listeners = new Set<() => void>();
let revision = 0,
  sequence = 0,
  generation = 0;
export const mcpSubscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const mcpRevision = () => revision;
function changed() {
  revision++;
  for (const listener of listeners) listener();
}
function companionTarget(s: McpServer) {
  if (s.transport === "stdio") return false;
  try {
    const base = new URL(useIde.getState().companionUrl || "http://127.0.0.1:7845");
    const url = parseMcpUrl(s.url);
    return (
      url.origin === base.origin &&
      url.pathname.replace(/\/$/, "") === `${base.pathname.replace(/\/$/, "")}/mcp` &&
      !url.search
    );
  } catch {
    return false;
  }
}
function credentials(s: McpServer): Record<string, string> {
  const secrets = loadSecrets();
  const headers: Record<string, string> = {};
  if (companionTarget(s) && secrets.companionToken.trim())
    headers["x-anvil-token"] = secrets.companionToken.trim();
  const token =
    secrets.keys[`mcp:${s.id}`]?.trim() ||
    (!mcpPackage(s) && secrets.keys[`mcp:${s.name}`]?.trim());
  const bound = secrets.keys[`mcp-target:${s.id}`];
  if (s.auth !== "oauth" && token && (!bound || bound === s.url.trim()))
    headers.authorization = `Bearer ${token}`;
  return headers;
}
function fingerprint(s: McpServer) {
  return `${serversFingerprint([s])}|${JSON.stringify([s.context, s.timeoutMs, s.service, s.allowedTools, s.allowResources, credentials(s), loadSecrets().keys[`mcp-env:${s.id}`]])}`;
}
function entryFor(s: McpServer): Entry {
  const fp = fingerprint(s);
  let entry = entries.get(s.id);
  if (entry && entry.fp !== fp) {
    mcpForget(s.id);
    entry = undefined;
  }
  if (!entry) {
    entry = {
      fp,
      generation: ++generation,
      tools: [],
      resources: [],
      caps: [],
      at: 0,
      controller: new AbortController(),
    };
    entries.set(s.id, entry);
  }
  return entry;
}
function sync() {
  const servers = useIde.getState().mcpServers || [];
  const next = new Map(servers.filter(mcpConfigured).map((s) => [s.id, fingerprint(s)]));
  for (const [id, fp] of configured)
    if (next.get(id) !== fp) {
      const live = servers.find((s) => s.id === id);
      const retainOffers = Boolean(
        live?.enabled && serviceOffers.get(id)?.key === serviceConnectionKey(live),
      );
      mcpForget(id, true, retainOffers);
    }
  configured.clear();
  for (const [id, fp] of next) configured.set(id, fp);
}
useIde.subscribe((state, previous) => {
  if (state.mcpServers !== previous.mcpServers || state.companionUrl !== previous.companionUrl)
    sync();
});
if (typeof window !== "undefined") {
  window.addEventListener("anvil-secrets-changed", sync);
  window.addEventListener("anvil-secret-status", sync);
  native()?.onMcpEvent?.((event) => {
    if (event.kind !== "catalog" && event.kind !== "closed") return;
    const entry = entries.get(event.server);
    if (nativeClosings.has(event.server)) return;
    if (event.connectionToken !== undefined && event.connectionToken !== String(entry?.generation))
      return;
    if (entry) {
      const offer = serviceOffers.get(event.server);
      if (offer) offer.ready = false;
      entry.at = 0;
      if (event.kind === "closed") {
        sessions.delete(event.server);
        entry.error = "MCP-Verbindung beendet. Katalog erneut laden.";
        entry.tools = [];
        entry.resources = [];
      }
      changed();
    }
  });
}
sync();

export function mcpSnapshot(servers: McpServer[]) {
  const live = servers.filter(mcpConfigured);
  const ready = new Set<string>(),
    tools: McpTool[] = [],
    resources: McpResource[] = [];
  for (const s of live) {
    const e = entries.get(s.id);
    if (!e || e.fp !== fingerprint(s) || e.error || !e.at) continue;
    const live = isMcpService(s) ? useIde.getState().mcpServers.find((x) => x.id === s.id) : s;
    if (!live?.enabled) continue;
    ready.add(s.id);
    tools.push(
      ...e.tools.filter((t) => !isMcpService(live) || live.allowedTools?.includes(t.name)),
    );
    resources.push(...e.resources.filter(() => !isMcpService(live) || live.allowResources));
  }
  return { ready, tools, resources };
}
export const mcpToolsCached = () => mcpSnapshot(useIde.getState().mcpServers).tools;
export const mcpResourcesCached = () => mcpSnapshot(useIde.getState().mcpServers).resources;
export const mcpCaps = (id: string) => entries.get(id)?.caps || [];
export const mcpListError = (id: string) => entries.get(id)?.error;
export const mcpCatalogNow = () => mcpCatalogText(mcpToolsCached());
export function mcpForget(id: string, closeNative = true, retainOffers = false) {
  if (!retainOffers) serviceOffers.delete(id);
  entries
    .get(id)
    ?.controller.abort(new Error("MCP-Konfiguration geändert oder Verbindung beendet."));
  entries.delete(id);
  sessions.delete(id);
  forgetMcpOutputs(id);
  const currentViews = useIde.getState().mcpView;
  if (Object.hasOwn(currentViews, id)) {
    const mcpView = { ...currentViews };
    delete mcpView[id];
    useIde.setState({ mcpView });
  }
  if (closeNative) void queueNativeClose(id).catch(() => {});
  changed();
}
export async function mcpClose(s: McpServer) {
  const session = sessions.get(s.id);
  mcpForget(s.id, false);
  if (hasMcpNative()) {
    await queueNativeClose(s.id);
    return;
  }
  if (session?.sid && s.transport !== "stdio") {
    try {
      await fetch(parseMcpUrl(s.url), {
        method: "DELETE",
        headers: {
          ...credentials(s),
          "mcp-session-id": session.sid,
          "mcp-protocol-version": session.proto,
        },
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
    } catch {
      /* best effort */
    }
  }
}
function findServer(servers: McpServer[], want: string): McpServer {
  const enabled = servers.filter(mcpConfigured);
  const id = enabled.find((s) => s.id === want);
  if (id) return id;
  const named = enabled.filter((s) => s.name === want);
  if (named.length > 1)
    throw new Error(`MCP-Servername mehrdeutig: ${want}. Server-Id aus mcp_list verwenden.`);
  if (!named.length) throw new Error(`MCP-Server nicht gefunden oder deaktiviert: ${want}`);
  return named[0];
}
export function mcpEventText(value: unknown): string {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const p = o.params && typeof o.params === "object" ? (o.params as Record<string, unknown>) : o;
  const text = typeof p.message === "string" ? p.message : typeof p.text === "string" ? p.text : "";
  const progress =
    typeof p.progress === "number"
      ? typeof p.total === "number" && p.total > 0
        ? `${Math.round((p.progress / p.total) * 100)}%`
        : String(p.progress)
      : "";
  return [text, progress].filter(Boolean).join(" ");
}
async function nativeRpc(
  s: McpServer,
  method: string,
  params: unknown,
  signal: AbortSignal,
  onChunk?: (text: string) => void,
) {
  const api = native()!,
    id = crypto.randomUUID();
  await nativeClosings.get(s.id);
  signal.throwIfAborted();
  let env;
  const envText = loadSecrets().keys[`mcp-env:${s.id}`];
  if (s.transport === "stdio" && envText?.trim()) {
    try {
      env = JSON.parse(envText);
    } catch {
      throw new Error("MCP-Umgebung muss ein JSON-Objekt sein.");
    }
  }
  const off = api.onMcpEvent((event) => {
    if (event.id === id && !signal.aborted) {
      const text = mcpEventText(event.params);
      if (text) onChunk?.(text);
    }
  });
  const abort = () => {
    void api.mcpCancel(id).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pending = api.mcpRequest({
      id,
      server: {
        ...s,
        headers: credentials(s),
        env,
        ...(entries.has(s.id) ? { connectionToken: String(entries.get(s.id)!.generation) } : {}),
      },
      method,
      params,
    });
    if (signal.aborted) abort();
    const result = await pending;
    signal.throwIfAborted();
    if (!result.ok) throw new Error(result.error || "MCP fehlgeschlagen.");
    return result.value;
  } finally {
    off();
    signal.removeEventListener("abort", abort);
  }
}
async function rpc(
  s: McpServer,
  method: string,
  params: unknown = {},
  signal?: AbortSignal,
  onChunk?: (text: string) => void,
): Promise<unknown> {
  assertServiceRequest(
    s,
    useIde.getState().mcpServers.find((x) => x.id === s.id),
    method,
    params,
  );
  assertMcpPackageRequest(s, method, params);
  if (s.transport !== "stdio" && s.auth !== "oauth") {
    const keys = loadSecrets().keys;
    const token = keys[`mcp:${s.id}`]?.trim() || (!mcpPackage(s) && keys[`mcp:${s.name}`]?.trim());
    if (token && keys[`mcp-target:${s.id}`] && keys[`mcp-target:${s.id}`] !== s.url.trim())
      throw new Error(
        "MCP-URL geändert. Bearer für diese Adresse im MCP-Bereich erneut eintragen.",
      );
    if (token && !keys[`mcp-target:${s.id}`])
      saveSecrets({ keys: { [`mcp-target:${s.id}`]: s.url.trim() } });
  }
  const entry = entryFor(s);
  const timeout = AbortSignal.timeout(Math.min(600000, Math.max(8000, s.timeoutMs || 120000)));
  const combined = AbortSignal.any([entry.controller.signal, timeout, ...(signal ? [signal] : [])]);
  if (hasMcpNative()) return nativeRpc(s, method, params, combined, onChunk);
  if (s.transport === "stdio" || s.auth === "oauth")
    throw new Error("MCP über stdio und OAuth benötigt die Anvil-Desktop-App.");
  const url = parseMcpUrl(s.url),
    session = sessions.get(s.id);
  const headers = {
    ...credentials(s),
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": session?.proto || MCP_PROTOCOL_PREFER,
    ...(session?.sid ? { "mcp-session-id": session.sid } : {}),
  };
  const note = method.startsWith("notifications/"),
    id = ++sequence;
  const payload = { jsonrpc: "2.0", ...(note ? {} : { id }), method, params };
  const cancel = () => {
    if (note) return;
    void fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: id, reason: "Anvil: Stop" },
      }),
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    }).catch(() => {});
  };
  combined.addEventListener("abort", cancel, { once: true });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: combined,
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 404) sessions.delete(s.id);
      throw new Error(`MCP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const sid = response.headers.get("mcp-session-id");
    if (sid && session) session.sid = sid;
    if (note) {
      await response.body?.cancel();
      return {};
    }
    if (response.headers.get("content-type")?.includes("text/event-stream"))
      return await readMcpSse(
        response,
        (event) => {
          const text = mcpEventText(event);
          if (text) onChunk?.(text);
        },
        id,
      );
    const body = parseMcpBody(await response.text());
    if (body.id !== id || (!Object.hasOwn(body, "result") && !body.error))
      throw new Error("MCP lieferte keine gültige JSON-RPC-Antwort zur Anfrage.");
    if (body.error) throw new Error(body.error.message || "MCP-Protokollfehler");
    return body.result;
  } finally {
    combined.removeEventListener("abort", cancel);
  }
}
async function initialize(s: McpServer, signal?: AbortSignal) {
  entryFor(s);
  const prior = sessions.get(s.id);
  if (prior) {
    await prior.ready;
    signal?.throwIfAborted();
    return;
  }
  const session: Session = {
    sid: "",
    proto: MCP_PROTOCOL_PREFER,
    caps: [],
    ready: Promise.resolve(),
  };
  sessions.set(s.id, session);
  session.ready = (async () => {
    const value = (await rpc(
      s,
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_PREFER,
        capabilities: {},
        clientInfo: { name: "anvil", version: ANVIL_VERSION },
      },
      signal,
    )) as { capabilities?: Record<string, unknown>; protocolVersion?: string };
    if (!value?.capabilities || !value.protocolVersion)
      throw new Error("Ungültige MCP-Initialisierung.");
    session.caps = Object.keys(value.capabilities);
    session.proto = value.protocolVersion;
    if (!hasMcpNative()) {
      if (!["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].includes(session.proto))
        throw new Error("MCP-Protokoll benötigt die native Desktop-Verbindung.");
      await rpc(s, "notifications/initialized", {}, signal);
    }
    entryFor(s).caps = session.caps;
  })().catch((error) => {
    if (sessions.get(s.id) === session) sessions.delete(s.id);
    throw error;
  });
  await session.ready;
}
async function listPaged(
  s: McpServer,
  method: string,
  key: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [],
    seen = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 128; page++) {
    const result = (await rpc(s, method, cursor ? { cursor } : {}, signal)) as Record<
      string,
      unknown
    >;
    if (!Array.isArray(result?.[key])) throw new Error(`MCP ${method}: ungültige Liste.`);
    rows.push(...(result[key] as Record<string, unknown>[]));
    cursor = nextListCursor(result);
    if (!cursor) return rows;
    if (seen.has(cursor)) throw new Error(`MCP ${method}: Server wiederholt denselben Cursor.`);
    seen.add(cursor);
  }
  throw new Error(`MCP ${method}: mehr als 128 Seiten. Katalog am Server eingrenzen.`);
}
function withServer<T>(s: McpServer, fn: () => Promise<T>, cwd?: string) {
  return companionTarget(s) ? withCompanion(fn, s.url, cwd) : fn();
}
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export async function mcpProbe(
  s: McpServer,
  all: McpServer[],
  signal?: AbortSignal,
): Promise<McpTool[]> {
  if (!mcpConfigured(s)) throw new Error("MCP-Server deaktiviert oder unvollständig konfiguriert.");
  return withServer(s, async () => {
    const entry = entryFor(s);
    if (!entry.pending) {
      const offer = serviceOffers.get(s.id);
      if (offer) offer.ready = false;
      entry.error = undefined;
      entry.pendingSignal = signal;
      entry.pending = (async () => {
        await initialize(s, signal);
        const key = catalogServerKey(s, all);
        const tools = entry.caps.includes("tools")
          ? await listPaged(s, "tools/list", "tools", signal)
          : [];
        const resources =
          !mcpPackage(s) && entry.caps.includes("resources")
            ? await listPaged(s, "resources/list", "resources", signal)
            : [];
        let templates: Record<string, unknown>[] = [];
        if (!mcpPackage(s) && entry.caps.includes("resources")) {
          try {
            templates = await listPaged(s, "resources/templates/list", "resourceTemplates", signal);
          } catch (error) {
            if (!/method.*(not found|not supported|nicht|unbekannt)|-32601/i.test(String(error)))
              throw error;
          }
        }
        signal?.throwIfAborted();
        if (entries.get(s.id) !== entry) return;
        entry.tools = mcpPackageTools(s, tools)
          .filter((t) => typeof t.name === "string")
          .map((tool) => ({
            ...tool,
            server: key,
            serverId: s.id,
            name: String(tool.name),
            description: String(tool.description || ""),
          })) as McpTool[];
        entry.resources = [...resources, ...templates].map((r) => ({
          ...r,
          server: key,
          serverId: s.id,
          uri: String(r.uri || r.uriTemplate),
          name: String(r.name || r.uri || r.uriTemplate),
        })) as McpResource[];
        if (isMcpService(s))
          serviceOffers.set(s.id, {
            key: serviceConnectionKey(s),
            tools: entry.tools,
            resources: entry.resources,
            ready: true,
          });
        entry.at = Date.now();
      })()
        .catch((error) => {
          if (entries.get(s.id) === entry) {
            entry.at = 0;
            entry.tools = [];
            entry.resources = [];
            entry.error = error instanceof Error ? error.message : String(error);
          }
          throw error;
        })
        .finally(() => {
          if (entries.get(s.id) === entry) {
            entry.pending = undefined;
            changed();
          }
        });
      changed();
    }
    const ownerSignal = entry.pendingSignal;
    try {
      await waitFor(entry.pending, signal);
    } catch (error) {
      // A remounted pane/new agent may have joined a catalog request owned by
      // an already canceled caller. Retry only this read-only catalog build.
      if (
        !signal?.aborted &&
        ownerSignal?.aborted &&
        entries.get(s.id) === entry &&
        !entry.controller.signal.aborted
      ) {
        await waitFor(entry.pending?.catch(() => {}) || Promise.resolve(), signal);
        return mcpProbe(s, all, signal);
      }
      throw error;
    }
    signal?.throwIfAborted();
    return mcpSnapshot(all).tools;
  });
}
export async function mcpList(servers: McpServer[], signal?: AbortSignal): Promise<McpTool[]> {
  const queue = servers.filter(mcpConfigured);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (index < queue.length) {
        signal?.throwIfAborted();
        const server = queue[index++];
        try {
          await mcpProbe(server, servers, signal);
        } catch (e) {
          if (signal?.aborted) throw e;
        }
      }
    }),
  );
  return mcpSnapshot(servers).tools;
}
export async function mcpRefresh(servers: McpServer[], maxAgeMs = 60000, signal?: AbortSignal) {
  const stale = servers.filter((s) => {
    const e = entries.get(s.id);
    return mcpConfigured(s) && (!e || e.fp !== fingerprint(s) || Date.now() - e.at >= maxAgeMs);
  });
  await mcpList(stale, signal);
  return mcpSnapshot(servers).tools;
}
export async function mcpCatalogPage(
  servers: McpServer[],
  options: Record<string, unknown> = {},
  signal?: AbortSignal,
) {
  const selected = options.server ? [findServer(servers, String(options.server))] : servers;
  await mcpRefresh(selected, 60000, signal);
  const snap = mcpSnapshot(selected),
    query = String(options.query || "").toLowerCase();
  const tools = snap.tools.filter((t) =>
    `${t.name} ${t.description} ${t.server}`.toLowerCase().includes(query),
  );
  const resources = snap.resources.filter((r) =>
    `${r.name} ${r.uri} ${r.server}`.toLowerCase().includes(query),
  );
  const rows = [...tools.map((t) => ({ tool: t })), ...resources.map((r) => ({ resource: r }))];
  const cursor = String(options.cursor || "");
  let offset = 0;
  if (cursor) {
    const parts = cursor.split(":");
    if (parts.length !== 2 || Number(parts[0]) !== revision || !/^\d+$/.test(parts[1]))
      throw new Error(
        "MCP-Katalog geändert oder Cursor ungültig. mcp_list ohne cursor wiederholen.",
      );
    offset = Number(parts[1]);
  }
  const limit = Math.max(1, Math.min(40, Math.floor(Number(options.limit) || 12)));
  const page = rows.slice(offset, offset + limit);
  const nextCursor =
    offset + page.length < rows.length ? `${revision}:${offset + page.length}` : undefined;
  return {
    tools: page.flatMap((r) => ("tool" in r ? [r.tool] : [])),
    resources: page.flatMap((r) => ("resource" in r ? [r.resource] : [])),
    total: rows.length,
    nextCursor,
    servers: selected
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        ready: snap.ready.has(s.id),
        error: mcpListError(s.id),
      })),
    hint: "mcp_call: server=Id, name=exakter Toolname, arguments=Objekt nach inputSchema. Ressourcen: mcp_read_resource. Weitere Ergebnisse: nextCursor an mcp_list übergeben.",
  };
}
export async function mcpCall(
  servers: McpServer[],
  server: string,
  name: string,
  args: unknown,
  onChunk?: (text: string) => void,
  extra?: { cwd?: string; signal?: AbortSignal },
): Promise<unknown> {
  const s = findServer(servers, server);
  return withServer(
    s,
    async () => {
      await mcpRefresh([s], 60000, extra?.signal);
      const tool = mcpSnapshot([s]).tools.find((t) => t.name === name);
      if (!tool)
        throw new Error(
          mcpListError(s.id) || `MCP-Tool nicht im aktuellen Katalog: ${name}. mcp_list verwenden.`,
        );
      const checked = mcpArguments(
        tool.inputSchema,
        args,
        s.context,
        companionTarget(s) ? extra?.cwd : undefined,
      );
      return unwrapMcp(
        await rpc(s, "tools/call", { name, arguments: checked }, extra?.signal, onChunk),
      );
    },
    extra?.cwd,
  );
}
export async function mcpReadResource(
  servers: McpServer[],
  server: string,
  uri: string,
  signal?: AbortSignal,
) {
  const s = findServer(servers, server);
  if (!uri.trim()) throw new Error("MCP-Ressourcen-URI fehlt.");
  return withServer(s, async () => {
    await initialize(s, signal);
    return unwrapMcp(await rpc(s, "resources/read", { uri }, signal));
  });
}
export function mcpReadOutput(servers: McpServer[], args: Record<string, unknown>) {
  return readMcpOutput(
    String(args.id || ""),
    servers.filter(mcpConfigured).map((s) => s.id),
    Number(args.offset),
    Number(args.limit),
  );
}
export async function mcpLogin(
  s: McpServer,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
) {
  if (!hasMcpNative()) throw new Error("MCP-Anmeldung benötigt die Desktop-App.");
  validateService(s);
  await mcpClose(s);
  return nativeRpc(s, "oauth/login", {}, signal || AbortSignal.timeout(660000), onProgress);
}
export async function mcpReopenLogin(s: McpServer, signal?: AbortSignal) {
  if (!hasMcpNative()) throw new Error("Dienst-Anmeldung benötigt die Anvil-Desktop-App.");
  return nativeRpc(s, "oauth/reopen", {}, signal || AbortSignal.timeout(8000));
}
export async function mcpAuthStatus(
  s: McpServer,
  signal?: AbortSignal,
): Promise<{ authenticated: boolean }> {
  if (!hasMcpNative()) throw new Error("Dienst-Anmeldung benötigt die Anvil-Desktop-App.");
  const value = await nativeRpc(s, "oauth/status", {}, signal || AbortSignal.timeout(8000));
  return {
    authenticated: Boolean((value as { authenticated?: boolean } | undefined)?.authenticated),
  };
}
export async function mcpLogout(s: McpServer) {
  if (!hasMcpNative()) throw new Error("MCP-Anmeldung benötigt die Desktop-App.");
  await mcpClose(s);
  return nativeRpc(s, "oauth/logout", {}, AbortSignal.timeout(8000));
}
export function newMcpId() {
  return `mcp-${crypto.randomUUID()}`;
}
