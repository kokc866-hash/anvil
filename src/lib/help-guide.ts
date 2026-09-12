import { create } from "zustand";

export const useHelpTour = create<{ step: number | null; start: (step?: number) => void; stop: () => void }>(set => ({
  step: null,
  start: (step = 0) => set({ step }),
  stop: () => set({ step: null }),
}));

export const HELP_STEPS = [
  { id: "files", de: "Dein Projekt", en: "Your project", bodyDe: "Öffne hier deinen Projektordner und wähle eine Datei. Du kannst Dateien auch ohne KI ansehen und bearbeiten.", bodyEn: "Open your project folder here and choose a file. You can view and edit files without AI." },
  { id: "agent", de: "Mit KI arbeiten", en: "Work with AI", bodyDe: "Hier öffnest du den Chat. Wähle Fragen zum Verstehen oder Agent für Änderungen. Eine Nachricht wird erst mit Senden abgeschickt.", bodyEn: "Open chat here. Choose Ask to understand or Agent for changes. A message only goes out when you send it." },
  { id: "modes", fallback: "agent", de: "Fragen oder ändern", en: "Ask or change", bodyDe: "Fragen untersucht ohne schreibende Projektwerkzeuge. Agent kann Dateien ändern und Werkzeuge ausführen. Der gewählte Modus bleibt für einen Auftrag erhalten, auch in der Warteschlange.", bodyEn: "Ask investigates without project-writing tools. Agent can edit files and run tools. Each task keeps its chosen mode, including while queued." },
  { id: "trail", de: "Arbeitsschritte prüfen", en: "Review the steps", bodyDe: "Die Spur zeigt, was Anvil getan hat: Werkzeugaufrufe, Änderungen und Prüfergebnisse. Schau hier nach, bevor du ein Ergebnis übernimmst.", bodyEn: "Trail shows what Anvil did: tool calls, changes and check results. Review it before accepting a result." },
  { id: "output", de: "Ergebnis ausprobieren", en: "Try the result", bodyDe: "Mit Run startest du dein Programm. Die Ausgabe zeigt Meldungen und Fehler. Für lokale Programme und Engines hilft der Companion; die Verbindung findest du in den Einstellungen.", bodyEn: "Use Run to start your program. Output shows messages and errors. Companion handles local programs and engines; find its connection in Settings." },
  { id: "extensions", de: "Dienste und Erweiterungen", en: "Services and extensions", bodyDe: "Unter Dienste meldest du dich zum Beispiel bei Notion an und wählst Werkzeuge aus. Plugins ergänzen Anvil. Verbinde nur, was du für deine Arbeit brauchst.", bodyEn: "Under Services, sign in to accounts such as Notion and choose tools. Plugins extend Anvil. Connect what your work needs." },
  { id: "settings", de: "Hilfe nach deinem Bedarf", en: "Help on your terms", bodyDe: "Unter Einstellungen → Orientierung kannst du Erklärhilfen zuschalten, ihre Verzögerung wählen, die zeigende Hand ausschalten und diese Tour erneut starten.", bodyEn: "Under Settings → Getting started, enable explanations, choose their delay, hide the pointing hand or restart this tour." },
] as const;
