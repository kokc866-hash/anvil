# Anvil: Praxistest auf dem eigenen Rechner

12. September 2026 · Anvil 1.3.24 · lokaler Entwicklungsstand

**Neuerer Umsetzungsstand:** [Produktarbeit 1–6](produktabschluss.md) mit Einstieg ohne KI, geführten Aufgaben, Verbindungsgrenzen, Hilfe und erweiterten Rücknahmeprüfungen. Dieser Bericht erhält die ursprüngliche Untersuchung und Reparaturgeschichte.

**Aktuelle Reparaturabnahme:** Die drei anschließend im Tageswerk-Test gefundenen Fehler sind behoben: keine erneut eingefügten Standarddateien beim Neustart, Rücknahme ohne künstliche Speicherkonflikte, verständliche Abbruch- und Abschlussmeldungen. Die gebaute Desktop-Version besteht den gezielten Wiederholungstest einschließlich Schutz bei echter externer Dateiänderung. [Nachweise und Grenzen](I:/Anvil/anleitungen/praxistest-tageswerk.md).

**Anschließender ausführlicher Produkttest:** [Tageswerk vollständig in Anvil erstellen und bedienen](I:/Anvil/anleitungen/praxistest-tageswerk.md). Dieser neue Test verwendet den echten Ordnerdialog und echte Modellaufträge, umfasst einen vollständigen App-Neustart und dokumentiert zusätzliche Befunde bei Standarddateien, Rundenrücknahme und Abbruchdarstellung.

## Reparatur und erneute Abnahme am selben Tag

**Die nachfolgend ursprünglich beschriebenen technischen Fehler sind jetzt repariert und erneut geprüft:**

- Run-/Play-Bilder bleiben in Anvils Spur sichtbar. Für die Text-CLI werden interne Ergebnisbilder durch einen ehrlichen Texthinweis ersetzt; die Folgeanfrage und der Abschluss funktionieren. Vom Nutzer angehängte Bilder werden weiterhin als nicht unterstützte Eingabe zurückgewiesen. API-Verbindungen behalten ihre ursprünglichen Bildnachrichten ohne zusätzliche API-Felder.
- Die Ersteinrichtung unterscheidet „Eingebaut“, „Auf dem Rechner“, „Im Netz“ und „Custom“. Lokale Verbindungsfehler zeigen eine verständliche Handlung; technische Details lassen sich ausklappen.
- Der Einstieg verwendet unter Electron denselben nativen Workspace-Pfad wie „Desktop-Ordner“. Der Browserweg bleibt erhalten.
- Die beiden Einstellungs-/Verbindungstests überwachen das Profilverzeichnis nicht mehr und bestehen bei geöffneter App ohne Polling-Umweg.

**Frische Nachweise:** Der neue Regressionstest `scripts/cli-run-frame.test.mjs` scheiterte vor der Reparatur exakt an der beobachteten Bildmeldung und besteht danach. Zusammen mit den gezielten Zustands-, Verbindungs-, Agenten- und Kontextprüfungen bestanden 31 Tests. Der zusätzliche bestehende Workspace-Test bestand ebenfalls. Typprüfung und Windows-UI-Build sind erfolgreich.

Die native Abnahme lief über `scripts/produkt-fixes.browser.mjs`: Einstieg und Laden des Projekts im Entwicklungsmodus sowie der gesamte Ablauf im endgültigen Produktionsbuild. Der bestehende Codex-Abo-Zugang wurde tatsächlich verwendet (`gpt-5.6-terra`, Thinking Low). Die CLI-Antwort wurde nicht simuliert. Der Agent änderte die Datei, führte sie mit Bildaufnahme aus und schloss den Auftrag ohne den bisherigen Fehler ab. Danach wurden Übernehmen, Ausführen, **0 → 2 → 0** und Speichern auf Festplatte geprüft. Es traten keine erfassten Rendererfehler auf.

