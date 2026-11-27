---
name: anvil-github
description: "GitHub über Anvils vorhandene Verbindungen und freigegebene MCP-Werkzeuge nutzen. Trennt Repository-Lesen, lokale Git-Arbeit und externe Änderungen wie Issues, Pull Requests oder Releases."
compatibility: "Für Anvils Agentenbetrieb mit passender GitHub-Anbindung. Verwendet Anvil-Werkzeuge; zusätzliche Dienstwerkzeuge benötigen einen aktuellen freigegebenen Katalog."
metadata:
  version: "1.1.0"
---

# GitHub gezielt nutzen

Verwende nur die für den aktuellen Auftrag eingerichteten GitHub-Funktionen. Ein vorhandenes Remote im Projekt oder eine GitHub-Anmeldung für Einstellungen bedeutet noch nicht, dass der Agent GitHub-MCP-Werkzeuge aufrufen kann.

## Zugriff prüfen

Mit `mcp_list` die passende Verbindung und ihre freigegebenen Werkzeuge samt Argumenten finden. Bei mehreren GitHub-Verbindungen anhand von Ziel und Zugriff wählen, nicht anhand eines zufälligen Anzeigenamens. Ein geladener Katalog bestätigt die Existenz der Werkzeuge; ein konkreter Leseaufruf bestätigt den Zugriff auf das gewünschte Repository.

Anvils vorbereitetes Lesepaket enthält `get_file_contents`, `list_branches` und `list_commits`. Es kann keine Issues, Pull Requests oder Releases erstellen. Eine weitergehende Verbindung kann solche Werkzeuge anbieten; ihre Namen, Parameter und Berechtigungen zuerst aus dem tatsächlichen Katalog lesen.

## Auftrag ausführen

Repository-Eigentümer, Repository und gegebenenfalls Branch beziehungsweise Commit eindeutig bestimmen. Lokale Dateiänderungen mit den Dateiwerkzeugen behandeln. Git-Werkzeuge hängen vom Betriebsweg ab: Der native Hintergrundbetrieb bietet einen lokalen Commit gespeicherter, von diesem Auftrag geänderter Dateien, aber keinen Push oder Clone. Ein bereits vorgemerkter Index wird dort abgelehnt.

Im Vordergrund kann der Companion-Commit weitere Änderungen aufnehmen; ein dort angebotenes `git_push` verbindet Commit und Übertragung des Arbeitsstands. Keine nicht angebotene Aktion aufrufen und eine vorhandene MCP-Verbindung nur anhand ihres aktuellen Katalogs nutzen. Ein lokaler Commit bestätigt noch keine GitHub-Sicherung.

Externe Änderungen nur aus dem dafür erteilten Auftrag ableiten. Eine Bitte um Prüfung erlaubt keinen Pull Request, Kommentar oder Release. Bei unklarer Veröffentlichung zunächst Inhalt und Ziel konkret vorbereiten und die fehlende Entscheidung klären. Der Skill erweitert keine Freigaben und verbindet keine zusätzlichen Konten.

## Wiederholung und Ergebnis

Ergebnisse großer Aufrufe mit `mcp_read_output` weiterlesen, statt den Auftrag nochmals auszuführen. Nach einem unklaren Ausgang einer schreibenden Aktion deren Ergebnis über einen passenden Leseweg prüfen; keine mögliche Veröffentlichung blind wiederholen.

Nenne belegte Repository-, Branch-, Commit- oder Objektangaben und einen verfügbaren Ergebnislink. „Werkzeug aufgerufen“ reicht für den Abschluss nicht. Eine fehlende Verbindung oder unzureichende Freigabe präzise benennen; Zugangsdaten nicht ausgeben.

