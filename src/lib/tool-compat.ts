import { providerOf } from "./providers.ts";
import { normalizeBaseUrl } from "./connection.ts";
import { AGENT_TOOLS } from "./agent-tools.ts";
import type { ToolCall } from "./tool-call.ts";
import { shrinkTools } from "./tool-fallback.ts";
import { capabilityPage, compactCatalogHistory } from './capability-search.ts';
import { previewInteractionRequest } from './preview-task.ts';

export type ToolCompatibility = "standard" | "compact" | "text";
export type ToolContract = { transport: "native" | "text"; names: string[] };
export const toolCompatibility = (value: unknown): ToolCompatibility => value === "compact" || value === "text" ? value : "standard";
const taskText = (task: string) => task.split("\n\nAuftrag:\n").at(-1) || task;

/** No credentials in settings/log keys; retain case-sensitive model and deployment paths. */
export function toolTargetKey(provider: string, model: string, baseUrl: string, protocol = provider === "ollama" ? "ollama-chat" : providerOf(provider).api) {
  let base = (baseUrl || providerOf(provider).baseUrl).trim().replace(/\/+$/, "");
  try { base = normalizeBaseUrl(base); } catch { /* allow editing incomplete URLs */ }
  try {
    const url = new URL(base.includes("://") ? base : `http://${base}`);
    url.username = ""; url.password = ""; url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/key|token|secret|password|signature/i.test(key)) url.searchParams.delete(key);
    if (provider === "ollama") url.pathname = url.pathname.replace(/\/(?:v1(?:\/chat\/completions)?|api(?:\/chat)?)\/?$/, "");
    base = url.toString().replace(/\/+$/, "");
  } catch { /* invalid URLs are handled by the connection layer */ }
  return JSON.stringify([provider, base, protocol, model.trim()]);
}

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[]; maxItems?: number; additionalProperties?: boolean };
function check(value: unknown, schema: Schema, path: string): string | null {
  if (schema.enum && !schema.enum.includes(value)) return `${path}: invalid value`;
  const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const types = schema.type ? Array.isArray(schema.type) ? schema.type : [schema.type] : [];
  if (types.length && !types.some((t) => t === "integer" ? Number.isInteger(value) : type === t)) return `${path}: expected ${types.join(" or ")}`;
  if (typeof value === "number" && !Number.isFinite(value)) return `${path}: expected finite number`;
  if (Array.isArray(value)) {
    if (schema.maxItems != null && value.length > schema.maxItems) return `${path}: at most ${schema.maxItems} items`;
    for (let i = 0; i < value.length; i++) { const error = schema.items && check(value[i], schema.items, `${path}[${i}]`); if (error) return error; }
  } else if (type === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) if (!Object.hasOwn(obj, key)) return `${path}.${key}: required`;
    for (const [key, child] of Object.entries(obj)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) return `${path}: invalid key`;
      const sub = schema.properties?.[key];
      if (sub) { const error = check(child, sub, `${path}.${key}`); if (error) return error; }
      else if (schema.additionalProperties === false) return `${path}.${key}: unknown argument`;
    }
  }
  return null;
}

/** Shared native/text check, before the existing permissions and executor. No JSON repair. */
export function validateToolCall(call: ToolCall, names: string[]): { args: Record<string, unknown>; error?: string } {
  const tool = AGENT_TOOLS.find((t) => t.function.name === call.function.name);
  if (!tool || !names.includes(call.function.name)) return { args: {}, error: `Tool not offered: ${call.function.name}` };
  try {
    const args: unknown = JSON.parse(call.function.arguments);
    const error = check(args, tool.function.parameters as Schema, "arguments");
    return error ? { args: {}, error } : { args: args as Record<string, unknown> };
  } catch { return { args: {}, error: "Arguments must be one complete JSON object." }; }
}

