---
name: anvil-unreal
description: "Unreal-Projekte in Anvil anhand von C++, Projektkonfiguration und vorhandenen Editorwerkzeugen bearbeiten. Beachtet binäre Assets und trennt Editorstart, Automation-Tests, Spielverhalten und Packaging."
---

# Mit Unreal Engine arbeiten

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-unreal",resource:"references/editor-und-tests.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Arbeite am ausgewählten Unreal-Projekt und seiner vorhandenen Engine-Version. Prüfe vor einer Änderung, ob Quellcode, Projektkonfiguration, Blueprint oder Level betroffen ist. Eine reine Bewertung bleibt lesend.

## Projekt und Werkzeugweg

Mit `engine_detect` die `.uproject`-Datei und den genauen `projectRoot` bestimmen. Lies relevante Module, Konfigurationen und vorhandene Testbeschreibungen. Mit `engine_status` die Editorverfügbarkeit im Companion prüfen. Ein fehlender Compiler, ein nicht verfügbares Plugin und ein Projektfehler sind unterschiedliche Voraussetzungen.

Der Companion bietet für Unreal standardmäßig den Editorstart. Daraus keine unterstützte Check-, Play- oder Testaktion ableiten. Für weitere Abläufe die tatsächlich verfügbare Verbindung mit `mcp_list` untersuchen oder einen ausdrücklich erlaubten `engine_run`-Befehl verwenden. Nicht unterstützte Aktionen melden, statt sie stillschweigend durch einen Editorstart zu ersetzen.

## Passend bearbeiten

C++ und lesbare Konfigurationen mit den Dateiwerkzeugen gezielt ändern. `.uasset` und `.umap` sind keine Markdown- oder Quelltextdateien und dürfen nicht durch `write_file` als Text ersetzt werden. Für solche Änderungen sind passende Editorwerkzeuge oder ein im Projekt vorhandener, freigegebener Ablauf erforderlich.

Bei Level- oder Blueprintänderungen das konkrete Asset und seine abhängigen Inhalte bestimmen. Bestehende Geometrie, Materialien und Komponenten erhalten, soweit der Auftrag sie nicht betrifft. Anvils Projektsicherung ersetzt keine Sicherung eines fremden geöffneten Editorzustands.

## Nachweise

Editorstart, C++-Build, Automation-Tests, Play-in-Editor und ein gepacktes Spiel belegen unterschiedliche Dinge. Ein Start ohne Rendering kann den Prozessablauf prüfen, aber keine Darstellung oder Spielbedienung bestätigen. Für einen Test Ergebnisbericht und relevante Logs auswerten, nicht nur die Existenz des Prozesses.

Für Assetgrenzen und Testberichte lies [references/editor-und-tests.md](references/editor-und-tests.md). Berichte das ausgeführte Verfahren und seine Reichweite präzise; fehlende Plattform- oder Spielprüfungen nicht als Erfolg ausgeben.
