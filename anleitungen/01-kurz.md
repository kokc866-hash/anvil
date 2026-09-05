# Anvil 1.2.3 — Kurz

Lokale IDE: Dateien, Agent, Run. Eigenes Fenster, kein Browser.

## Start

**Installer (Windows):** [Releases](https://github.com/kokc866-hash/anvil/releases) → Setup-exe oder portable. UI ist eingebaut, **kein** Node.js, **kein** Vite auf dem PC.

Oder aus dem Ordner:

1. [Node.js LTS](https://nodejs.org) einmalig.
2. **install.bat** (nur beim ersten Mal).
3. **start.bat** — eigenes Fenster.
4. **stop.bat** beendet alles.

Oder nur **start.bat**: richtet beim ersten Mal selbst ein.

Port 8080 belegt: start.bat räumt ihn. Electron fehlt: nochmal install.bat.

## Modell (einmal)

Zahnrad → **Einstellungen → Agent**

| Feld | Beispiel |
|---|---|
| Anbieter | Ollama |
| API-URL | `http://127.0.0.1:11434/v1` oder LAN `http://192.168.x.x:11434/v1` |
| Modell | z. B. `llama3.1` |

**Verbindung prüfen**. Profil speichern.

Auf dem Ollama-Rechner: `OLLAMA_HOST=0.0.0.0` und `OLLAMA_ORIGINS=*`.

To-do: Einstellungen → Agent → **To-do** (Auto / Anvil / Helfer / Agent). Auto: nummerierter Prompt bleibt.

## Fenster

```
[ Dateien | Editor | Spur | Agent ]
[ Status: Modell · Helfer · Zeile ]
```

Links die Leiste: Dateien, Referenzen, Suche, Git, Spur, Ausgabe, Einstellungen.

Rechts der Chat (volle Höhe). Spur daneben, nur bis zur Konsole.

## Drei Hände

| Wer | Tut was |
|---|---|
| **Anvil** | Dateien, Run, Git, Fenster |
| **Agent** (Hauptmodell) | Denkt, schreibt Code |
| **Helfer** (optional, klein, lokal) | Titel, Kurzbefehl — kein Code |

Chat-Modus **Agent** ändert Dateien. **Ask** erklärt nur.

## Erste Aufgabe

1. Dateien → neue Datei `index.html`.
2. Chat (Agent): `Bau eine kleine To-do-Liste in index.html`.
3. Enter. Datei landet im Workspace. Auto-Diffs aus: **Übernehmen**.
4. **Run** — HTML öffnet ein eigenes Fenster (Titel `Run · index.html`).

Python/JS: Konsole. Go/Rust/Java: Run in Anvil (Compiler auf dem PC oder im Netz). Companion ist kein Internet — Einstellungen → **Companion**.

Neuer Auftrag: neuer Chat oder klarer Prompt. Alte Nachfrage (Ask) gilt nicht weiter.

## Acht Tasten

| Taste | |
|---|---|
| Ctrl+S | Speichern |
| Ctrl+Enter / Leiste **Run** | Ausführen |
| Ctrl+J | Konsole |
| Ctrl+B | Dateien |
| Ctrl+P | Datei öffnen |
| Ctrl+Shift+P | Befehle |
| Ctrl+L | Ask zur Auswahl |
| Esc | Fenster zu |

Tasten umbelegen: Einstellungen → Tasten.

Sprache: Einstellungen → Editor → Deutsch / English.

Mehr: `02-handbuch.md` · Abläufe: `03-workflow.md`
