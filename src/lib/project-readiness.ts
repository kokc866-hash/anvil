export type ReadinessItem = { id: string; status: "ready" | "missing" | "unknown" | "optional"; label: string; detail: string };

/** Presence checks are deliberately separate from evidence of a successful execution. */
export function projectReadiness(input: { files: Record<string, string>; saved: boolean; model: string; bins?: Record<string, string | null>; runtimeError?: string }): ReadinessItem[] {
  const paths = Object.keys(input.files);
  const html = paths.find(path => path === "web-paket/index.html") || paths.find(path => /(^|\/)index\.html$/i.test(path)) || paths.find(path => /\.html?$/i.test(path));
  const pkg = paths.find(path => path === "package.json");
  const python = paths.find(path => /(^|\/)(main|app)\.py$/i.test(path));
  const main = html || pkg || python;
  const rows: ReadinessItem[] = [{ id: "files", status: paths.length ? "ready" : "missing", label: "Projektdateien", detail: paths.length ? `${paths.length} Dateien im Projekt.` : "Zuerst einen Projektordner öffnen oder ein Aufgabenpaket ergänzen." },
    { id: "entry", status: main ? "ready" : "unknown", label: "Startweg", detail: html ? `${html} im Editor öffnen und Run wählen. Ein HTML-Einstieg ist erkannt; die Funktion wurde damit noch nicht geprüft.` : pkg ? "package.json vorhanden. Vor dem Start dessen scripts und README prüfen." : python ? `${python} erkannt. Benötigte Pakete und Startparameter im Projekt prüfen.` : "Noch kein eindeutiger Einstieg erkannt. README und Projekteinstellungen prüfen." },
    { id: "saved", status: input.saved ? "ready" : "unknown", label: "Speicherort", detail: input.saved ? "Ein Projektordner ist verbunden. Ungespeicherte Änderungen werden weiterhin im Editor markiert." : "Noch kein Projektordner verbunden. Für Dateien außerhalb des Sitzungsspeichers einen Ordner wählen." }];
  if (pkg || python) {
    const runtime = pkg ? "node" : "python";
    const value = input.bins?.[runtime] || (runtime === "python" ? input.bins?.python3 : undefined);
    const known = input.bins && (runtime in input.bins || (runtime === "python" && "python3" in input.bins));
    rows.push({ id: "runtime", status: value ? "ready" : known ? "missing" : "unknown", label: pkg ? "Node.js" : "Python", detail: value ? "Laufzeit vom Companion gefunden. Projektabhängigkeiten sind damit noch nicht geprüft." : input.runtimeError || (known ? "Laufzeit fehlt. Unter Einstellungen → Companion einrichten; anschließend erneut prüfen." : "Laufzeit noch nicht geprüft. Voraussetzungen prüfen wählen.") });
  } else rows.push({ id: "runtime", status: html ? "ready" : "unknown", label: "Laufzeit", detail: html ? "Für einfaches HTML steht Anvils Run bereit. Das mitgelieferte Web-Beispiel braucht keine zusätzliche Installation." : "Laufzeit hängt vom Projekt ab; nichts wurde installiert." });
  rows.push({ id: "model", status: "optional", label: "Modellverbindung", detail: input.model ? `${input.model} ist ausgewählt. Erreichbarkeit und erfolgreiche Antwort sind hier nicht geprüft. Das Web-Beispiel läuft ohne Modell.` : "Kein Modell ausgewählt. Das Web-Beispiel läuft ohne Modell; KI-Aufträge benötigen eine eingerichtete Verbindung." });
  return rows;
}
