# Produktarbeit: Punkte 1 bis 6

Umsetzung vom 12. September 2026; Status aktualisiert am 13. September 2026.

**Aktueller Veröffentlichungsstand:** Anvil 1.3.26 ist als unsignierte Setup-EXE und portable ZIP veröffentlicht. Die Release-Prüfungen auf einem frischen GitHub-Windows-Runner und beide Downloads wurden erfolgreich geprüft. Die unten genannten lokalen Testartefakte dokumentieren die ursprüngliche Abnahme; sie sind keine neu ausgeführten Tests der heutigen Änderungen. Aktuelle Bedienwege stehen in den verlinkten Fachanleitungen.

## 1. Installation und Updates

Setup und Deinstallation verweigern Änderungen, solange Anvil läuft. Es gibt kein erzwungenes Beenden. Nutzer speichern und schließen Anvil selbst; Abbrechen erhält die laufende Arbeit. „Setup herunterladen“ zeigt nach erfolgreicher Prüfung die Datei im Ordner. Es startet das Setup nicht heimlich.

Der Download prüft Release-Herkunft, Dateiname und SHA-256. Wenn ein Signierherausgeber konfiguriert ist, wird zusätzlich dessen gültige Signatur mit Zeitstempel geprüft. Eine Prüfsumme ist kein Herausgebernachweis. ZIP-Updates benötigen einen leeren Zielordner. Eigene Daten und Run-Ausgaben werden bei der Deinstallation erhalten.

Die [Paketabnahme](installation-abnahme.md) verwendet eine eigene Windows-App-Identität und getrennte Testdateien. Damit werden die echte Installation und die installierte Oberfläche geprüft. Ein Start mit entferntem externem Node im Anwendungspfad ersetzt keine Prüfung in einer vollständig sauberen Windows-VM; erneutes Installieren derselben Version ersetzt keine echte Altversionsmigration. Diese Nachweisgrenzen bleiben sichtbar.

Die finale Setup-Abnahme ist erfolgreich (`artifacts/installer-acceptance/install-NPYrMa/result.json`): Start ohne externes Node im Pfad, echter Dateispeichervorgang, offener Puffer bei abgewiesenem Update/Deinstallation, Abbrechen, Neustart, geschlossene erneute Installation und Deinstallation mit unveränderten Nutzerdaten. Das Paket ist bewusst unsigniert. Ein Startfehler zeigt den tatsächlich konfigurierten Logpfad statt eines veralteten AppData-Verweises.

Auch das tatsächliche ZIP wurde in einen eigenen Ordner entpackt und ohne externes Node gestartet. Der vollständige Neustart erhielt die Einstellungen; Profilablage neben der EXE und fehlerfreie Oberfläche sind bestätigt (`artifacts/portable-acceptance/zip-MhD2R7/result.json`). Beide Paketformen wurden geprüft, nicht nur ein entpackter Buildordner.

## 2. Verlässliche Rundenrücknahme

„Zurück vor diese Runde“ zeigt erst die betroffenen Dateien und Ordner. Bestätigen speichert die Rücknahme sofort. Unterstützt werden leerer Ausgangsstand, hinzugefügte, bearbeitete, gelöschte und umbenannte geladene Dateien. Nur leere neue Ordner werden entfernt.

Anvil vergleicht den Beginn, den versiegelten Endstand der Runde und den heutigen Inhalt. Spätere eigene Änderungen werden nicht als Teil einer älteren Runde zurückgesetzt. Änderungen eines anderen Programms werden unmittelbar vor der Dateiverarbeitung geprüft. Ein Scheitern lässt einen gesicherten Plan zurück; nach Unterbrechung kann Anvil den Vorgang erneut abgleichen. Schreibvorgänge ersetzen Dateien über eine temporäre Nachbardatei, damit ein fehlgeschlagener Schreibvorgang die ursprüngliche Datei nicht zuerst leert.

Alte Runden ohne gespeicherten Endstand erzeugen keine destruktive Rücknahme. Die ursprüngliche Abnahme betraf geladene Dateien; nicht eingelesene Binärdateien waren davon ausgenommen.

