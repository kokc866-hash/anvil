# Editor: Bearbeiten, Speichern und Wiederherstellen

Interner Entwicklungsstand nach Anvil 1.3.19; noch nicht als neuer Installer veröffentlicht. Bestehende Editor-, Agent-, Canvas- und Tool-Funktionen bleiben verfügbar.

## Dateien und Vorschläge

Der Live-Editor zeigt eintreffenden Modelltext als ausdrücklich gekennzeichnete Vorschau. Erst ein vollständig geprüfter Tool-Aufruf verändert Projektdateien. Beispiele in Antworten und unvollständige Argumente schreiben keine Dateien.

Änderungsvorschläge lassen sich weiterhin einzeln, gemeinsam oder abschnittsweise prüfen. Rücknahmen bewahren bestehende leere Dateien und vollständige Ausgangstexte. Nach einer zusätzlichen manuellen Änderung verweigert Anvil eine pauschale Rücknahme, die diese Änderung überschreiben würde. Ältere, bereits abgeschnittene Sicherungen können nicht nachträglich rekonstruiert werden; mehrdeutige Rücknahmen werden deshalb abgewiesen.

Ordner behalten beim Verschieben ihren Namen und ihre Unterordner. Bestehende Ziele werden nicht überschrieben. Native Verschiebungen erhalten auch Binärdateien und vom Editor ausgeblendete Dateien; Browser-Verschiebungen kopieren vollständig vor dem Entfernen der Quelle.

## Speichern und Projektwechsel

- Speichern bearbeitet die aktive Datei; „Alle speichern“ bearbeitet die tatsächlich geänderten Dateien.
- Deaktiviertes automatisches Speichern wird respektiert. Bestätigte Datei-Tools und ausdrücklich angenommene Vorschläge dürfen weiterhin schreiben.
- Beim Schließen oder Projektwechsel stehen Speichern, Verwerfen und Abbrechen zur Wahl. Ein fehlgeschlagener Speichervorgang lässt Änderungen offen.
- Fenster schließen wartet in Electron auf die ausstehenden Speicheraufträge. Nach einem Fehler bleibt der Dialog mit der konkreten Ursache offen. „Erneut versuchen“ wiederholt die ausstehenden Schreibaufträge.
- „Sicherung erstellen“ schreibt alle geladenen Projektdateien einschließlich Bildern in einen neuen Unterordner des gewählten Ziels. Der ursprüngliche Ordner bleibt erhalten. Nach vollständiger Sicherung kann Anvil beendet werden; fehlgeschlagene Schlüssel- oder Einstellungssicherungen werden dabei ausdrücklich angezeigt.
- Eine geöffnete Änderungsansicht einer Agentenrunde verhindert nicht mehr, dass eine erfolgreich gespeicherte Datei als gespeichert erkannt wird.
- Beim Wiederverbinden des Companion wird der zuvor gewählte Workspace erneut angemeldet. Die Ordnergrenzen bleiben wirksam; Windows-Pfade werden hinsichtlich Groß-/Kleinschreibung korrekt verglichen.
- Beim Zurückwechseln zu Anvil werden offene und geänderte Dateien mit der Platte abgeglichen. Der Befehl „Dateien von Platte abgleichen“ startet dies auch manuell. Der Abgleich ist begrenzt und kein vollständiger Dateisystem-Watcher.
- Externe Änderungen an ungespeicherten Dateien erscheinen als Konflikt: „Editorstand speichern“ behält den Editortext, „Plattenstand laden“ lädt die externe Fassung. Schreibvorgänge prüfen den zuletzt bekannten Plattenstand vor dem Überschreiben.

IndexedDB hält vollständige Datei- und Rücknahmeinhalte; die kleinere lokale Wiederherstellungskopie nimmt nur vollständige Einträge auf. Undo ist pro Datei begrenzt und wird beim Wechsel zu einem anderen Projekt getrennt. Lokale Versionsstände ersetzen keine externe Datensicherung.

Auf schmalen Fenstern sind Dateien, Editor, Agent, Spur und Ausgabe einzeln über eine Bereichsleiste erreichbar. Desktop-Breiten und gespeicherte Panel-Einstellungen bleiben erhalten.

## Navigation, Formatierung und Sprachdienste

