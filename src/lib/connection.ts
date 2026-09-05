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
  const endpoint =
    spec.api === "azure"
      ? `${new URL(base).origin}/openai/models?api-version=2024-10-21`
      : `${base}/models`;
  const headers =
    spec.api === "anthropic" ? anthropicHeaders(opts.apiKey) : pipeHeaders(spec.id, opts.apiKey);
  headers.Accept = "application/json";
  const res = await send(endpoint, {
    headers,
    signal: opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    redirect: "error",
  });
  const raw = await res.text();
  if (!res.ok)
    throw new Error(
      `${spec.label}: HTTP ${res.status}${/^\s*</.test(raw) ? " · HTML statt Modellantwort" : ` · ${raw.slice(0, 220)}`}`,
    );
  let data: { data?: unknown; models?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${spec.label}: Kein Modell-JSON. API-URL prüfen.`);
  }
  const rows = data?.data ?? data?.models;
  if (!Array.isArray(rows) || rows.some((m) => !m || typeof m !== "object"))
    throw new Error(`${spec.label}: Ungültige Modellliste.`);
  const ids = [
    ...new Set(
      rows.map((m) => String(m.id ?? m.name ?? "").replace(/^models\//, "")).filter(Boolean),
    ),
  ];
  return { ids, rows };
}
