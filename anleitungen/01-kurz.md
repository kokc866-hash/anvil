# Anvil — Kurzstart

Anvil ist eine lokale Entwicklungsumgebung mit Editor, KI-Agent und Programmausführung in einem eigenen Fenster.

## Start

**Windows, Release 1.3.29:** [Anvil 1.3.29](https://github.com/kokc866-hash/anvil/releases/tag/v1.3.29) → **Setup-EXE** installieren oder **portable ZIP** vollständig in einen beschreibbaren Ordner entpacken und `Anvil.exe` starten. Oberfläche und Laufzeit sind enthalten; Node.js muss dafür nicht installiert werden. Beide Pakete sind bewusst unsigniert. Die GitHub-Dateien „Source code“ sind keine fertige Anwendung.

Für die Entwicklung aus dem Quellcode:

1. [Node.js LTS](https://nodejs.org) einmalig installieren.
2. Führe beim ersten Mal **install.bat** aus.
3. Starte Anvil anschließend mit **start.bat** in einem eigenen Fenster.
4. **stop.bat** beendet die Entwicklungsinstanz von Anvil und ihren lokalen Server.

Du kannst auch direkt **start.bat** verwenden. Beim ersten Start übernimmt das Skript die Einrichtung.

Für die normale Nutzung das fertige Setup oder ZIP verwenden. `install.bat` und `start.bat` gehören zum Arbeiten am Quellcode. Nach Änderungen an Anvil selbst bei Bedarf vollständig schließen und neu starten.

## Modell einrichten

Zahnrad → **Einstellungen → Agent**

| Feld | Beispiel |
|---|---|
| Anbieter | Ollama |
| API-URL | `http://127.0.0.1:11434/v1` oder LAN `http://192.168.x.x:11434/v1` |
| Modell | z. B. `llama3.1` |

Wähle **Modellliste laden** und speichere die Verbindung als Profil. Eine geladene Modellliste bestätigt die Verbindung zum Server; eine Modellantwort prüfst du anschließend im Chat.

Auf dem Ollama-Rechner: `OLLAMA_HOST=0.0.0.0` und `OLLAMA_ORIGINS=*`.

To-do: Einstellungen → Agent → **To-do** (Auto / Anvil / Helfer / Agent). Bei „Auto“ wird eine nummerierte Aufgabenliste aus deiner Nachricht als Checkliste beibehalten.

## Fenster

```
[ Dateien | Editor | Spur | Agent ]
[ Status: Modell · Helfer · Zeile ]
```

In der linken Seitenleiste findest du Dateien, Referenzen, Suche, Git, Spur, Ausgabe und Einstellungen.

Rechts befindet sich der Chat über die volle Fensterhöhe. Die Spur daneben reicht bis zur Konsole.

## Aufgaben der einzelnen Komponenten

| Komponente | Aufgabe |
|---|---|
| **Anvil** | Verwaltet Dateien, Programmausführung, Git und Fenster. |
| **Agent** (Hauptmodell) | Bearbeitet deine Aufträge und schreibt Code. |
| **Helfer** (optionales lokales Modell) | Unterstützt kurze Aufgaben, etwa Titel und Kurzbefehle. |

Im Chat-Modus **Agent** kann das Modell Dateien ändern. Der Modus **Fragen** dient zum Lesen und Erklären.

## Erste Aufgabe

1. Dateien → neue Datei `index.html`.
2. Chat (Agent): `Bau eine kleine To-do-Liste in index.html`.
3. Sende den Auftrag mit Enter. Die Datei wird im Projekt angelegt. Wenn die automatische Übernahme ausgeschaltet ist, prüfe den Änderungsvorschlag und wähle **Übernehmen**.
4. **Ausführen** öffnet für HTML ein eigenes Vorschaufenster.

Python- und JavaScript-Ausgaben erscheinen in der Konsole. Für Go, Rust und Java verwendet Anvil einen lokalen Compiler oder einen eingerichteten Online-Compiler. Der Companion ist ein lokaler Hilfsdienst; du richtest ihn unter Einstellungen → **Companion** ein.

Für einen neuen Auftrag kannst du einen neuen Chat beginnen oder die Aufgabe im bestehenden Chat eindeutig beschreiben. Der zuvor verwendete Modus einer einzelnen Frage gilt nicht automatisch für den nächsten Auftrag.

## Wichtige Tastenkürzel

| Taste | |
|---|---|
| Ctrl+S | Speichern |
| Ctrl+Enter / Schaltfläche **Ausführen** | Ausführen |
| Ctrl+J | Konsole |
| Ctrl+B | Dateien |
| Ctrl+P | Datei öffnen |
| Ctrl+Shift+P | Befehle |
| Ctrl+L | Frage zur markierten Auswahl |
| Esc | Geöffnetes Menü oder Dialog schließen |

Unter Einstellungen → Tastenkürzel kannst du die Belegung ändern.

Sprache: Einstellungen → Editor → Deutsch / English.

Mehr: `02-handbuch.md` · Abläufe: `03-workflow.md`