/** Only a complete answer envelope is executable. Prose, fences, examples and thinking are never scanned. */
export function parseTextTool(content: string, names: string[], rejectPausedPlan = false): { calls: ToolCall[]; error?: string } {
  const src = content.trim();
  if (!src.startsWith("{")) return { calls: [] };
  try {
    const value = JSON.parse(src);
    if (!value || !Object.hasOwn(value, "name") || !Object.hasOwn(value, "arguments")) return { calls: [] };
    if (Object.keys(value).sort().join(",") !== "arguments,name" || typeof value.name !== "string") return { calls: [], error: "Use only name and arguments in the tool object." };
    const call: ToolCall = { id: `text_${crypto.randomUUID()}`, type: "function", function: { name: value.name, arguments: JSON.stringify(value.arguments) } };
    // The loop needs the envelope to return a controlled rejection instead of
    // terminating text transport. The paused tool cannot reach the executor.
    if (rejectPausedPlan && value.name === "set_plan") return { calls: [call] };
    const checked = validateToolCall(call, names);
    return checked.error ? { calls: [], error: checked.error } : { calls: [call] };
  } catch { return /"(?:name|arguments)"\s*:/.test(src) ? { calls: [], error: "Tool call must be one complete JSON object." } : { calls: [] }; }
}

/** Tool-free answers, questions and long thinking alone do not establish a stall. */
export function isToolStall(task: string, used: string[], text: string, finish?: string): boolean {
  const ask = taskText(task);
  const write = /\b(schreib\w*|erstelle?\w*|implement\w*|beheb\w*|reparier\w*|fix|create|write|edit)\b/i.test(ask);
  const run = /\b(run|compile|compili\w*|kompili\w*|ausführ\w*|starte?|test\w*)\b/i.test(ask);
  const wrote = used.some((n) => /^(write_file|edit_file|append_file)$/.test(n));
  const ran = used.some((n) => /^(run_file|engine_run|skill_run)$/.test(n));
  if ((!write || wrote) && (!run || ran)) return false;
  if (text.includes("?") || /\b(fertig|done|erledigt|completed)\b/i.test(text)) return false;
  return !text.trim() || finish === "length" || /keine (?:datei[- ]?)?tools|tools.*nicht (?:verfügbar|aktiv)|no (?:file )?tools (?:available|are)|cannot .*tools|ich (?:werde|muss|möchte) .*?(?:schreib|erstell|tool|ausführ)|I (?:will|need to) .*?(?:write|create|tool|run)/i.test(text);
}

export function toolCallKey(name: string, args: Record<string, unknown>): string {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
  return JSON.stringify([name, stable(args)]);
}

const BASE = ["read_file", "list_files", "grep", "edit_file", "write_file", "run_file", "ask_user"];
const CORE = ['select_tools','set_plan','ask_user','read_tool_output'];
const RELEVANCE: [RegExp, string[]][] = [
  [/\.(?:png|blend|fcstd|glb|gltf|stl|step|fbx)\b|\b(?:render|export)\w*\b|dateiprüfung|file verification/i, ["verify_file"]],
  [/\bmcp\b|\bdienste?\b|\bservices?\b|server.*tools?|freecad|openscad|blender|\bcad\b|notion|linear|studio/i, ["mcp_list", "mcp_call"]],
  [/compil|\brun\b|\bshell\b|ausführ|starte|test|prüf|\bcheck\b|\bverify\b/i, ["run_file", "see_run","shell"]],
  [/debug|breakpoint|haltepunkt/i, ["debug_state", "debug_start", "debug_step"]],
  [/\bgit\b|repository|push|commit/i, ["git_status", "git_commit", "git_push"]],
  [/engine|godot|unity|unreal/i, ["engine_detect", "engine_status", "engine_run"]],
  [/skill/i, ["skill_list", "skill_read", "skill_run"]],
  [/skill.*(?:bewert|outcome|nutzung)|(?:bewert|outcome).*skill/i,['skill_outcome']],
  [/format|einruck|einrück/i,['format_file']],
  [/https?:|website|webseite|fetch|\burl\b/i,['fetch_url','open_preview']],
  [/rename|umbenenn|verschieb|\bmove\b/i,['rename']],
  [/delete|losch|lösch|entfern/i,['delete_file']],
  [/mkdir|ordner.*(?:erstell|anleg)|create.*(?:folder|director)/i,['mkdir']],
  [/append|anhang|anhäng|anfug|anfüg/i,['append_file']],
  [/memory|gedachtnis|gedächtnis|erinner/i,['memory_list','memory_add','memory_forget']],
  [/harness|tafel|board/i, ["harness_read", "board_read", "board_write"]],
];

