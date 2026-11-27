import type { PlanStep } from "@/store/ide";
import { parseTestCommand } from "./test-parse.ts";
import { toolResultFailed, toolResultPending } from "./agent-evidence.ts";
import { agentTaskPolicy, steeredTaskPolicy } from "./agent-task-policy.ts";
import {taskCorrectionBody} from './task-correction.ts';
import { automaticFileStep, isResponseOnlyStep, nativeFileActionMatches, planFileTargets, planOperationPaths, planRequiredKinds, planTargetMatches, workspaceFileOperation } from "./plan-targets.ts";
import { MAX_PLAN_STEPS } from './plan-limits.ts';
import { withPlanStatus } from './plan-status.ts';
import { previewInteractionRequest,previewObservationEvidence } from './preview-task.ts';

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
  if (locked) return false;
  if (who === "helper") return true;
  if (who === "auto") return !hasPlan && !locked;
  return false;
}

export function planAgentMayReplace(who: PlanWho, locked: boolean): boolean {
  if (who === "anvil" || who === "helper") return false;
  if (who === "agent") return !locked;
  return !locked;
}

export function planFromAsk(text: string): boolean {
  return numberedSteps(text).length >= 2;
}

function numberedSteps(text: string): string[] {
  const lines = String(text || "").split("\n");
  const numbered = lines.flatMap(line => /^\s*\d+[.)]\s+(.+)$/.exec(line)?.slice(1) || []);
  // A later "Vorgehen" bullet list describes how to do the numbered task; it
  // must not displace explicit requirements from the starting checklist.
  return (numbered.length >= 2 ? numbered : lines
    .flatMap((line) => {
      const match = /^\s*(?:\d+[.)]|[-*]\s*(?:\[[ xX]\])?)\s+(.+)$/.exec(line);
      return match ? [match[1].trim()] : [];
    }))
    .filter((l) => l.length > 2 && l.length <= 1000);
}

const genericLabels = new Set([
  "Auftrag und Projekt verstehen", "Angefragte Änderungen umsetzen", "Geänderte Funktionen prüfen",
  "Angefragte Dienstaktion ausführen", "Spielablauf und angefragtes Ziel prüfen",
  "Understand the task and project", "Implement the requested changes", "Check the changed behavior",
  "Carry out the requested service action", "Check gameplay and the requested goal",
  "Lesen", "Ändern", "Engine", "Prüfen", "MCP", "Commit", "Verstehen", "Bauen", "Run", "Refactor",
  "Read", "Edit", "Check", "Understand", "Build",
  "Angefragte Projektinformationen prüfen", "Angefragtes Verhalten prüfen", "Angefragte Ausführung durchführen", "Ergebnis und Grenzen berichten",
  "Inspect the requested project information", "Check the requested behavior", "Carry out the requested execution", "Report findings and limits",
  "Angeforderte Bedienaktionen mit play prüfen und ihre erwarteten Ergebnisse bestätigen", "Geprüfte Aktionen, Ergebnisse und offene Prüfpunkte berichten",
  "Use play to test the requested controls and confirm their expected results", "Report tested actions, results and remaining limits",
].map(text => text.toLocaleLowerCase("de")));

function genericPlan(plan: readonly Pick<PlanStep, "text">[]): boolean {
  return plan.length >= 2 && plan.length <= 4 && plan.every(s => genericLabels.has(s.text.trim().toLocaleLowerCase("de")));
}

/** Only a short continuation can inherit the immediately preceding task in this chat. */
export function isPlanContinuation(text: string): boolean {
  return /^(?:(?:ok(?:ay)?|ja|yes)[,! .]+)?(?:(?:bitte|please)\s+)?(?:(?:mach(?:e)?\s+(?:bitte\s+)?)?weiter(?:machen)?|fortsetzen|setze\s+(?:bitte\s+)?fort|continue|resume|go\s+on)(?:\s+(?:bitte|please))?[.! ]*$/i.test(text.trim());
}

