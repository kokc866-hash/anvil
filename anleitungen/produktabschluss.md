# Produktarbeit: Punkte 1 bis 6

12. September 2026 · Lokaler Arbeitsstand, keine öffentliche Freigabe.

## 1. Installation und Updates

Setup und Deinstallation verweigern Änderungen, solange Anvil läuft. Es gibt kein erzwungenes Beenden. Nutzer speichern und schließen Anvil selbst; Abbrechen erhält die laufende Arbeit. „Setup herunterladen“ zeigt nach erfolgreicher Prüfung die Datei im Ordner. Es startet das Setup nicht heimlich.

Der Download prüft Release-Herkunft, Dateiname und SHA-256. Wenn ein Signierherausgeber konfiguriert ist, wird zusätzlich dessen gültige Signatur mit Zeitstempel geprüft. Eine Prüfsumme ist kein Herausgebernachweis. ZIP-Updates benötigen einen leeren Zielordner. Eigene Daten und Run-Ausgaben werden bei der Deinstallation erhalten.

Die [Paketabnahme](installation-abnahme.md) verwendet eine eigene Windows-App-Identität und getrennte Testdateien. Damit werden die echte Installation und die installierte Oberfläche geprüft. Ein Start mit entferntem externem Node im Anwendungspfad ersetzt keine Prüfung in einer vollständig sauberen Windows-VM; erneutes Installieren derselben Version ersetzt keine echte Altversionsmigration. Diese Nachweisgrenzen bleiben sichtbar.

Die finale Setup-Abnahme ist erfolgreich (`artifacts/installer-acceptance/install-NPYrMa/result.json`): Start ohne externes Node im Pfad, echter Dateispeichervorgang, offener Puffer bei abgewiesenem Update/Deinstallation, Abbrechen, Neustart, geschlossene erneute Installation und Deinstallation mit unveränderten Nutzerdaten. Das Paket ist bewusst unsigniert. Ein Startfehler zeigt den tatsächlich konfigurierten Logpfad statt eines veralteten AppData-Verweises.

Auch das tatsächliche ZIP wurde in einen eigenen Ordner entpackt und ohne externes Node gestartet. Der vollständige Neustart erhielt die Einstellungen; Profilablage neben der EXE und fehlerfreie Oberfläche sind bestätigt (`artifacts/portable-acceptance/zip-MhD2R7/result.json`). Beide Paketformen wurden geprüft, nicht nur ein entpackter Buildordner.

## 2. Verlässliche Rundenrücknahme

„Zurück vor diese Runde“ zeigt erst die betroffenen Dateien und Ordner. Bestätigen speichert die Rücknahme sofort. Unterstützt werden leerer Ausgangsstand, hinzugefügte, bearbeitete, gelöschte und umbenannte geladene Dateien. Nur leere neue Ordner werden entfernt.

Anvil vergleicht den Beginn, den versiegelten Endstand der Runde und den heutigen Inhalt. Spätere eigene Änderungen werden nicht als Teil einer älteren Runde zurückgesetzt. Änderungen eines anderen Programms werden unmittelbar vor der Dateiverarbeitung geprüft. Ein Scheitern lässt einen gesicherten Plan zurück; nach Unterbrechung kann Anvil den Vorgang erneut abgleichen. Schreibvorgänge ersetzen Dateien über eine temporäre Nachbardatei, damit ein fehlgeschlagener Schreibvorgang die ursprüngliche Datei nicht zuerst leert.

Alte Runden ohne gespeicherten Endstand erzeugen keine destruktive Rücknahme. Geheimnisdateien werden nicht in die Snapshots aufgenommen. Externe Aktionen, Datenbanken, nicht eingelesene Binärdateien oder Dateien außerhalb des Projekts werden nicht zurückgenommen. Beispielsweise bleiben übersprungene Binärdateien in einem umbenannten Ordner erhalten, werden aber nicht automatisch an ihren alten Ort verschoben.

## 3. Erster Erfolg ohne KI

In der Ersteinrichtung **Beispiel ohne KI starten** wählen. Das Beispiel benötigt keine Anmeldung, Bibliothek oder Compilerwahl. In Run lässt sich der Zähler direkt bedienen. Anvil legt eine freie Datei `anvil-erster-test.html` an und schützt gleichnamige vorhandene Dateien und Ordner durch einen anderen Namen.

Ein vorhandener Auftragsentwurf bleibt erhalten. Ist er leer, wird eine kleine Änderung als nächster Auftrag vorbereitet. Für eine KI-Antwort wird anschließend eine funktionierende Verbindung benötigt. Bestehende Profile und das große Desktop-Layout bleiben erhalten.

## 4. Verständliche Verbindungen

