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

export type AgentJob = {
  id: string;
  status: "run" | "ask" | "paused";
  goal: string;
  rounds: number;
  ask: JobAsk | null;
  at: number;
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

export function askCorrection(ask: JobAsk, choiceId?: string, text?: string): string {
  const want = str(choiceId);
  const choice = ask.choices.find((c) => c.id === want || c.label === want);
  const note = str(text).slice(0, 80);
  const pick = [choice ? `${choice.id}) ${choice.label}` : "", note].filter(Boolean).join(" · ");
  return `Nachfrage „${ask.prompt.slice(0, 72)}“ → ${pick || "ohne Wahl"}`.slice(0, 160);
}

export function newJob(goal: string): AgentJob {
  return {
    id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: "run",
    goal: str(goal).slice(0, 240),
    rounds: 0,
    ask: null,
    at: Date.now(),
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
  if (opts?.revive && status === "run") return null;
  const ask = status === "ask" ? normalizeAsk(o.ask) : null;
  if (opts?.revive && status === "ask" && !ask) return null;
  const goal = str(o.goal).slice(0, 240);
  const id = str(o.id).slice(0, 40) || `job-${Date.now().toString(36)}`;
  const rounds = typeof o.rounds === "number" && Number.isFinite(o.rounds) ? Math.max(0, Math.round(o.rounds)) : 0;
  const at = typeof o.at === "number" && Number.isFinite(o.at) ? o.at : Date.now();
  return { id, status: opts?.revive && status === "ask" ? "ask" : status, goal, rounds, ask, at };
}