/** A retest is fresh work, never a request to replay an old native job. */
export function isPlanRetest(text: string): boolean {
  return /^(?:(?:ok(?:ay)?|ja|yes)[,! .]+)?(?:(?:bitte|please)\s+)?(?:noch\s*(?:einmal|mal)|nochmals|erneut\s+testen|noch\s*(?:einmal|mal)\s+testen|test(?:e)?\s+(?:noch\s*(?:einmal|mal)|erneut)|test\s+again|try\s+again|retest)(?:\s+(?:bitte|please))?[.! ]*$/i.test(text.trim());
}

function additivePlanCorrection(text: string): boolean {
  return taskCorrectionBody(text)!==undefined;
}

type PlanHistoryMessage = { role: string; content: string; voice?: string; plan?: PlanStep[]; planLocked?: boolean };
export type RequestPlanContext = { text: string; plan?: PlanStep[]; locked: boolean; continued: boolean; humanPrompt?:string; humanCorrections?:string[] };

/** Resolve only the last contiguous task block, never a search across old goals.
 * Callers supply the current workspace's captured chat. This is planning context,
 * not authorization to replay old actions or replace the active human request. */
export function requestPlanContext(text: string, chat: readonly PlanHistoryMessage[]): RequestPlanContext {
  const fresh: RequestPlanContext = { text, locked: false, continued: false };
  const retest = isPlanRetest(text), additive = additivePlanCorrection(text);
  if (!isPlanContinuation(text) && !retest && !additive) return fresh;
  const turns = chat.slice(-64).filter(m => !(m.role === "assistant" && m.voice === "helper"));
  let index = turns.length - 1;
  // Foreground callers may already have appended this turn and its empty reply.
  if (turns[index]?.role === "assistant" && !turns[index].content.trim() && !turns[index].plan?.length) index--;
  if (turns[index]?.role === "user" && turns[index].content.trim() === text.trim()) index--;
  const latest = turns[index];
  if (latest?.role !== "assistant" || !latest.plan?.length) return fresh;
  let plan = latest.plan.map(s => ({ ...s }));
  let locked = latest.planLocked === true;
  let objective = text;
  const additions: string[] = additive ? [text] : [];
  while (index >= 0) {
    // Tool/system rows cannot create a different human goal, but an intervening
    // assistant answer without a task plan is a boundary, not a cue to search on.
    index--;
    while (index >= 0 && turns[index].role !== "user") index--;
    if (index < 0) break;
    const request = turns[index].content.trim();
    if (!isPlanContinuation(request) && !isPlanRetest(request) && !additivePlanCorrection(request)) { objective = request || text; break; }
    if (additivePlanCorrection(request)) additions.unshift(request);
    index--;
    const previous = turns[index];
    if (previous?.role !== "assistant" || !previous.plan?.length) break;
    if (genericPlan(plan) && !genericPlan(previous.plan) && !locked && !plan.some(s => s.completedBy === "user")) {
      plan = previous.plan.map(s => ({ ...s }));
      locked = previous.planLocked === true;
    }
  }
  if (objective === text) return fresh;
  const humanPrompt=objective;
  const humanCorrections=[...additions];
  if (additions.length) objective = [objective, ...additions].join('\n\n');
  if (retest) plan = plan.map(s => ({ ...s, status: 'todo', completedBy: undefined }));
  else if (additive) plan = plan.map(s => s.kind === 'report' ? { ...s, status: 'todo', completedBy: undefined } : s);
  const explicit = numberedSteps(objective);
  if (!locked && explicit.length >= 2 && genericPlan(plan) && !plan.some(s => s.completedBy === "user")) {
    // Phase-level "done" cannot certify individual requirements. Keep the old
    // receipts in the job; the model reconciles these concrete entries against
    // those receipts rather than replaying the actual work.
    plan = explicit.slice(0, MAX_PLAN_STEPS).map(step);
  }
  if(additive){
    const body=taskCorrectionBody(text)!;
    const policy=humanCorrections.reduce((previous,correction)=>steeredTaskPolicy(previous,correction),agentTaskPolicy(humanPrompt));
    const verb=body.replace(/^(?:(?:und|auch|zusätzlich|and|also|additionally)\s+)?(?:(?:bitte|please)\s+)?/i,'');
    const reportOnly=/^(?:bericht\w*|report\w*|erklär\w*|explain\w*|beschreib\w*|describe\w*)\b/i.test(verb);
    const checkOnly=/^(?:prüf\w*|test\w*|check\w*|verify\w*|beobacht\w*|observe\w*)\b/i.test(verb);
    if(!locked&&genericPlan(plan)&&!plan.some(s=>s.completedBy==='user'))plan=reportOnly?initialAgentPlan(humanPrompt):[];
    const kind:PlanStep['kind']=reportOnly?'report':policy.allowChanges&&!checkOnly?'edit':'check';
    const label=body.replace(/\s+/g,' ').trim().slice(0,700);
    const add=(text:string,kind:PlanStep['kind'])=>{
      const matching=plan.findIndex(s=>s.text===text);
      if(matching>=0){plan=plan.map((s,i)=>i===matching?{...s,status:'todo',completedBy:undefined}:s);return;}
      if(plan.length>=MAX_PLAN_STEPS)throw Error('Die Aufgabenliste ist voll. Die neue Anforderung wurde nicht verworfen; starte dafür einen eigenen Auftrag.');
      const report=plan.findIndex(s=>s.kind==='report');
      plan.splice(report<0?plan.length:report,0,{text,kind,status:'todo'});
    };
    add(label,kind);
    if(kind==='edit')add(`Geänderte Funktion prüfen: ${label}`,'check');
    if(!plan.some(s=>s.kind==='report'))add('Prüfergebnisse und offene Punkte berichten','report');
  }
  return { text: objective, plan, locked: locked || planFromAsk(objective), continued: true, humanPrompt, humanCorrections };
}

