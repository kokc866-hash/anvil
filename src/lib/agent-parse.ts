export function decodeWriteEscapes(s: string): string {
  if (!s) return s;
  let t = s;
  const lt = "\u003c";
  const gt = "\u003e";
  const amp = "&";
  if (t.includes(amp + "lt;") || t.includes(amp + "gt;") || t.includes(amp + "#")) {
    t = t.replaceAll(amp + "lt;", lt).replaceAll(amp + "gt;", gt).replaceAll(amp + "quot;", '"');
    t = t.replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => fromCode(h, 16));
    t = t.replace(/&#(\d+);/g, (_, d) => fromCode(d, 10));
    t = t.replaceAll(amp + "amp;", amp);
  }
  // Models XML-escape < > as u003c/u003e (backslash dropped). JS XSS "\\u003c" stays.
  if (/u003c/i.test(t) && /u003e/i.test(t) && !/\\u003[ce]/i.test(t)) {
    t = t.replace(/u003c/gi, lt).replace(/u003e/gi, gt);
  }
  return t;
}

function fromCode(raw: string, base: number): string {
  const n = parseInt(raw, base);
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

export function isNudgeEcho(text: string): boolean {
  return /Auftrag offen|Nächstes Tool, kein Plansatz|Job still open|Next tool, no plan|Dateien liegen\. Fertig schreiben|Files are in place\. Finish writing|Kein Text ohne Tool|No prose without a tool|Run-Schleife aus|enable the run loop via harness_write/i.test(
    text,
  );
}

import { isExecutablePath, selectRunTarget } from "./run-target.ts";

export function pickRunPath(files: Iterable<string>, hint = ""): string {
  return selectRunTarget(files, hint);
}

export function skipAutoRunPath(path: string): boolean {
  return !isExecutablePath(path);
}

export function extractFileBlocks(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const meta = m[1].trim();
    const body = m[2].replace(/\n$/, "");
    if (!body.trim()) continue;
    const path =
      meta.match(/(?:^|[\s:])([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\s*$/)?.[1] ||
      (/^[A-Za-z0-9_./-]+\.[A-Za-z0-9]+$/.test(meta) ? meta : "");
    if (!path || path.includes("..")) continue;
    out.push({ path: path.replace(/^\/+/, ""), content: decodeWriteEscapes(body) });
  }
  return out;
}

export function isToolTemplateEcho(text: string): boolean {
  const t = text || "";
  if (/<function-name>|args-json-object/i.test(t)) return true;
  const closes = t.split("</tool_call>").length - 1;
  return closes >= 3 && !/"name"\s*:\s*"[a-z_][a-z0-9_]*"/i.test(t);
}

export function looksLikeNoTools(text: string): boolean {
  if (isToolTemplateEcho(text)) return false;
  return /keine (workspace-)?datei[- ]?tools|dateiänderungen ausführen|no (file )?tools (available|are)|cannot [^.]*workspace|nicht .*tools verfügbar/i.test(
    text,
  );
}

export function looksIncomplete(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 24) return false;
  if (isNudgeEcho(t)) return false;
  if (/^(fertig|done|erledigt|ok)\.?$/i.test(t)) return false;
  if (/\b(geschrieben|angepasst|läuft|done|fertig)\b/i.test(t) && t.length > 400 && !/jetzt |als nächstes|dann noch|ich (prüfe|lese|sehe)/i.test(t)) return false;
  return /als nächstes|jetzt |ich (werde|habe|hab |mach|schreib|änder|öffne|lege|plane|lese|prüfe|sehe|schaue|vertief|teil|strukturiere|erstell|bau|füg|führ)|aufteil|in module|module auf|vertief|let me |i('ll| will) |next i('| )|todo:|to-do|schritt \d|warte kurz|dann (noch|öffne|schreib|änder)|weiter mit|now i (will|am)|i (have|just) (read|looked|found)|gefunden|exception|debug_/i.test(
    t,
  );
}

export function looksStoppedEarly(choice: {
  content?: string | null;
  reasoning?: string;
  finish_reason?: string;
  tool_calls?: unknown[];
}): boolean {
  if (choice.tool_calls && choice.tool_calls.length) return false;
  if (choice.finish_reason === "length") return true;
  const text = (choice.content || "").trim();
  if (!text) return Boolean(choice.reasoning);
  if (text.length < 24) return false;
  if (/\b(fertig|done|läuft|sauber|kein (fehler|patch)|ok)\b/i.test(text) && !looksIncomplete(text)) return false;
  if (looksLikeNoTools(text) || looksIncomplete(text)) return true;
  const think = (choice.reasoning || "").length;
  if (think > 80 && text.length < 600) return true;
  return false;
}

export function wantsWorkspaceWrite(text: string): boolean {
  const t = String(text || "").replace(/bei fehler[^\n.]*patch(en)?/gi, "");
  return /schreib|erstell|vertief|\bdateien?\b|\bbau|mach(en|e)\b|implement|\bfix\b|anleg|aufteil|modul/i.test(t) ||
    (/\bpatch\b/i.test(t) && !/kein patch|nichts/i.test(t));
}

export function askPickedNone(ask: string): boolean {
  return /^Antwort auf:/i.test(ask) && /\b(nichts|nothing|kein (patch|änder)|nur stil)/i.test(ask);
}

export function jobOpen(opts: { ask: string; used: string[]; text?: string }): boolean {
  // ChatPane prepends references and attached files. Those may contain words
  // such as "Dateien"/"schreiben" without the user asking us to change anything.
  const marker = "\n\nAuftrag:\n";
  const taskAt = opts.ask.lastIndexOf(marker);
  const ask = taskAt >= 0 ? opts.ask.slice(taskAt + marker.length) : opts.ask;
  if (askPickedNone(ask)) return false;
  if (/^Antwort auf:/i.test(ask) && /wahl:\s*[b-e]\)/i.test(ask)) return true;
  const wrote = opts.used.some((n) => /write_file|append_file|edit_file/.test(n));
  const ran = opts.used.some((n) => /run_file|engine_run/.test(n));
  if (wrote && !ran) return true;
  if (opts.text && looksIncomplete(opts.text)) return true;
  const askBody = ask.replace(/^Antwort auf:[^\n]*\n?/i, "");
  if (wantsWorkspaceWrite(askBody) && !wrote) return true;
  const failText = /exception|error:|fehlgeschlagen|nicht (ok|grün)|schwarz|blockiert/i.test(opts.text || "");
  if (ran && failText) return true;
  return false;
}