Testgrenze: Nur der Windows-Ordnerdialog wurde automatisiert mit dem vorbereiteten Testpfad beantwortet; der restliche native IPC-/Companion-/Dateiweg wurde tatsächlich ausgeführt. Die Testprofile und Projekte waren getrennt; verwendet wurde der reguläre Companion-Endpunkt. Zwei erste Versuche mit einem abweichenden Companion-Port scheiterten an der Testkonfiguration, bevor ein Modellauftrag startete. Diese werden nicht als erfolgreiche Abnahmen gezählt. Die allgemeine Vereinfachung des Einstiegs und eine umfassende Barrierefreiheitsprüfung bleiben Produktvorschläge. Die heuristische Zuordnung einzelner freier To-do-Texte wurde nicht überarbeitet.

![Reparierte Ersteinrichtung](I:/Anvil/anleitungen/produktkonzept-bilder/12-reparatur-einrichtung.png)

![Echter CLI-Auftrag sauber abgeschlossen](I:/Anvil/anleitungen/produktkonzept-bilder/13-reparatur-cli-abgeschlossen.png)

![Zurücksetzen nach erfolgreicher Reparatur geprüft](I:/Anvil/anleitungen/produktkonzept-bilder/14-reparatur-reset.png)

## Ursprünglicher Befund vor der Reparatur

**Ergebnis:** Öffnen, Ausführen, Änderungen ansehen, Übernehmen, Speichern und Neuladen funktionieren im geprüften kleinen HTML-Projekt. Der vollständige Agentenablauf über das Codex-Abo scheitert dagegen nach erfolgreicher Änderung und Ausführung an Anvils eigener Bildverarbeitung. Dies ist der wichtigste Befund dieses Tests.

## Prüfrahmen

Direkte Bedienung der Windows-App mit dem Computer-Use-Skill, ergänzt durch vorhandene automatisierte Tests und gezielte Quellcodeprüfung nach dem Code-Verification-Skill. Für Änderungen wurde ein eigenes Profil mit einem eigenen Projekt unter `I:\Anvil\data\produkt-pruefung-20260912` verwendet. Das vorhandene Nutzerprojekt war nicht Ziel des Änderungsauftrags. Die Testinstanz hatte eigene App-Ports; die Oberfläche nutzte allerdings den bereits erreichbaren Companion unter Port 7845. Damit war der Companion keine vollständig unabhängige Testumgebung.

Der Desktop-Arbeitsplatz wurde maximiert bei 2560 × 1392 Pixeln betrachtet. Einzelne Einrichtungsschritte erfolgten zuvor im normalen App-Fenster. Die frühere Browser-Vorschau mit 786 Pixeln Breite ist keine Grundlage für eine negative Desktop-Layoutbewertung.

## Ergebnisse nach Arbeitsschritt

| Prüfung | Ergebnis | Frischer Nachweis und Grenze |
|---|---|---|
| Arbeitsplatz im großen Fenster | Bestanden, visuell | Editor, Spur und Chat klar getrennt. Kein belegter Bedarf für einen Layoutumbau. |
| Frische Ersteinrichtung | Verbesserungsbedarf bestätigt | Zwei Kategorien heißen „Eingebaut“. Voreingestelltes Ollama zeigt HTTP 502 und ECONNREFUSED. Das belegt schlechte Fehlerdarstellung bei fehlendem Server, keinen Ausfall eines korrekt eingerichteten Modells. |
| Ordnerwahl in der Ersteinrichtung | Ungeklärt | Nach Auswahl des Testordners blieben die drei Ausgangsdateien sichtbar. Die Automatisierung des Windows-Dialogs war unzuverlässig; deshalb kein abschließend bestätigter Importfehler. |
| Derselbe Ordner über „Desktop-Ordner“ | Bestanden | `index.html` wurde geladen, Rückmeldung „1 Dateien geladen“. |
| HTML ausführen | Bestanden | Run öffnet Ausgabe; ein Klick auf „Erhöhen“ ändert 0 auf 1. |
| CLI erkennen und Thinking wählen | Bestanden für die Oberfläche | Codex CLI 0.147.0 wird als angemeldet erkannt. Thinking Low ließ sich wählen und blieb nach Schließen der Einstellungen in der Statusanzeige sichtbar. Eine Messung des tatsächlich verwendeten Denkaufwands erfolgte nicht. |
| Echte KI-Dateiänderung | Teilweise bestanden | Codex mit `gpt-5.6-terra` liest die Datei, erzeugt den Reset-Button und führt die Vorschau aus. Anschließend Abbruch wegen nicht unterstützter Bilder. |
| Änderung prüfen und übernehmen | Bestanden | Rote/grüne Änderung sichtbar, „Übernehmen“ übernimmt die gezeigte Datei. |
| Ergebnis selbst bedienen | Bestanden | Zwei Klicks ergeben 2; „Zurücksetzen“ setzt wieder auf 0. |
| Speichern und Neuladen | Bestanden für diesen Fall | „Gespeichert“ angezeigt; Datei auf Festplatte enthält Reset-Button und Handler. Nach Neuladen bleibt die Änderung sichtbar. Ein vollständiger App-Neustart wurde nicht zusätzlich geprüft. |
| Anbieter-/Profileinstellungen | Bestanden unter dokumentierter Testumgebung | Zwei vorhandene Zustandstests erfolgreich mit Polling; die normale Dateiüberwachung scheiterte zuvor an einer gesperrten Profildatei. |

