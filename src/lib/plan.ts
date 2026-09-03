import type { PlanStep } from "@/store/ide";

export function guessPlan(text: string): PlanStep[] {
  const numbered = text
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 2 && l.length < 72);
  if (numbered.length >= 3) return numbered.slice(0, 7).map((t) => step(t));
  if (/godot|unity|unreal|bevy/i.test(text)) return ["Lesen", "Ändern", "Engine", "Prüfen"].map(step);
  if (/app|ui|formular|seite|html/i.test(text)) return ["Verstehen", "Bauen", "Run", "Prüfen"].map(step);
  if (/refactor|aufräum/i.test(text)) return ["Lesen", "Refactor", "Prüfen"].map(step);
  return ["Verstehen", "Ändern", "Run", "Prüfen"].map(step);
}

function mark(next: PlanStep[], pred: (s: PlanStep) => boolean, status: PlanStep["status"]) {
  let i = -1;
  if (status === "ok") {
    i = next.findIndex((s) => s.status === "run" && pred(s));
    if (i < 0) i = next.findIndex((s) => s.status === "todo" && pred(s));
  } else if (status === "err") {
    i = next.findIndex((s) => (s.status === "run" || s.status === "todo") && pred(s));
  } else {
    i = next.findIndex((s) => s.status === "todo" && pred(s));
  }
  if (i < 0) return;
  if (status === "ok") {
    const earlier = next.slice(0, i).some((s) => s.status === "todo" || s.status === "run");
    if (earlier) return;
  }
  next[i] = { ...next[i], status };
}

function apply(name: string, next: PlanStep[], status: PlanStep["status"]) {
  if (/write|edit|append|delete|rename|mkdir|format/.test(name))
    mark(next, (s) => /änder|schreib|edit|datei|bau|überarbeit|layout|farb|ui|interakt|style|css|html/i.test(s.text), status);
  else if (/engine/.test(name)) mark(next, (s) => /engine/i.test(s.text), status);
  else if (/see_run|open_preview|test/.test(name))
    mark(next, (s) => /prüf|test|see|bild|vorschau|preview|fehler|run/i.test(s.text), status);
  else if (/run_file|shell|play/.test(name))
    mark(next, (s) => /run|ausführ|play/i.test(s.text) && !/^(prüf|test)\b/i.test(s.text), status);
  else if (/read|list|grep/.test(name))
    mark(next, (s) => /versteh|les|such|referenz|bestehend/i.test(s.text), status);
}

export function planStart(name: string, plan: PlanStep[] | undefined): PlanStep[] | null {
  if (!plan?.length || name === "set_plan") return null;
  const next = plan.map((s) => ({ ...s, status: s.status === "run" ? ("todo" as const) : s.status }));
  apply(name, next, "run");
  return next;
}

export function planFromTool(name: string, plan: PlanStep[] | undefined, failed = false): PlanStep[] | null {
  if (!plan?.length) return null;
  if (name === "set_plan") return null;
  const next = plan.map((s) => ({ ...s }));
  apply(name, next, failed ? "err" : "ok");
  return next;
}

/** Runde vorbei: Rest-To-dos schließen. Bei Fehler nur den laufenden Schritt. */
export function planFinish(plan: PlanStep[] | undefined, failed = false): PlanStep[] | null {
  if (!plan?.length) return null;
  let changed = false;
  const next = plan.map((s) => {
    if (s.status === "ok" || s.status === "err") return s;
    changed = true;
    if (failed) return s.status === "run" ? { ...s, status: "err" as const } : s;
    return { ...s, status: "ok" as const };
  });
  return changed ? next : null;
}

function step(text: string): PlanStep {
  return { text, status: "todo" };
}
