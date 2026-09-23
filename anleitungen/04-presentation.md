# Anvil — Kurzpräsentation

Diese Einführung dauert etwa fünf Minuten. Sie beschreibt den Funktionsstand von Release 1.3.29. Weitere Möglichkeiten und Grenzen erklären die Anleitungen zu [Verbindungen](05-verbindungen.md) und [Editor](editor.md).

---

## 1. Was es ist

**Anvil** ist eine lokale Entwicklungsumgebung in einem eigenen Fenster.

Sie verbindet Dateiverwaltung, Editor, KI-Agent und Programmausführung. Du kannst ein lokales Modell oder einen Cloud-Anbieter verwenden.

---

## 2. Die Komponenten

Anvil führt die Werkzeuge aus; das gewählte Hauptmodell bearbeitet deine Aufträge. Ein zusätzliches Helfermodell ist optional.

| Komponente | Aufgabe |
|---|---|
| **Anvil** | Verwaltet Dateien, Git, Programmausführung, Vorschau und Debugger. |
| **Agent** | Bearbeitet deine Aufträge mit dem gewählten Hauptmodell und den freigegebenen Werkzeugen. |
| **Helfer** | Unterstützt kurze Aufgaben, etwa Titel und Kurzbefehle, mit einem optionalen lokalen Modell. |

Der Agent funktioniert auch ohne aktivierten Helfer.

---

## 3. Eine erste Aufgabe

So erstellst und prüfst du eine kleine Anwendung:

1. Beschreibe im Chat, welche Anwendung du erstellen möchtest.
2. Der Agent legt Dateien an.
3. Prüfe die Änderungsvorschläge und übernimm sie.
4. **Ausführen** — HTML in einem eigenen Fenster, Python in der Konsole.
5. Prüfe das Ergebnis. Du kannst Fehler melden oder eine weitere Änderung beschreiben. Eine Vorschauaufnahme unterstützt visuelle Aufgaben, sofern die Modellverbindung Bilder verarbeitet.

Wiederhole diese Schritte, bis das Ergebnis den Anforderungen entspricht.

---

## 4. Weitere Funktionen

- **Eigenes Fenster** — Die fertige Anwendung wird über `Anvil.exe` gestartet, die Entwicklungsfassung über `start.bat`.
- **Lokal oder Cloud** — Anvil unterstützt unter anderem Ollama, LM Studio, OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, OpenRouter, xAI und Azure. Verbindungen lassen sich als Profile speichern; erforderliche Zugangsschlüssel werden getrennt verwaltet.
- **Automatische Ausführung** — Der Agent kann Änderungen ausführen, Ergebnisse prüfen und Fehler korrigieren.
- **Companion** — Ein Hilfsdienst auf deinem Rechner verbindet unter anderem lokale Compiler und Laufzeitprogramme mit Anvil.
- **Graph** — Legt Abläufe fest und kann Vorschauaufnahmen zur Prüfung an den Agenten zurückgeben.
- **Referenzen** — Spezifikationen, Bilder und Notizen im Ordner `ref/` liefern gezielten Kontext für die Aufgabe.
- **Runde zurücknehmen** — Dateiänderungen einer Agentenrunde vor der Bestätigung ansehen und zurücksetzen; externe Aktionen bleiben getrennt.
- **Deutsch / English** — Umschalter in den Einstellungen.

---

## 5. Grenzen

Anvil enthält keine eigene Spiele-Engine. HTML-Anwendungen lassen sich direkt in der Vorschau ausführen. Engine-Projekte benötigen die jeweiligen Programme und ihre Anbindungen.

Die Spur zeigt Arbeitsschritte, Änderungen, Prüfergebnisse und gegebenenfalls Vorschauaufnahmen. Eine Modellantwort allein ist kein Nachweis, dass das erstellte Programm fehlerfrei funktioniert.

Das Helfermodell ist für die Agentenarbeit nicht erforderlich.

---

## 6. Starten

1. Installiere die Setup-EXE aus den [GitHub Releases](https://github.com/kokc866-hash/anvil/releases) oder entpacke die portable ZIP vollständig und starte `Anvil.exe`.
2. Für die Entwicklung aus dem Quellcode benötigst du stattdessen Node.js LTS und **start.bat**.
3. Wähle unter Einstellungen → Agent den Anbieter, die Verbindungsadresse und das Modell. Ergänze bei Bedarf den Zugangsschlüssel und prüfe die Verbindung.
4. Chat: *Bau eine To-do-Liste in index.html.*
5. Prüfe die Änderungen, übernimm sie und wähle **Ausführen**.

Die Entwicklungsinstanz lässt sich mit **stop.bat** beenden.

---

## 7. Abschluss

Du beschreibst die Aufgabe, prüfst die vorgeschlagenen Änderungen und testest das Ergebnis. Anvil hält die zugehörigen Dateien, Arbeitsschritte und Ausgaben zusammen.
