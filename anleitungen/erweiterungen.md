# Erweiterungen in Anvil

Stand: 12. September 2026. Lokaler Entwicklungsstand; keine neue veröffentlichte Version.

Die erste Ausbaustufe aus der [Erweiterungsanalyse](erweiterungsanalyse.md) ist umgesetzt. Die vorhandenen Bereiche bleiben erhalten. Die neuen Funktionen sind dort ergänzt, wo man sie verwendet.

## Eigene Plugins entfernen

Unter **Erweiterungen → Alle** besitzt jedes eigene Projekt-Plugin den Knopf **Plugin entfernen**. Das gilt auch für das mit **Neues Plugin** angelegte `mein-plugin`.

Nach der Bestätigung entfernt Anvil die zugehörige Datei, die Registrierung, Befehle und Plugin-Einstellungen. Die Entfernung bleibt nach einem Neustart bestehen. Abbrechen lässt das Plugin bestehen. Ungespeicherte oder zwischenzeitlich außerhalb von Anvil geänderte Dateien werden beim Entfernen berücksichtigt; ein fehlgeschlagener Dateizugriff wird nicht als Erfolg gemeldet.

Noch laufende alte Plugin-Befehle verlieren den Zugriff auf Anvils Plugin-API. Bereits ausgeführte externe Aktionen werden dadurch nicht rückgängig gemacht. Das ist keine Betriebssystem-Isolation beliebigen JavaScript-Codes.

## Skills und das Web-Aufgabenpaket

Unter **Erweiterungen → Aufgabenpakete**:

- **Web-Aufgabenpaket ergänzen** legt eine kleine Aufgabenliste unter `web-paket/index.html` an, dazu eine Arbeitsanleitung, eine Abnahmereferenz und eine gespeicherte Bedienprüfung. Vorhandene Dateien werden nicht überschrieben. Das Beispiel benötigt keine Downloads und kein Modell.
- **Skill-Ordner importieren** übernimmt ein Verzeichnis mit `SKILL.md`, `name`, `description` und ergänzenden Dateien. Anleitungen werden vollständig übernommen; alte Anvil-Skills mit `when` bleiben nutzbar. Die Grenze beträgt 100 Dateien und 8 MB pro Paket. Enthaltene Skripte werden beim Import nicht ausgeführt.
- **Exportieren** erstellt ein ZIP mit dem Skill und seinen Dateien. Für einen späteren Ordnerimport das ZIP vorher entpacken.
- **Entfernen** entfernt das gewählte Skill-Paket einschließlich eigener Änderungen innerhalb seines Verzeichnisses. Andere Projektdateien bleiben erhalten; beim Web-Beispiel bleibt daher die Anwendung bestehen.

**Projekt startklar?** zeigt Projektdateien, Startweg, Ablage und vorhandene Voraussetzungen. **Voraussetzungen prüfen** fragt die Laufzeiten beim eingestellten Companion ab. Ein ausgewähltes Modell wird ausdrücklich nicht als erfolgreich getestete Modellverbindung ausgegeben.

## Gespeicherte Bedienprüfungen

Im vorhandenen Bereich **Tests → Bedienprüfungen** eine Prüfung auswählen oder anlegen. Unterstützt werden HTML-Startseiten, Anklicken, Ausfüllen, Neuladen und Erwartungen an Sichtbarkeit, Text, Feldwert und Elementanzahl. Die Elemente werden über CSS-Selektoren angegeben. Das Web-Paket enthält bereits eine passende Prüfung für Hinzufügen, leere Eingabe und Entfernen.

Prüfungen und Ergebnisse liegen im Projekt unter `.anvil/interaction-checks.json` und `.anvil/interaction-results.json`. Sie bleiben nach einem Neustart verfügbar und verdrängen beim Speichern nicht die gerade geöffnete Editor-Datei.

Jeder Lauf verwendet einen getrennten, anfangs leeren Prüfspeicher. Eine Seitenneuladung innerhalb desselben Laufs behält dessen Speicher. Normale Anwendungsdaten werden nicht verwendet. Externe Netzressourcen sind gesperrt. Die erste Fassung eignet sich für lokale HTML-Projekte mit ihren Textdateien; native Anwendungen, Spiele, externe Backends und beliebige Binärdateien sind nicht abgedeckt.

