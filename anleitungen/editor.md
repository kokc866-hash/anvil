# Editor: Bearbeiten, Speichern und Wiederherstellen

Stand: 13. September 2026, Release 1.3.28. Die unten beschriebenen erweiterten Projektsicherungspunkte gehören zu diesem Stand.

## Dateien und Vorschläge

„Neue Datei“ verwendet einen freien Namen, etwa `neu-2.py`, wenn der Name schon belegt ist. Auch gleichnamige Ordner und Unterschiede nur in Groß-/Kleinschreibung werden berücksichtigt. Ein verspäteter Helfer-Namensvorschlag verändert keinen später geöffneten Anlegedialog.

Der Live-Editor zeigt eintreffenden Modelltext als ausdrücklich gekennzeichnete Vorschau. Erst ein vollständig geprüfter Tool-Aufruf verändert Projektdateien. Beispiele in Antworten und unvollständige Argumente schreiben keine Dateien. Beim Ende des Schreib-Streams klappt der Entwurf automatisch zu; der nächste Schreibvorgang öffnet ihn wieder. Manuelles Aufklappen bleibt möglich. Nach der Dateiübernahme kann ein verzögerter Entwurf nicht erneut erscheinen.

Beim Schreiben folgt der Editor der bearbeiteten Datei: vorhandene Dateien öffnen sich bereits beim Beginn des Live-Entwurfs, neue Dateien nach der Übernahme. Ihr Entwurf ist vorher separat sichtbar. Lesen, MCP-Ausgaben und das Starten einer Vorschau wechseln die aktive Editor-Datei nicht.

Änderungsvorschläge lassen sich weiterhin einzeln, gemeinsam oder abschnittsweise prüfen. Rücknahmen bewahren bestehende leere Dateien und vollständige Ausgangstexte. Nach einer zusätzlichen manuellen Änderung verweigert Anvil eine pauschale Rücknahme, die diese Änderung überschreiben würde. Ältere, bereits abgeschnittene Sicherungen können nicht nachträglich rekonstruiert werden; mehrdeutige Rücknahmen werden deshalb abgewiesen.

Ordner behalten beim Verschieben ihren Namen und ihre Unterordner. Bestehende Ziele werden nicht überschrieben. Native Verschiebungen erhalten auch Binärdateien und vom Editor ausgeblendete Dateien; Browser-Verschiebungen kopieren vollständig vor dem Entfernen der Quelle.

## Speichern und Projektwechsel

Es ist nur ein Arbeitsordner aktiv: ein Desktop-Pfad oder ein Browser-Ordner. Beim Wechsel wird das vorherige Speicherziel abgelöst. Beim Neustart wird zu einem gespeicherten Desktop-Pfad kein alter Browser-Arbeitsordner zusätzlich aktiviert. Ein separater Backup-Ordner bleibt erhalten. Fehlgeschlagene Schreibvorgänge nennen Datei und Ursache.

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

## Projekt und Assets vor einer Agentenrunde sichern

**Neu in Release 1.3.28:** Bei einem lokalen Desktop-Projekt mit der lokalen Standard-Companion-Verbindung erstellt Anvil vor jedem bearbeitenden Agentenauftrag einen Projektsicherungspunkt. Zunächst werden offene Änderungen ohne automatische Formatierung gespeichert. Erst nach erfolgreicher Sicherung beginnt die bearbeitende Modell-/Werkzeugrunde. Scheitert Speichern oder Sichern, startet der Auftrag nicht. Nach der Runde wird der Endstand separat festgehalten.

Der Sicherungspunkt erfasst die tatsächlichen Dateien im Projektordner, einschließlich noch nicht im Editor geöffneter Dateien, Bildern, Szenen, anderen Binärdateien, Lockdateien und leeren Ordnern. Die Runde zeigt den Projektumfang und die Dateianzahl. Es wird nicht der gesamte Projektordner blind auf einen alten Stand ersetzt: Anvil ermittelt die Änderungen zwischen Beginn und Ende dieser Runde.

**Runde zurücknehmen / Zurück vor diese Runde** öffnet die gemeinsame Vorschau für Editor-Dateien und Projekt-Assets. Sie zeigt wiederherzustellende oder zu entfernende Dateien, Ordner, Konflikte und ausgeschlossene Pfade. Die Bestätigung speichert die Rücknahme. Spätere eigene oder externe Bearbeitungen und Löschungen führen bei betroffenen Dateien zu einem Konflikt; neue unbeteiligte Dateien bleiben bestehen. Bei einem unterbrochenen Wiederherstellungsvorgang kann Anvil den gesicherten Plan erneut abgleichen. Ein fehlender verlässlicher Endstand erlaubt keine pauschale Rücknahme.

