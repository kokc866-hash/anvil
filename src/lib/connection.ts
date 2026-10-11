import { providerOf } from "./providers.ts";
import { anthropicHeaders, pipeHeaders } from "./llm-headers.ts";

/** An explicit path is the API prefix. Only bare hosts get the /v1 default. */
export function normalizeBaseUrl(raw: string): string {
  if (!raw.trim()) return "";
  const url = new URL(raw.includes("://") ? raw.trim() : `http://${raw.trim()}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("API-URL: http(s), ohne Zugangsdaten, Query oder Fragment angeben.");
  url.pathname = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|responses|models)$/, "");
  if (!url.pathname || url.pathname === "/") url.pathname = "/v1";
  return url.toString().replace(/\/+$/, "");
}

export type ModelRequest = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
};
export async function fetchModels(
  opts: ModelRequest,
  send: (url: string, init: RequestInit) => Promise<Response>,
): Promise<{ ids: string[]; rows: Record<string, unknown>[] }> {
  const spec = providerOf(opts.provider);
  if (spec.id === "codex" || spec.id === "github")
    throw new Error("Abo-Verbindung über die CLI prüfen.");
  if (spec.needsKey && !opts.apiKey.trim()) throw new Error(`API-Key für ${spec.label} fehlt.`);
  const base = normalizeBaseUrl(opts.baseUrl || spec.baseUrl);
  if (!base) throw new Error("API-URL fehlt.");
  let endpoint =
    spec.api === "azure"
      ? `${new URL(base).origin}/openai/models?api-version=2024-10-21`
      : `${base}/models`;
  // Cohere's OpenAI compatibility API serves chat; its catalog uses the native API.
  if (spec.id === "cohere") endpoint = `${base.replace(/\/compatibility\/v1$/, "/v1")}/models?endpoint=chat`;
  // Model Studio has a native catalog. Keep the user's region/workspace origin.
  // Coding/Token Plan endpoints stay on their own OpenAI-compatible /models path.
  const qwenNative = spec.id === "qwen" && /\/compatible-mode\/v1$/.test(base);
  if (qwenNative) endpoint = `${base.replace(/\/compatible-mode\/v1$/, "/api/v1")}/models?page_no=1&page_size=100&capabilities=TG`;
  const headers =
    spec.api === "anthropic" ? anthropicHeaders(opts.apiKey) : pipeHeaders(spec.id, opts.apiKey);
  headers.Accept = "application/json";
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000);
  const rows: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  const visited = new Set<string>();
  const initial = new URL(endpoint);
  let bytes = 0;
  let received = 0;
  for (let page = 0; page < 50; page++) {
    signal.throwIfAborted();
    if (visited.has(endpoint)) throw new Error(`${spec.label}: Die Modellliste wiederholt eine Seite.`);
    visited.add(endpoint);
    const res = await send(endpoint, { headers, signal, redirect: "error" });
    signal.throwIfAborted();
    const raw = await res.text();
    signal.throwIfAborted();
    bytes += raw.length;
    if (bytes > 16 * 1024 * 1024) throw new Error(`${spec.label}: Modellliste ist zu groß.`);
    if (!res.ok)
      throw new Error(`${spec.label}: HTTP ${res.status}${/^\s*</.test(raw) ? " · HTML statt Modellantwort" : ` · ${raw.slice(0, 220)}`}`);
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error(`${spec.label}: Kein Modell-JSON. API-URL prüfen.`); }
    if (spec.id === "qwen" && (data?.success === false || data?.code))
      throw new Error(`${spec.label}: ${String(data.code || "Modellliste abgelehnt").slice(0, 100)} · ${String(data.message || "API-Schlüssel und Region prüfen.").slice(0, 220)}`);
    // Together returns a top-level array; OpenAI uses data and Cohere uses models.
    const native = qwenNative && data?.output;
    const entries = native ? data.output.models : Array.isArray(data) ? data : data?.data ?? data?.models;
    if (!Array.isArray(entries)) throw new Error(`${spec.label}: Ungültige Modellliste.`);
    for (const row of entries) {
      const id = native ? row?.model : row?.id ?? row?.name;
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof id !== "string" || !id.trim() || id.length > 512 || [...id].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))
        throw new Error(`${spec.label}: Ungültiger Eintrag in der Modellliste.`);
      const normalized = id.replace(/^models\//, "");
      if (!normalized.trim()) throw new Error(`${spec.label}: Leere Modellkennung in der Modellliste.`);
      if (!ids.has(normalized)) { ids.add(normalized); rows.push(native ? { ...row, id: normalized } : row); }
    }
    if (ids.size > 10000) throw new Error(`${spec.label}: Modellliste ist zu groß.`);
    const next = new URL(initial);
    if (native) {
      const output = data.output;
      if (!Number.isSafeInteger(output.total) || output.total < 0 || output.total > 10000 || output.page_no !== page + 1 || !Number.isSafeInteger(output.page_size) || output.page_size < 1 || entries.length > output.page_size)
        throw new Error(`${spec.label}: Ungültige Folgeseite der Modellliste.`);
      received += entries.length;
      if (received > output.total) throw new Error(`${spec.label}: Widersprüchliche Modellliste.`);
      if (received === output.total) return { ids: [...ids], rows };
      if (!entries.length || entries.length < output.page_size) throw new Error(`${spec.label}: Folgeseite der Modellliste fehlt.`);
      next.searchParams.set("page_no", String(page + 2));
      endpoint = next.toString();
      continue;
    }
    let cursor: unknown, parameter: string;
    if (data?.has_more === true) { cursor = data.last_id ?? entries.at(-1)?.id; parameter = "after_id"; }
    else if (data?.nextPageToken) { cursor = data.nextPageToken; parameter = "pageToken"; }
    else if (data?.next_page_token) { cursor = data.next_page_token; parameter = "page_token"; }
    else if (spec.api === "azure" && data?.nextLink) {
      const link = new URL(data.nextLink, initial);
      // Never forward credentials to another host or another API path.
      if (link.origin !== initial.origin || link.pathname !== initial.pathname || link.username || link.password || link.hash)
        throw new Error(`${spec.label}: Ungültige Folgeseite der Modellliste.`);
      endpoint = link.toString();
      continue;
    } else return { ids: [...ids], rows };
    if (typeof cursor !== "string" || !cursor || cursor.length > 4096)
      throw new Error(`${spec.label}: Folgeseite der Modellliste fehlt oder ist ungültig.`);
    next.searchParams.set(parameter, cursor);
    endpoint = next.toString();
  }
  throw new Error(`${spec.label}: Modellliste hat zu viele Seiten; Aktualisierung unvollständig.`);
}
