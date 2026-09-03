# Anvil 1.2.0 — Handbuch

Ausführlich, mit Vorschau der Fenster. Kurzfassung: `01-kurz.md`. Abläufe: `03-workflow.md`. Stand: 29.08.2026.

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

- Windows, [Node.js LTS](https://nodejs.org)
- Optional: Ollama / LM Studio auf diesem PC oder im LAN

### Start

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
│📁│┌──────────────────┐│ Plan     │  ┌───────────────┐  │
│📎││                  ││ Denken   │  │ Antwort       │  │
│🔎││     Editor       ││ Diff     │  │               │  │
│⎇ ││                  ││ Run      │  └───────────────┘  │
│🧠│└──────────────────┘│          │  [@main.py]         │
│🧪│                    ├──────────┤  ┌─────────┐  [➤]  │
│▦ │  Konsole           │          │  │ Agent…  │       │
│💬│  > print(1)        │          │  └─────────┘       │
│🐾│                    │          │  Kontext 16/33k    │
├──┴────────────────────┴──────────┴─────────────────────┤
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
| Puzzle | Erweiterungen |
| Fußspuren | Spur (Plan, Denken, Run, Diff) |
| Blase | Agent ein/aus |
| Terminal | Ausgabe |
| Zahnrad | Einstellungen |

### Mitte

Tabs, Editor. Spur rechts daneben, nur bis zur Konsole. HTML öffnet **nicht** hier, sondern ein eigenes Run-Fenster.

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

Vorschläge wie am Handy: graue Leiste über der Zeile, **Tab** übernimmt. Aus: Einstellungen → Editor → Schreibvorschläge.

| Taste | |
|---|---|
| Ctrl+S | Speichern (optional formatieren) |
| Ctrl+F / Ctrl+H | Suchen / Ersetzen |
| Ctrl+G | Zeile |
| F12 / Ctrl+Klick | Definition — auch über `import` in andere Dateien |
| Alt+F12 | Definition einsehen |
| Strg+T | Symbol im ganzen Workspace |
| Ctrl+K | Inline ändern (Auswahl beschreiben) |
| Ctrl+L | Ask zur Auswahl — erklärt, schreibt nicht |
| F5 | Debug |
| F10 | Schritt |
| Shift+F5 | Debug aus |
| Shift+Alt+F | Formatieren |

Live-Run: Python/JS nach dem Tippen, Ergebnis unter dem Editor. HTML: Run-Fenster.

---

## 6. Agent — Vorschau

```
┌ Agent ─────────────────────────────┐
│ Anvil handelt. Das Modell schreibt.│
│                                    │
│ ▾ Denken                    live   │
│   (klappt zu, wenn fertig)         │
│                                    │
│ Plan                               │
│  [x] Datei anlegen                 │
│  [x] schreiben                     │
│  [ ] Run                           │
│                                    │
│ Hier der Text.                     │
│ ┌ diff main.py ─┐                  │
│ │ + print("hi") │  Übernehmen      │
│ └───────────────┘                  │
│                                    │
│ [@main.py]                         │
│ ┌ Agent… @Datei @ref · Enter ┐ [➤]│
│ └────────────────────────────┘     │
│ [Kontext 16/33k ▓░░ 0%] [Sitzung 0]│
│ [Denken auto] [Kompakt auto] [Run] │
└────────────────────────────────────┘
```

### Modus

- **Agent** — darf Dateien anlegen und ändern
- **Ask** — nur erklären. Umschalten in der Chat-Leiste oder Standard unter Einstellungen → Agent

### Erwähnungen

Im Eingabefeld `@` tippen: Dateien und `ref/` erscheinen. Enter wählt.

Bilder: Büroklammer oder Einfügen. Vision-fähiges Modell vorausgesetzt.

### Nach der Runde

- Diffs: **Übernehmen** / **Verwerfen** / alle
- **Zurück vor diese Runde** — Workspace auf den Snapshot
- **Nochmals** — gleiche Aufgabe
- Run-Schleife an: Anvil führt aus, sieht Fehler/Frames, der Agent patched

Chip **aktiv**, solange die Runde läuft. Abbrechen: Quadrat neben dem Feld.

Wenn das Modell abbricht (lokal): Einstellungen → Agent → **Versuche** (Standard 3).

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

HTML immer im Run-Fenster (Standard). Aus: Einstellungen → Ausgabe → **Run im Fenster**.

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

Der Helfer schreibt **keine** Dateien und ruft **nicht** das Hauptmodell.

Modelle-Katalog: Einstellungen → Modelle. Pins vorladen, Cache OPFS/IndexedDB, „auf die Platte“ in der Desktop-App.

---

## 9. Einstellungen (alle Kategorien)

Zahnrad oder Suche oben in den Einstellungen.

| Kategorie | Inhalt |
|---|---|
| **Agent** | Anbieter, URL, Modell, Key, Profil, Context, Thinking, Versuche, Compacting, Ask/Agent, Diffs, Run, Harness, Regeln, MCP |
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

Kein Internet. Kleines Node-Programm **auf diesem PC**. Anvil (Electron) startet es bei **Run** und beendet es, wenn Run zu ist.

Einstellungen → **Companion**

| | |
|---|---|
| **Anlassen** aus | nur während Run (Standard) |
| **Anlassen** an | bleibt, bis Anvil zu ist |
| Prüfen / Koppeln | Token aus `~\.anvil-companion-token` |
| Grün in der Liste | `go` / `rustc` / … im PATH |

Browser ohne Electron: `companion\start.bat` oder `node companion\server.mjs`. Fenster offen lassen.

Patch für Anvil selbst: `grok.anvil-patch` neben `grok.mjs`, dann `node grok.mjs`, danach stop.bat / start.bat.

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

- **Run-Schleife** — nach dem Schreiben ausführen, bei Fehler erneut
- **Graph** — Frames ansehen, Agent patched die Darstellung
- Einstellungen → Agent: An, Nach Write, Versuche, Runden, Frames

**Ins Projekt** schreibt `.anvil/harness.json`. Der Agent darf die Tafel lesen und bauen.

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
| Chat-Feld tot | Esc, Agent-Leiste zu/auf, Intern → Oberfläche neu. Nach 90 s ohne Fortschritt bricht Anvil den Agent selbst ab. |
| HTML links, Konsole rechts, nichts zu sehen | Run im Fenster an, Vorschau im Editor aus |
| Graph-Phasen im Chat obwohl Graph aus | Graph-Schalter in Einstellungen **und** Tafel; Chat zeigt Phasen nur wenn an |
| Helfer nicht in der Leiste | Helfer an + Laden, nicht nur Katalog gewählt |
| Companion „Website“ | Ist lokal. 127.0.0.1 = dieser PC. Einstellungen → Companion |
| Go/Rust startet nicht | Run in Anvil. Companion startet mit. Compiler fehlt → Netz |

---

## 15. Daten und Reset

- **Nur Einstellungen zurücksetzen** — Workspace bleibt
- **Workspace zurücksetzen** — Dateien und Chat
- **Werksreset** (Intern) — alles inkl. Speicher, mit Nachfrage
- Export/Import unter Daten: JSON der IDE-Einstellungen, ohne Secrets
