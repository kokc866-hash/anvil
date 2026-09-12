import { useIde } from "@/store/ide";
import type { SettingsCategory } from "@/lib/settings-groups";
import { HelpSettings } from "./help";

export function OrientationSection({ navigate }: { navigate: (category: SettingsCategory) => void }) {
  const en = useIde(s => s.locale) === "en";
  const busy = useIde(s => s.agentBusy || s.running || Boolean(s.pathOperation));
  const text = (de: string, english: string) => en ? english : de;
  const actions: [SettingsCategory, string, string][] = [
    ["agent", text("Mit KI arbeiten", "Work with AI"), text("Anbieter, Anmeldung und Modell für deinen Chat wählen.", "Choose the provider, sign-in and model for your chat.")],
    ["companion", text("Code oder ein Spiel ausführen", "Run code or a game"), text("Lokale Programme, Sprachen und Unity, Unreal oder Godot einrichten.", "Set up local programs, languages and Unity, Unreal or Godot.")],
    ["storage", text("Dateien und Speicherorte", "Files and storage locations"), text("Nachsehen, wo Anvil speichert und wann Änderungen auf die Festplatte gelangen.", "See where Anvil saves and when changes reach your disk.")],
    ["layout", text("Arbeitsfläche anpassen", "Adjust your workspace"), text("Editor, Chat und Ausgabe passend zu deiner Arbeit anordnen.", "Arrange the editor, chat and output for your work.")],
  ];
  return <section className="@container py-4 text-sm" aria-label={text("Orientierung in Anvil", "Getting around Anvil")}>
    <HelpSettings />
    <h3 className="font-medium">{text("Was möchtest du tun?", "What would you like to do?")}</h3>
    <p className="mt-2 text-xs leading-relaxed text-muted">{text("Für den Anfang reichen ein Projekt und, wenn du den Chat nutzen möchtest, eine KI-Verbindung. Die weiteren Bereiche brauchst du erst für die jeweilige Aufgabe.", "Start with a project and, if you want to use chat, an AI connection. Set up the other areas when a task needs them.")}</p>
    <div className="mt-4 grid grid-cols-1 gap-2 @min-[30rem]:grid-cols-2">
      {actions.map(([id, label, hint]) => <button key={id} type="button" onClick={() => navigate(id)} className="rounded-md border border-border p-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring">
        <span className="block font-medium">{label}</span><span className="mt-1 block text-xs leading-relaxed text-muted">{hint}</span>
      </button>)}
    </div>
    <h4 className="mt-6 font-medium">{text("Dein erster Ablauf", "Your first workflow")}</h4>
    <ol className="mt-2 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted">
      <li>{text("Projektordner öffnen oder beim Einstieg das Beispiel ohne KI starten.", "Open a project folder or run the no-AI example from the introduction.")}</li>
      <li>{text("Im Chat „Fragen“ wählen, um etwas zu verstehen. „Agent“ wählen, um Änderungen ausführen zu lassen.", "Choose Ask in chat to understand something. Choose Agent to have changes carried out.")}</li>
      <li>{text("Dateiänderungen und Prüfungen in der „Spur“ ansehen. Mit „Run“ ausführen und das Ergebnis selbst ausprobieren.", "Inspect file changes and checks in Trail. Use Run and try the result yourself.")}</li>
      <li>{text("Änderungen prüfen und speichern. Ein gestartetes Programm ist noch kein bestandener Test.", "Review and save your changes. A program starting does not mean its tests passed.")}</li>
    </ol>
    <button type="button" disabled={busy} onClick={() => {
      const state = useIde.getState();
      if (state.agentBusy || state.running || state.pathOperation) return;
      state.setSettingsOpen(false); state.setSetupDone(false);
    }} className="mt-3 rounded-md border border-border px-3 py-2 text-xs hover:bg-hover disabled:opacity-50">{text("Einstieg erneut öffnen", "Reopen introduction")}</button>
    <h4 className="mt-6 font-medium">{text("Wofür sind die Bereiche da?", "What are the areas for?")}</h4>
    <dl className="mt-2 space-y-3 text-xs leading-relaxed">
      {[
        ["Agent", text("Dein KI-Arbeitsmodus. Kann Dateien bearbeiten und verfügbare Werkzeuge ausführen. Anbieter und Modell stellst du hier unter Agent ein.", "Your AI work mode. Can edit files and run available tools. Choose its provider and model under Agent.")],
        [text("Fragen", "Ask"), text("Erklärt und untersucht. In diesem Modus stehen keine schreibenden Projektwerkzeuge zur Verfügung.", "Explains and investigates. Project-writing tools are unavailable in this mode.")],
        ["Companion", text("Führt lokale Programme und Prüfungen aus. Die Desktop-App startet ihn bei Bedarf. Er ist kein KI-Modell.", "Runs local programs and checks. The desktop app starts it when needed. It is not an AI model.")],
        [text("Helfer · optional", "Helper · optional"), text("Zusätzliche lokale KI für Hilfsaufgaben. Für den normalen Chat brauchst du sie nicht einzurichten.", "Additional local AI for helper tasks. You do not need to set it up for regular chat.")],
        [text("Gedächtnis", "Memory"), text("Gespeichertes Wissen und Regeln für spätere Aufgaben ansehen und verwalten.", "View and manage saved knowledge and rules for later tasks.")],
        [text("Spur", "Trail"), text("Zeigt Arbeitsschritte, Dateiänderungen und Prüfergebnisse einer Aufgabe.", "Shows the steps, file changes and check results of a task.")],
        [text("Dienste und MCP", "Services and MCP"), text("Unter Erweiterungen → Dienste externe Konten verbinden und Werkzeuge auswählen. MCP ist die technische Verbindung für diese und lokale Werkzeuge.", "Connect external accounts and choose tools under Extensions → Services. MCP is the technical connection for these and local tools.")],
        [text("Intern", "Internal"), text("Diagnose für die Fehlersuche. Für den Einstieg ist hier keine Einrichtung erforderlich.", "Diagnostics for troubleshooting. No setup here is needed to get started.")],
      ].map(([label, hint]) => <div key={label}><dt className="font-medium text-fg">{label}</dt><dd className="text-muted">{hint}</dd></div>)}
    </dl>
  </section>;
}
