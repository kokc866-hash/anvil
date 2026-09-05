# Anvil 1.2.2 — Handbuch

Ausführlich, mit Vorschau der Fenster. Kurzfassung: `01-kurz.md`. Abläufe: `03-workflow.md`. Stand: 05.09.2026.

---

## 1. Was Anvil ist

Anvil ist eine lokale Entwicklungsumgebung in einem eigenen Programmfenster (Electron).

- Workspace im Speicher, optional Ordner auf der Platte
- Editor mit Vorschlägen, Suche, Debug
- Agent (dein Modell: Ollama, LM Studio, OpenAI, …) schreibt und ändert Dateien
- Run: Python/JS hier, HTML in einem zweiten Fenster, Go/Rust/Java in Anvil (Compiler lokal oder Netz)
- Helfer: kleines lokales Modell für Kurzaufgaben, nie für den eigentlichen Code
- Companion: kleines Programm **auf diesem PC** (kein Internet). Startet bei Run, stoppt wenn Run zu.

Anvil handelt (Dateien, Run, Git). Das Hauptmodell denkt. Der Helfer ist optional.

---

## 2. Installation und Start

### Voraussetzungen

- Windows, [Node.js LTS](https://nodejs.org) — nur wenn du aus dem Ordner startest
- Optional: Ollama / LM Studio auf diesem PC oder im LAN

### Installer

[GitHub Releases](https://github.com/kokc866-hash/anvil/releases): **Setup** (Ordner wählen, Verknüpfung) oder **portable** (eine exe, kein Setup). Version steht im Fenster und unter Einstellungen → Daten.

### Ordner

```
anvil\
  start.bat      ← Anvil öffnen
  stop.bat       ← Anvil und Port 8080 beenden
  Anvil.vbs      ← stilles Starten, ohne Konsolenfenster
  TESTEN.md
  anleitungen\
```

**start.bat** prüft Node, lädt beim ersten Mal `npm install` und Electron, startet dann das Fenster.

Falls `electron.exe` fehlt:

```
npm install-scripts approve electron
node node_modules\electron\install.js
```

Port 8080 belegt: **stop.bat**, dann neu starten. Nicht `http://localhost:8080` in PowerShell eintippen — das ist keine Eingabe, das ist die Adresse im Fenster.

### Sprache

Einstellungen → Editor → Sprache: Deutsch oder English. Sofort.

---

## 3. Fenster — Vorschau

```
┌──┬────────────────────┬──────────┬─────────────────────┐
│▓▓│  index.html ×      │ Spur     │  Agent              │
│📁│┌──────────────────┐│ Runde ←→ │  ┌───────────────┐  │
│📎││                  ││ Denken   │  │ Antwort       │  │
│🔎││     Editor       ││ Tools    │  │               │  │
│⎇ ││                  ││ Diff/Run │  └───────────────┘  │
│🧠│└──────────────────┘│ To-do    │  [@main.py]         │
│🧪├────────────────────┴──────────┤  ┌─────────┐  [➤]  │
│▦ │  Konsole                      │  │ Agent…  │       │
│💬│  > print(1)                   │  └─────────┘       │
│🐾│                               │  Kontext 16/33k    │
├──┴───────────────────────────────┴─────────────────────┤
│ llama3.1  ·  Helfer bereit  ·  Z. 12  ·  2 Leerzeichen│
└───────────────────────────────────────────────────────┘
```

### Linke Leiste (von oben)

| Symbol | Öffnet |
|---|---|
| Ordner | Dateien |
| Bücher | Referenzen (`ref/`) |
| Lupe | Suche + Vorschau, dann Ersetzen |
| Ast | Git |
| Hirn | Gedächtnis / Skills |
| Kolben | Tests: entdeckt, Run, rot/grün, Klick auf Datei:Zeile |
| Knoten | Tafel (Harness / Graph) |
| Puzzle | Erweiterungen: Built-ins, `plugins/*.js`, Open-VSX/.vsix |
| Stecker | MCP: fremde Fläche (Engine, Docs). Exclusive oder Brücke |
| Fußspuren | Spur (Plan, Denken, Run, Diff) |
| Blase | Agent ein/aus |
| Terminal | Ausgabe |
| Zahnrad | Einstellungen |

### Mitte

Tabs, Editor. Spur rechts daneben, **nur bis zur Konsole** (nicht volle Höhe). Pfeile wechseln ältere Runden. HTML öffnet **nicht** hier, sondern ein eigenes Run-Fenster.

### Rechts — Agent

Volle Höhe an der rechten Wand. Chat, Diffs. Plan und Denken liegen in der **Spur**, nicht im Chat (außer Spur-im-Chat an).

### Unten — Status

Hauptmodell links, Helfer daneben, Zeile/Spalte, Einzug, Wrap.

### Anordnung

Einstellungen → Layout:

- **Auto** — bei schmalem Fenster Agent als Overlay
- **Nebeneinander** — Agent bleibt rechts
- **Untereinander** — Agent unter dem Editor

Presets: IDE · Code + Agent · Schreiben · Ausführen.

**Hardware anpassen** misst RAM, Kerne und die GPU des Rechners (nicht nur WebGPU). Setzt Animation, Live-Run, Agent-Schleifen. Helfer-Modell nur, wenn WebGPU da ist.

### Erweiterungen (Puzzle)

Drei Quellen, ein Schalter:

- **Built-ins** — Format, Snippets, Lint, Web, ZIP, Debug, Helfer. Aus = Befehl weg.
- **Workspace** — `plugins/*.js` mit `activate(anvil)`. Ohne `// @trust` in den ersten 8 Zeilen nur lesen. Mit `@trust` voll (schreiben, Agent, Netz) und startet **aus**, bis du den Schalter anmachst.
- **VS Code / Markt** — Open VSX oder `.vsix`. Anvil nimmt Snippets, Sprachen, Kommentare und Keywords aus `tmLanguage`. Kein vscode-Modul, kein Language-Server. Pack lassen sich aus und entfernen.

Neues Plugin: unten **Neues Plugin** → `plugins/mein-plugin.js`. Befehle stehen in Ctrl+Shift+P.

### MCP (Stecker)

HTTP-Server in der Unplug-Leiste, nicht stdio.

- **An/Aus** verbindet. **Hier arbeiten** macht den Server zur Fläche.
- **Eine Fläche** — Agent nur `mcp_call` / `mcp_list` / Plan. Anvil-Dateien aus.
- **Brücke** — MCP und Anvil-Dateien in einer Runde.
- Kontextzeile (`scene=overworld`) landet in Tool-Args, wenn das Tool den Key kennt.
- Open VSX ist Erweiterungen, nicht MCP. Companion unter `/mcp` liefert Engine-Detect/Run und den Workspace-Pfad.

Neues `@trust`-Plugin und MCP-Bearer liegen lokal (Tresor).

---

## 4. Dateien

```
┌ Dateien ────────────── ┐
│ Filter…                │
│ ▾ src                  │
│    main.py             │
│    index.html          │
│ ▸ ref                  │
│ + Datei  + Ordner  💾  │
└────────────────────────┘
```

- Neue Datei / Ordner über die Knöpfe oder Rechtsklick
- Drag-and-Drop aus dem Explorer in den Baum
- Rechtsklick: umbenennen, duplizieren, löschen, Pfad, Zip
- `ref/` ist der **Referenzkorb** — Specs, Bilder, Notizen, die der Agent bevorzugt sieht. Im Chat: `@ref`

Arbeitskopie: standardmäßig Browser-Speicher. Für echten Ordner: Einstellungen → Speicher → **Ordner vom Rechner öffnen** (oder Dateien-Leiste).

---

## 5. Editor

Vorschläge wie am Handy: graue Leiste über der Zeile, **Tab** übernimmt. Aus: Einstellungen → Editor → Schreibvorschläge. Monaco lädt lokal (`/monaco/vs`), CDN nur als Fallback.

| Taste | |
|---|---|
| Ctrl+S | Speichern (optional formatieren; bei Formatfehler trotzdem speichern) |
| Ctrl+F / Ctrl+H | Suchen / Ersetzen **in der Datei** (Anvil-Leiste, nicht Monaco-Widget) |
| Ctrl+G | Zeile |
| F12 / Ctrl+Klick | Definition — auch über `import` in andere Dateien. Klick in der Glyph-Leiste = Breakpoint |
| Alt+F12 | Definition einsehen |
| Strg+T | Symbol im ganzen Workspace |
| Ctrl+K | Inline ändern (Auswahl beschreiben) |
| Ctrl+L | Ask zur Auswahl — erklärt, schreibt nicht |
| Ctrl+W | Tab schließen — fragt bei ungespeicherten Änderungen. „Andere schließen“ auch. |
| F5 | Debug |
| F10 | Schritt |
| Shift+F5 | Debug aus |
| Shift+Alt+F | Formatieren |

Live-Run: Python/JS nach dem Tippen, Ergebnis unter dem Editor. Voriger Live-Run wird verworfen, Run-Knopf bleibt frei. HTML: Run-Fenster. Dateien per Drop (Editor oder Tab): Nachfrage. Große Dateien (>1,5 MB) nur als Textvorschau. Tab-Wechsel merkt Cursor und Scroll.

---

## 6. Agent — Vorschau

```
┌ Agent ─────────────────────────────┐
│ Anvil handelt. Das Modell schreibt.│
│                                    │
│ Hier die Antwort.                  │
│ Spur daneben: Denken, Tools, Diff. │
│                                    │
│ [@main.py]                         │
│ ┌ Agent… @Datei @ref · Enter ┐ [➤]│
│ └────────────────────────────┘     │
│ [Kontext 16/33k ▓░░ 0%] [Sitzung 0]│
│ [Ask | Agent]                      │
└────────────────────────────────────┘
```

### Modus

- **Agent** — darf Dateien anlegen und ändern. Writes landen im Workspace. Aus: **Diffs automatisch** → Editor **Übernehmen / Verwerfen**. Spur **Zurück** stellt die ganze Runde wieder.
- **Ask** — erklärt. Darf lesen/suchen, nicht schreiben. Umschalten in der Chat-Leiste oder Standard unter Einstellungen → Agent

### Erwähnungen

Im Eingabefeld `@` tippen: Dateien und `ref/` erscheinen. Enter wählt. Auswahl (Ctrl+L): im Ask-Modus erklären, im Agent-Modus mit Auftrag patchen.

Bilder: Büroklammer oder Einfügen. Vision-fähiges Modell vorausgesetzt.

### Nach der Runde

- Spur: Diff gegen Checkpoint, **Zurück vor diese Runde**
- Editor: wenn Auto-Diffs aus, **Übernehmen** / **Verwerfen**
- Run-Schleife an: Anvil führt aus, sieht Fehler/Frames, der Agent patched. `run_file` startet immer (auch wenn die Schleife aus ist) — Compile+Run bei C/C++. Winkelklammern in Quelltext (`#include <iostream>`) nicht als `u003c` speichern.

Ollama: `num_ctx` = Slider, `keep_alive` 30m. Kein separates Generate-Warmup (das blockiert den Chat). Bei VRAM/OOM halbiert Anvil `num_ctx` und sendet erneut.

Cloud (OpenAI, xAI, …): Electron-Pipe holt den Strom direkt — Tokens live, nicht erst nach dem ganzen JSON. GPT-5/Codex: Responses-API mit `input` (nicht `messages`). 400 `param: input` darf das Feld nicht löschen. Ohne hartes Zeitlimit bricht Anvil nach 3 Min ab.

Chip **aktiv**, solange die Runde läuft. Abbrechen: Quadrat neben dem Feld.

**To-do** (Einstellungen → Agent): wer die Checkliste schreibt.

| | |
|---|---|
| **Auto** | Nummerierter Prompt bleibt. Sonst der Agent, solange kein Schritt läuft |
| **Anvil** | Nur Anvil. `set_plan` tickt, ersetzt nicht |
| **Helfer** | Nur der kleine Helfer |
| **Agent** | Nur `set_plan` |

Neuer Chat / neuer Auftrag: altes Ask-Ziel (*Antwort auf: …*) gilt nicht weiter.

Wenn das Modell eine Entscheidung braucht, stellt es eine **Nachfrage** mit 2–5 Optionen in Chat und Spur. Der Job bleibt stehen, Companion bleibt. Option klicken oder Enter = weiter am gleichen Auftrag. Stop / **Job beenden** = Job tot.

Wenn das Modell abbricht (lokal): Einstellungen → Agent → **Versuche** (Standard 3). Ohne Fortschritt: Hinweis nach 90 s. Harter Stop (Minuten) nur wenn gesetzt.

---

## 7. Run und Vorschau

Zwei getrennte Dinge:

| | Was | Wo |
|---|---|---|
| **Konsole** | Text, Fehler, REPL | Unten, Seite, oder eigenes Fenster |
| **Run-Fenster** | HTML / Spiel | Zweites Programmfenster, wie Anvil selbst |

```
┌ Run ──────────────┐     ┌ Konsole ─────────────┐
│                   │     │ ok  python main.py   │
│   (die Seite)     │     │ 42                   │
│                   │     │ >                    │
└───────────────────┘     └──────────────────────┘
```

HTML immer im Run-Fenster (Standard). Aus: Einstellungen → Ausgabe → **Run im Fenster**. Titel **Run · datei.html** — nicht „Keine Datei“, wenn HTML im Workspace liegt. Anvil schickt `runPath` ins Kindfenster.

Konsole docken: unten oder Seite, oder Knopf **Eigenes Fenster**.

Python/JS laufen hier. Go, Rust, Java, C, C++, C#, PHP, Ruby: **Run in Anvil**. Compiler zuerst auf diesem PC (Companion, startet automatisch bei Run), sonst im Netz. Companion ist **keine Website** — Einstellungen → **Companion**.

Eingabe (Tastatur, Maus, Gamepad) für HTML-Spiele: Einstellungen → Eingabe. Nach Änderung **Play** / Run neu, sonst gilt die alte Belegung.

---

## 8. Helfer

Kleines Modell **in Anvil**, nicht Ollama. Nur Kurzaufgaben: Intent, Titel, Commit-Zeile, unsichere Heuristik.

Einstellungen → **Helfer**

1. Helfer an
2. Modell wählen (klein, z. B. Qwen 0.5B / 1.5B Klasse)
3. **Laden** — erster Download groß, danach Cache
4. Statusleiste: `Helfer · Name · bereit`

**Testen** prüft, ob er antwortet. GPU High-Performance / Worker: nach dem nächsten Laden.

Der Helfer schreibt **keine** Dateien, startet **kein** Run, setzt **keine** Breakpoints und ruft **nicht** das Hauptmodell. Autonomie = nur Hinweise in der Leiste. Jobs (Intent, Titel, Commit-Zeile, Hilfe) einzeln in den Einstellungen. Standard: die meisten Jobs aus.

Modelle-Katalog: Einstellungen → Modelle. Pins vorladen, Cache OPFS/IndexedDB, „auf die Platte“ in der Desktop-App.

---

## 9. Einstellungen (alle Kategorien)

Zahnrad oder Suche oben in den Einstellungen.

| Kategorie | Inhalt |
|---|---|
| **Agent** | Anbieter, URL, Modell, Key, Profil, Context, Thinking, Versuche, Compacting, Ask/Agent, To-do (Auto/Anvil/Helfer/Agent), Diffs, Run, Harness, Regeln, MCP |
| **Companion** | Anlassen, Adresse, Port, Token, Prüfen, Koppeln, Compiler-Liste, MCP |
| **Helfer** | An, Profil, Autonomie, Laden, GPU, Context, Jobs |
| **Modelle** | Pins, Cache, Vorladen, Löschen |
| **Gedächtnis** | Lernen an, Prompt, Fakten, Skills, Destillieren |
| **Intern** | Fehlerbuch, Auto-heilen, Soft-/Hard-Reload, Werksreset |
| **Editor** | Sprache, Thema, Schrift, Einzug, Vorschläge, Live-Run |
| **Layout** | Presets, Anordnung, Statusleiste, Animation (Voll / Reduziert / Aus) |
| **Ausgabe** | Konsole docken, beim Run öffnen, Run im Fenster |
| **Speicher** | Browser oder Ordner, Auto-Save, Backup |
| **Eingabe** | Tasten/Pad für HTML-Run |
| **Tasten** | Übersicht und umbelegen |
| **Daten** | Tresor, Export/Import, Reset, Versionszeile |

Jeder Anbieter merkt sich URL, Modell, Context und Key. **Profil speichern** für benannte Stände (z. B. „Ollama LAN“, „OpenRouter“).

Cloud-Keys bleiben lokal (Tresor/Secrets). Ollama/LM Studio/LAN gehen direkt aus dem Fenster — CORS auf dem Modell-Rechner.

---

## 10. Companion

Kein Internet. Kleines Node-Programm **auf diesem PC**. Electron startet es bei **Run** und beendet es, wenn Run zu ist (außer **Anlassen**). Standard-Port **7845**. Anderer Port: Umgebung `ANVIL_COMPANION_PORT` (Server **und** Electron). LAN nur mit `ANVIL_COMPANION_HOST=0.0.0.0` plus Token. Pair (`/v1/pair`) nur localhost.

Einstellungen → **Companion**

| | |
|---|---|
| **Anlassen** aus | nur während Run (Standard) |
| **Anlassen** an | bleibt, bis Anvil zu ist |
| Prüfen / Koppeln | Token aus `~\.anvil-companion-token` |
| Grün in der Liste | `go` / `rustc` / … im PATH |

Browser ohne Electron: `companion\start.bat` oder `node companion\server.mjs`. Fenster offen lassen.

Patch für Anvil selbst: `grok.anvil-patch` neben `grok.mjs`, dann `node grok.mjs`, danach stop.bat / start.bat.

Companion räumt alte `anvil-run-*` unter `%TEMP%` auf (Windows). Volle Temp-Platte: Anvil beenden, dann start.bat.

---

## 11. Tafel (Harness / Graph)

Linke Leiste → Tafel.

```
┌ Tafel ─────────────────────────────────────┐
│  [Start]──write──[Run]──fail──[Patch]──┐  │
│                           └──see──[Look]│  │
│                                         │  │
│  Raster  Einrasten  Speichern  Ins Projekt│
└────────────────────────────────────────────┘
```

Kacheln sind Schritte. Leitungen: von einem **Ausgang** (rechts an der Kachel) zum **Eingang** (links). Ziehen, nicht die Kachelmitte.

- **Run-Schleife** — Write → Run → bei Fehler Patch (Text/Compile). Ein Loop, ein Schreib-Thread.
- **Graph** — nur Sichtprüfung: nach HTML-Run ein Frame. Kein zweites Auto-Run, kein Pflicht-Play.
- Aus ist aus: Projektdatei und Tafel dürfen die Schalter nicht überschreiben.
- Einstellungen → Agent: An, Nach Write, Versuche, Runden, Frames

**Ins Projekt** und Tafel **Speichern** schreiben `.anvil/harness.json`, `graph.json` und `board.json`. Der Agent darf die Tafel lesen und bauen; `board_write` lässt sie offen. `Cargo.toml` allein ist keine Engine (nur Godot/Unity/Bevy).

Layout zurück setzt auf den **verdrahteten** Standard (Write → Run → Fail → Patch), nicht auf leere Fläche.

---

## 12. Git, Tests, Debug

**Git** in der Leiste: Status, Diff, Commit, Push. Secrets und Tresor-Dateien gehören nicht in den Commit.

**Tests**: letzte Ausgabe als Liste, rot/grün, Klick auf Datei:Zeile. `pytest`, `npm test` oder Testdateien ausführen.

**Debug**: F5 auf der Datei. Schritte F10. JS im Debugger-Sandbox, Python analog soweit der Runner reicht.

---

## 13. Regeln und Referenzen

Der Agent liest immer, wenn vorhanden:

- `AGENTS.md` im Workspace
- `.anvil/rules.md`
- plus das Feld **Regeln** in den Einstellungen

`ref/` extra: Specs, Screenshots, APIs. Chat `@ref` oder `@ref/datei.md`. Index-Zeile pro Datei, sobald der Korb wächst.

---

## 14. Typische Störungen

| Symptom | Tun |
|---|---|
| Port 8080 belegt | stop.bat |
| Einstellungen weg nach anderem Fenster | Immer über start.bat / Electron, nicht wild im Browser |
| Ollama „lokale URL“ | URL mit `/v1`, CORS `OLLAMA_ORIGINS=*`, Verbindung prüfen |
| Modell bricht ab | Versuche 3–5, keep-alive am Server, kleineres Modell |
| Chat-Feld tot | Esc, Agent-Leiste zu/auf, Intern → Oberfläche neu. Nach 90 s ohne Fortschritt Hinweis. Harter Stop nur wenn unter Agent gesetzt. |
| HTML links, Konsole rechts, nichts zu sehen | Run im Fenster an, Vorschau im Editor aus |
| Graph-Phasen im Chat obwohl Graph aus | Graph-Schalter in Einstellungen **und** Tafel; Chat zeigt Phasen nur wenn an |
| Helfer nicht in der Leiste | Helfer an + Laden, nicht nur Katalog gewählt |
| Companion „Website“ | Ist lokal. 127.0.0.1 = dieser PC. Einstellungen → Companion |
| Temp voll (`anvil-run-*`) | Companion neu starten. Räumt `%TEMP%\anvil-run-*` / `anvil-fmt-*` / `anvil-dbg-*` selbst. GUI-Runs spätestens nach einer Stunde. |
| Go/Rust startet nicht | Run in Anvil. Companion startet mit. Compiler fehlt → Netz |

---

## 15. Daten und Reset

- **Nur Einstellungen zurücksetzen** — Workspace bleibt
- **Workspace zurücksetzen** — Dateien und Chat
- **Werksreset** (Intern) — alles inkl. Speicher, mit Nachfrage
- Export/Import unter Daten: JSON der IDE-Einstellungen, ohne Secrets