export function guessPlan(text: string, locale: Locale = "de"): PlanStep[] {
  const numbered = numberedSteps(text);
  if (numbered.length >= 2) return numbered.slice(0, MAX_PLAN_STEPS).map((t) => step(t));
  if (/godot|unity|unreal|bevy/i.test(text)) return pack(locale, ["Lesen", "Ändern", "Engine", "Prüfen"], ["Read", "Edit", "Engine", "Check"]);
  if (/mcp|ziva|fläche|surface/i.test(text)) return pack(locale, ["Lesen", "MCP", "Prüfen"], ["Read", "MCP", "Check"]);
  if (/git|commit|push/i.test(text)) return pack(locale, ["Lesen", "Ändern", "Commit"], ["Read", "Edit", "Commit"]);
  if (/app|ui|formular|seite|html/i.test(text)) return pack(locale, ["Verstehen", "Bauen", "Run", "Prüfen"], ["Understand", "Build", "Run", "Check"]);
  if (/refactor|aufräum/i.test(text)) return pack(locale, ["Lesen", "Refactor", "Prüfen"], ["Read", "Refactor", "Check"]);
  return pack(locale, ["Verstehen", "Ändern", "Run", "Prüfen"], ["Understand", "Edit", "Run", "Check"]);
}

/** A visible starting point belongs to this request, even when a model omits
 * set_plan. Existing progress and the user's own list remain authoritative.
 * The helper gets its first opportunity; its caller supplies a fallback only
 * after that attempt has completed. No step is considered done here. */
