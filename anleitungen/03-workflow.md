# Anvil — Arbeitsabläufe

Schritt für Schritt. [Fenster erklärt](02-handbuch.md). Stand: 13.09.2026, Release 1.3.29. Einzelheiten zu den Funktionen stehen in den Fachanleitungen.

---

## A. Neu auf diesem PC

1. **Fertige Anwendung:** [Anvil 1.3.29](https://github.com/kokc866-hash/anvil/releases/tag/v1.3.29) als Setup-EXE installieren oder portable ZIP vollständig entpacken und **Anvil.exe** starten. Node.js ist darin enthalten. Für die Arbeit am Quellcode stattdessen Node.js LTS installieren, einmal **install.bat**, danach **start.bat** verwenden.
2. Warte beim ersten Start, bis sich das Anvil-Fenster öffnet.
3. Einstellungen → Editor → Sprache.
4. Einstellungen → Agent:
   - Anbieter **Ollama**
   - URL `http://127.0.0.1:11434/v1` (gleicher PC) oder `http://192.168.x.x:11434/v1` (LAN)
   - Modellname wie in `ollama list`
   - **To-do** auf Auto, wenn deine Nachricht eine nummerierte Aufgabenliste enthält
5. **Modellliste laden**. Profilname z. B. `Ollama LAN` → Speichern. Eine geladene Liste bestätigt noch keine Modellantwort.
6. Eine Datei anlegen, Chat testen: `Sag nur: bereit.`

Ollama-Host im LAN:

```
set OLLAMA_HOST=0.0.0.0
set OLLAMA_ORIGINS=*
ollama serve
```

---

## B. Eine HTML-Anwendung mit dem Agenten erstellen

Ziel: Code erstellen, Änderungen übernehmen, die Vorschau prüfen und bei Bedarf nachbessern.

```
Auftrag → Änderungsvorschlag → Übernehmen → Vorschaufenster → Nächste Änderung
```

1. Dateien → neue Datei `index.html` (leer ist ok).
2. Wähle den Chat-Modus **Agent**.
3. Chat:

   ```
   Bau in index.html eine To-do-Liste: Eingabe, Hinzufügen, Durchstreichen, lokal speichern. Nur diese Datei.
   ```

4. Verfolge den Fortschritt in der Spur. Der Denkverlauf wird nach Abschluss eingeklappt. Die Checkliste zeigt bestätigte Arbeitsschritte; bei „To-do: Auto“ bleibt deine nummerierte Aufgabenliste erhalten.
5. Prüfe die Änderungsvorschläge und wähle **Übernehmen**, sofern die automatische Übernahme ausgeschaltet ist.
6. **Ausführen** öffnet die HTML-Vorschau in einem zweiten Fenster.
7. Beschreibe weitere Änderungen im Chat und verweise dabei auf `@index.html`.
8. Wenn du die Änderungen rückgängig machen möchtest, wähle unter der Antwort **Diese Runde rückgängig machen**.

Mit der Ausführungsschleife unter Einstellungen → Agent kann Anvil nach einer Änderung automatisch ausführen und Fehler korrigieren. Bei aktiviertem Graphen kann eine Aufnahme der HTML-Vorschau an den Agenten zurückgegeben werden. Starte denselben `run_file`-Aufruf nicht gleichzeitig manuell und über die Schleife.

---

## C. Ein Python-Skript ausführen und Fehler beheben

1. Neue Datei `main.py`.
2. Agent: `Schreibe main.py: liest eine Zahl, gibt die Fakultät aus. Eine Datei.`
3. Übernehmen.
4. **Ausführen** — Konsole unten (Ctrl+J), nicht das HTML-Fenster.
5. REPL in der Konsole: `print(1)` Enter.
6. Rote Fehlermarkierungen: Ausgabe → Probleme. Rechtsklick **Diese Probleme beheben** oder Chat `Behebe die Fehler in @main.py.`.

Wenn **Beim Bearbeiten ausführen** aktiviert ist, erscheint das Ergebnis nach dem Tippen unter dem Editor.

---

## D. Nur fragen, nichts ändern

1. Im Editor Code markieren.
2. **Ctrl+L** öffnet den Modus **Fragen** und fügt die markierte Auswahl als Kontext hinzu.
3. Frage, z. B. `Warum ist das langsam?`
4. Anvil schreibt keine Dateien.
5. Zurück zu Agent: Umschalter über dem Feld.

Oder lege **Fragen** als Standardmodus fest: Einstellungen → Agent → Standard-Modus.

---

## E. Referenzen als Kontext verwenden

```
ref/
  api.md
  screen.png
  notes.txt
```

1. Leiste **Referenzen** oder Ordner `ref/` im Baum.
2. Ziehe die gewünschten Dateien in den Referenzbereich.
3. Im Chat `@ref` oder `@ref/api.md`.
4. Der Agent erhält die Referenzen als bevorzugten Kontext für die Aufgabe.

Lege keine Zugangsdaten in `ref/` ab. Verwende dafür den Tresor unter Einstellungen → Daten; dessen Inhalte werden nicht in die Modellanfrage aufgenommen.

---

## F. Zwei Modelle, ein Klick

Beispiel: Ollama zu Hause, OpenRouter unterwegs.

1. Ollama einrichten → Profil `Heim` speichern.
2. Wechsle den Anbieter, trage Serveradresse, API-Schlüssel und Modell ein und speichere das Profil `Cloud`.
3. Wähle das gewünschte Profil im Agentenbereich. Die gespeicherte URL und Modellauswahl werden wiederhergestellt; Zugangsschlüssel werden getrennt nach Anbieter verwaltet.

Der Helfer hat eigene Profile, unabhängig vom Agenten.

---

## G. Projektdateien in einem lokalen Ordner speichern

1. Einstellungen → Speicher → Arbeitskopie **Ordner**.
2. Wähle unter **Projektordner → Öffnen** deinen Ordner aus und erlaube den Zugriff.
3. Aktiviere **Automatisch speichern**, wenn Änderungen fortlaufend im gewählten Ordner gespeichert werden sollen.
4. Aktiviere **Beim Start laden**, wenn Anvil diesen Ordner bei jedem Start öffnen soll.

Für eine Sicherung wählst du einen zweiten Speicherort und kopierst das Projekt dorthin. Git kannst du zusätzlich für die Versionsverwaltung verwenden.

---

## H. Automatisch ausführen, prüfen und verbessern

Für HTML-Projekte mit sichtbarer Oberfläche:

1. Aktiviere unter Einstellungen → Agent → **Automatische Ausführung und Prüfung** die Option **Nach Änderungen ausführen**. Wähle bei **Prüfung nach Änderungen** die Option **Ausführen** und stelle **Korrekturversuche** auf 3.
2. Aktiviere bei Bedarf unter **Graph** die Option **Ablauf aktivieren** und stelle **Vorschauprüfungen** auf 2–4.
3. Alternativ kannst du die Tafel öffnen und den Standardablauf verwenden: Datei ändern → ausführen → Fehler oder Vorschau prüfen → korrigieren. Übernimm die Einstellungen mit **Ins Projekt übernehmen**.
4. Auftrag:

   ```
   index.html: Memory-Spiel, 4×4, Maus. Prüfe das Spiel und behebe auftretende Fehler.
   ```

5. Aufnahmen und Ausführungsversuche werden im Chat angezeigt und zusätzlich protokolliert.
6. Selbst spielen im Ausgabefenster. Nächste Nachricht: `Versuch 2, die Karten drehen nicht zurück.`

Für die automatische Ausführung brauchst du die Tafel nicht zu öffnen. Den Graphen kannst du zusätzlich nutzen, wenn Bildaufnahmen bei der Prüfung helfen, etwa bei Layouts, Canvas-Anwendungen oder Spielen.

---

## I. Helfer dazu (optional)

1. Einstellungen → Helfer → **Helfer aktivieren**.
2. Kleines Modell, **Laden**. Warten auf `bereit` in der Statusleiste.
3. **Testen**.
4. Autonomie: Aus / Still / An (Hinweise bei Fehlern und Commits).
5. Aktiviere nur die gewünschten Helferaufgaben, etwa Titel, Commit-Nachrichten oder Dateianhänge.

Unter Einstellungen → Modelle kannst du Helfermodelle vorladen und im Zwischenspeicher behalten. Die Agentenmodelle werden weiterhin über Ollama oder den gewählten Cloud-Anbieter verwaltet.

---

## J. Regeln für ein Projekt

1. Lege im Projekt `AGENTS.md` oder `.anvil/rules.md` an, z. B.:

   ```
   Sprache: Deutsch in UI-Texten.
   Keine neuen Abhängigkeiten ohne Nachfrage.
   HTML ohne Framework.
   ```

2. Zusätzliche Anweisungen: Einstellungen → Agent → Regeln.
3. Bei der nächsten Agentenrunde werden beide Quellen berücksichtigt.

---

## L. Lange Sitzung, mittleres Projekt

Ziel, bearbeitete Dateien und Korrekturen bleiben in den Sitzungsnotizen erhalten, auch wenn der Modellkontext zusammengefasst wird. Du findest sie unter Gedächtnis → **Sitzung**.

Mittleres Projekt (einige Dutzend bis ein paar hundert Dateien):

1. Einen lokalen Projektordner öffnen (Einstellungen → Speicher).
2. Der Agent erhält zunächst eine Übersicht der Ordner. Mit `list_files`, `grep` und `read_file` kann er anschließend gezielt Dateien suchen und lesen.
3. Offene und angehängte Dateien werden bevorzugt berücksichtigt. Verweise mit `@datei` auf eine Datei, statt ihren gesamten Inhalt in die Nachricht zu kopieren.
4. Ein langer Chat muss nicht geleert werden. Die Kontextzusammenfassung verkürzt den an das Modell gesendeten Verlauf; die Sitzungsnotizen bleiben erhalten.

Wenn der Agent den Faden verliert, prüfe Gedächtnis → Sitzung oder beschreibe kurz den aktuellen Stand: `Wir sind bei index.html, dunkles Theme, ohne Tailwind. Mach als Nächstes …`

---

## M. Häufige Aktionen

| Aktion | Zugriff |
|---|---|
| Datei finden | Ctrl+P |
| Befehl | Ctrl+Shift+P |
| Speichern | Ctrl+S |
| Ausführen | Schaltfläche **Ausführen** / Ctrl+Shift+P → Ausgabefenster |
| Konsole | Ctrl+J |
| Auswahl erklären | Ctrl+L |
| Auswahl umschreiben | Ctrl+K |
| Agentenbereich öffnen oder schließen | Sprechblase in der Seitenleiste |
| Runde rückgängig machen | Unter der Antwort oder über „Letzte Agentenrunde rückgängig machen“ |
| Menüs und Dialoge schließen | Esc, bei mehreren Ebenen wiederholt |

---

## N. Anvil beenden

**stop.bat** beendet die Entwicklungsinstanz von Anvil und ihren lokalen Server auf Port 8080.
Gespeicherte Einstellungen und Projektdateien bleiben im Anwendungsspeicher bzw. Projektordner erhalten. Für den nächsten Entwicklungsstart genügt **start.bat**.

---

## O. Go, Rust und Java in Anvil ausführen

Du kannst die Ausführung direkt aus Anvil starten.

1. Datei anlegen (`main.go` / `main.rs` / …).
2. Wähle **Ausführen**. Die Desktop-App startet den Companion bei Bedarf selbst.
3. Wenn die benötigte Laufzeit oder der Compiler installiert ist, etwa `go` oder `rustc`, läuft das Programm lokal. Andernfalls wird ein eingerichteter Online-Compiler verwendet.
4. Beim Schließen des Ausgabefensters wird der Companion beendet, sofern er nicht dauerhaft eingeschaltet bleiben soll.

Unter Einstellungen → Companion zeigt die Statusanzeige, welche Laufzeitprogramme gefunden wurden. Falls die Verbindungsprüfung eine fehlende Anmeldung meldet, trage den Companion-Zugriffsschlüssel ein.

---

## P. Ein Änderungspaket einspielen

1. `grok.anvil-patch` neben `grok.mjs` (Anvil-Ordner) legen.
2. `node grok.mjs`
3. **stop.bat**, dann **start.bat**
