import { ARCHIVE_MAX_COMPRESSED } from "./archive-codec.ts";

function requestSignal(signal: AbortSignal | undefined, milliseconds: number): AbortSignal {
  const deadline = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

async function boundedBody(response: Response, max: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const declared = Number(response.headers.get("content-length"));
  if (declared > max) { await response.body?.cancel(); throw new Error("Download überschreitet die Größenbegrenzung."); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > max) { await reader.cancel(); throw new Error("Download überschreitet die Größenbegrenzung."); }
      chunks.push(chunk.value);
    }
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

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
  const deadline = requestSignal(signal, 8000);
  const r = await fetch(url, { signal: deadline });
  if (!r.ok) throw new Error(`Markt: HTTP ${r.status}`);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("json") || ct.includes("text") || !ct.includes("octet") && !ct.includes("zip") && !ct.includes("vsix")) {
    const j = JSON.parse(new TextDecoder().decode(await boundedBody(r, 1024 * 1024, deadline))) as {
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
  const deadline = requestSignal(signal, 8000);
  const r = await fetch(url, { signal: deadline });
  if (!r.ok) throw new Error(`Markt: HTTP ${r.status}`);
  const j = JSON.parse(new TextDecoder().decode(await boundedBody(r, 1024 * 1024, deadline))) as { extensions?: SearchHit[] };
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
  const deadline = requestSignal(signal, 60000);
  const resolved = await resolveVsixUrl(url, deadline);
  deadline.throwIfAborted();
  const r = await fetch(resolved, { signal: deadline });
  if (!r.ok) throw new Error(`Download: HTTP ${r.status}`);
  return Uint8Array.from(await boundedBody(r, ARCHIVE_MAX_COMPRESSED, deadline)).buffer;
}