export function initialAgentPlan(text: string, current?: PlanStep[], owner: PlanWho = "auto", locale: Locale = "de"): PlanStep[] {
  if (current?.length) {
    const explicit = numberedSteps(text);
    if (explicit.length >= 2 && genericPlan(current) && current.every(s => s.status === "todo"))
      return explicit.slice(0, MAX_PLAN_STEPS).map(step);
    // Older builds silently truncated a user's list after ten entries. Repair
    // only that exact, wholly unconfirmed prefix; keep custom lists/progress.
    if (current.length === 10 && explicit.length > 10 && explicit.length <= MAX_PLAN_STEPS && current.every((s, i) => s.status === 'todo' && s.text === explicit[i])) {
      return [...current.map(s => ({ ...s })), ...explicit.slice(current.length).map(step)];
    }
    return current.map(s => ({ ...s }));
  }
  if (!text.trim()) return [];
  const policy = agentTaskPolicy(text);
  const correction=taskCorrectionBody(text);
  if(correction&&!policy.allowChanges){
    const body=correction.replace(/^(?:(?:und|auch|zusätzlich|and|also|additionally)\s+)?(?:(?:bitte|please)\s+)?/i,'');
    if(/^(?:bericht\w*|report\w*|erklär\w*|explain\w*|beschreib\w*|describe\w*)\b/i.test(body))return [{text:correction,kind:'report',status:'todo'}];
    return [{text:correction,kind:'check',status:'todo'},{text:locale==='en'?'Report tested results and limits':'Prüfergebnisse und offene Punkte berichten',kind:'report',status:'todo'}];
  }
  if (!policy.allowChanges && !policy.negativeTest && previewInteractionRequest(text)) {
    const checks = text.split('\n').flatMap(line => /^\s*[-*]\s+(.{3,700}:.+)$/.exec(line)?.slice(1) || []);
    if (checks.length >= 2) return [
      ...checks.slice(0, MAX_PLAN_STEPS - 1).map(text => ({ text: `${locale === 'en' ? 'Check with play' : 'Mit play prüfen'}: ${text}`, kind: 'check' as const, status: 'todo' as const })),
      { text: locale === 'en' ? 'Report results and remaining limits' : 'Prüfergebnisse und offene Punkte berichten', kind: 'report', status: 'todo' },
    ];
  }
  if (planFromAsk(text)) return guessPlan(text, locale);
  if (owner === "helper") return [];
  // A direct answer, explanation or image description needs no invented task.
  if (!policy.allowChanges && /^(?:(?:bitte|please)\s+)?(?:(?:be)?antwort\w*|answer|respond|erklär\w*|beschreib\w*|explain\w*|describ\w*|was\s+siehst|what\s+(?:do|can)\s+you\s+see)\b/i.test(text.trim())) return [];
  if (!policy.allowChanges && !policy.negativeTest && previewInteractionRequest(text)) return [
    { text: locale === 'en' ? 'Use play to test the requested controls and confirm their expected results' : 'Angeforderte Bedienaktionen mit play prüfen und ihre erwarteten Ergebnisse bestätigen', kind: 'check', status: 'todo' },
    { text: locale === 'en' ? 'Report tested actions, results and remaining limits' : 'Geprüfte Aktionen, Ergebnisse und offene Prüfpunkte berichten', kind: 'report', status: 'todo' },
  ];
  const checkRequest = /^(?:bitte\s+)?(?:prüf\w*|test\w*|check\w*|verify\w*)\b/i.test(text.trim());
  const execution = /^(?:bitte\s+)?(?:run|execute|launch|starte|führ\w*\s+aus)\b/i.test(text.trim())
    || policy.negativeTest && /\.(?:html?|[cm]?[jt]sx?|py|go|rs|c|cpp|cs|java|rb|php|exe)\b/i.test(text);
  if (!policy.allowChanges) {
    const kind: PlanStep["kind"] = execution ? "run" : checkRequest && !policy.negativeTest ? "check" : "read";
    const label = locale === "en"
      ? kind === "run" ? "Carry out the requested execution" : kind === "check" ? "Check the requested behavior" : "Inspect the requested project information"
      : kind === "run" ? "Angefragte Ausführung durchführen" : kind === "check" ? "Angefragtes Verhalten prüfen" : "Angefragte Projektinformationen prüfen";
    return [{text:label,kind,status:"todo"},{text:locale === "en" ? "Report findings and limits" : "Ergebnis und Grenzen berichten",kind:"report",status:"todo"}];
  }
  const game = /spiel|game|jump|held|level|gegner/i.test(text);
  const service = /\bmcp\b|\bdienst|\bservice/i.test(text);
  const goal = text.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  const objective = goal.length > 700 ? `${goal.slice(0, 690).replace(/\s+\S*$/, "")} …` : goal;
  const labels = locale === "en"
    ? ["Understand the task and project", objective, game ? "Check gameplay and the requested goal" : "Check the changed behavior"]
    : ["Auftrag und Projekt verstehen", objective, game ? "Spielablauf und angefragtes Ziel prüfen" : "Geänderte Funktionen prüfen"];
  const kinds: PlanStep["kind"][] = ["read", service ? "service" : "edit", "check"];
  return labels.map((text, i) => ({ text, kind: kinds[i], status: "todo" }));
}

