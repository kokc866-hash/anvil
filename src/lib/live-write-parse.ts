const WRITE = /^(write_file|append_file|edit_file)$/;

export function extractJsonString(raw: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`);
  const m = raw.match(re);
  if (!m || m.index == null) return null;
  let out = "";
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      const n = raw[i + 1];
      if (n == null) break;
      out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
      i++;
      continue;
    }
    if (c === '"') return out;
    out += c;
  }
  return out;
}

export function draftFromToolArgs(name: string, argsJson: string): { path: string; content: string; mode: "write" | "append" | "edit" } | null {
  if (!WRITE.test(name)) return null;
  const path = extractJsonString(argsJson, "path")?.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path) return null;
  if (name === "edit_file") {
    const neu = extractJsonString(argsJson, "new_string") ?? extractJsonString(argsJson, "content");
    if (neu == null) return { path, content: "", mode: "edit" };
    return { path, content: neu, mode: "edit" };
  }
  const content = extractJsonString(argsJson, "content");
  if (content == null) return { path, content: "", mode: name === "append_file" ? "append" : "write" };
  return { path, content, mode: name === "append_file" ? "append" : "write" };
}

export function draftFromText(text: string): { path: string; content: string; mode: "write" | "append" | "edit" } | null {
  let last: ReturnType<typeof draftFromToolArgs> = null;
  for (const name of ["write_file", "append_file", "edit_file"] as const) {
    let idx = 0;
    while (true) {
      const i = text.indexOf(name, idx);
      if (i < 0) break;
      const d = draftFromToolArgs(name, text.slice(i, i + 240_000));
      if (d?.path) last = d;
      idx = i + name.length;
    }
  }
  return last;
}

export function mcpMirrorPath(server: string, args: unknown, _tool: string) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const raw = a.path ?? a.file ?? a.uri ?? a.target ?? a.script;
  if (raw == null || String(raw).trim() === "") return "";
  const base = String(raw).split(/[/\\]/).filter(Boolean).pop()?.replace(/[^\w.-]+/g, "_").slice(0, 80) || "out";
  const host = (server || "mcp").replace(/[^\w.-]+/g, "_").slice(0, 40);
  return `mcp/${host}/${base}`;
}