### Umfang und Grenzen

- Ausgenommen sind Abhängigkeiten, Build- und Cache-Verzeichnisse wie `node_modules`, `.git`, `dist`, `.godot`, Unity-`Library`/`Temp` und Unreal-`Binaries`/`Intermediate`/`Saved`. Auch `.anvil/work`, `.anvil/out` und Anvils eigener Datenordner werden nicht mitgesichert. Die konkreten Ausschlüsse sind in der Vorschau sichtbar.
- Bekannte Geheimnispfade wie `.env`, Schlüsseldateien und Tresorverzeichnisse sind ausgenommen; `.env.example`, `.env.sample` und `.env.template` bleiben erfassbar. Das ist eine Pfadregel, keine inhaltliche Suche nach sämtlichen Geheimnissen.
- Verknüpfungen und Windows-Junctions werden nicht verfolgt. Unsichere Pfade, Änderungen während der Erfassung oder überschrittene Grenzen brechen die Sicherung mit einer Meldung ab. Die Grenzen sind 8 GiB je Datei, 64 GiB je Sicherungsstand und 100.000 Einträge. Ein unvollständiger Stand wird nicht als vollständig gesichert ausgegeben.
- Externe Dienste, außerhalb des Projektordners liegende Dateien und laufende Datenbanktransaktionen werden nicht zurückgesetzt. Ausgeführte MCP-Werkzeuge werden in der Rücknahme mit Dienst und Werkzeugname aufgeführt; diese Liste nimmt ihre Aktionen nicht zurück. Ein Stop garantiert ebenfalls keine Rücknahme beim Anbieter.
- Lokale Datenbankdateien können als Dateien erfasst werden. Für einen konsistenten Datenbankstand müssen schreibende Programme beendet oder die eigenen Sicherungsfunktionen der Datenbank verwendet werden. Der Projektsicherungspunkt ist keine Transaktionssicherung einer laufenden Datenbank.
- Ältere Runden sowie Browser- und entfernte Companion-Projekte behalten die Rücknahme der geladenen Dateien. Sie werden nicht nachträglich zu vollständigen Projektsicherungspunkten erklärt.

Die Sicherungsinhalte liegen unter `project-checkpoints` im Anvil-Datenordner. Identische Inhalte werden gemeinsam gespeichert, statt pro Runde erneut kopiert. Es gibt derzeit keine automatische Bereinigung alter Sicherungsinhalte. Siehe [Datenablage](datenablage.md).

Vor der Rücknahme werden benötigte Editorinhalte aus der unveränderten Sicherung geladen und geprüft, einschließlich bytegetreuer Binärdaten. Für diesen Editor-Abgleich gelten 32 MiB je Datei und 256 MiB insgesamt; nicht im Editor geladene Assets werden direkt auf der Platte wiederhergestellt. Wird eine Rücknahme unterbrochen, bleiben ihr Plan und die Schreibsperre erhalten. Dieselbe Runde erneut zurücknehmen, um den Abgleich abzuschließen; alte Editorpuffer werden bis dahin nicht automatisch gespeichert.

## Fenster und Spur

Auf schmalen Fenstern sind Dateien, Editor, Agent, Spur und Ausgabe einzeln über eine Bereichsleiste erreichbar. Desktop-Breiten und gespeicherte Panel-Einstellungen bleiben erhalten.

Das externe Run-Fenster passt sich nach dem Laden einmalig an die grafische Ausgabe an. Bei Anvil-Canvas zählt die logische Spielgröße statt der durch Bildschirm-Skalierung vergrößerten Pixelauflösung. Bedienleisten und Fensterrahmen kommen hinzu; die Größe bleibt innerhalb der Arbeitsfläche des aktuellen Monitors. Die Mindestgröße beträgt 480 × 360. Anschließend bleibt manuelles Vergrößern und Verkleinern erhalten. Ausgaben ohne messbare grafische Fläche verwenden weiterhin die normale Startgröße.

Die Spur unter „Denken“ folgt neuen Schritten und Ergebnissen automatisch. Manuelles Hochscrollen pausiert das Nachführen; unten wird es wieder aktiv.

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
