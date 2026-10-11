import type { PlanStep } from "@/store/ide";
import { parseTestCommand } from "./test-parse.ts";
import { toolResultFailed, toolResultPending } from "./agent-evidence.ts";

type Locale = "de" | "en";

function pack(locale: Locale, de: string[], en: string[]): PlanStep[] {
  return (locale === "en" ? en : de).map(step);
}

export type PlanWho = "auto" | "anvil" | "helper" | "agent";

export function normalizePlanWho(v: unknown): PlanWho {
  return v === "anvil" || v === "helper" || v === "agent" ? v : "auto";
}

export function planSeedNow(who: PlanWho): boolean {
  return who === "anvil" || who === "auto";
}

export function planHelperNow(who: PlanWho, hasPlan: boolean, locked: boolean): boolean {
  if (who === "helper") return true;
  if (who === "auto") return !hasPlan && !locked;
  return false;
}

export function planAgentMayReplace(who: PlanWho, locked: boolean): boolean {
  if (who === "anvil" || who === "helper") return false;
  if (who === "agent") return true;
  return !locked;
}

export function planFromAsk(text: string): boolean {
  return numberedSteps(text).length >= 3;
}

function numberedSteps(text: string): string[] {
  return String(text || "")
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 2 && l.length < 72);
}

export function guessPlan(text: string, locale: Locale = "de"): PlanStep[] {
  const numbered = numberedSteps(text);
  if (numbered.length >= 3) return numbered.slice(0, 7).map((t) => step(t));
  if (/godot|unity|unreal|bevy/i.test(text)) return pack(locale, ["Lesen", "Ändern", "Engine", "Prüfen"], ["Read", "Edit", "Engine", "Check"]);
  if (/mcp|ziva|fläche|surface/i.test(text)) return pack(locale, ["Lesen", "MCP", "Prüfen"], ["Read", "MCP", "Check"]);
  if (/git|commit|push/i.test(text)) return pack(locale, ["Lesen", "Ändern", "Commit"], ["Read", "Edit", "Commit"]);
  if (/app|ui|formular|seite|html/i.test(text)) return pack(locale, ["Verstehen", "Bauen", "Run", "Prüfen"], ["Understand", "Build", "Run", "Check"]);
  if (/refactor|aufräum/i.test(text)) return pack(locale, ["Lesen", "Refactor", "Prüfen"], ["Read", "Refactor", "Check"]);
  return pack(locale, ["Verstehen", "Ändern", "Run", "Prüfen"], ["Understand", "Edit", "Run", "Check"]);
}

function mark(next: PlanStep[], pred: (s: PlanStep) => boolean, status: PlanStep["status"]) {
  let i = -1;
  if (status === "ok") {
    i = next.findIndex((s) => s.status === "run" && pred(s));
    if (i < 0) i = next.findIndex((s) => s.status === "todo" && pred(s));
  } else if (status === "err") {
    i = next.findIndex((s) => (s.status === "run" || s.status === "todo") && pred(s));
  } else {
    i = next.findIndex((s) => (s.status === "todo" || s.status === "err") && pred(s));
  }
  if (i < 0) return;
  // Explicitly classified steps run in order: an early read cannot certify a
  // later comparison that depends on edits which have not happened yet.
  if (next[i].kind && next.slice(0, i).some(s => s.status !== "ok")) return;
  if ((status === "ok" || status === "err") && next[i].status === "run") {
    next[i] = { ...next[i], status };
    return;
  }
  if (status === "ok") {
    const earlier = next.slice(0, i).some((s) => s.status === "todo" || s.status === "run");
    if (earlier) return;
  }
  next[i] = { ...next[i], status };
}

type ToolArgs = Record<string, unknown>;

const editAction = (text: string) => /änder|schreib|edit|write|bau|build|überarbeit|anpass|umsetz|implement|korrig|beheb|fix|refactor|verbind|erweiter|ergänz|hinzufüg|\badd\b/i.test(text);
const readStep = (text: string) => !editAction(text) && /versteh|understand|\bles|\bread|such|search|referenz|bestehend|ursache.*find|investigat|inspect|projektdateien|project files/i.test(text);
const runAction = (text: string) => /\brun\b|ausführ|\bplay\b|\bshell\b|start|öffnen|\bopen|launch/i.test(text);
const checkStep = (text: string) => !readStep(text) && (/prüf|check|verif|\btesten\b/i.test(text) || (/\btests?\b/i.test(text) && (!editAction(text) || runAction(text))));
const runStep = (text: string) => runAction(text) && !checkStep(text);

