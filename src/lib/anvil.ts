import { applyIntent, resolveIntent, type BrainIntent } from "./brain/tasks";

/** Anvil handelt. Das Hauptmodell denkt. Der lokale Helfer ist optional. */
export type AnvilHand = "app" | "model";

export async function anvilHandle(text: string): Promise<{ hand: AnvilHand; reply?: string }> {
  const it = await Promise.race([
    resolveIntent(text),
    new Promise<BrainIntent>((res) => setTimeout(() => res({ kind: "agent", conf: 0.2 }), 800)),
  ]);
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
