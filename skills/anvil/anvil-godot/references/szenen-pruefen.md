# Godot-Szenen und Nachweise

## Import und Skripte

Anvils Companion nutzt für die angebotene Importprüfung Godots `--headless --import` im erkannten Projekt. Das verarbeitet Ressourcen und meldet gegebenenfalls Skriptfehler. Es spielt keine Szene durch. Lies auch Meldungen wie `SCRIPT ERROR` und `ERROR`; der Prozesscode allein reicht für diese Bewertung nicht.

Die genaue Aktion aus dem zurückgegebenen Projekt verwenden. Bei mehreren Projekten ist `projectRoot` der erkannte relative Unterordner, kein selbst erfundener Systempfad.

## Beispiel: Szenenobjekt ändern

Wenn der Auftrag ein Objekt in einer Szene verändert, lies die Szene, das zugehörige Skript und verwendete Ressourcen. Bestimme das vorhandene Objekt anhand seiner tatsächlichen Kennung oder seines Pfads. Prüfe nach dem Eingriff die Szene und den Import. Für ein Spielverhalten, etwa Bewegung oder Kollision, zusätzlich genau diese Interaktion ausführen, sofern die vorhandenen Engine-Werkzeuge es ermöglichen.

Eine erfolgreiche Startmeldung bestätigt keine Kollision, Steuerung oder Asset-Darstellung. Bei einem ausschließlich ohne Darstellung ausgeführten Test bleibt die visuelle Wirkung ungeprüft.

## Verlangte Wiederherstellung

Nur wenn eine Rückkehr zum ursprünglichen Stand Teil des Auftrags ist, den Ausgangsstand der betroffenen Szene, Skripte und Ressourcen gesondert erfassen. Nach dem Zurücksetzen erneut lesen und relevant prüfen. Ein weiterhin geöffnetes Editorfenster beweist nicht, dass es den zurückgesetzten Dateistand verwendet.

## Primärquelle

Godot beschreibt Import, Projektpfad und Spielstart als getrennte Kommandozeilenabläufe. Befehle an die verwendete Version anpassen: [Godot-Kommandozeilenanleitung](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html).
