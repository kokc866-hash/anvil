export type MarketItem = {
  id: string;
  name: string;
  publisher: string;
  description: string;
  version?: string;
  downloads?: number;
  vsix?: string;
};

const OPEN = "https://open-vsx.org/api";

export const FEATURED: MarketItem[] = [
  {
    id: "EricSia.pythonsnippets3",
    name: "Python-Snippets",
    publisher: "EricSia",
    description: "Python-Vorlagen. Anvil lädt Snippets, keinen Language Server.",
    vsix: `${OPEN}/EricSia/pythonsnippets3/latest`,
  },
  {
    id: "xabikos.JavaScriptSnippets",
    name: "JavaScript-Snippets",
    publisher: "xabikos",
    description: "JS/TS-Vorlagen aus dem VS-Code-Paket.",
    vsix: `${OPEN}/xabikos/JavaScriptSnippets/latest`,
  },
  {
    id: "abusaidm.html-snippets",
    name: "HTML-Snippets",
    publisher: "abusaidm",
    description: "HTML-Vorlagen.",
    vsix: `${OPEN}/abusaidm/html-snippets/latest`,
  },
];

type SearchHit = {
  namespace?: string;
  name?: string;
  displayName?: string;
  description?: string;
  version?: string;
  downloadCount?: number;
  files?: { download?: string };
};

export async function resolveVsixUrl(url: string, signal?: AbortSignal): Promise<string> {
  if (/\.vsix(\?|#|$)/i.test(url)) return url;
  const r = await fetch(url, { signal: signal ?? AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Markt: HTTP ${r.status}`);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("json") || ct.includes("text") || !ct.includes("octet") && !ct.includes("zip") && !ct.includes("vsix")) {
    const j = (await r.json()) as {
      files?: { download?: string };
      version?: string;
      namespace?: string;
      name?: string;
    };
    if (j.files?.download) return j.files.download;
    if (j.namespace && j.name && j.version) {
      return `${OPEN}/${j.namespace}/${j.name}/${j.version}/file/${j.namespace}.${j.name}-${j.version}.vsix`;
    }
    throw new Error("Markt: keine Download-URL");
  }
  return url;
}

export async function searchMarket(q: string, signal?: AbortSignal): Promise<MarketItem[]> {
  const query = q.trim() || "snippets";
  const url = `${OPEN}/-/search?query=${encodeURIComponent(query)}&size=16&sortBy=relevance`;
  const r = await fetch(url, { signal: signal ?? AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Markt: HTTP ${r.status}`);
  const j = (await r.json()) as { extensions?: SearchHit[] };
  return (j.extensions ?? []).map((e) => {
    const ns = e.namespace || "unknown";
    const name = e.name || "ext";
    const ver = e.version || "latest";
    const vsix = e.files?.download || `${OPEN}/${ns}/${name}/${ver}/file/${ns}.${name}-${ver}.vsix`;
    return {
      id: `${ns}.${name}`,
      name: e.displayName || name,
      publisher: ns,
      description: (e.description || "").slice(0, 180),
      version: ver,
      downloads: e.downloadCount,
      vsix,
    };
  });
}

export async function downloadVsix(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const resolved = await resolveVsixUrl(url, signal);
  const r = await fetch(resolved, { signal: signal ?? AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Download: HTTP ${r.status}`);
  return r.arrayBuffer();
}