export function visibleAgentPlan(chat: { id: string; role: string; plan?: PlanStep[] }[], forced?: PlanStep[], msgId?: string): PlanStep[] | undefined {
  if (msgId) return chat.find(message => message.id === msgId)?.plan ?? forced;
  if (forced) return forced;
  for (let i = chat.length - 1; i >= 0; i--) if (chat[i].role === "assistant") return chat[i].plan;
  return undefined;
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
    next[i] = withPlanStatus(next[i], status, "agent");
    return;
  }
  if (status === "ok") {
    const earlier = next.slice(0, i).some((s) => s.status === "todo" || s.status === "run");
    if (earlier) return;
  }
  next[i] = withPlanStatus(next[i], status, "agent");
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
  if (operation === "execute_blender_code") return explicit;
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
const skillAsInstrument = /\b(?:mit|mithilfe(?:[ \t]+von)?|using|with)[ \t]+(?:[\p{L}\p{N}_-]+[ \t]+(?:und|and)[ \t]+)?(?:(?:dem|der|des|einem|einer|eines|the|a|an)[ \t]+)?[\p{L}\p{N}_-]+(?:[ \t]+|-)skills?\b/giu;

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
  // Saving a scene with a named skill is work on the scene. It does not ask to save the skill.
  if (/\bskills?\b|fertigkeit/i.test(text.replace(skillAsInstrument, " "))) {
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
  if (/^(write_file|edit_file|append_file)$/.test(name) && next.some(s => s.kind === "report" && planFileTargets(s.text).length)) {
    const paths = planOperationPaths(args);
    mark(next, s => s.kind === "report" && planFileTargets(s.text).some(target => paths.some(path => planTargetMatches(target, path))), status);
    return;
  }
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
  return next.map((s, i) => s.status !== plan[i].status && !operationTargetMatches(plan[i], name, args) ? { ...plan[i] } : s);
}

function operationTargetMatches(step: PlanStep, name: string, args: ToolArgs): boolean {
  if (!nativeFileActionMatches(step.text, name)) return false;
  const targets = planFileTargets(step.text), paths = planOperationPaths(args);
  if (name === "rename" && targets.length >= 2)
    return typeof args.from === "string" && typeof args.to === "string" && planTargetMatches(targets[0], args.from) && planTargetMatches(targets.at(-1)!, args.to);
  return !targets.length || !workspaceFileOperation(name) || targets.some(target => paths.some(path => planTargetMatches(target, path)));
}