Ein echter Erwartungsfehler ergibt **Fehlgeschlagen**. Abbruch und fehlende Voraussetzungen bleiben **offen**. Nach einer Änderung an Projekt oder Prüfung wird ein älteres Ergebnis als veraltet angezeigt. Ein früherer grüner Lauf ist damit kein Nachweis für den neuen Stand.

## Verbindungen ergänzen

Für Anmeldungen bei externen Diensten und deren Werkzeugauswahl gibt es inzwischen **Erweiterungen → Dienste**, zunächst mit Notion, Linear und eigenen OAuth-MCP-Adressen. Dieser Ablauf verwendet die vorhandene Brücke; siehe [Externe Dienste](dienste.md).

Im **MCP-Bereich → Aufgabenpakete** steht **GitHub · Projektquelle lesen** bereit. Es wird zunächst deaktiviert hinzugefügt und begrenzt die Verbindung auf drei Lese-Werkzeuge. Der eigene Token und die Verbindung lassen sich wieder entfernen. Einzelheiten und Datenwege: [MCP-Pakete](mcp-pakete.md).

Unter **Erweiterungen → API → Externe Agenten · ACP-Vorschau** lässt sich ein installiertes ACP-Programm ausdrücklich zur Initialisierung starten. Diese Vorschau ist ein Protokolltest, noch kein produktiver externer Agent-Modus. Sie bestätigt weder Anmeldung noch Modellantwort. Umfang und Grenzen: [ACP-Vorschau](acp-vorschau.md).

## Abnahme

Die gebaute Desktop-Oberfläche wurde in einem getrennten Projekt bedient: Plugin anlegen, Entfernung abbrechen, bestätigen und nach einem echten Neustart erneut prüfen; Web-Paket ergänzen; gespeicherte Bedienprüfung ausführen. Ein absichtlich eingebauter Fehler wurde erkannt, nach der Korrektur bestand dieselbe Prüfung wieder. Der aktuelle Editor blieb beim Speichern der Prüfergebnisse erhalten.

- `artifacts/extensions-product/result.json`: gemeinsame Desktop-Abnahme einschließlich Neustart und tatsächlicher ACP-Initialisierung mit einem lokalen Protokoll-Testprogramm.
- `artifacts/interaction-checks/native-result.json`: acht native Prüffälle einschließlich getrenntem Speicher, Neuladen, Fehlererkennung, Abbruch und Netzsperre.
- `artifacts/mcp-packages/result.json`: MCP-Oberfläche einschließlich Fehlerantwort, Entfernung und Neustart. Der Transport wurde kontrolliert ersetzt; ein persönlicher GitHub-Token und der Live-Dienst wurden nicht verwendet.

Zusätzliche automatisierte Tests prüfen unter anderem Skill-Import, bestehende Skills, Dateikollisionen, Entfernungszustand, verspätete Plugin-Zugriffe und ACP-Protokollfehler. Es wurden keine KI-Modellaufrufe für diese Abnahme benötigt.

Der abschließende vollständige Testlauf bestand mit **929 erfolgreichen Tests, 5 übersprungenen Tests und 0 Fehlern** (`artifacts/extensions-product/tests-final.log`). TypeScript-Prüfung und Desktop-Build bestanden ebenfalls; der fertige Build wurde nach `ui-build` übernommen. Ein früherer, mit weiteren Prüfjobs überlappender Lauf hatte zwei Fehler; beide bestanden einzeln und anschließend im vollständigen ruhigen Lauf. Der genaue Auslöser dieser zwischenzeitlichen Fehler ist nicht abschließend belegt.

Zum Starten des lokalen Quellstands weiterhin `I:\Anvil\Anvil.vbs` verwenden. Ein bereits laufendes Anvil muss für die neuen Desktop-Funktionen nach dem Speichern vollständig beendet und erneut geöffnet werden.
