# Anvil — Handbuch

Dieses Handbuch erklärt die Fenster, Einstellungen und wichtigsten Arbeitsabläufe. [Kurzfassung](01-kurz.md) · [Abläufe](03-workflow.md). Stand: 13.09.2026, Release 1.3.29. Einzelheiten zu den Funktionen stehen in den Fachanleitungen.

---

## 1. Was Anvil ist

Anvil ist eine lokale Entwicklungsumgebung in einem eigenen Programmfenster (Electron).

- Projekte im Anwendungsspeicher oder in einem lokalen Ordner
- Editor mit Codevorschlägen, Suche und Debugger
- Agent zum Erstellen und Bearbeiten von Dateien mit deinem gewählten Modell, beispielsweise über Ollama, LM Studio oder OpenAI
- Ausführung von Python und JavaScript sowie HTML-Vorschau in einem eigenen Fenster; weitere Sprachen über lokale oder optionale Online-Compiler
- Optionaler Helfer: ein kleines lokales Modell für kurze unterstützende Aufgaben
- Companion: ein Hintergrundprogramm auf deinem Computer, das Programme, Compiler und weitere Werkzeuge ausführt

Das Hauptmodell plant die Arbeit und fordert Werkzeuge an. Anvil führt diese Anforderungen aus, etwa Dateiänderungen, Programmläufe oder Git-Aktionen.

---

## 2. Installation und Start

### Voraussetzungen