function completedOperation(step: PlanStep, name: string, args: ToolArgs, result: unknown, explicit: boolean): boolean {
  if (!operationTargetMatches(step, name, args)) return false;
  const row = result && typeof result === "object" ? result as ToolArgs : {};
  if (toolResultFailed(row) || row.truncated || row.already_executed || row.pending) return false;
  const checking=step.kind==='check'||!step.kind&&checkStep(step.text);
  // A browser assertion can prove only the step whose expectations it covers.
  // PlanProgress matches step-specific receipts for explicit attribution.
  if (checking && name === 'play' && (!explicit || row.functionalChecks !== true)) return false;
  if(checking&&(name==='see_run'||name==='run_file'&&/\.html?$/i.test(String(args.path||'')))&&!previewObservationEvidence(step.text,Boolean(row.image||row.frame)))return false;
  if (/^(write_file|edit_file|append_file|delete_file|rename|mkdir|format_file)$/.test(name) && row.ok !== true) return false;
  if (toolResultPending(row)) {
    const launch = step.kind === "run" || !step.kind && runStep(step.text);
    const editor = name === "engine_run" && /^(editor|play)$/.test(String(args.action));
    const browser = name === "run_file" && /\.html?$/i.test(String(args.path)) && /^(render|ready|preview)$/.test(String(row.stage));
    if (!launch || row.ok !== true || !editor && !browser) return false;
  }
  if (knowledgeTools.has(name)) return true;
  if (explicit) return true;
  const targets = planFileTargets(step.text);
  if (planRequiredKinds(step).length > 1 || targets.length > 1) return false;
  if (/^(write_file|edit_file|append_file|delete_file|rename|mkdir|format_file)$/.test(name))
    return Boolean(result && typeof result === "object") && automaticFileStep(step);
  // Unbound captures cannot prove the requested file was checked.
  if (targets.length && /^(see_run|play)$/.test(name)) return false;
  return true;
}

/** Explicit attribution is used only by PlanProgress after validating real evidence IDs. */
export function planFromTool(name: string, plan: PlanStep[] | undefined, failed = false, args: ToolArgs = {}, result?: unknown, explicit = false): PlanStep[] | null {
  if (!plan?.length) return null;
  if (name === "set_plan") return null;
  const next = plan.map((s) => ({ ...s }));
  const row = result && typeof result === "object" ? result as ToolArgs : {};
  apply(name, next, failed || toolResultFailed(row) ? "err" : "ok", args, result);
  return next.map((s, i) => s.status !== plan[i].status && (!operationTargetMatches(plan[i], name, args)
    || s.status === "ok" && !completedOperation(plan[i], name, args, result, explicit)) ? { ...plan[i] } : s);
}

/** Runde vorbei: Rest nur schließen wenn Beweis da. Bei Fehler nur den laufenden Schritt. */
export function planFinish(plan: PlanStep[] | undefined, failed = false, proved = false, delivered = false): PlanStep[] | null {
  // Kept for call compatibility; a whole-job success is not a per-step receipt.
  void proved;
  if (!plan?.length) return null;
  let changed = false;
  const next = plan.map((s) => {
    if (s.status === "ok" || s.status === "err") return s;
    if (failed) {
      changed = true;
      return s.status === "run" ? { ...s, status: "err" as const } : s;
    }
    if (delivered && isResponseOnlyStep(s)) {
      changed = true;
      return withPlanStatus(s, "ok", "agent");
    }
    return s;
  });
  return changed ? next : null;
}

export function applySetPlan(cur: PlanStep[] | undefined, next: string[], locked = false, kinds?: unknown[]): PlanStep[] | null {
  const steps = next.map((s) => s.trim()).filter((s) => s.length >= 1).slice(0, MAX_PLAN_STEPS);
  if (steps.length < 2) return null;
  if (locked) return null;
  if (cur?.length && !genericPlan(cur) && genericPlan(steps.map(text => ({ text })))) return null;
  if (cur?.some((s) => s.status === "ok" || s.status === "run" || s.status === "err")) return null;
  const classified = steps.length === next.length && kinds?.length === next.length && kinds.every(k => typeof k === "string" && /^(read|edit|run|check|service|report)$/.test(k));
  return steps.map((text, i) => ({ ...step(text), ...(classified ? { kind: kinds![i] as PlanStep["kind"] } : {}) }));
}

function step(text: string): PlanStep {
  return { text, status: "todo" };
}
