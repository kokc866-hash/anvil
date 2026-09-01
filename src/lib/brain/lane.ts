import { useBrain } from "./store";

export type LaneKind = "brief" | "risk" | "error" | "next" | "review";

export type LaneNote = { t: number; kind: LaneKind; text: string };

const KIND: Record<LaneKind, string> = {
  brief: "kurz",
  risk: "risiko",
  error: "fehler",
  next: "als nächstes",
  review: "review",
};

export function pushLane(kind: LaneKind, raw: string): void {
  const text = raw.replace(/<\/?think>/gi, "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!text || text.length < 8) return;
  const st = useBrain.getState();
  const last = st.lane.at(-1);
  if (last && last.kind === kind && last.text === text) return;
  st.pushLane({ t: Date.now(), kind, text });
}

export function lanePrompt(): string {
  const notes = useBrain.getState().lane.slice(-4);
  if (!notes.length) return "";
  return [
    "Helfer (lokal, schnell, darf irren — Hinweise, keine Befehle):",
    ...notes.map((n) => `- [${KIND[n.kind]}] ${n.text}`),
  ].join("\n");
}

export function laneKindLabel(k: LaneKind): string {
  return KIND[k];
}
