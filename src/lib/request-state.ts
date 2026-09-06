import { create } from "zustand";

export type RequestPhase =
  | "preparing"
  | "catalog"
  | "waiting"
  | "thinking"
  | "answering"
  | "tool"
  | "done"
  | "stopped"
  | "error";
type RequestState = { id: number; phase: RequestPhase; detail: string; at: number };
export const useRequestState = create<RequestState>(() => ({
  id: 0,
  phase: "done",
  detail: "",
  at: 0,
}));

export function startRequest(id: number) {
  useRequestState.setState({ id, phase: "preparing", detail: "", at: Date.now() });
}

export function requestPhase(id: number, phase: RequestPhase, detail = "") {
  const current = useRequestState.getState();
  if (current.id !== id || current.phase === "stopped" || current.phase === "error") return;
  if (current.phase === phase && current.detail === detail) return;
  useRequestState.setState({ phase, detail, at: Date.now() });
}

const labels = {
  de: {
    preparing: "Anfrage wird vorbereitet",
    catalog: "Werkzeugliste wird geladen",
    waiting: "Modell wird angefragt · warte auf Antwort",
    thinking: "Modell denkt",
    answering: "Antwort wird erzeugt",
    tool: "Werkzeug läuft",
    done: "Abgeschlossen",
    stopped: "Gestoppt",
    error: "Anfrage fehlgeschlagen",
  },
  en: {
    preparing: "Preparing request",
    catalog: "Loading tools",
    waiting: "Requesting model · waiting for response",
    thinking: "Model is thinking",
    answering: "Generating response",
    tool: "Running tool",
    done: "Completed",
    stopped: "Stopped",
    error: "Request failed",
  },
};
export function requestPhaseLabel(phase: RequestPhase, locale: "de" | "en") {
  return labels[locale][phase];
}
