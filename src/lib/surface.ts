import type { McpResource, McpTool } from "./mcp-parse";

export const ANVIL_SURFACE = "anvil";
export type SurfaceMode = "exclusive" | "bridge";

type Named = { id: string; name: string };

export const MCP_SIDECAR = new Set(["mcp_list", "mcp_call", "set_plan", "ask_user"]);
export const ANVIL_WRITE = new Set([
  "write_file",
  "append_file",
  "edit_file",
  "delete_file",
  "mkdir",
  "rename",
  "run_file",
  "shell",
  "engine_run",
  "format_file",
  "open_preview",
  "play",
  "see_run",
]);

export type SurfaceSnap = {
  id: string;
  mode: SurfaceMode;
  label: string;
  tools: McpTool[];
  resources: McpResource[];
  context: Record<string, string>;
  view?: string;
  ready: boolean;
  error?: string;
};

export function surfaceLabel(id: string, servers: Named[]): string {
  if (!id || id === ANVIL_SURFACE) return "Anvil";
  const s = servers.find((x) => x.id === id || x.name === id);
  return s?.name?.trim() || s?.id || id;
}

export function parseContext(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = text.trim();
  if (!raw) return out;
  for (const line of raw.split(/[\n;]+/)) {
    const m = line.trim().match(/^([a-zA-Z_][\w]*)\s*[:=]\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  if (!Object.keys(out).length) out.target = raw;
  return out;
}

export function contextLine(ctx: Record<string, string> | undefined): string {
  if (!ctx) return "";
  return Object.entries(ctx)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function mergeMcpArgs(ctx: Record<string, string> | undefined, args: unknown): Record<string, unknown> {
  const a = args && typeof args === "object" && !Array.isArray(args) ? { ...(args as Record<string, unknown>) } : {};
  if (!ctx) return a;
  for (const [k, v] of Object.entries(ctx)) {
    if (v && a[k] == null) a[k] = v;
  }
  return a;
}

export function surfaceBlockWrite(id: string, mode: SurfaceMode, name: string): string | null {
  if (mode === "bridge" || !id || id === ANVIL_SURFACE) return null;
  if (!ANVIL_WRITE.has(name)) return null;
  return `Aktive Fläche ist MCP „${id}“, nicht Anvil. Kein ${name}. Nutze mcp_call. Anvil-Dateien nur im Modus Brücke.`;
}

export function toolsAllowed(id: string, mode: SurfaceMode, name: string): boolean {
  if (mode === "bridge" || !id || id === ANVIL_SURFACE) return true;
  return MCP_SIDECAR.has(name);
}

export function surfacePrompt(snap: SurfaceSnap): string {
  if (snap.id === ANVIL_SURFACE) {
    const mcp = snap.tools.filter((t) => t.name !== "(fehler)");
    const extra = mcp.length
      ? `\nMCP verbunden, nicht aktiv (${mcp.length} Tools). Nur nutzen wenn der User die fremde Fläche nennt, sonst Anvil-Dateien.`
      : "";
    return `Arbeitsfläche: Anvil (Dateien, Run, Git). Modus: ${snap.mode === "bridge" ? "Brücke — MCP und Anvil erlaubt" : "Anvil"}.${extra}`;
  }
  const ctx = contextLine(snap.context);
  const tools = snap.tools
    .filter((t) => t.name !== "(fehler)")
    .slice(0, 80)
    .map((t) => `- ${t.server}.${t.name}${t.description ? ` — ${t.description.slice(0, 140)}` : ""}`);
  const res = snap.resources.slice(0, 24).map((r) => `- ${r.uri}${r.name ? ` (${r.name})` : ""}`);
  const bits = [
    `Arbeitsfläche: MCP „${snap.label}“ · ${snap.ready ? "bereit" : snap.error || "nicht bereit"}`,
    snap.mode === "bridge"
      ? "Modus Brücke: mcp_call auf dieser Fläche UND Anvil-Dateien. Jede Aktion gehört zu einer Fläche."
      : "Nur mcp_call auf DIESE Fläche. write_file/run_file sind Anvil — verboten, außer der User schaltet Brücke ein.",
    ctx ? `Kontext (geht in Tool-Args wenn das Tool den Key kennt):\n${ctx}` : "Kein Kontext gesetzt. Vor Schreiben: Resource lesen oder open/status-Tool, sonst den User nach Szene/Projekt fragen.",
    tools.length ? `Tools (mcp_call: server = Name vor dem Punkt, name = Tool):\n${tools.join("\n")}` : "Keine Tools.",
    res.length ? `Resources:\n${res.join("\n")}` : "",
    snap.view ? `Letzte Sicht:\n${snap.view.slice(0, 1200)}` : "",
  ];
  return bits.filter(Boolean).join("\n");
}
