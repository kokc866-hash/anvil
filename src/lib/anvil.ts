import { applyIntent, heuristicIntent, resolveIntent, type BrainIntent } from "./brain/tasks";

/** Anvil handelt. Das Hauptmodell denkt. Der lokale Helfer ist optional. */
export type AnvilHand = "app" | "model";

let prepared: { text: string; intent: BrainIntent } | null = null;
let preparing = false;
export async function prepareAnvilIntent(text: string) {
  if (preparing || prepared?.text === text) return;
  preparing = true;
  try { prepared = { text, intent: await resolveIntent(text) }; }
  finally { preparing = false; }
}

export async function anvilHandle(text: string): Promise<{ hand: AnvilHand; reply?: string }> {
  const it = prepared?.text === text ? prepared.intent : heuristicIntent(text);
  if (it.kind !== "agent" && it.conf >= 0.85) {
    const reply = applyIntent(it);
    if (reply) return { hand: "app", reply };
  }
  return { hand: "model" };
}

export const ANVIL_ROLES = {
  app: "Anvil handelt: Dateien, Run, Git, Debug, Speicher, UI.",
  model: "Hauptmodell denkt und schreibt. Einstellungen → Agent.",
  helper: "Lokaler Helfer (optional): Kurzbefehl, Titel, Commit-Zeile. Kein Code, kein Ask-Modus.",
} as const;