function serviceStep(text: string, operation: string, explicit = false): boolean {
  // A search cannot certify a deletion just because both labels name a service.
  if (/lösch|entfern|delete|remove/i.test(text)) return /delete|remove|trash/i.test(operation);
  if (/erstell|anleg|create|insert/i.test(text)) return /create|insert|add/i.test(operation);
  if (editAction(text) && !/verbindung/i.test(text)) return /update|edit|write|patch|move/i.test(operation);
  if (/such|search|find|abfrag|query/i.test(text)) return /search|query|find|list/i.test(operation);
  if (/les|read|abruf|fetch|konto|account/i.test(text)) return /fetch|read|get|list/i.test(operation);
  return explicit || /mcp|fremd|fläche|surface|dienst|service|verbindung|connection|werkzeug|tool/i.test(text);
}

/** MCP is a transport, not an action kind. Arbitrary code needs the model's
 * explicit evidence attribution: its successful execution alone never checks
 * geometry or proves that every requested edit was made. */
export function mcpStepMatches(step: PlanStep, args: ToolArgs, explicit = false): boolean {
  const operation = String(args.name ?? "").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (!step.kind) return serviceStep(step.text, operation);
  if (step.kind === "report") return false;
  if (/(?:^|[._-])(?:execute_code(?:_async|_headless)?|run_code|execute_script|run_script|execute_python|run_python|get_async_status)$/.test(operation))
    return explicit || (step.kind === "service" && serviceStep(step.text, operation, true));
  if (step.kind === "service") return serviceStep(step.text, operation, true);
  if (step.kind === "check" && /verbindung|connection|erreichbar|health|version/i.test(step.text)
    && /(?:^|[._-])(?:ping|health|(?:get_)?(?:status|version))$/.test(operation)) return true;
  const kind = /(?:^|[._-])(?:create|insert|add|update|edit|write|patch|delete|remove|rename|move|mkdir)(?:[._-]|$)/.test(operation) ? "edit"
    : /(?:^|[._-])(?:check|verify|validate|test)(?:[._-]|$)/.test(operation) ? "check"
    : /(?:^|[._-])(?:read|get|list|fetch|search|query|find)(?:[._-]|$)/.test(operation) ? "read" : undefined;
  return step.kind === kind && (kind !== "edit" || serviceStep(step.text, operation, true));
}

export function mcpPlanStatus(row: ToolArgs, args: ToolArgs): ToolArgs {
  // Only protocol-level structured/JSON results supply execution state. Never
  // interpret prose or arbitrary nested document fields as a passed check.
  const values: ToolArgs[] = [row];
  if (row.structuredContent && typeof row.structuredContent === "object") values.push(row.structuredContent as ToolArgs);
  if (Array.isArray(row.content)) for (const block of row.content) {
    if (block?.type !== "text" || typeof block.text !== "string" || block.text.length > 24000) continue;
    try { const value = JSON.parse(block.text); if (value && typeof value === "object" && !Array.isArray(value)) values.push(value); } catch { /* prose is not state */ }
  }
  const pending = values.some(toolResultPending);
  const failed = values.some(toolResultFailed);
  const asyncUnconfirmed = /(?:^|_)async$|(?:^|_)get_async_status$/.test(String(args.name))
    && !values.some(value => /^(completed|done|success|succeeded)$/i.test(String(value.status)));
  return { ...row, ...(pending || asyncUnconfirmed ? { pending: true } : {}), ...(failed ? { isError: true } : {}) };
}

const knowledgeReads = new Set(["memory_list", "skill_list", "skill_read"]);
const knowledgeEdits = new Set(["memory_add", "memory_forget", "skill_write", "skill_patch"]);
const knowledgeTools = new Set([...knowledgeReads, ...knowledgeEdits, "skill_run", "skill_outcome"]);