Ersteinrichtung, Agent-Einstellungen und der Chat erklären Anfrageziel, Zugang, Abrechnung, Bilder, Antwortanzeige und Thinking anhand des Anvil-Verbindungswegs. Ein erreichbarer Modellkatalog oder eine erkannte Anmeldung wird nicht als erfolgreiche Modellantwort bezeichnet. Ein lokaler Server kann weiterleiten; sein Standort allein beweist nicht, wo das Modell rechnet.

CLI- und interne Helferverbindungen ohne Bildübertragung blockieren neue Bildaufträge vor dem Senden. Bei einem Wechsel von API zu CLI bleiben bereits ausgewählte Bilder und der Entwurf erhalten, bis die Verbindung oder die Anhänge angepasst werden. Alte Bilder bleiben im Chat sichtbar; die ausgehende CLI-Historie behauptet nicht, sie übertragen zu haben. Bildaufträge gelangen nicht unbemerkt in eine Warteschlange, die nur Text unterstützt. Ein Bild ohne Begleittext erhält eine sinnvolle Standardfrage.

## 5. Vier geführte Aufgaben

Im Chat **Geführte Aufgaben** öffnen. Die Auswahl bereitet einen bearbeitbaren Auftrag vor und sendet nichts automatisch. Beim Wechsel zwischen Abläufen bleibt der eigentliche Auftrag erhalten. Dieselben Arbeitsanweisungen sind als vier vorhandene Anvil-Skills eingebunden.

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

Auf Wunsch des Eigentümers bleiben Herausgeber, Supportkontakt, Lizenz und Signierung vorerst offen. `product-release.json` enthält dafür leere Felder. Die Oberfläche nennt den Stand korrekt; eine öffentliche Freigabeprüfung scheitert bis zur vollständigen Konfiguration. Normale Builds erzeugen lokale unsignierte Testpakete. Eine öffentliche Veröffentlichung verlangt einen ausdrücklich gestarteten Lauf, vollständige Angaben und überprüfte echte Signaturen.

Später gemeinsam festzulegen: rechtlich zutreffender Herausgebername, erreichbarer Supportweg, gewünschter Nutzungsrahmen und geeigneter Signierzugang. Dafür wurden keine Identitäten, Verträge oder Zertifikate erfunden. Eine Lizenzwahl und rechtliche Texte brauchen eine gesonderte Entscheidung, bevor verteilt oder verkauft wird.

## Nachweise

- `scripts/product-experience.browser.mjs`: echte gebaute Electron-Oberfläche, Erstbeispiel einschließlich Zählerbedienung, vier Aufgaben, Hilfe mit Vorschau/Kopieren und Bildschutz.
- `scripts/product-workflow.browser.mjs`: echter Projektordner, Speichern, vollständiger Neustart, Rundenrücknahme über die Bedienelemente, externe Schreibkonflikte, Stop und ehrliche offene Prüfungen.
- `scripts/round-restore.test.mjs`: reale Testdateien, gemischte Änderungen, spätere eigene und externe Bearbeitung, Teilausfall sowie erneute Store-Hydration und Wiederholung.
- `scripts/product-send.test.mjs`: Versandgrenzen, Bild ohne Text und unveränderte Projektdateien bei lesenden Aufgaben in Deutsch und Englisch.
- `scripts/product-support.test.mjs`, Verbindungs- und Update-Tests: erlaubte Berichtsfelder, Arbeitsabläufe, Fähigkeiten, Herkunft, Prüfsumme, Absender und leere ZIP-Ziele.
- Build und Typprüfung gehören zum integrierten Stand. Der Windows-Testaufruf wurde korrigiert, damit auch die Prüfdateien unter `scripts` tatsächlich ausgeführt werden.

Abschließende vollständige Testsammlung: **904 bestanden, 0 Fehler, 5 bedingt übersprungen**. Die dateibasierten Testmodule laufen nacheinander, weil parallele Vollprüfungen auf diesem Windows-Rechner vorübergehende Dateisperren bei einem vorhandenen Helfer-Wiederherstellungstest auslösten. Der betroffene Test besteht einzeln und in der vollständigen sequenziellen Ausführung. Typprüfung und Produktionsbuild sind erfolgreich.

Die JSON-Ergebnisse und Screenshots liegen lokal unter `artifacts/product-experience`, `artifacts/product-workflow` und nach der Paketprüfung unter `artifacts/installer-acceptance`. Testläufe verändern keine echten Nutzerprojekte und führen keine neuen Modellanfragen aus.

Eine öffentliche Produktfreigabe, eine saubere Windows-VM, eine echte Altversionsmigration und die Nutzung durch neue Menschen sind zusätzliche Nachweise. Sie werden nicht durch bestandene technische Tests vorgetäuscht.
