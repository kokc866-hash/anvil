export type VsSnip = { prefix: string; body: string; lang: string };

function tabstop(body: string): string {
  return body
    .replace(/\$\{\d+:([^}]+)\}/g, "$1")
    .replace(/\$\{\d+\|([^}]+)\|\}/g, (_, a: string) => a.split(",")[0] ?? "")
    .replace(/\$\d+/g, "")
    .replace(/\$TM_SELECTED_TEXT/g, "")
    .replace(/\$TM_FILENAME/g, "");
}

function bodyOf(raw: unknown): string {
  if (Array.isArray(raw)) return tabstop(raw.map(String).join("\n"));
  return tabstop(String(raw ?? ""));
}

export function parseSnippetFile(json: string, lang = "*"): VsSnip[] {
  let data: unknown;
  try {
    data = JSON.parse(json.replace(/^\uFEFF/, "").replace(/^\s*\/\/.*$/gm, ""));
  } catch {
    return [];
  }
  const out: VsSnip[] = [];
  const walk = (node: unknown, fallbackLang: string) => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.prefix && rec.body != null) {
      const prefixes = Array.isArray(rec.prefix) ? rec.prefix : [rec.prefix];
      const scope = String(rec.scope ?? fallbackLang);
      for (const p of prefixes) {
        const prefix = String(p).trim();
        if (!prefix) continue;
        for (const langId of scope.split(",").map((s) => s.trim()).filter(Boolean)) {
          out.push({ prefix, body: bodyOf(rec.body), lang: langId || "*" });
        }
      }
      return;
    }
    for (const v of Object.values(rec)) walk(v, fallbackLang);
  };
  walk(data, lang);
  return out;
}

export function joinManifest(base: string, rel: string): string {
  const root = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const parts = `${root}/${rel.replace(/^\.\//, "")}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}