function knowledgeRequirements(text: string): string[] | undefined {
  const explicit = [...text.matchAll(/\b(memory|skill)_([a-z]+(?:\/[a-z]+)*)\b/gi)]
    .flatMap(match => match[2].toLowerCase().split("/").map(action => `${match[1].toLowerCase()}_${action}`));
  if (explicit.length) return [...new Set(explicit)];
  const required: string[] = [];
  const add = (name: string, pattern: RegExp) => { if (pattern.test(text)) required.push(name); };
  if (/gedächtnis|erinnerung|\bmemor(?:y|ies)\b/i.test(text)) {
    add("memory_list", /\bles|auflist|anzeig|abruf|\bread|\blist|\bview|\bsearch|such/i);
    add("memory_add", /speicher|hinzufüg|anleg|erstell|notier|schreib|\badd\b|\bcreate|\bstore|\bsave|\bwrite/i);
    add("memory_forget", /vergess|lösch|entfern|\bforget|\bdelete|\bremove/i);
  }
  if (/\bskills?\b|fertigkeit/i.test(text)) {
    add("skill_list", /auflist|\blist|verfügbar|\bavailable/i);
    add("skill_read", /\bles|\bread|ansehen|abruf/i);
    add("skill_write", /schreib|erstell|anleg|speicher|\bwrite|\bcreate/i);
    add("skill_patch", /änder|überarbeit|ergänz|aktualis|verbesser|anpass|\bedit|\bpatch|\bupdate/i);
    add("skill_run", /nutz|verwend|ausführ|anwend|\brun|\buse|\bapply/i);
    add("skill_outcome", /bewert|erfolg|ergebnis|\boutcome|\bresult|\bevaluat|\breport/i);
  }
  return required.length ? [...new Set(required)] : undefined;
}

/** undefined: not a knowledge step. Explicit compound steps need every named action.
 * Using a skill returns instructions; it never proves a program run or a test. */
export function knowledgeStepMatches(step: PlanStep, names: string[]): boolean | undefined {
  const required = knowledgeRequirements(step.text);
  if (!required) return undefined;
  return required.every(name => knowledgeTools.has(name) && names.includes(name)
    && (!step.kind || (step.kind === "service" && !knowledgeReads.has(name))
      || (step.kind === "read" && knowledgeReads.has(name))
      || (step.kind === "edit" && knowledgeEdits.has(name))));
}

function apply(name: string, next: PlanStep[], status: PlanStep["status"], args: ToolArgs = {}, result?: unknown) {
  if (knowledgeTools.has(name)) {
    mark(next, s => knowledgeStepMatches(s, [name]) === true, status);
    return;
  }
  if (/^git_/.test(name)) {
    const action=name.slice(4);
    mark(next,s=>{
      if(action==='status')return /(?:git.*status|status.*git|versions?stand)/i.test(s.text)&&!/commit|push|clone/i.test(s.text);
      return new RegExp(action,'i').test(s.text);
    },status);
    return;
  }
  if (/^engine_(detect|status)$/.test(name)) {
    // A model may classify discovery as a check. Only the explicit discovery
    // step is evidenced here, never the later engine validation or launch.
    mark(next, s => /erkenn|detect|installation|verfügbar|available|verbindung.*(prüf|check)/i.test(s.text), status);
    return;
  }
  const pending = result && typeof result === "object" && "running" in result && result.running === true;
  if (name === "mcp_call") {
    const state = mcpPlanStatus(result && typeof result === "object" ? result as ToolArgs : {}, args);
    if (status === "ok" && (toolResultPending(state) || state.truncated || state.already_executed)) return;
    if (status === "ok" && toolResultFailed(state)) status = "err";
    if (next.some(s => s.kind)) {
      mark(next, s => knowledgeRequirements(s.text) === undefined && mcpStepMatches(s, args), status);
      return;
    }
  }
  const kind: PlanStep["kind"] = /^(read_file|list_files|grep)$/.test(name) ? "read"
    : /^(write_file|edit_file|append_file|delete_file|rename|mkdir|format_file)$/.test(name) ? "edit"
    : name === "mcp_call" ? "service"
    : name === "engine_run" ? (/check|test/.test(String(args.action ?? "check")) ? "check" : /play|editor/.test(String(args.action)) ? "run" : undefined)
    : name === "shell" ? (parseTestCommand(String(args.command ?? "")) ? "check" : "run")
    : /^(see_run|tests)$/.test(name) ? "check"
    : /^(run_file|play|open_preview)$/.test(name) ? "run" : undefined;
  if (next.some(s => s.kind)) {
    if (kind && !(kind === "check" && pending && status === "ok"))
      mark(next, s => s.kind === kind && knowledgeRequirements(s.text) === undefined && (kind !== "service" || serviceStep(s.text, String(args.name ?? ""), true)), status);
    return;
  }
  if (name === "mcp_call") {
    // Listing a catalogue cannot prove service access. Match the operation actually called.
    const operation = String(args.name ?? "");
    mark(next, (s) => serviceStep(s.text, operation), status);
  }
  else if (/^mcp_(list|read)/.test(name)) mark(next, (s) => /katalog|catalog|werkzeuge.*(auflist|such)|list.*tools/i.test(s.text), status);
  else if (/git_/.test(name)) mark(next, (s) => /git|commit|push/i.test(s.text), status);
  else if (/write|edit|append|delete|rename|mkdir|format/.test(name))
    mark(next, (s) => !readStep(s.text) && !runStep(s.text) && !checkStep(s.text) && (editAction(s.text) || /layout|farb|ui|interakt|style|css|html/i.test(s.text)), status);
  else if (name === "engine_run") {
    const action = String(args.action ?? "check");
    if (/check|test/.test(action)) {
      if (pending && status === "ok") return;
      mark(next, (s) => checkStep(s.text) || /^(engine|godot|unity|unreal)$/i.test(s.text), status);
    } else if (/play|editor/.test(action)) mark(next, (s) => runStep(s.text) || /^(engine|godot|unity|unreal)$/i.test(s.text), status);
  }
  else if (/engine/.test(name)) mark(next, (s) => /erkenn|detect|installation|verfügbar|available/i.test(s.text), status);
  else if (/see_run|open_preview|test/.test(name))
    mark(next, (s) => /prüf|test|see|check|bild|vorschau|preview|fehler|run/i.test(s.text), status);
  else if (name === "shell" && parseTestCommand(String(args.command ?? "")))
    mark(next, (s) => checkStep(s.text), status);
  else if (/run_file|shell|play/.test(name))
    mark(next, (s) => runStep(s.text), status);
  else if (/read|list|grep/.test(name))
    mark(next, (s) => readStep(s.text), status);
}

