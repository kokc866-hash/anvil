export const INTERACTION_CHECKS_PATH = ".anvil/interaction-checks.json";
export const INTERACTION_RESULTS_PATH = ".anvil/interaction-results.json";
export type InteractionAction = "click" | "fill" | "reload" | "visible" | "text" | "value" | "count";
export type InteractionStep = { action: InteractionAction; selector?: string; value?: string };
export type InteractionScenario = { id: string; name: string; entry: string; steps: InteractionStep[] };
export type InteractionResult = {
  id: string; scenarioId: string; revision: string; scenarioRevision: string;
  status: "passed" | "failed" | "open"; startedAt: string; durationMs: number;
  steps: { index: number; status: "passed" | "failed" | "open"; message: string }[];
  message: string;
};
export type InteractionPayload = { id: string; scenario: InteractionScenario; files: Record<string, string>; revision: string; scenarioRevision: string };
export type InteractionNative = {
  interactionCheckRun?: (payload: InteractionPayload) => Promise<InteractionResult>;
  interactionCheckCancel?: (id: string) => Promise<boolean>;
};
export function interactionNative(): InteractionNative | null {
  return typeof window === "undefined" ? null : (window as unknown as { anvilNative?: InteractionNative }).anvilNative ?? null;
}
export function parseInteractionScenarios(raw: string | undefined): InteractionScenario[] {
  if (!raw?.trim()) return [];
  const doc = JSON.parse(raw);
  if (doc?.version !== 1 || !Array.isArray(doc.scenarios) || doc.scenarios.length > 40) throw new Error("Bedienprüfungen: Version 1 mit höchstens 40 Prüfungen erwartet.");
  const ids = new Set<string>();
  return doc.scenarios.map((scenario: InteractionScenario) => {
    if (!scenario || typeof scenario.id !== "string" || !scenario.id || ids.has(scenario.id)) throw new Error("Jede Prüfung benötigt eine eigene Kennung.");
    ids.add(scenario.id);
    validateInteractionScenario(scenario);
    return scenario;
  });
}
export function validateInteractionScenario(s: InteractionScenario): void {
  if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 160) throw new Error("Name der Prüfung fehlt oder ist zu lang.");
  if (typeof s.entry !== "string" || !/\.html?$/i.test(s.entry) || /(^\/|\\|(^|\/)\.\.?(\/|$)|:)/.test(s.entry)) throw new Error("Eine HTML-Datei im Projekt als Startdatei wählen.");
  if (!Array.isArray(s.steps) || !s.steps.length || s.steps.length > 40) throw new Error("Eine Prüfung braucht 1 bis 40 Schritte.");
  if (!s.steps.some(step => ["visible", "text", "value", "count"].includes(step.action))) throw new Error("Mindestens eine Erwartung hinzufügen, etwa Text prüfen.");
  for (const step of s.steps) {
    if (!step || !["click", "fill", "reload", "visible", "text", "value", "count"].includes(step.action)) throw new Error("Unbekannter Prüfschritt.");
    if (step.action !== "reload" && (typeof step.selector !== "string" || !step.selector.trim() || step.selector.length > 500)) throw new Error("Jeder Schritt außer Neuladen braucht einen CSS-Selektor.");
    if (["fill", "text", "value", "count"].includes(step.action) && (typeof step.value !== "string" || step.value.length > 4000)) throw new Error("Wert oder Erwartung fehlt oder ist zu lang.");
    if (step.action === "count" && !/^(0|[1-9]\d{0,4})$/.test(step.value!)) throw new Error("Anzahl muss eine ganze Zahl von 0 bis 99999 sein.");
  }
}
export function interactionSnapshot(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !path.startsWith(".anvil/")).sort(([a], [b]) => a.localeCompare(b)));
}
export async function interactionRevision(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
export function interactionResultCurrent(result: InteractionResult | undefined, revision: string, scenarioRevision: string): boolean {
  return Boolean(result && result.revision === revision && result.scenarioRevision === scenarioRevision);
}