## Priorität 1: CLI-Agent bricht nach eigener Vorschau ab

**Schwere: hoch für den betroffenen Ablauf. Sicherheit des Befunds: hoch.**

Ausgangsdatei: eine einfache HTML-Seite mit Zähler und Erhöhen-Button, ohne externe Ressourcen. Verbindung: Codex-Abo, vorhandene angemeldete CLI, Modell `gpt-5.6-terra`, Thinking Low. Reiner Textauftrag:

> Ergänze ausschließlich in index.html einen zweiten Button mit dem Text Zurücksetzen. Er soll den vorhandenen Zähler auf 0 setzen. Behalte Gestaltung und Erhöhen-Funktion bei. Keine Bibliotheken, Downloads oder weiteren Dateien. Dies ist ein kleines isoliertes Testprojekt.

Die Spur zeigt Lesen, Ändern und Run. Der Patch ist funktional richtig. Danach lautet die abschließende Nachricht: „Bilder werden über die Abo-CLI noch nicht übertragen. Bitte Text verwenden oder eine API-Verbindung wählen.“ Es wurde kein Bild an den Auftrag angehängt. Der Nutzer hat somit bereits Text verwendet und erhält eine unpassende Handlungsanweisung. Die Spur nennt den Lauf gleichzeitig „Fertig“, während die Aufgabenliste bei 2/3 steht.

![CLI-Abbruch trotz erzeugtem Patch und erfolgreichem Run](I:/Anvil/anleitungen/produktkonzept-bilder/08-praxistest-cli-abbruch.png)

**Quellcode bestätigt den Mechanismus:** `src/lib/agent-core.ts` fügt einen vorhandenen Run-/Play-Frame als `image_url` in die Folgekonversation ein. `src/lib/cli-protocol.ts` entfernt Bilder nur bei besonders markierten MCP-Ergebnissen und weist sonstige Bilder mit genau der beobachteten Meldung zurück. Die transportabhängige Behandlung fehlt damit in diesem geprüften Run-Pfad.

**Kleinste Verbesserungsrichtung:** Eigene Ausgabebilder entsprechend den Fähigkeiten der gewählten Verbindung behandeln. Bei einem Texttransport müssen Laufstatus und verwertbare Textergebnisse weiterlaufen; visuelle Prüfung darf dann nicht behauptet werden. Die sichtbare Ergebnisaufnahme kann dem Nutzer weiterhin zur Verfügung stehen. Ein gesondert implementierter Bildtransport wäre eine weitere Möglichkeit, ist aber keine Voraussetzung für einen sauber abgeschlossenen Textablauf.

**Abnahmetest:** Genau diesen Textauftrag wiederholen. Die App muss Lesen → Ändern → Ausführen → verständlichen Abschluss schaffen, ohne den Nutzer wegen eines selbst erzeugten Bildes zum Verbindungswechsel aufzufordern. Funktionsprüfung des Zählers bleibt separat erforderlich.

## Priorität 2: Ersteinrichtung verständlicher und konsistent machen

**Schwere: mittel. Sicherheit: hoch für Beschriftung/Fehlertext, offen für den Ordnerimport.**

Die doppelte Kategorie ist auch im frischen nativen Profil sichtbar. `first-run.tsx` unterscheidet beim Beschriften nur „local“ und „cloud“; andere Gruppen erhalten dieselbe Beschriftung. Die automatische Prüfung der voreingestellten lokalen Verbindung zeigt einen technischen Netzwerkfehler. Der Einrichtungsabschluss liegt hinter zahlreichen Compiler- und Sprachserveroptionen.