export function harvestTools(text: string): { id: string; type: "function"; function: { name: string; arguments: string } }[] {
  const src = (text || "").trim();
  if (src.length < 12 || isToolTemplateEcho(src)) return [];
  const xml = harvestXml(src);
  if (xml.length) return xml;
  return harvestPlain(src);
}

export function blocksToWriteCalls(
  blocks: { path: string; content: string }[],
  round = 0,
): { id: string; type: "function"; function: { name: string; arguments: string } }[] {
  return blocks.slice(0, 12).map((b, i) => ({
    id: `fence_${round}_${i}`,
    type: "function" as const,
    function: { name: "write_file", arguments: JSON.stringify({ path: b.path, content: b.content }) },
  }));
}

const TOOL_NAMES =
  /^(list_files|read_file|write_file|append_file|edit_file|delete_file|mkdir|rename|grep|run_file|set_plan|shell|see_run|play|format_file|open_preview|git_status|git_commit|git_push|git_clone|fetch_url|debug_start|debug_continue|debug_step|debug_stop|debug_breakpoint|debug_eval|debug_state|debug_watch|memory_list|memory_add|memory_forget|skill_list|skill_write|skill_read|skill_run|skill_debug|skill_patch|skill_outcome|mcp_list|mcp_call|engine_detect|engine_status|engine_run|harness_read|harness_write|graph_write|board_read|board_open|board_reset|board_write)$/;

function harvestXml(src: string): { id: string; type: "function"; function: { name: string; arguments: string } }[] {
  if (!/<tool_call>|tool call/i.test(src)) return [];
  const out: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];
  const re = /<tool_call>\s*([\s\S]*?)<\/tool_call>/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(src))) {
    const hit = parseToolBlob(m[1].trim());
    if (hit) out.push({ id: `xml_${++n}`, type: "function", function: hit });
  }
  return out;
}

