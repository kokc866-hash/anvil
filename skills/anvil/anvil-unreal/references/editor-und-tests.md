# Unreal-Editor, Assets und Tests

## Dateigrenzen

`.uproject`, Konfigurationen und C++ sind mit den Anvil-Dateiwerkzeugen lesbar. Binäre Level und Assets brauchen ihre passende Editor- oder Projektschnittstelle. Ein gleichnamiger Textplatzhalter ersetzt kein Blueprint oder Level.

Bei einer Scene- oder Blueprint-Aufgabe zuerst ermitteln, welche konkreten Assets und Referenzen betroffen sind. Falls die eingerichtete Verbindung keine Änderung dieser Inhalte erlaubt, ist genau diese Fähigkeit eine fehlende Voraussetzung. Der Start des Editors schafft sie nicht automatisch.

## Prüfergebnisse

Unreal-Automation kann gezielte Tests ausführen und Berichte erzeugen. Dazu muss ein im Projekt vorhandener oder tatsächlich freigegebener Werkzeugweg benutzt werden. Der Anvil-Companion bietet allein durch die Engine-Erkennung standardmäßig den Editorstart.

Ein Bericht soll die erwarteten Testfälle und ihren abgeschlossenen Status enthalten. Laufende, fehlgeschlagene und nicht ausgeführte Fälle getrennt nennen. Ein Kommando, das nur den Editor öffnet und beendet, bestätigt kein Gameplay. Ein Lauf ohne Rendering bestätigt keine visuelle Wirkung.

Die [Epic-Anleitung zu Automation-Tests](https://dev.epicgames.com/documentation/unreal-engine/run-automation-tests-in-unreal-engine) beschreibt Editor- und Kommandozeilentests sowie den Berichtsweg. Prüfe Version, vorhandene Tests und unterstützte Anvil-Aktion, bevor du diesen Weg verwendest.

## Gewünschter Rückweg

Wenn eine Wiederherstellung verlangt ist, Dateien und gegebenenfalls geöffneten Editorzustand getrennt betrachten. Bestehende Sicherungs- oder Versionsverwaltungswege nutzen. Nicht allein aus einer Anvil-Projektrücksetzung ableiten, dass fremde Editorassets zurückgesetzt wurden.
