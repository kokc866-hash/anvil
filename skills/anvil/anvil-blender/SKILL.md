---
name: anvil-blender
description: "Blender über eine eingerichtete MCP-Verbindung für Modelle, Materialien und Szenen verwenden. Prüft das gewählte Dokument, Maße, sichtbare Ergebnisse und Exporte ohne zusätzliche Asset-Dienste vorauszusetzen."
---

# Mit Blender modellieren

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-blender",resource:"references/speichern-und-exportieren.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Verwende die eingerichtete Blender-Verbindung und ändere nur die gewünschte Szene oder das gewünschte Modell. Eine reine Bestandsaufnahme oder Bewertung bleibt lesend.

## Verbindung und Szene

Mit `mcp_list` Server, Werkzeuge und Argumente feststellen. Das vorbereitete MCP-for-Blender-Paket kann beispielsweise `get_addon_status`, `get_scene_info`, `get_object_info`, `get_viewport_screenshot` und `execute_blender_code` anbieten. Nur im aktuellen Katalog vorhandene Werkzeuge über `mcp_call` verwenden. Ein Katalog allein beweist noch nicht, dass das Blender-Addon erreichbar ist.

Prüfe aktive Szene, Objekte, vorhandenes Speicherziel und Einheiten, bevor du modellierst. Für neue Arbeiten eine getrennte Szene oder Datei verwenden, wenn dies zum Auftrag passt. Vor Änderungen an einem bestehenden Dokument den erforderlichen Rückweg sichern. Die Anvil-Projektrücksetzung stellt fremde Blender-Dokumente nicht automatisch wieder her.

## Geometrie und Daten erhalten

Ändere identifizierte Objekte gezielt. Nicht pauschal die gesamte Szene leeren. Maße, Transformationen, Modifier und Materialzuweisungen gemeinsam betrachten. Python-Code zur Modellierung hat echte Nebenwirkungen; sein Umfang muss zum Auftrag und zu den freigegebenen Werkzeugen passen.

Für versionsabhängige Blender-APIs verfügbare Auskunftswerkzeuge oder passende Dokumentation nutzen. Lokalisierte Anzeigenamen können wechseln; beim Arbeiten mit Nodes ihre stabilen Typen beziehungsweise API-Kennungen verwenden. Zusätzliche Asset-Downloads oder kostenpflichtige Generierungen sind eigene Aktionen und werden durch diesen Skill nicht freigegeben.

## Prüfen und speichern

Veränderte Geometrie und Maße aus der Anwendung lesen, eine geeignete Ansicht prüfen und im vereinbarten Ziel speichern. Für einen Export das gewünschte Objekt- und Szenenset eindeutig wählen. Eine Datei mit passender Endung bestätigt noch keinen gültigen Export; bei relevanten Austauschformaten erneut einlesen und Maße sowie Materialien prüfen.

Den bedingten Ablauf für Sicherung, GLB-Export und Wiederherstellung beschreibt [references/speichern-und-exportieren.md](references/speichern-und-exportieren.md). Melde nur tatsächlich beobachtete Ergebnisse.