Sinnvolle Reihenfolge: vorhandenen Zugang erkennen, Projekt öffnen, einen ersten erfolgreichen Run ermöglichen. Compilerdetails können bei der betreffenden Sprache angeboten werden. Den nicht erreichbaren Server mit verständlichem Zustand und einer konkreten nächsten Handlung erklären.

Die Ordnerwahl verdient einen gezielten Regressionstest: Der Einstieg verwendet `pickFolder()` aus der Browser-Dateischnittstelle, der Arbeitsplatz den nativen Desktop-Workspace-Pfad. Im Bedienungstest funktionierte nur letzterer nachweislich. Aufgrund der Schwierigkeiten des Automatisierungswerkzeugs mit dem ersten Dialog bleibt offen, ob dessen erfolglose Auswahl ein Anvil-Defekt oder ein Testbedienungsproblem war.

## Was bereits gut funktioniert

Die Prüfung des Patches ist unmittelbar erreichbar. Übernehmen führt zurück zum bearbeiteten Code; Run zeigt das Ergebnis in einem eigenen Fenster. Das sind konkrete Stärken des Produkts und eine bessere Grundlage für die Positionierung als eine reine Funktionsliste.

![Ausführung nach Änderung, Zähler bei 2](I:/Anvil/anleitungen/produktkonzept-bilder/09-praxistest-zaehler-zwei.png)

![Zurücksetzen funktioniert](I:/Anvil/anleitungen/produktkonzept-bilder/10-praxistest-reset.png)

![Thinking Low bei erkannter Codex-CLI](I:/Anvil/anleitungen/produktkonzept-bilder/07-praxistest-thinking.png)

## Ergänzende automatisierte Prüfungen

Ausgeführt wurden die vorhandenen Tests `scripts/settings-state.test.mjs` und `scripts/connection-state.test.mjs`. Sie prüfen Anbieterwechsel, getrennte Endpunkte und Anmeldemodi, explizite Modelle sowie Erhalt von Verbindungs- und Projektzustand bei Einstellungen, Sicherungen und Rücksetzen.

- Erster Start scheiterte in der eingeschränkten Ausführungsumgebung an `spawn EPERM`.
- Mit erlaubter Prozessausführung scheiterten beide an `EBUSY: watch ... data\Network\Cookies`, während Anvil geöffnet war. Dies betrifft die Testeinrichtung und beweist keinen Fehler der Einstellungen.
- Mit `CHOKIDAR_USEPOLLING=true` bestanden beide Tests, Exitcode 0. Die Testdateien wurden dafür nicht geändert.

Erfolgreicher Aufruf mit Node.js 24.19:

```powershell
$env:CHOKIDAR_USEPOLLING = 'true'
node --test --test-force-exit --test-concurrency=1 scripts/settings-state.test.mjs scripts/connection-state.test.mjs
```

**Kleine technische Folgeaufgabe:** Die Testserver sollen das aktive Datenverzeichnis nicht überwachen. Der Windows-Test muss auch bei geöffneter App ohne diesen Umweg laufen.

## Grenzen und nächste Entscheidung

Dies ist ein gezielter Praxistest, keine allgemeine Releasefreigabe. Nicht vollständig geprüft: neue Installation, Update/Migration, alle Modellanbieter, Claude-Abo, API-Bildtransport, Langzeitstabilität, Wiederherstellung nach Absturz sowie vollständige Tastatur- und Screenreader-Bedienung. Aus Schwierigkeiten mit dem Automatisierungswerkzeug werden keine pauschalen Barrierefreiheitsfehler abgeleitet.

Die getestete HTML-Funktion besteht; der Agentenablauf als Ganzes besteht wegen des CLI-Abbruchs nicht. Deshalb zuerst diesen Ablauf reparieren und denselben Test wiederholen. Danach Einstieg und Verbindungserklärungen verbessern. Das große Desktop-Layout benötigt aufgrund dieser Beobachtungen keine Umgestaltung.

Anvils Produktcode wurde in dieser Prüfung nicht repariert. Das isolierte Projekt und die Bilder bleiben als nachvollziehbare Testbelege erhalten.