function harvestPlain(src: string): { id: string; type: "function"; function: { name: string; arguments: string } }[] {
  if (src.length > 12000) return [];
  const out: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];
  let n = 0;
  const nameRe = /"name"\s*:\s*"([a-z][a-z0-9_]*)"/g;
  let nm: RegExpExecArray | null;
  while ((nm = nameRe.exec(src))) {
    const brace = src.lastIndexOf("{", nm.index);
    if (brace < 0) continue;
    const obj = sliceObject(src, brace);
    if (!obj) continue;
    try {
      const j = JSON.parse(obj) as Record<string, unknown>;
      const name = String(j.name || "");
      if (!TOOL_NAMES.test(name)) continue;
      const args = j.arguments ?? j.params ?? {};
      out.push({
        id: `js_${++n}`,
        type: "function",
        function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
      });
    } catch {
      /* */
    }
  }
  if (out.length) return out;
  const callRe =
    /(?:^|\n)\s*(list_files|read_file|write_file|append_file|edit_file|delete_file|mkdir|rename|grep|run_file|set_plan|shell|see_run|play|format_file|open_preview|git_status|git_commit|git_push|git_clone|fetch_url|debug_start|debug_continue|debug_step|debug_stop|debug_breakpoint|debug_eval|debug_state|debug_watch|memory_list|memory_add|memory_forget|skill_list|skill_write|skill_read|skill_run|skill_debug|skill_patch|skill_outcome|mcp_list|mcp_call|engine_detect|engine_status|engine_run|harness_read|harness_write|graph_write|board_read|board_open|board_reset|board_write)\s*\(/g;
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(src))) {
    const name = cm[1];
    const inner = sliceArgs(src, cm.index + cm[0].length - 1);
    if (inner == null) continue;
    out.push({ id: `fn_${++n}`, type: "function", function: { name, arguments: argsFromCall(name, inner) } });
  }
  return out;
}

function sliceObject(src: string, openIdx: number): string | null {
  if (src[openIdx] !== "{") return null;
  let depth = 0;
  let inStr = "";
  let esc = false;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = "";
      continue;
    }
    if (c === '"') {
      inStr = c;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return null;
}

function parseToolBlob(body: string): { name: string; arguments: string } | null {
  let name = "";
  let args = "{}";
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    name = String(j.name || j.tool || "");
    args = JSON.stringify(j.arguments ?? j.params ?? j);
  } catch {
    name = body.match(/^([a-z_][a-z0-9_]*)/i)?.[1] || "";
    const js = body.match(/\{[\s\S]*\}/);
    args = js?.[0] || "{}";
  }
  if (/<function-name>|args-json-object|function-name/i.test(body)) return null;
  if (!name || /^<?function/i.test(name)) return null;
  return { name, arguments: args };
}

function sliceArgs(src: string, openIdx: number): string | null {
  if (src[openIdx] !== "(") return null;
  let depth = 0;
  let inStr = "";
  let esc = false;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = "";
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i).trim();
    }
  }
  return null;
}

function argsFromCall(name: string, inner: string): string {
  const t = inner.trim();
  if (!t) return "{}";
  if (t.startsWith("{")) return t;
  const q = t[0];
  if ((q === '"' || q === "'") && t.endsWith(q) && t.length >= 2) {
    const v = t.slice(1, -1);
    if (/read_file|write_file|edit_file|append_file|delete_file|mkdir|run_file|format_file|open_preview/.test(name)) {
      return JSON.stringify({ path: v });
    }
    if (name === "grep") return JSON.stringify({ query: v });
    if (name === "shell") return JSON.stringify({ command: v });
    if (name === "list_files") return JSON.stringify({ glob: v });
  }
  return "{}";
}

export function isFixPrompt(text: string): boolean {
  return /^(behebe diese probleme|intern-fehler beheben|arbeitsbaum hat |führe .+ nochmal)/i.test(text.trim());
}

export function unescapeJsonFrag(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const n = s[++i];
      if (n === "n") out += "\n";
      else if (n === "t") out += "\t";
      else if (n === "r") out += "\r";
      else if (n === '"') out += '"';
      else if (n === "\\") out += "\\";
      else if (n === "/") out += "/";
      else if (n === "u" && i + 4 < s.length) {
        out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16) || 0);
        i += 4;
      } else out += n;
    } else out += c;
  }
  return out;
}

function decodeArgStrings(args: Record<string, unknown>): Record<string, unknown> {
  const keys = ["content", "old_string", "new_string"];
  const next = { ...args };
  for (const k of keys) {
    if (typeof next[k] === "string") next[k] = decodeWriteEscapes(next[k] as string);
  }
  return next;
}

export function parseToolArgs(raw: string): { args: Record<string, unknown>; truncated: boolean } {
  const s = (raw || "").trim() || "{}";
  try {
    const args = JSON.parse(s) as Record<string, unknown>;
    return { args: args && typeof args === "object" ? decodeArgStrings(args) : {}, truncated: false };
  } catch {
    /* incomplete JSON from a long write */
  }
  const path = s.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
  const mark = s.match(/"content"\s*:\s*"/);
  if (path != null && mark?.index != null) {
    const body = decodeWriteEscapes(
      unescapeJsonFrag(
        s
          .slice(mark.index + mark[0].length)
          .replace(/"\s*,?\s*"truncated".*$/s, "")
          .replace(/"\s*}\s*$/, ""),
      ),
    );
    return { args: { path, content: body, truncated: true }, truncated: true };
  }
  return { args: {}, truncated: true };
}