export function planStart(name: string, plan: PlanStep[] | undefined, args: ToolArgs = {}): PlanStep[] | null {
  if (!plan?.length || name === "set_plan") return null;
  const next = plan.map((s) => ({ ...s, status: s.status === "run" ? ("todo" as const) : s.status }));
  apply(name, next, "run", args);
  return next;
}

export function planFromTool(name: string, plan: PlanStep[] | undefined, failed = false, args: ToolArgs = {}, result?: unknown): PlanStep[] | null {
  if (!plan?.length) return null;
  if (name === "set_plan") return null;
  const next = plan.map((s) => ({ ...s }));
  apply(name, next, failed ? "err" : "ok", args, result);
  return next;
}

/** Runde vorbei: Rest nur schließen wenn Beweis da. Bei Fehler nur den laufenden Schritt. */
export function planFinish(plan: PlanStep[] | undefined, failed = false, proved = false, delivered = false): PlanStep[] | null {
  if (!plan?.length) return null;
  let changed = false;
  const next = plan.map((s) => {
    if (s.status === "ok" || s.status === "err") return s;
    if (failed) {
      changed = true;
      return s.status === "run" ? { ...s, status: "err" as const } : s;
    }
    if (delivered && (s.kind === "report" || /^(ergebnis(?:se)?|result(?:s)?|antwort|answer)\s+(zusammenfassen|berichten|mitteilen|summari[sz]e|report|geben|liefern)\b/i.test(s.text))) {
      changed = true;
      return { ...s, status: "ok" as const };
    }
    // Execution evidence cannot certify unrelated tasks (or all problem rows) at once.
    if (!proved || s.status !== "run" || !/^(run|ausführ|prüf|check|test)\b/i.test(s.text)) return s;
    changed = true;
    return { ...s, status: "ok" as const };
  });
  return changed ? next : null;
}

export function applySetPlan(cur: PlanStep[] | undefined, next: string[], locked = false, kinds?: unknown[]): PlanStep[] | null {
  const steps = next.map((s) => s.trim()).filter((s) => s.length >= 1).slice(0, 10);
  if (steps.length < 2) return null;
  if (locked) return null;
  if (cur?.some((s) => s.status === "ok" || s.status === "run" || s.status === "err")) return null;
  const classified = steps.length === next.length && kinds?.length === next.length && kinds.every(k => typeof k === "string" && /^(read|edit|run|check|service|report)$/.test(k));
  return steps.map((text, i) => ({ ...step(text), ...(classified ? { kind: kinds![i] as PlanStep["kind"] } : {}) }));
}

function step(text: string): PlanStep {
  return { text, status: "todo" };
}
