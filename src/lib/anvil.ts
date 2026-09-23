import { captureBrainCommit, captureBrainScope } from "./brain/scope";
import { applyIntent, heuristicIntent, resolveIntent, type BrainIntent } from "./brain/tasks";

/** Anvil handelt. Das Hauptmodell denkt. Der lokale Helfer ist optional. */
export type AnvilHand = "app" | "model";

let prepared: { text: string; intent: BrainIntent; valid: () => boolean } | null = null;
export async function prepareAnvilIntent(text: string) {
  if (prepared?.text === text && prepared.valid()) return;
  const valid = captureBrainCommit("intent");
  if (!valid()) return;
  const intent = await resolveIntent(text);
  if (valid()) prepared = { text, intent, valid: captureBrainScope("intent") };
}

export async function anvilHandle(text: string, context: { hasImages?: boolean } = {}): Promise<{ hand: AnvilHand; reply?: string }> {
  // Text-only shortcuts cannot interpret an attachment, even if its caption
  // looks like a known command or a prepared helper intent.
  if (context.hasImages) return { hand: "model" };
  const it = prepared?.text === text && prepared.valid() ? prepared.intent : heuristicIntent(text);
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
