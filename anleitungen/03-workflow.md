# Anvil 1.2.4 — Workflows

Schritt für Schritt. Fenster erklärt: `02-handbuch.md`. Stand: 05.09.2026.

---

## A. Neu auf diesem PC

1. **Installer:** [Releases](https://github.com/kokc866-hash/anvil/releases) Setup oder portable. Oder Zip + Node.js LTS nach `I:\Anvil` (oder wo du willst) entpacken, **start.bat**.
2. Erstes Mal warten, bis das Fenster da ist.
3. Einstellungen → Editor → Sprache.
4. Einstellungen → Agent:
   - Anbieter **Ollama**
   - URL `http://127.0.0.1:11434/v1` (gleicher PC) oder `http://192.168.x.x:11434/v1` (LAN)
   - Modellname wie in `ollama list`
   - **To-do** auf Auto, wenn der Prompt Schritte vorgibt
5. **Verbindung prüfen**. Profilname z. B. `Ollama LAN` → Speichern.
6. Eine Datei anlegen, Chat testen: `Sag nur: bereit.`

Ollama-Host im LAN:

```
set OLLAMA_HOST=0.0.0.0
set OLLAMA_ORIGINS=*
ollama serve
```

---

## B. HTML-App vom Agent bauen

Ziel: schreiben → übernehmen → im Run-Fenster sehen → nachbessern.

```
du  →  Agent schreibt  →  Diff  →  Run-Fenster  →  „mach den Button rot“
```

1. Dateien → neue Datei `index.html` (leer ist ok).
2. Agent-Modus (nicht Ask).
3. Chat:

   ```
   Bau in index.html eine To-do-Liste: Eingabe, Hinzufügen, Durchstreichen, lokal speichern. Nur diese Datei.
   ```

4. Warten. Denken klappt zu. Plan-Haken füllen sich (To-do Auto: deine nummerierte Liste bleibt).
5. Diff **Übernehmen** (oder „Diffs automatisch“ an).
6. **Run** — zweites Fenster, Titel `Run · index.html`.
7. Nachbessern im Chat, Datei bleibt `@index.html`.
8. Schiefgelaufen: unter der Antwort **Zurück vor diese Runde**.

Run-Schleife an (Einstellungen → Agent): nach dem Schreiben führt Anvil selbst aus, bei Fehler einmal anders patchen. Graph an: nach HTML-Run ein Frame zurück an den Agenten — nicht parallel zum Loop denselben `run_file`.

---

## C. Python-Skript + Fehler + Fix

1. Neue Datei `main.py`.
2. Agent: `Schreibe main.py: liest eine Zahl, gibt die Fakultät aus. Eine Datei.`
3. Übernehmen.
4. **Run** — Konsole unten (Ctrl+J), nicht das HTML-Fenster.
5. REPL in der Konsole: `print(1)` Enter.
6. Rote Unterschlangen: Ausgabe → Probleme. Rechtsklick **Diese Probleme beheben** oder Chat `fix die Fehler in @main.py`.

Live-Run an: nach dem Tippen erscheint das Ergebnis unter dem Editor.

---

## D. Nur fragen, nichts ändern

1. Im Editor Code markieren.
2. **Ctrl+L** — Chat wird Ask, Auswahl hängt an.
3. Frage, z. B. `Warum ist das langsam?`
4. Anvil schreibt keine Dateien.
5. Zurück zu Agent: Umschalter über dem Feld.

Oder Chat-Modus dauerhaft Ask: Einstellungen → Agent → Standard-Modus.

---

## E. Referenzen statt Workspace durchsuchen

```
ref/
  api.md
  screen.png
  notes.txt
```

1. Leiste **Referenzen** oder Ordner `ref/` im Baum.
2. Dateien per Drag-and-Drop in den Korb.
3. Im Chat `@ref` oder `@ref/api.md`.
4. Agent sieht den Korb zuerst, nicht den ganzen Workspace.

Keine Secrets in `ref/` — Tresor (Einstellungen → Daten) bleibt außerhalb des Prompts.

---

## F. Zwei Modelle, ein Klick

Beispiel: Ollama zu Hause, OpenRouter unterwegs.

1. Ollama einrichten → Profil `Heim` speichern.
2. Anbieter wechseln, URL/Key/Modell → Profil `Cloud` speichern.
3. Oben in Agent die Profile anklicken. URL und Modell kommen zurück, Keys pro Anbieter.

Helfer hat eigene Profile, unabhängig vom Agenten.

---

## G. Auf die Platte, nicht nur in Anvil

1. Einstellungen → Speicher → Arbeitskopie **Ordner**.
2. **Ordner vom Rechner öffnen** — einmal erlauben.
3. **Automatisch speichern** an, wenn jede Änderung raus soll.
4. **Beim Start laden** an, wenn dieser Ordner Standard ist.

Backup: zweiten Ort wählen, „kopieren“. Git bleibt zusätzlich in der Git-Leiste.

---

## H. Schleife: bauen, spielen, patchen

Für HTML, das man **sieht**:

1. Einstellungen → Agent: **Run-Schleife an**, Nach Write **Run**, Versuche 3.
2. Optional **Graph an**, Frames 2–4.
3. Oder Tafel öffnen, Standard-Verdrahtung (Write → Run → Fail/See → Patch), **Ins Projekt**.
4. Auftrag:

   ```
   index.html: Memory-Spiel, 4×4, Maus. Wenn etwas hakt, selbst nachlegen.
   ```

5. Filmstrip / Versuche erscheinen im Chat, nicht nur im Log.
6. Selbst spielen im Run-Fenster. Nächste Nachricht: `Versuch 2, die Karten drehen nicht zurück.`

Ohne Tafel reicht die Run-Schleife. Graph nur, wenn Frames helfen (Layout, Canvas, Spiel).

---

## I. Helfer dazu (optional)

1. Einstellungen → Helfer → an.
2. Kleines Modell, **Laden**. Warten auf `bereit` in der Statusleiste.
3. **Testen**.
4. Autonomie: Aus / Still / An (Hinweise bei Fehlern und Commits).
5. Jobs: nur lassen, was du willst (Titel, Commit, Attach, …).

Wenn der Download stört: Einstellungen → Modelle, Pin, vorladen, Cache behalten. Agent-Modelle bleiben bei Ollama/Cloud — der Helfer ist extra.

---

## J. Regeln für ein Repo

1. Im Workspace `AGENTS.md` oder `.anvil/rules.md` anlegen, z. B.:

   ```
   Sprache: Deutsch in UI-Texten.
   Keine neuen Abhängigkeiten ohne Nachfrage.
   HTML ohne Framework.
   ```

2. Extra-Sätze: Einstellungen → Agent → Regeln.
3. Nächste Agent-Runde liest beides.

---

## L. Lange Sitzung, mittleres Projekt

Anvil merkt sich über Compacting hinweg: Ziel, angefasste Dateien, Korrekturen. Gedächtnis → **Sitzung**.

Mittleres Projekt (einige Dutzend bis ein paar hundert Dateien):

1. Ordner auf der Platte öffnen (Einstellungen → Speicher).
2. Agent sieht eine Ordnerkarte, nicht jede Datei. `list_files`, `grep`, dann `read_file`.
3. Offene und angehängte Dateien liegen im Fokus. Ganze Dateien nicht in den Chat kippen — `@datei` reicht.
4. Chat nicht leeren, nur weil er lang ist. Compacting kürzt den Prompt, die Sitzung bleibt.

Wenn der Agent den Faden verliert: Gedächtnis → Sitzung prüfen, oder eine kurze Lage: `Wir sind bei index.html, dunkles Theme, ohne Tailwind. Mach als Nächstes …`

---

## M. Alltagsgriff

| Ich will | Griff |
|---|---|
| Datei finden | Ctrl+P |
| Befehl | Ctrl+Shift+P |
| Speichern | Ctrl+S |
| Ausführen | Run / Ctrl+Shift+P → Run-Fenster |
| Konsole | Ctrl+J |
| Auswahl erklären | Ctrl+L |
| Auswahl umschreiben | Ctrl+K |
| Agent zu/auf | Blase in der Leiste |
| Runde zurück | unter der Antwort, oder Befehl „Letzte Agent-Runde rückgängig“ |
| Alles zu | Esc mehrmals |

---

## N. Feierabend

**stop.bat** — Electron und der Dev-Server auf 8080 weg.  
Einstellungen und Workspace bleiben (Browser-Speicher bzw. Ordner). Nächster Start: nur start.bat.

---

## M. Go / Rust / Java in Anvil

Nicht in einem anderen Programm ausführen.

1. Datei anlegen (`main.go` / `main.rs` / …).
2. **Run**. Electron startet Companion selbst.
3. `go`/`rustc` auf dem PC → lokale Ausgabe. Sonst Compiler im Netz.
4. Run-Fenster zu → Companion stoppt (wenn **Anlassen** aus).

Einstellungen → Companion: Liste grün = gefunden. Token nur wenn Prüfen rot.

---

## N. Patch einspielen

1. `grok.anvil-patch` neben `grok.mjs` (Anvil-Ordner) legen.
2. `node grok.mjs`
3. **stop.bat**, dann **start.bat**

