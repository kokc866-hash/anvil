import type { WorkflowSnapshot } from "./agent-workflow";
import { validWorkflowSnapshot } from "../../electron/workflow-validation.mjs";
export type JobAskChoice = { id: string; label: string };

export type JobAsk = {
  id: string;
  prompt: string;
  why: string;
  choices: JobAskChoice[];
  allowText: boolean;
  recommended?: string;
  blocking: "hard" | "soft";
};

export type JobHumanContext = {
  version: 1;
  project: string;
  request: string;
  corrections: { id: string; text: string }[];
};

export type AgentJob = {
  id: string;
  status: "run" | "ask" | "paused";
  goal: string;
  rounds: number;
  ask: JobAsk | null;
  at: number;
  mode?: "ask" | "agent";
  workflow?: WorkflowSnapshot;
  human?: JobHumanContext;
};

const LETTERS = "ABCDE";

function letter(i: number): string {
  return LETTERS[i] ?? String(i + 1);
}

function str(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function choiceOf(raw: unknown, i: number): JobAskChoice | null {
  if (typeof raw === "string") {
    const label = str(raw).slice(0, 80);
    if (!label) return null;
    return { id: letter(i), label };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = str(o.label ?? o.text ?? o.title ?? o.name).slice(0, 80);
  if (!label) return null;
  const id = str(o.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || letter(i);
  return { id, label };
}

export function parseAsk(args: Record<string, unknown>): { ask: JobAsk } | { error: string } {
  const prompt = str(args.prompt ?? args.question ?? args.text).slice(0, 280);
  if (prompt.length < 4) return { error: "ask_user: prompt too short" };
  const raw = args.choices ?? args.options;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/\n|;/).map((s) => s.trim()).filter(Boolean)
      : [];
  const seen = new Set<string>();
  const choices: JobAskChoice[] = [];
  for (const item of list) {
    const c = choiceOf(item, choices.length);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    choices.push(c);
    if (choices.length >= 5) break;
  }
  const allowText = args.allow_text === true || args.allowText === true || args.allow_text === "true";
  if (!choices.length && !allowText) return { error: "ask_user: need 2–5 choices or allow_text" };
  if (choices.length === 1) return { error: "ask_user: need 2–5 choices or allow_text" };
  const rec = str(args.recommended ?? args.recommend);
  const recommended = rec && choices.some((c) => c.id === rec || c.label === rec)
    ? (choices.find((c) => c.id === rec || c.label === rec)?.id ?? undefined)
    : undefined;
  const blocking = args.blocking === "soft" ? "soft" : "hard";
  const why = str(args.why ?? args.reason).slice(0, 200);
  return {
    ask: {
      id: `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      prompt,
      why,
      choices,
      allowText: Boolean(allowText) || choices.length === 0,
      recommended,
      blocking,
    },
  };
}

export function formatAskAnswer(ask: JobAsk, choiceId?: string, text?: string): string {
  const want = str(choiceId);
  const choice = ask.choices.find((c) => c.id === want || c.label === want);
  const note = str(text).slice(0, 2000);
  const bits = [`Antwort auf: ${ask.prompt}`];
  if (choice) bits.push(`Wahl: ${choice.id}) ${choice.label}`);
  if (note) bits.push(note);
  return bits.join("\n");
}

export function isAskAnswer(text: string): boolean {
  return /^Antwort auf:/i.test(String(text ?? "").trim());
}

/** Question and choice labels come from the model; only the user's extra text can change permissions. */
export function askAnswerHumanText(ask: JobAsk, text: string): string {
  if (!isAskAnswer(text)) return text.trim();
  const lines = text.trim().split("\n");
  if (lines.shift() !== `Antwort auf: ${ask.prompt}`) return "";
  if (lines[0]?.startsWith("Wahl: ")) lines.shift();
  return lines.join("\n").trim();
}

export function normalizeJobHumanContext(value: unknown): JobHumanContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const context = value as JobHumanContext;
  if (context.version !== 1 || typeof context.project !== "string" || !context.project || context.project.length > 4000 ||
      typeof context.request !== "string" || !context.request.trim() || context.request.length > 128000 ||
      !Array.isArray(context.corrections) || context.corrections.length > 256) return;
  const seen = new Set<string>();
  for (const correction of context.corrections) {
    if (!correction || typeof correction.id !== "string" || !/^[-\w:.]{1,120}$/.test(correction.id) || seen.has(correction.id) ||
        typeof correction.text !== "string" || !correction.text.trim() || correction.text.length > 8000) return;
    seen.add(correction.id);
  }
  return { version: 1, project: context.project, request: context.request, corrections: context.corrections.map(({ id, text }) => ({ id, text })) };
}

export function newJobHumanContext(project: string, request: string): JobHumanContext {
  const context = normalizeJobHumanContext({ version: 1, project, request, corrections: [] });
  if (!context) throw Error("Projekt oder Auftrag ist ungültig oder zu lang. Dein Entwurf bleibt erhalten.");
  return context;
}

export function extendJobHumanContext(context: JobHumanContext, text: string, id: string = globalThis.crypto.randomUUID()): JobHumanContext {
  if (!text.trim()) return context;
  const previous = context.corrections.find(correction => correction.id === id);
  if (previous) {
    if (previous.text !== text.trim()) throw Error("Die Kennung der Nutzerkorrektur wurde bereits verwendet.");
    return context;
  }
  const next = normalizeJobHumanContext({ ...context, corrections: [...context.corrections, { id, text: text.trim() }] });
  if (!next) throw Error("Die Nutzerkorrekturen sind zu lang oder zu zahlreich. Dein Entwurf bleibt erhalten.");
  return next;
}

export function resumeJobHumanContext(job: AgentJob, project: string, correction: string): JobHumanContext {
  const existing = normalizeJobHumanContext(job.human);
  if (job.human && !existing) throw Error("Die gespeicherten Nutzeranweisungen sind ungültig. Starte einen neuen Auftrag.");
  if (existing && existing.project !== project) throw Error("Dieser Auftrag gehört zu einem anderen Projekt. Dein Entwurf bleibt erhalten.");
  // Older saved jobs have no full human request. A neutral continuation must not invent permission from their short goal or model history.
  const context = existing ?? newJobHumanContext(project, "Resume the saved task by inspection and reporting. Do not change or repair files.");
  return extendJobHumanContext(context, correction);
}

export function askCorrection(ask: JobAsk, choiceId?: string, text?: string): string {
  const want = str(choiceId);
  const choice = ask.choices.find((c) => c.id === want || c.label === want);
  const note = str(text).slice(0, 80);
  const pick = [choice ? `${choice.id}) ${choice.label}` : "", note].filter(Boolean).join(" · ");
  return `Nachfrage „${ask.prompt.slice(0, 72)}“ → ${pick || "ohne Wahl"}`.slice(0, 160);
}

export function newJob(goal: string, mode: "ask" | "agent" = "agent"): AgentJob {
  return {
    id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: "run",
    goal: str(goal).slice(0, 240),
    rounds: 0,
    ask: null,
    at: Date.now(),
    mode,
  };
}

export function jobKeepsCompanion(job: AgentJob | null | undefined): boolean {
  return Boolean(job && (job.status === "run" || job.status === "ask"));
}

function normalizeAsk(raw: unknown): JobAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = parseAsk(raw as Record<string, unknown>);
  if ("error" in parsed) return null;
  const o = raw as Record<string, unknown>;
  return {
    ...parsed.ask,
    id: str(o.id).slice(0, 40) || parsed.ask.id,
  };
}

export function normalizeJob(raw: unknown, opts?: { revive?: boolean }): AgentJob | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const status = o.status === "ask" || o.status === "paused" || o.status === "run" ? o.status : null;
  if (!status) return null;
  if (opts?.revive && status === "run" && !validWorkflowSnapshot(o.workflow)) return null;
  const ask = status === "ask" ? normalizeAsk(o.ask) : null;
  if (opts?.revive && status === "ask" && !ask) return null;
  const goal = str(o.goal).slice(0, 240);
  const id = str(o.id).slice(0, 40) || `job-${Date.now().toString(36)}`;
  const rounds = typeof o.rounds === "number" && Number.isFinite(o.rounds) ? Math.max(0, Math.round(o.rounds)) : 0;
  const at = typeof o.at === "number" && Number.isFinite(o.at) ? o.at : Date.now();
  const human = normalizeJobHumanContext(o.human);
  return { id, status: opts?.revive && status === "run" ? "paused" : status, goal, rounds, ask, at,
    ...(o.mode === "ask" || o.mode === "agent" ? { mode: o.mode } : {}),
    ...(validWorkflowSnapshot(o.workflow) ? { workflow: o.workflow as WorkflowSnapshot } : {}),
    ...(human ? { human } : {}),
  };
}