export class ToolSession {
  contract: ToolContract = { transport: "native", names: [] };
  private selected: string[] = [];
  private available = AGENT_TOOLS;
  private fallback = false;
  private planUpdatesPaused = false;
  readonly mode: ToolCompatibility;
  readonly task: string;
  constructor(mode: ToolCompatibility, task: string, hints: string[] = []) { this.mode = mode; this.task = taskText(task); this.selected = hints.slice(0,12); }
  pausePlanUpdates(paused: boolean) { this.planUpdatesPaused = paused; }
  get planUpdatesArePaused() { return this.planUpdatesPaused; }
  private currentTools() {
    return this.planUpdatesPaused ? this.available.filter(tool => tool.function.name !== "set_plan") : this.available;
  }
  tools(available: typeof AGENT_TOOLS): typeof AGENT_TOOLS {
    this.available = available;
    available = this.currentTools();
    const exclusiveMcp = available.some((t) => t.function.name === "mcp_call") && !available.some((t) => t.function.name === "read_file");
    const priorities = [...(exclusiveMcp ? ["mcp_list", "mcp_call", "mcp_read_resource", "mcp_read_output"] : []), ...(previewInteractionRequest(this.task) ? ['play','run_file','see_run'] : []), ...this.selected, ...RELEVANCE.filter(([re]) => re.test(this.task)).flatMap(([, names]) => names), ...BASE];
    const names = new Set([...CORE, ...(this.mode==='standard'?BASE:[]), ...[...new Set(priorities)].filter((name) => !CORE.includes(name) && available.some((t) => t.function.name === name)).slice(0, this.mode==='standard'?24:6)]);
    const picked=available.filter((t) => names.has(t.function.name));
    return this.mode==='standard'?picked:shrinkTools(picked)||[];
  }
  select(names: string[]) {
    const allowed = new Set(this.currentTools().map((t) => t.function.name));
    const invalid = names.filter((name) => !allowed.has(name));
    if (invalid.length) return { error: `Unavailable tools: ${invalid.join(", ")}` };
    if (names.length) this.selected = [...new Set([...names,...this.selected])].filter((name) => name !== "select_tools").slice(0,24);
    return { ok: true, selected: this.selected.filter(name => !this.planUpdatesPaused || name !== "set_plan") };
  }
  selectAvailable(names:string[]) { const tools = this.currentTools(); return this.select(names.filter(name=>tools.some(tool=>tool.function.name===name))); }
  search(options:{query?:string;cursor?:string;limit?:number}={}) {
    const rows=this.currentTools().map(t=>({id:t.function.name,name:t.function.name,description:t.function.description}));
    const page=capabilityPage(rows,options);
    if(options.query?.trim())this.select(page.items.map(row=>row.name));
    return {available:page.items.map(({name,description})=>({name,description:description.slice(0,180)})),total:page.total,nextCursor:page.nextCursor};
  }
  get text() { return this.mode === "text" || this.fallback; }
  prepare(payload: Record<string, unknown>) {
    if (!Array.isArray(payload.messages)) return;
    const marker = "\nTool selection for this request:";
    const instruction = `${marker}\n${this.planUpdatesPaused ? "Checklist updates are paused until the next successful work action." : "Core tools stay available."} More permitted capabilities are loaded on demand: select_tools({"query":"describe the needed capability","scope":"all"}) searches native tools, MCP connections and skills; scope can be tools, mcp or skills. Exact names can be loaded with names:[...]. This discovers only; it executes no action and grants no permissions. For a selected skill use skill_read before applying its guide. Missing capabilities remain searchable; never silently skip required work. A final answer or a question needs no tool.`;
    const messages = compactCatalogHistory(payload.messages as Record<string, unknown>[]).map((m) => ({ ...m }));
    const system = messages.find((m) => m.role === "system" && typeof m.content === "string");
    if (system) { if(!String(system.content).endsWith(instruction))system.content = String(system.content) + instruction; }
    else messages.unshift({ role: "system", content: instruction.trim() });
    payload.messages = messages;
  }
  tryTextFallback() {
    if (this.mode !== "compact" || this.fallback || this.contract.transport === "text") return false;
    this.fallback = true;
    return true;
  }
  record(tools: typeof AGENT_TOOLS, text: boolean) {
    this.contract = { transport: text ? "text" : "native", names: tools.map((t) => t.function.name) };
  }
}
