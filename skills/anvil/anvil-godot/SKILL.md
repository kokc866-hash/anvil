---
name: anvil-godot
description: "Godot-Projekte in Anvil bearbeiten und Import, Skripte sowie Szenen getrennt prüfen. Für GDScript, Ressourcen und Spielverhalten; ein erfolgreicher Import zählt nicht als Spieltest."
compatibility: "Für Anvils Agentenbetrieb mit passender Godot-Anbindung. Verwendet Anvil-Werkzeuge; zusätzliche Dienstwerkzeuge benötigen einen aktuellen freigegebenen Katalog."
metadata:
  version: "1.2.0"
  adaptation: "Anvil-spezifische Arbeitsanleitung; keine unverändert importierte Laufzeit"
  provenance: "references/quellen.json"
---

# Mit Godot arbeiten

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-godot",resource:"references/szenen-pruefen.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Arbeite am gespeicherten Godot-Projekt und verwende dessen Version, Szenenaufbau und Ressourcen. Bei einer reinen Erklärung nur Projektdateien lesen; ein Engine-Start kann Importe und Projektzustand verändern.

## Projekt und Verbindung bestimmen

Mit `engine_detect` das Projekt erkennen. Bei mehreren Treffern die zurückgegebene Engine und den genauen `projectRoot` wählen. Lies `project.godot`, relevante Szenen und Skripte mit den Dateiwerkzeugen. `engine_status` prüft den Companion und bekannte Programmpfade. Eine installierte Engine allein stellt keine Editor-MCP-Werkzeuge bereit.

Für Szenenbearbeitung über eine zusätzliche Godot-MCP-Verbindung zunächst `mcp_list` verwenden und deren tatsächliche Parameter lesen. Fehlt die benötigte Verbindung oder passende Godot-Version, diese Voraussetzung benennen. Keine neue Engine oder Erweiterung allein auf Grundlage dieses Skills installieren.

## Gezielt ändern

Szenen, Skripte, Ressourcenpfade, bestehende Kennungen und Signalverbindungen gemeinsam betrachten. Ressourcen nur ersetzen oder verschieben, wenn dies zum Auftrag gehört und ihre Verweise erhalten bleiben. Geometrie, Asset-Maße und unabhängige Szeneinhalte nicht beiläufig verändern.

Prüfe nach Änderungen die unterstützten Aktionen aus `engine_detect`. `engine_run` mit `action:"check"` führt im vorhandenen Companion die Godot-Importprüfung aus. Lies dabei auch Fehlerausgaben: Ein Prozesscode allein belegt keine fehlerfreien Skripte. `action:"play"` startet das Projekt; ein laufendes Fenster bestätigt noch kein korrektes Spielverhalten.

## Ergebnisse unterscheiden

Import, Skriptausführung, konkrete Spielinteraktion und Export haben eigene Nachweise. Für eine Spielfunktion die betroffene Szene und ein beobachtbares Ergebnis prüfen, soweit die eingerichteten Werkzeuge dies ermöglichen. Nicht erreichbare Interaktionen als offen melden. Keine künstlichen Screenshot- oder Gameplay-Aussagen ergänzen.

Bei Importproblemen, Szenenänderungen und einer verlangten Wiederherstellung lies [references/szenen-pruefen.md](references/szenen-pruefen.md). Berichte geänderte Ressourcen, tatsächliche Prüfungen und verbleibende Einschränkungen getrennt.

## Fachliche Vertiefung

Für GDScript-Runner, Fehlerzählung und kontrollierten Prozessabschluss lies [references/headless-und-verhalten.md](references/headless-und-verhalten.md). Ein grüner Import und eine ausgegebene PASS-Zeile ersetzen keinen durchgelaufenen Verhaltenstest.

Herkunft und Lizenzhinweise: [references/quellen.md](references/quellen.md).