- Windows; [Node.js LTS](https://nodejs.org) nur für den Start aus dem Quellcode
- Optional: Ollama / LM Studio auf diesem PC oder im LAN

### Installer

[Anvil 1.3.29](https://github.com/kokc866-hash/anvil/releases/tag/v1.3.29): **Setup-EXE** installieren oder **portable ZIP** vollständig in einen beschreibbaren Ordner entpacken und `Anvil.exe` starten. Oberfläche und Laufzeit sind enthalten; kein zusätzliches Node.js. Beide Pakete sind bewusst unsigniert. Vor einem Update Arbeit speichern und Anvil schließen. Die Daten liegen standardmäßig unter `data` neben der Anwendung; Details zu Updates und Datenerhalt stehen in der [Installationsanleitung](installation-abnahme.md).

### Quellcode für die Entwicklung

Dieser Weg verwendet `install.bat` einmalig und danach `start.bat` oder `Anvil.vbs`. Er ist vom fertig entpackten portablen ZIP zu unterscheiden.

```
anvil\
  start.bat      ← Anvil öffnen
  stop.bat       ← Anvil und Port 8080 beenden
  Anvil.vbs      ← stilles Starten, ohne Konsolenfenster
  TESTEN.md
  anleitungen\
```

**start.bat** prüft Node.js, installiert beim ersten Start die benötigten Pakete einschließlich Electron und öffnet anschließend Anvil.

Falls `electron.exe` fehlt:

```
npm install-scripts approve electron
node node_modules\electron\install.js
```

Wenn Port 8080 belegt ist, beende Anvil über **stop.bat** und starte es anschließend neu. `http://localhost:8080` ist eine Browseradresse, kein PowerShell-Befehl.

### Sprache

Unter Einstellungen → Editor → Sprache wählst du Deutsch oder Englisch. Die Änderung gilt sofort.

---

## 3. Fenster — Vorschau

```
┌──┬────────────────────┬──────────┬─────────────────────┐
│▓▓│  index.html ×      │ Spur     │  Agent              │
│📁│┌──────────────────┐│ Runde ←→ │  ┌───────────────┐  │
│📎││                  ││ Denken   │  │ Antwort       │  │
│🔎││     Editor       ││ Werkzeuge│  │               │  │
│⎇ ││                  ││ Änderung│  └───────────────┘  │
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
| Lupe | Projekt durchsuchen, Treffer prüfen und Text ersetzen |
| Ast | Git |
| Gehirn | Gedächtnis und Skills |
| Kolben | Tests ausführen und Ergebnisse mit Verweis auf Datei und Zeile anzeigen |
| Knoten | Tafel (Harness / Graph) |
| Puzzle | Mitgelieferte Erweiterungen, Projekt-Plugins und Open-VSX-/VSIX-Pakete |
| Stecker | Externe Arbeitsflächen und Werkzeuge über MCP |
| Fußspuren | Spur: Checkliste, Denkverlauf, Ausführungen und Dateiänderungen |
| Sprechblase | Agent ein- oder ausblenden |
| Terminal | Ausgabe |
| Zahnrad | Einstellungen |

### Mitte

In der Mitte liegen die Dateitabs und der Editor. Rechts daneben zeigt die Spur die Arbeitsschritte bis oberhalb der Konsole. Mit den Pfeilen wechselst du zwischen Runden. HTML-Seiten öffnen sich in einem eigenen Ausgabefenster.

### Rechts — Agent

Der Chat nutzt die volle Höhe auf der rechten Seite. Checkliste und Denkverlauf erscheinen in der **Spur**. Mit **Spur auch im Chat** kannst du sie zusätzlich im Chat anzeigen lassen.

### Unten — Status

Die Statusleiste zeigt das Hauptmodell, den Helferstatus sowie Zeile, Spalte, Einzug und Zeilenumbruch des Editors.

### Anordnung

Einstellungen → Layout:

- **Automatisch** — in schmalen Fenstern wird der Agent eingeblendet
- **Nebeneinander** — Agent bleibt rechts
- **Untereinander** — Agent unter dem Editor

Verfügbare Anordnungsvorlagen: IDE · Code + Agent · Schreiben · Ausführen.

**An Hardware anpassen** ermittelt Arbeitsspeicher, Prozessorkerne und Grafikleistung. Anvil passt daran Animationen und automatische Ausführungen an. Die WebGPU-Unterstützung wird für das Helfermodell berücksichtigt.

### Erweiterungen (Puzzle)

Drei Arten von Erweiterungen stehen zur Verfügung:

- **Grundfunktionen** — etwa Formatierung, Codevorlagen, Codeprüfung, Web, ZIP, Debugger und Helfer. Wenn du eine Funktion deaktivierst, stehen ihre Befehle nicht mehr zur Verfügung.
- **Projekt-Plugins** — Dateien unter `plugins/*.js` mit `activate(anvil)`. Ohne `// @trust` in den ersten acht Zeilen haben sie nur Lesezugriff. Mit `@trust` können sie zusätzlich schreiben, den Agenten verwenden und auf das Netzwerk zugreifen. Solche Plugins sind zunächst deaktiviert und müssen bewusst eingeschaltet werden.
- **Marktplatz und VSIX** — Pakete aus Open VSX oder `.vsix`-Dateien. Anvil übernimmt Codevorlagen, Sprachdefinitionen, Kommentarregeln und Schlüsselwörter aus `tmLanguage`. Der Programmcode der VS Code-Erweiterung und ihre Sprachserver werden nicht ausgeführt. Pakete lassen sich deaktivieren und entfernen.

Mit **Neues Plugin** erstellst du `plugins/mein-plugin.js`. Seine Befehle findest du in der Befehlspalette unter Strg+Umschalt+P.

### MCP (Stecker)

Im MCP-Bereich verwaltest du externe Server. Ab Anvil 1.3.20 sind native HTTP-/stdio-Verbindungen, OAuth und Ressourcen verfügbar; siehe [MCP-Anleitung](mcp.md).

- Aktiviere den Server und wähle **Werkzeuge laden**, um seinen Katalog abzurufen. **Hier arbeiten** legt ihn als Arbeitsfläche fest.
- **Nur aktive Arbeitsfläche** — der Agent verwendet die MCP-Werkzeuge und Ressourcen dieses Servers.
- **Brücke** — der Agent kann im selben Auftrag MCP-Werkzeuge und Anvil-Dateien verwenden.
- Die Kontextzeile, beispielsweise `scene=overworld`, wird als Werkzeugargument übergeben, wenn das Werkzeug diesen Schlüssel unterstützt.
- Open-VSX-Pakete findest du unter Erweiterungen. Companion bietet unter `/mcp` Werkzeuge zur Engine-Erkennung und -Ausführung sowie den Projektpfad an.

Projekt-Plugins werden lokal gespeichert. MCP-Zugangsschlüssel werden im lokalen Tresor verwaltet.

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

- Erstelle Dateien und Ordner über die Schaltflächen oder das Kontextmenü.
- Ziehe Dateien aus dem Explorer in den Dateibaum, um sie hinzuzufügen.
- Per Rechtsklick kannst du Dateien umbenennen, duplizieren, löschen, ihren Pfad kopieren oder sie als ZIP exportieren.
- `ref/` ist der **Referenzkorb** für Anforderungen, Bilder und Notizen, die der Agent berücksichtigen soll. Im Chat kannst du ihn mit `@ref` erwähnen.

Die Arbeitskopie liegt zunächst im Anwendungsspeicher. Mit **Lokalen Ordner öffnen** unter Einstellungen → Speicher oder in der Dateileiste verbindest du einen Ordner auf deinem Computer.

---

## 5. Editor

Codevorschläge erscheinen in einer Leiste über der Zeile. Mit **Tab** übernimmst du einen Vorschlag. Unter Einstellungen → Editor → Schreibvorschläge kannst du diese Funktion deaktivieren. Der Editor Monaco wird lokal geladen (`/monaco/vs`); ein CDN dient nur als Ausweichlösung.

| Tastenkürzel | Funktion |
|---|---|
| Ctrl+S | Speichern (optional formatieren; bei Formatfehler trotzdem speichern) |
| Ctrl+F / Ctrl+H | Suchen / Ersetzen **in der Datei** (Anvil-Leiste, nicht Monaco-Widget) |
| Ctrl+G | Zu einer Zeile springen |
| F12 / Ctrl+Klick | Definition öffnen, auch über `import` in einer anderen Datei. Ein Klick am linken Editorrand setzt einen Haltepunkt. |
| Alt+F12 | Definition einsehen |
| Strg+T | Symbol im gesamten Projekt suchen |
| Ctrl+K | Auswahl bearbeiten: gewünschte Änderung beschreiben |
| Ctrl+L | Frage zur Auswahl stellen, ohne Dateien zu ändern |
| Ctrl+W | Tab schließen. Ungespeicherte Änderungen müssen bestätigt werden, auch bei „Andere schließen“. |
| F5 | Debugger starten |
| F10 | Nächsten Debugschritt ausführen |
| Shift+F5 | Debugger beenden |
| Shift+Alt+F | Formatieren |

**Beim Bearbeiten ausführen** startet Python oder JavaScript nach einer Eingabepause und zeigt das Ergebnis unter dem Editor. Eine noch laufende automatische Ausführung wird dabei ersetzt; die Schaltfläche **Ausführen** bleibt unabhängig nutzbar. HTML öffnet sich im Ausgabefenster. Wenn du Dateien auf den Editor oder einen Tab ziehst, fragt Anvil vor dem Hinzufügen nach. Große Dateien über 1,5 MB erscheinen nur als Textvorschau. Beim Tabwechsel bleiben Cursorposition und Bildlauf erhalten.

---

## 6. Agent — Vorschau

```
┌ Agent ─────────────────────────────┐
│ Dateien bearbeiten und prüfen     │
│                                    │
│ Hier die Antwort.                  │
│ Spur: Denkverlauf und Werkzeuge    │
│                                    │
│ [@main.py]                         │
│ ┌ Agent… @Datei @ref · Enter ┐ [➤]│
│ └────────────────────────────┘     │
│ [Kontext 16/33k ▓░░ 0%] [Sitzung 0]│
│ [Fragen | Agent]                   │
└────────────────────────────────────┘
```

### Modus

- **Agent** — darf Dateien erstellen und bearbeiten. Wenn **Änderungen automatisch übernehmen** ausgeschaltet ist, zeigt der Editor anschließend **Übernehmen** und **Verwerfen** an. Die Dateien wurden zu diesem Zeitpunkt bereits geändert. In der Spur kannst du die Dateiänderungen einer ganzen Runde rückgängig machen.
- **Fragen** — erklärt und analysiert. Der Agent darf lesen und suchen, aber keine Projektdateien ändern. Du wechselst den Modus in der Chatleiste; den Standard legst du unter Einstellungen → Agent fest.

### Erwähnungen

Tippe `@` im Eingabefeld, um eine Datei oder `ref/` auszuwählen. Enter übernimmt die Auswahl. Mit Strg+L stellst du eine Frage zum markierten Code. Im Agentenmodus kannst du stattdessen eine konkrete Änderung beauftragen.

Bilder kannst du über die Anhangsschaltfläche oder die Zwischenablage hinzufügen. Das gewählte Modell muss Bildinhalte verarbeiten können.

### Nach der Runde

- Die Spur zeigt Dateiänderungen gegenüber der Sicherung vor dieser Runde. **Diese Runde rückgängig machen** stellt diesen Stand wieder her.
- Wenn Änderungen nicht automatisch übernommen werden, kannst du sie im Editor **Übernehmen** oder **Verwerfen**.
- Bei aktiven automatischen Ausführungen startet Anvil den Code und gibt Fehler oder verfügbare Vorschauaufnahmen an den Agenten zurück. Dieser kann anschließend Korrekturen vornehmen. Das Werkzeug `run_file` kann auch bei ausgeschalteter Ausführungsschleife verwendet werden; bei C/C++ kompiliert und startet es das Programm. Winkelklammern in Quelltext wie `#include <iostream>` müssen als echte Zeichen erhalten bleiben.

Bei Ollama legt die Einstellung für die Kontextlänge `num_ctx` fest. `keep_alive` beträgt 30 Minuten. Anvil sendet keine separate Aufwärmanfrage, die den Chat blockieren könnte. Bei einem Fehler wegen unzureichenden Grafikspeichers halbiert Anvil `num_ctx` und versucht die Anfrage erneut.

Cloud-APIs werden über die native Modellleitung, den Companion oder den Server angesprochen. Abo-Verbindungen starten die installierte Codex-, Claude-Code- oder Copilot-CLI mit deren eigener Anmeldung. Anvil führt angeforderte Werkzeuge weiterhin selbst aus. Details und Einrichtung: [Verbindungen](05-verbindungen.md).

Während einer laufenden Runde zeigt die Statusanzeige **aktiv**. Mit der quadratischen Schaltfläche neben dem Eingabefeld brichst du den Auftrag ab.

Unter Einstellungen → Agent → **To-do** legst du fest, wer die Checkliste erstellt.

| Auswahl | Verhalten |
|---|---|
| **Automatisch** | Übernimmt eine nummerierte Liste aus deiner Nachricht. Andernfalls erstellt der Agent die Checkliste, solange noch kein Schritt läuft. |
| **Anvil** | Anvil erstellt die Checkliste. Der Agent kann mit `set_plan` den Fortschritt aktualisieren, aber die Liste nicht ersetzen. |
| **Helfer** | Das Helfermodell erstellt die Checkliste. |
| **Agent** | Der Agent erstellt und aktualisiert die Checkliste mit `set_plan`. |

Bei einem neuen Chat oder Auftrag wird ein vorheriger Bezug unter *Antwort auf: …* nicht übernommen.

Wenn das Modell eine Entscheidung benötigt, erscheint eine **Nachfrage** mit zwei bis fünf Optionen in Chat und Spur. Der Auftrag wartet auf deine Antwort; Companion bleibt verfügbar. Wähle eine Option oder bestätige deine eigene Antwort mit Enter, um denselben Auftrag fortzusetzen. **Stoppen** oder **Auftrag beenden** beendet ihn.

Unter Einstellungen → Agent → **Versuche** legst du fest, wie oft wiederholbare Verbindungsfehler erneut versucht werden (Standard: drei Versuche). Nach 90 Sekunden ohne Fortschritt erscheint ein Hinweis. Ein festes Zeitlimit gilt nur, wenn du **Harter Stop** eingestellt hast.

---

## 7. Ausführen und Vorschau

Anvil zeigt Textausgaben und grafische Vorschauen in getrennten Bereichen:

| Bereich | Inhalt | Position |
|---|---|---|
| **Konsole** | Textausgaben, Fehler und interaktive Befehle | Unten, seitlich oder in einem eigenen Fenster |
| **Ausgabefenster** | HTML-Seiten und Spiele | Eigenes Programmfenster |

```
┌ Ausgabe ──────────┐     ┌ Konsole ─────────────┐
│                   │     │ ok  python main.py   │
│   (die Seite)     │     │ 42                   │
│                   │     │ >                    │
└───────────────────┘     └──────────────────────┘
```

HTML-Seiten öffnen sich standardmäßig im Ausgabefenster. Unter Einstellungen → Ausgabe → **In eigenem Fenster ausführen** kannst du das ändern. **HTML ausführen** erlaubt HTML-Vorschauen auch für vom Agenten erstellte Inhalte. Wenn du die Option ausschaltest, werden nur Text und Protokoll angezeigt.

Das Ausgabefenster verwendet dieselbe Sitzung wie der Editor. Die Vorschau selbst läuft in einem isolierten iframe. Anvil übergibt den Dateipfad über `runPath`, damit das Fenster die richtige Projektdatei öffnet und ihren Namen im Titel anzeigt.

Die Konsole kannst du unten oder seitlich andocken. Mit **Eigenes Fenster** öffnest du sie separat.

Python und JavaScript lassen sich direkt in Anvil ausführen. Für Go, Rust, Java, C, C++, C#, PHP und Ruby verwendet Anvil die über Companion verfügbaren Compiler oder Laufzeiten. Lokale Werkzeuge haben Vorrang; ein Online-Compiler wird nur bei aktivierter Ausweichlösung verwendet. Die Verbindung und Werkzeuge verwaltest du unter Einstellungen → **Companion**.

Unter Einstellungen → Eingabe legst du Tastatur-, Maus- und Gamepad-Steuerung für HTML-Spiele fest. Starte die Vorschau nach einer Änderung erneut, damit die neue Belegung wirksam wird.

---

## 8. Helfer

Der Helfer ist ein kleines Modell, das direkt **in Anvil** läuft. Es unterstützt kurze Aufgaben wie die Erkennung einer Absicht, Chat-Titel, Commit-Nachrichten oder die Prüfung unsicherer regelbasierter Ergebnisse.

Einstellungen → **Helfer**

1. Aktiviere den Helfer.
2. Wähle ein kleines Modell, beispielsweise aus der Qwen-0.5B- oder -1.5B-Klasse.
3. Wähle **Laden**. Beim ersten Mal werden die Modelldateien heruntergeladen, später aus dem lokalen Zwischenspeicher geladen.
4. Warte auf die Statusanzeige `Helfer · Name · bereit`.

Mit **Testen** prüfst du, ob der Helfer antwortet. Änderungen am GPU-Leistungsmodus oder an der Worker-Ausführung gelten nach dem nächsten Laden des Modells.

Der Helfer übernimmt keine selbstständige Projektarbeit: Er startet keine Programme, setzt keine Haltepunkte und ruft nicht das Hauptmodell auf. Automatische Helferaufgaben liefern Hinweise in der Oberfläche. Aufgaben wie Absichtserkennung, Titel, Commit-Nachricht und Hilfe lassen sich einzeln einstellen; die meisten sind standardmäßig ausgeschaltet.

Den Modellkatalog findest du unter Einstellungen → Modelle. Dort kannst du angeheftete Modelle vorladen und den Zwischenspeicher verwalten. Je nach Betriebsart werden Modelldaten im Browserspeicher (OPFS/IndexedDB) oder lokal über die Desktop-App gespeichert.

---

## 9. Einstellungen (alle Kategorien)

Öffne die Einstellungen über das Zahnrad. Mit dem Suchfeld oben findest du einzelne Optionen.

| Kategorie | Inhalt |
|---|---|
| **Agent** | Anbieter, Adresse, Modell, API-Schlüssel, Profile, Kontextlänge, Denkaufwand, Wiederholungsversuche, Kontextzusammenfassung, Arbeitsmodus, Checkliste, Dateiänderungen, Ausführung, Regeln und MCP |
| **Companion** | Hintergrundbetrieb, Adresse, Port, Zugangsschlüssel, Verbindungsprüfung, Kopplung, Compiler und MCP |
| **Helfer** | Aktivierung, Profile, automatische Aufgaben, Modell laden, GPU und Kontext |
| **Modelle** | Modelle anheften, vorladen und aus dem Zwischenspeicher löschen |
| **Gedächtnis** | Lernen, Anweisungen, Fakten, Skills und Zusammenfassungen |
| **Intern** | Fehlerprotokoll, automatische Fehlerbehebung, Oberfläche neu aufbauen, Seite neu laden und Werkseinstellungen |
| **Editor** | Sprache, Farbschema, Schrift, Einzug, Vorschläge und Ausführung beim Bearbeiten |
| **Layout** | Anordnungsvorlagen, Fensteranordnung, Statusleiste und Animationen |
| **Ausgabe** | Konsole andocken, beim Ausführen öffnen, eigenes Fenster und HTML-Vorschau |
| **Speicher** | Anwendungsspeicher oder lokaler Ordner, automatisches Speichern und Sicherungen |
| **Eingabe** | Tastatur- und Gamepad-Steuerung für HTML-Vorschauen |
| **Tastenkürzel** | Tastenkürzel anzeigen und ändern |
| **Daten** | Updates, Konten, Tresor, Export, Import und Zurücksetzen |

Für jeden Anbieter bleiben Adresse, Modell, Kontext und Zugangsdaten gespeichert. Mit **Profil speichern** verwaltest du mehrere Konfigurationen unter einem Namen, beispielsweise „Ollama LAN“ oder „OpenRouter“.

Cloud-Zugangsschlüssel werden lokal gespeichert. Beim direkten Browserzugriff auf Ollama, LM Studio oder einen Netzwerkserver müssen die CORS-Freigaben des Modellservers passen.

---

## 10. Companion

Companion ist ein kleines Node-Programm, das standardmäßig auf deinem Computer läuft. Die Desktop-App startet es bei Bedarf. Mit **Im Hintergrund geöffnet lassen** bleibt es bis zum Schließen von Anvil aktiv.

Der Standardport ist **7845**. Für einen anderen Port setzt du `ANVIL_COMPANION_PORT` sowohl beim Server als auch bei Electron. Netzwerkzugriff erfordert `ANVIL_COMPANION_HOST=0.0.0.0` und einen Zugangsschlüssel. Die Kopplung über `/v1/pair` ist nur lokal möglich.

Einstellungen → **Companion**

| Einstellung oder Anzeige | Bedeutung |
|---|---|
| **Im Hintergrund geöffnet lassen** aus | Companion läuft nur während der Ausführung (Standard). |
| **Im Hintergrund geöffnet lassen** an | Companion bleibt bis zum Schließen von Anvil aktiv. |
| Prüfen / Koppeln | Die Verbindung verwendet den Zugangsschlüssel aus `~\.anvil-companion-token`. |
| Grüne Anzeige in der Compilerliste | Ein Compiler wie `go` oder `rustc` wurde über PATH gefunden. |

Wenn du Anvil im Browser verwendest, starte Companion über `companion\start.bat` oder `node companion\server.mjs`. Lass das zugehörige Fenster geöffnet.

Um einen Patch für Anvil selbst anzuwenden, lege `grok.anvil-patch` neben `grok.mjs` und führe `node grok.mjs` aus. Starte Anvil anschließend über stop.bat und start.bat neu.

Companion entfernt unter Windows alte Ausführungsordner mit dem Namen `anvil-run-*` aus `%TEMP%`. Wenn diese temporären Dateien viel Speicher belegen, beende Anvil und starte es erneut über start.bat.

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

Jede Kachel stellt einen Arbeitsschritt dar. Um zwei Schritte zu verbinden, ziehe eine Leitung vom **Ausgang** rechts an einer Kachel zum **Eingang** links an der nächsten Kachel. Ziehe dafür am Anschluss, nicht an der Kachelmitte.

- **Automatische Ausführungen** — nach dem Schreiben wird der Code ausgeführt. Bei Fehlern kann der Agent ihn korrigieren. Die Arbeit erfolgt in einer gemeinsamen Schleife.
- **Graph** — ergänzt die Sichtprüfung mit einer Aufnahme nach einer HTML-Ausführung. Er startet keine zweite Ausführungsschleife und verlangt keine zusätzliche Interaktion.
- Ausgeschaltete Funktionen bleiben ausgeschaltet. Weder Projektdateien noch die Tafel dürfen diese Einstellungen überschreiben.
- Unter Einstellungen → Agent konfigurierst du die Aktivierung, Ausführung nach Dateiänderungen, Wiederholungsversuche, Runden und Bildaufnahmen.

**Ins Projekt** und **Speichern** legen die Tafelkonfiguration in `.anvil/harness.json`, `graph.json` und `board.json` ab. Der Agent darf die Tafel lesen und bearbeiten; nach `board_write` bleibt sie geöffnet. Eine `Cargo.toml` allein kennzeichnet noch kein Engine-Projekt. Die Erkennung berücksichtigt Godot, Unity und Bevy.

Das Zurücksetzen des Layouts stellt den verbundenen Standardablauf wieder her: Schreiben → Ausführen → Fehler prüfen → Korrigieren.

---

## 12. Git, Tests und Debugger

Unter **Git** findest du Status, Dateiänderungen, Commits und Push. Zugangsdaten und Tresordateien gehören nicht in einen Commit.

Der Bereich **Tests** zeigt die Ergebnisse der letzten Ausführung. Grün steht für bestandene, Rot für fehlgeschlagene Tests. Ein Klick öffnet die zugehörige Datei und Zeile. Starte Tests beispielsweise mit `pytest`, `npm test` oder einer Testdatei.

Mit **F5** startest du den Debugger für die geöffnete Datei. **F10** führt den nächsten Schritt aus. JavaScript läuft in einer Debugger-Sandbox; die verfügbaren Python-Funktionen hängen von der unterstützten Laufzeit ab.

---

## 13. Regeln und Referenzen

Der Agent liest immer, wenn vorhanden:

- `AGENTS.md` im Projekt
- `.anvil/rules.md`
- zusätzlich das Feld **Regeln** in den Einstellungen

Im Ordner `ref/` kannst du Anforderungen, Screenshots und API-Dokumentationen ablegen. Erwähne im Chat `@ref` oder eine einzelne Datei wie `@ref/datei.md`. Bei größeren Sammlungen verwendet Anvil eine Übersicht mit einem Eintrag je Datei.

---

## 14. Typische Störungen

| Problem | Mögliche Lösung |
|---|---|
| Port 8080 ist belegt | Beende Anvil mit stop.bat und starte es erneut. |
| Einstellungen fehlen in einem anderen Fenster | Starte Anvil über denselben Weg, beispielsweise start.bat oder die Desktop-App. Ein anderer Browser kann einen eigenen Datenspeicher verwenden. |
| Ollama „lokale URL“ | URL mit `/v1`, etwa `http://IP:11434/v1`, dann Modellliste laden. Desktop nutzt die native Modellleitung; direkter Browserzugriff benötigt passende CORS-Freigaben. |
| Modellanfragen brechen ab | Prüfe die Wiederholungsversuche, die keep-alive-Einstellung des Modellservers und den verfügbaren Speicher. Ein kleineres Modell kann helfen. |
| Chat reagiert nicht | Prüfe die Anfragephase oben im Chat. Nach drei Minuten erscheint ein Hinweis zum manuellen Abbrechen. Ein festes Zeitlimit gilt nur bei eingestelltem „Harter Stop“. Esc oder die Abbruchschaltfläche beendet die Anfrage. |
| HTML-Vorschau ist nicht sichtbar | Aktiviere „In eigenem Fenster ausführen“ und deaktiviere gegebenenfalls die Vorschau im Editor. |
| Graph-Phasen erscheinen trotz ausgeschaltetem Graphen | Prüfe den Graph-Schalter in den Einstellungen und auf der Tafel. Die Phasen sollten nur bei aktivierter Funktion erscheinen. |
| Helfer fehlt in der Statusleiste | Aktiviere den Helfer und lade das Modell. Die Auswahl im Katalog allein lädt es noch nicht. |
| Companion-Adresse ist unklar | Companion läuft standardmäßig lokal. 127.0.0.1 bezeichnet deinen Computer. Die Verbindung findest du unter Einstellungen → Companion. |
| Temporäre Ausführungsdateien belegen viel Speicher | Starte Companion neu. Es bereinigt `%TEMP%\anvil-run-*`, `anvil-fmt-*` und `anvil-dbg-*`; grafische Ausführungen spätestens nach einer Stunde. |
| Go oder Rust startet nicht | Prüfe unter Companion, ob der benötigte Compiler verfügbar ist. Ein Online-Compiler kann als ausdrücklich aktivierte Ausweichlösung dienen. |

---

## 15. Daten und Zurücksetzen

- **Nur Einstellungen zurücksetzen** setzt die Konfiguration zurück; das Projekt bleibt erhalten.
- **Projekt zurücksetzen** betrifft Dateien und Chat.
- **Auf Werkseinstellungen zurücksetzen** unter Intern löscht nach einer Nachfrage die Einstellungen und gespeicherten Daten.
- Unter Daten kannst du die Anvil-Einstellungen als JSON exportieren oder importieren. Zugangsdaten werden nicht exportiert.
- **Konto:** Über GitHub-Gist oder Google Drive kannst du Einstellungen auf einen anderen Computer übertragen. API-Schlüssel werden nicht mit übertragen.
- **Updates:** Unter Daten suchst du nach neuen Versionen und lädst die ZIP-Datei oder den Installer herunter. Die portable ZIP-Datei muss vollständig entpackt werden, bevor du die enthaltene `Anvil.exe` startest.
