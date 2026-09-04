export type HttpReq = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i;

/** RFC-lite `.http` blocks (`###` separators). Falls back to the first URL as GET. */
export function parseHttpFile(src: string): HttpReq[] {
  const blocks = String(src ?? "").split(/^\s*###.*$/m);
  const out: HttpReq[] = [];
  for (const raw of blocks) {
    const lines = raw.split(/\r?\n/);
    let i = 0;
    while (i < lines.length && (!lines[i]!.trim() || lines[i]!.trim().startsWith("#"))) i += 1;
    if (i >= lines.length) continue;
    const start = lines[i]!.trim();
    const hit = start.match(METHODS);
    if (!hit) {
      const url = raw.match(/https?:\/\/[^\s<>"']+/)?.[0]?.replace(/[),.;]+$/, "");
      if (url) out.push({ method: "GET", url, headers: {}, body: "" });
      continue;
    }
    const method = hit[1]!.toUpperCase();
    const url = hit[2]!;
    i += 1;
    const headers: Record<string, string> = {};
    while (i < lines.length && lines[i]!.trim() && lines[i]!.includes(":")) {
      const line = lines[i]!;
      const c = line.indexOf(":");
      headers[line.slice(0, c).trim()] = line.slice(c + 1).trim();
      i += 1;
    }
    if (i < lines.length && !lines[i]!.trim()) i += 1;
    const body = lines.slice(i).join("\n").trim();
    out.push({ method, url, headers, body });
  }
  return out;
}
