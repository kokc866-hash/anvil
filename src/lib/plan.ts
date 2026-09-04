import type { PlanStep } from "@/store/ide";

type Locale = "de" | "en";

function pack(locale: Locale, de: string[], en: string[]): PlanStep[] {
  return (locale === "en" ? en : de).map(step);
}

export function guessPlan(text: string, locale: Locale = "de"): PlanStep[] {
  const numbered = text
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 2 && l.length < 72);
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
    i = next.findIndex((s) => s.status === "todo" && pred(s));
  }
  if (i < 0) return;
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

function apply(name: string, next: PlanStep[], status: PlanStep["status"]) {
  if (/mcp/.test(name)) mark(next, (s) => /mcp|fremd|fläche|surface|engine|tool/i.test(s.text), status);
  else if (/git_/.test(name)) mark(next, (s) => /git|commit|push/i.test(s.text), status);
  else if (/skill_/.test(name)) mark(next, (s) => /skill|hilfe|help/i.test(s.text), status);
  else if (/write|edit|append|delete|rename|mkdir|format/.test(name))
    mark(next, (s) => /änder|schreib|edit|write|datei|file|bau|build|überarbeit|layout|farb|ui|interakt|style|css|html/i.test(s.text), status);
  else if (/engine/.test(name)) mark(next, (s) => /engine/i.test(s.text), status);
  else if (/see_run|open_preview|test/.test(name))
    mark(next, (s) => /prüf|test|see|check|bild|vorschau|preview|fehler|run/i.test(s.text), status);
  else if (/run_file|shell|play/.test(name))
    mark(next, (s) => /run|ausführ|play|shell/i.test(s.text) && !/^(prüf|test|check)\b/i.test(s.text), status);
  else if (/read|list|grep/.test(name))
    mark(next, (s) => /versteh|understand|les|read|such|search|referenz|bestehend/i.test(s.text), status);
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

/** Runde vorbei: Rest nur schließen wenn Beweis da. Bei Fehler nur den laufenden Schritt. */
export function planFinish(plan: PlanStep[] | undefined, failed = false, proved = false): PlanStep[] | null {
  if (!plan?.length) return null;
  let changed = false;
  const next = plan.map((s) => {
    if (s.status === "ok" || s.status === "err") return s;
    if (failed) {
      changed = true;
      return s.status === "run" ? { ...s, status: "err" as const } : s;
    }
    if (!proved) return s;
    changed = true;
    return { ...s, status: "ok" as const };
  });
  return changed ? next : null;
}

function step(text: string): PlanStep {
  return { text, status: "todo" };
}