**Ergänzung im lokalen Entwicklungsstand nach 1.3.26:** Für lokale Desktop-Projekte mit der Standard-Companion-Verbindung sichert Anvil vor bearbeitenden Aufträgen zusätzlich den tatsächlichen Projektordner einschließlich Binärdateien, Assets und ungeöffneter Dateien. Die vorhandene Rücknahmevorschau zeigt diese Dateien, Konflikte, Ausschlüsse und externe MCP-Werkzeugaktionen gemeinsam. Scheitert die Anfangssicherung, startet der Auftrag nicht. Externe Dienstaktionen und laufende Datenbanktransaktionen bleiben außerhalb der Rücknahme; alte Runden und Browser-/Remote-Projekte behalten ihren bisherigen Umfang. Den genauen Vertrag und die Speichergrenzen beschreibt das [Editor-Handbuch](editor.md#projekt-und-assets-vor-einer-agentenrunde-sichern). Diese Ergänzung ist noch nicht im veröffentlichten Download 1.3.26 enthalten.

## 3. Erster Erfolg ohne KI

In der Ersteinrichtung **Beispiel ohne KI starten** wählen. Das Beispiel benötigt keine Anmeldung, Bibliothek oder Compilerwahl. In Run lässt sich der Zähler direkt bedienen. Anvil legt eine freie Datei `anvil-erster-test.html` an und schützt gleichnamige vorhandene Dateien und Ordner durch einen anderen Namen.

Ein vorhandener Auftragsentwurf bleibt erhalten. Ist er leer, wird eine kleine Änderung als nächster Auftrag vorbereitet. Für eine KI-Antwort wird anschließend eine funktionierende Verbindung benötigt. Bestehende Profile und das große Desktop-Layout bleiben erhalten.

## 4. Verständliche Verbindungen

Ersteinrichtung, Agent-Einstellungen und der Chat erklären Anfrageziel, Zugang, Abrechnung, Bilder, Antwortanzeige und Thinking anhand des Anvil-Verbindungswegs. Ein erreichbarer Modellkatalog oder eine erkannte Anmeldung wird nicht als erfolgreiche Modellantwort bezeichnet. Ein lokaler Server kann weiterleiten; sein Standort allein beweist nicht, wo das Modell rechnet.

Die ursprüngliche Abnahme prüfte den Bildschutz des Text-CLI-Adapters. Diese Grenze gilt noch für den veröffentlichten Download 1.3.26.

**Ergänzung im lokalen Entwicklungsstand nach 1.3.26:** Codex, Claude Code und Copilot übertragen nun passende Bildinhalte und zeigen eintreffende Antwortteile während der Anfrage. Angehängte Bilder sowie unterstützte Run-/Play-/MCP-Bilder bleiben dem Gespräch zugeordnet. Format- und Größenlimits werden geprüft; das gewählte Modell muss Bilder verstehen können. Nicht bildfähige interne Verbindungen behalten ihren Eingabeschutz. Thinking folgt weiterhin den unterstützten Modellstufen. Den genauen Umfang und die Voraussetzungen beschreibt die [Verbindungsanleitung](05-verbindungen.md#abo-über-cli). Ein Bild ohne Begleittext erhält weiterhin eine sinnvolle Standardfrage.

## 5. Vier geführte Aufgaben

Links über den Einstellungen über das Checklisten-Symbol **Geführte Aufgaben** öffnen. Die Auswahl bereitet einen bearbeitbaren Auftrag vor und sendet nichts automatisch. Beim Wechsel zwischen Abläufen bleibt der eigentliche Auftrag erhalten. Dieselben Arbeitsanweisungen sind als vier vorhandene Anvil-Skills eingebunden.

| Aufgabe | Verhalten | Erfolg und Grenze |
| --- | --- | --- |
| Projekt verstehen | Ask, nur lesen | Aufbau und Startweg aus gelesenen Dateien erklären; unbekannte Voraussetzungen benennen. Keine Projektdatei wird durch die Ask-Journalpflege geändert. |
| Änderung umsetzen | Agent | Gewünschte Stelle bearbeiten, Gestaltung und andere Funktionen erhalten, passend prüfen. Ein reiner Textwechsel verlangt keinen unnötigen Run. |
| Fehler beheben | Agent | Fehlerfall und Ursache eingrenzen, korrigieren, ursprünglichen Fall erneut prüfen. Fehlende Laufzeit oder Anmeldung konkret benennen; gleiche erfolglose Versuche nicht endlos wiederholen. |
| Änderung prüfen | Ask, nur lesen | Änderungen und vorhandene Nachweise prüfen. Fehlender Vergleichsstand bleibt offen; keine erfundene Freigabe und keine Programmausführung. |

Die deterministischen Tests prüfen die echte Versandsteuerung mit ersetzter Modellantwort. Sie belegen keine gleichbleibende Antwortqualität aller Modelle. Der frühere Tageswerk-Praxistest belegt zusätzlich echte Arbeit über Ollama und Codex CLI.

## 6. Hilfe und Veröffentlichungsrahmen

**Einstellungen → Hilfe** zeigt Version, Produktangaben und Datenwege. Für einen Fehlerbericht erwartetes Verhalten, tatsächliches Verhalten und Schritte zum Nachstellen eintragen. **Bericht vorbereiten** erzeugt eine vollständige Vorschau; **Bericht kopieren** kopiert nur in die Zwischenablage. Es gibt keinen automatischen Versand.

Die automatische Zusammenfassung enthält Version, bekannte Anbieterkennung, Verbindungsart, Sprache, Status und Zähler. Sie enthält keine Projektinhalte, Dateinamen, Pfade, Modelladressen, Chats, Protokolle oder Schlüssel. Selbst eingegebener Freitext ist sichtbar und wird nicht automatisch als vertraulichkeitsbereinigt behandelt.

Auf Wunsch des Eigentümers bleiben Herausgeber, Supportkontakt, Lizenz und Signierung vorerst offen. `product-release.json` enthält dafür leere Felder. Der Eigentümer hat die unsignierte Veröffentlichung ausdrücklich freigegeben; Release 1.3.26 ist veröffentlicht. Normale lokale Builds veröffentlichen nichts. Der Release-Workflow unterscheidet die unsignierte Veröffentlichung von einer späteren signierten Freigabe: Erst Letztere verlangt die vollständigen Angaben und überprüfte echte Signaturen. Details stehen unter [Installation und Freigabe](installation-abnahme.md).

Später gemeinsam festzulegen: Herausgebername, erreichbarer Supportweg, gewünschter Nutzungsrahmen und geeigneter Signierzugang. Dafür wurden keine Identitäten, Verträge oder Zertifikate erfunden. Diese offenen Entscheidungen sind durch die technische Veröffentlichung nicht automatisch erledigt.

## Nachweise

- `scripts/product-experience.browser.mjs`: echte gebaute Electron-Oberfläche, Erstbeispiel einschließlich Zählerbedienung, vier Aufgaben, Hilfe mit Vorschau/Kopieren und Bildschutz.
- `scripts/product-workflow.browser.mjs`: echter Projektordner, Speichern, vollständiger Neustart, Rundenrücknahme über die Bedienelemente, externe Schreibkonflikte, Stop und ehrliche offene Prüfungen.
- `scripts/round-restore.test.mjs`: reale Testdateien, gemischte Änderungen, spätere eigene und externe Bearbeitung, Teilausfall sowie erneute Store-Hydration und Wiederholung.
- `scripts/product-send.test.mjs`: Versandgrenzen, Bild ohne Text und unveränderte Projektdateien bei lesenden Aufgaben in Deutsch und Englisch.
- `scripts/product-support.test.mjs`, Verbindungs- und Update-Tests: erlaubte Berichtsfelder, Arbeitsabläufe, Fähigkeiten, Herkunft, Prüfsumme, Absender und leere ZIP-Ziele.
- Build und Typprüfung gehören zum integrierten Stand. Der Windows-Testaufruf wurde korrigiert, damit auch die Prüfdateien unter `scripts` tatsächlich ausgeführt werden.

Vollständige Testsammlung der ursprünglichen Abnahme vom 12. September: **904 bestanden, 0 Fehler, 5 bedingt übersprungen**. Die dateibasierten Testmodule liefen nacheinander, weil parallele Vollprüfungen auf diesem Windows-Rechner vorübergehende Dateisperren bei einem vorhandenen Helfer-Wiederherstellungstest auslösten. Der betroffene Test bestand einzeln und in der vollständigen sequenziellen Ausführung. Typprüfung und Produktionsbuild waren erfolgreich. Diese Zahlen werden nicht als Zähler späterer Release-Prüfungen fortgeschrieben.

Die JSON-Ergebnisse und Screenshots liegen lokal unter `artifacts/product-experience`, `artifacts/product-workflow` und nach der Paketprüfung unter `artifacts/installer-acceptance`. Testläufe verändern keine echten Nutzerprojekte und führen keine neuen Modellanfragen aus.

Die öffentliche unsignierte Veröffentlichung ist erfolgt. Ein unverändertes Endnutzer-Windows ohne Entwicklungswerkzeuge, eine echte Altversionsmigration und die selbstständige Nutzung durch neue Menschen bleiben zusätzliche Nachweise. Sie werden nicht durch die bestandenen Runner- und lokalen Tests ersetzt.
