export type InternKind = "js" | "persist" | "board" | "agent" | "preview" | "plugin";
export type HealId = "board-reset" | "agent-abort" | "soft-restart" | "hard-reload" | "preview-reload" | "agent-task" | "none";

export function fingerprint(kind: InternKind, msg: string): string {
  const s = msg
    .replace(/https?:\/\/\S+/g, "URL")
    .replace(/:\d+:\d+/g, ":N")
    .replace(/\b\d+\b/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140)
    .toLowerCase();
  return `${kind}:${s || "leer"}`;
}

export function suggestHeal(fp: string, kind: InternKind): { heal: HealId; auto: boolean } {
  if (kind === "board" || /board\.json|unlesbar|unexpected token|json parse/.test(fp)) {
    return { heal: "board-reset", auto: true };
  }
  if (kind === "agent" || /ohne fortschritt|hängt|budget|tool-runden|abgebrochen/.test(fp)) {
    return { heal: "agent-task", auto: false };
  }
  if (kind === "preview" || /iframe|vorschau|canvas|srcdoc/.test(fp)) {
    return { heal: "preview-reload", auto: false };
  }
  if (kind === "persist" || /quota|idb|indexeddb|localstorage/.test(fp)) {
    return { heal: "soft-restart", auto: false };
  }
  if (kind === "js") {
    return { heal: "agent-task", auto: false };
  }
  return { heal: "none", auto: false };
}

export function internNoise(msg: string): boolean {
  return /resizeobserver|script error\.|chrome-extension:|moz-extension:|anvil-intern|ohne fortschritt|wartet auf das modell|superseded|\bjs timeout\b|^(js )?timeout$|AbortError|The operation was aborted|signal is aborted/i.test(msg);
}
