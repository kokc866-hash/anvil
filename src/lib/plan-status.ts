import type { PlanStep } from "../store/ide-types.ts";

/** Completion provenance records who ticked a step, not an extra correctness verdict. */
export function withPlanStatus(step: PlanStep, status: PlanStep["status"], by?: PlanStep["completedBy"]): PlanStep {
  const next = { ...step, status };
  delete next.completedBy;
  if (status === "ok" && by) next.completedBy = by;
  return next;
}

export function planCompletionTitle(step: PlanStep, locale: "de" | "en" = "de"): string | undefined {
  if (step.status !== "ok") return undefined;
  if (step.completedBy === "user") return locale === "en" ? "Marked complete manually." : "Manuell als erledigt markiert.";
  if (step.completedBy === "agent") return locale === "en" ? "Marked complete by the agent from its recorded results." : "Vom Agenten anhand seiner protokollierten Ergebnisse abgehakt.";
  return locale === "en" ? "The source of this completion mark was not recorded." : "Die Herkunft dieser Markierung wurde nicht gespeichert.";
}
