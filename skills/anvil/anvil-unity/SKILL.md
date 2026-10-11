---
name: anvil-unity
description: "Unity-Projekte in Anvil bearbeiten und Skripte, Assets, Szenen und Tests zusammenhängend prüfen. Erhält Asset-Kennungen und unterscheidet Editorstart, Testausführung und beobachtetes Spielverhalten."
---

# Mit Unity arbeiten

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-unity",resource:"references/assets-und-tests.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Erhalte Version und Aufbau des bestehenden Unity-Projekts. Ein geöffnetes Unity-Fenster oder ein installierter Unity Hub ersetzt weder den passenden Editor noch eine funktionsfähige Verbindung zum Projekt.

## Voraussetzungen prüfen

Verwende `engine_detect` und lies `ProjectSettings/ProjectVersion.txt`, `Packages/manifest.json` sowie die betroffenen Skripte und Assets. Bei mehreren Projekten den genauen `projectRoot` verwenden. `engine_status` zeigt, ob der Companion einen Editor findet. Eine reine Architektur- oder Codefrage bleibt lesend.

Für Szenen, Prefabs und Editoraktionen über MCP zunächst `mcp_list` für die eingerichtete Unity-Verbindung aufrufen. Namen und Argumente aus deren Katalog übernehmen. Unterschiedliche Unity-Erweiterungen bieten unterschiedliche Werkzeuge. Fehlende Pakete, Editorversionen oder Zugriffe konkret benennen; sie nicht ungefragt installieren oder durch einen Projektumbau ersetzen.

## Assets und Prüfungen

Vorhandene `.meta`-Dateien enthalten Kennungen, die andere Assets referenzieren. Bei Umbenennung oder Verschiebung gehören Asset und Metadatei zusammen. Bestehende Kennungen nicht neu erzeugen, um einen Importfehler scheinbar zu beheben. Szenen- oder Prefabänderungen anhand der zugehörigen Komponenten und Verweise überprüfen.

Der Companion bietet für erkannte Unity-Projekte standardmäßig Editorstart und PlayMode-Testausführung. Nur tatsächlich angebotene Aktionen mit `engine_run` verwenden. Ein angeforderter `check` ist nicht automatisch verfügbar. Bei Tests die ausgeführten Fälle, Fehler und gegebenenfalls Ergebnisdateien auswerten; ein gestarteter Testprozess ist kein bestandener Test.

## Abschluss

C#-Übersetzung, EditMode-Tests, PlayMode-Tests und Bedienung im Spiel unterscheiden. Die passende Prüfung hängt von der Änderung ab. Eine neue Steuerung braucht beispielsweise ein konkretes Verhalten in der betroffenen Szene, eine reine Berechnungsänderung kann gezielt durch einen Test abgesichert werden.

Für GUID-Erhalt und Testgrenzen lies [references/assets-und-tests.md](references/assets-und-tests.md). Nenne den geprüften Projektstand und lasse nicht ausgeführte Spiel- oder Plattformtests ausdrücklich offen.
