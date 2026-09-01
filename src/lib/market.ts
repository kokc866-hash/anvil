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
    id: "vscode.python-snippets",
    name: "Python-Snippets",
    publisher: "Open VSX",
    description: "Häufige Python-Vorlagen. Anvil lädt Snippets, keinen Language Server.",
    vsix: `${OPEN}/ms-python/python/latest/file/ms-python.python.vsix`,
  },
  {
    id: "vscode.javascript-snippets",
    name: "JavaScript-Snippets",
    publisher: "Open VSX",
    description: "JS/TS-Vorlagen aus dem VS-Code-Paket.",
    vsix: `${OPEN}/xabikos/JavaScriptSnippets/latest/file/xabikos.JavaScriptSnippets.vsix`,
  },
  {
    id: "vscode.html-snippets",
    name: "HTML-Snippets",
    publisher: "Open VSX",
    description: "HTML-Vorlagen.",
    vsix: `${OPEN}/abusaidm/html-snippets/latest/file/abusaidm.html-snippets.vsix`,
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

export async function searchMarket(q: string): Promise<MarketItem[]> {
  const query = q.trim() || "snippets";
  const url = `${OPEN}/-/search?query=${encodeURIComponent(query)}&size=16&sortBy=relevance`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
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

export async function downloadVsix(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Download: HTTP ${r.status}`);
  return r.arrayBuffer();
}