Zeilensprünge funktionieren auch in der bereits geöffneten Datei. Zurück/Vorwärts, Tab-Wechsel, Such- und Symbolbefehle behalten ihre bisherigen Zugänge. Verspätete Formatierungen und Vorschläge werden nur auf die ursprüngliche, unveränderte Datei angewandt.

JavaScript, TypeScript, JSON, CSS, HTML, Markdown und YAML verwenden gebündelte Formatierer. Einrückungseinstellungen und unterstützte JSON-Prettier-Konfigurationen werden berücksichtigt. Andere bisher unterstützte Sprachen verwenden weiterhin die lokalen Companion-Formatierer. Fehlende Formatierer führen zu einer Meldung; der Text wird nicht ersatzweise mit pauschalen Leerraumregeln verändert.

JavaScript/TypeScript-Diagnosen laufen inkrementell in einem Worker mit den TypeScript-Standardbibliotheken. Unterstützte Projektkonfigurationen und Importpfade werden berücksichtigt. Semantisches Umbenennen unterscheidet Bindungen, Zeichenketten und lokale Gültigkeitsbereiche. Für andere Sprachen bleibt textuelles Umbenennen als überprüfbarer Änderungsvorschlag erhalten. Die Prüfung bezieht sich auf die geladenen Projektdateien und konfigurierten Grenzen; externe Sprachserver bleiben ergänzend verfügbar.

TypeScript verwendet auch im gepackten Worker die vollständigen Standardbibliotheken einschließlich DOM und Array-Methoden. Die jeweils nächste `tsconfig.json`/`jsconfig.json`, relative Vererbung sowie Dateiauswahl gelten auch für Projekte in Unterordnern. Der Companion überschreibt diese Konfigurationen nicht mit eigenen Vorgaben.

Die Problemliste und die Statusleiste unterscheiden Fehler, Warnungen und Hinweise. Veraltete Ergebnisse werden ersetzt; Python und TypeScript überschreiben sich nicht gegenseitig. Python-Näherungen behandeln Ganzzahldivision `//`, mehrzeilige Blockköpfe, einzeilige Blöcke und Kommentare korrekt. Eine echte Syntaxprüfung ersetzt die Näherungen derselben Datei.

Python-Prüfungen verwenden einen eigenen Worker und belegen nicht mehr den Run-Interpreter. Die erste Python-Prüfung benötigt weiterhin die bisherige Pyodide-Laufzeitquelle.

## Suche, Run und Ausgabe

Die Projektsuche läuft abbrechbar im Worker. Die Ergebnisanzeige bleibt begrenzt; „Alle ersetzen“ verarbeitet alle Treffer innerhalb der unterstützten Dateien. Reguläre Ausdrücke behalten ihre Gruppen und den ursprünglichen Suchkontext. Zu aufwendige Suchmuster werden beendet, übermäßig große Ersetzungen abgewiesen.

Manueller Run und Live Run teilen eine Ausführungssperre. Live Run wartet bei belegter Ausführung und berücksichtigt danach nur die aktuelle Änderung. Ergebnisse eines alten Projekts erscheinen nicht im neuen Projekt. Interaktive oder grafische Programme bleiben vom automatischen Live Run ausgeschlossen und sind weiterhin manuell ausführbar.

Ausgabefenster erhalten zunächst einen vollständigen Stand, anschließend Dateiänderungen. Ohne verbundenes Ausgabefenster werden keine Projektschnappschüsse dafür übertragen.

## Verifikation

`npm run test:editor` prüft den tatsächlichen Monaco-Editor, Navigation, Modellwechsel, Rücknahmen, vollständige IndexedDB-Sicherungen, lokale Formatierung sowie Such- und Compiler-Worker. `npm run test:editor:release` prüft zusätzlich die gebündelte Produktionsanwendung. Die Fixtures verwenden keine echten Modellanfragen. Beide gehören zur Release-Prüfung.

Die gezielten Regressionen für diese Fehler laufen über `npm run test:reported-problems`. `npm run test:reported-problems:browser` prüft Diagnose-Aktualisierung, Warnungsfarben, Speichern, Wiederholen und Projektsicherung mit simuliertem Companion. `--production` prüft das gebaute Programm; `ANVIL_TEST_START=1` startet den passenden Server im selben Prüfprozess. Es werden keine Modelle heruntergeladen oder Anbieteranfragen ausgeführt.
