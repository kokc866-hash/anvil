---
name: anvil-github
description: "GitHub über Anvils vorhandene Verbindungen und freigegebene MCP-Werkzeuge nutzen. Trennt Repository-Lesen, lokale Git-Arbeit und externe Änderungen wie Issues, Pull Requests oder Releases."
---

# GitHub gezielt nutzen

Verwende nur die für den aktuellen Auftrag eingerichteten GitHub-Funktionen. Ein vorhandenes Remote im Projekt oder eine GitHub-Anmeldung für Einstellungen bedeutet noch nicht, dass der Agent GitHub-MCP-Werkzeuge aufrufen kann.

## Zugriff prüfen

Mit `mcp_list` die passende Verbindung und ihre freigegebenen Werkzeuge samt Argumenten finden. Bei mehreren GitHub-Verbindungen anhand von Ziel und Zugriff wählen, nicht anhand eines zufälligen Anzeigenamens. Ein geladener Katalog bestätigt die Existenz der Werkzeuge; ein konkreter Leseaufruf bestätigt den Zugriff auf das gewünschte Repository.

Anvils vorbereitetes Lesepaket enthält `get_file_contents`, `list_branches` und `list_commits`. Es kann keine Issues, Pull Requests oder Releases erstellen. Eine weitergehende Verbindung kann solche Werkzeuge anbieten; ihre Namen, Parameter und Berechtigungen zuerst aus dem tatsächlichen Katalog lesen.

## Auftrag ausführen

Repository-Eigentümer, Repository und gegebenenfalls Branch beziehungsweise Commit eindeutig bestimmen. Dateiänderungen am lokalen Projekt mit den normalen Dateiwerkzeugen behandeln. `git_commit` und `git_push` sind eigene Abläufe; insbesondere erstellt `git_push` in Anvil zusätzlich einen Commit und überträgt den Arbeitsstand.

Externe Änderungen nur aus dem dafür erteilten Auftrag ableiten. Eine Bitte um Prüfung erlaubt keinen Pull Request, Kommentar oder Release. Bei unklarer Veröffentlichung zunächst Inhalt und Ziel konkret vorbereiten und die fehlende Entscheidung klären. Der Skill erweitert keine Freigaben und verbindet keine zusätzlichen Konten.

## Wiederholung und Ergebnis

Ergebnisse großer Aufrufe mit `mcp_read_output` weiterlesen, statt den Auftrag nochmals auszuführen. Nach einem unklaren Ausgang einer schreibenden Aktion deren Ergebnis über einen passenden Leseweg prüfen; keine mögliche Veröffentlichung blind wiederholen.

Nenne belegte Repository-, Branch-, Commit- oder Objektangaben und einen verfügbaren Ergebnislink. „Werkzeug aufgerufen“ reicht für den Abschluss nicht. Eine fehlende Verbindung oder unzureichende Freigabe präzise benennen; Zugangsdaten nicht ausgeben.

