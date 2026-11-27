# Anleitungen

Die [Versionshinweise zu Anvil 1.3.36](releases/v1.3.36.md) fassen die aktuellen Änderungen zusammen. Ältere Praxistests bleiben mit ihrem jeweiligen Prüfdatum gekennzeichnet.

Windows: [Aktuelle Veröffentlichung](https://github.com/kokc866-hash/anvil/releases/latest) — Setup-EXE oder portable ZIP. ZIP vollständig in einen beschreibbaren Ordner entpacken und `Anvil.exe` starten. Beide Pakete enthalten die Laufzeit; Node.js wird nur für die Arbeit am Quellcode separat benötigt. Die bisherige Auslieferung ist auf Wunsch des Eigentümers unsigniert.

Aktualisierung vom **15. Oktober 2026**: [Aufträge fortsetzen und wiederholen](auftraege.md) beschreibt den Ablauf nach dem Entfernen der Abnahmeformulare und ihrer Sperren.

Aktualisierung vom **17. Oktober 2026**: [Verbesserungen für lange Agentenaufträge](harness-verbesserungen.md) erklärt Ausgaben, Kontext und Pluginstarts nach dem Vergleich mit OpenCode 2 und DeepSeek Harness.

Aktualisierung vom **18. Oktober 2026**: [Werkzeuge und Anleitungen nach Bedarf](werkzeuge-nach-bedarf.md) beschreibt die automatische Vorauswahl und das gezielte Nachladen von MCP-, Plugin- und Skill-Fähigkeiten.

Aktualisierung vom **19. Oktober 2026**: [Planen und Nachsteuern](planen-und-nachsteuern.md), [Projektregeln und Plugin-Kompatibilität](projektregeln.md), [getrennte Arbeitsstände](getrennte-arbeitsstaende.md) und [Änderungen prüfen](aenderungen-pruefen.md) beschreiben die übernommenen Workflow-Verbesserungen. Alle bleiben in die vorhandene Oberfläche eingebunden; es gibt keine neue Pflichtbestätigung.

| Datei | |
|---|---|
| [produktreife.md](produktreife.md) | Historischer Arbeitsplan mit Verweis auf den aktuellen Umsetzungsstand |
| [produktabschluss.md](produktabschluss.md) | Umgesetzte Produktarbeit 1–6, Bedienwege und bekannte Grenzen |
| [erweiterungen.md](erweiterungen.md) | Plugins entfernen, Skill-Pakete, Projektprüfung, Bedienprüfungen, MCP und ACP-Vorschau |
| [skills.md](skills.md) | Anvils eigene Skill-Bibliothek, automatische Auswahl, Projekt-Anheftungen und gezielte Referenzen |
| [werkzeuge-nach-bedarf.md](werkzeuge-nach-bedarf.md) | Kontext sparen durch automatische Vorauswahl und gezieltes Nachladen, ohne zusätzliche Auswahlfenster |
| [planen-und-nachsteuern.md](planen-und-nachsteuern.md) | Freiwillige Planversionen, feste Umsetzungsaufträge und Korrekturen während eines laufenden Auftrags |
| [projektregeln.md](projektregeln.md) | Dateibezogene Regeln, Cursor-MDC und ehrliche Kompatibilität einzelner Plugin-Bestandteile |
| [getrennte-arbeitsstaende.md](getrennte-arbeitsstaende.md) | Eigene Git-Aufgabenstände, Konfliktschutz und begrenzte parallele Hintergrundaufträge |
| [aenderungen-pruefen.md](aenderungen-pruefen.md) | Vergleichsbasis, tatsächliche Leseabdeckung, offene Befunde und gezielte Folgeaufträge |
| [dienste.md](dienste.md) | Bei Notion und anderen Diensten anmelden und deren Werkzeuge über Anvils Brücke nutzen |
| [dienstkatalog.md](dienstkatalog.md) | Verfügbare Dienste und erforderliche Einrichtung |
| [engines.md](engines.md) | Unity, Unreal, Godot, Blender und CAD einrichten; Voraussetzungen und Testnachweise |
| [blender.md](blender.md) | Blender mit Anvil und global mit Codex verbinden, automatisch starten und Ergebnisse prüfen |
| [freecad.md](freecad.md) | FreeCAD Schritt für Schritt mit Anvil verbinden, automatisch starten und ein erstes Bauteil prüfen |
| [orientierung.md](orientierung.md) | Einstieg, Fragen und Agent sowie die Aufgaben der einzelnen Bereiche |
| [installation-abnahme.md](installation-abnahme.md) | Sichere Updates, echte Paketprüfung und spätere Signierung |
| [optimierungen-2026-10.md](optimierungen-2026-10.md) | Laufbindung, zuverlässige Wiederherstellung, Plugin-Freigaben, Leistung und aktueller Prüfstand |
| [01-kurz.md](01-kurz.md) | Start, Modell, erste Aufgabe |
| [02-handbuch.md](02-handbuch.md) | Fenster, Einstellungen, Vorschau |
| [03-workflow.md](03-workflow.md) | Abläufe Schritt für Schritt |
| [loop-und-graph.md](loop-und-graph.md) | Gemeinsamer Ablaufzustand, Tafel, Prüfungsnachweise, Vorlagen und Wiederaufnahme |
| [harness-verbesserungen.md](harness-verbesserungen.md) | Große Ausgaben nachlesen, Werkzeuggruppen erhalten und fehlgeschlagene Pluginstarts aufräumen |
| [04-presentation.md](04-presentation.md) | Kurzpräsentation (5 Minuten) |
| [05-verbindungen.md](05-verbindungen.md) | Lokale Modelle, Cloud-Anbieter, Abonnements über CLI und eigene Verbindungen |
| [qwen-und-deepseek.md](qwen-und-deepseek.md) | API-Zugänge, dynamische Modelllisten und Denkaufwand für Qwen AI und DeepSeek |
| [06-optimierungen.md](06-optimierungen.md) | Speicher, Chat, Anfrageablauf und Schlüsselablage |
| [canvas.md](canvas.md) | Canvas-API, Eingaben, HTML-Projekte und gemeinsame Programmausgabe |
| [tool-learning.md](tool-learning.md) | Gelernte Werkzeugaufrufe, Bestätigungen und Grenzen |
| [editor.md](editor.md) | Sicheres Bearbeiten, Speichern, Navigation, Suche und Sprachdienst |
| [chat.md](chat.md) | Statusanzeige, Chatwechsel, Warteschlange und Abbruch |
| [auftraege.md](auftraege.md) | Direkt weiterarbeiten, wiederholen und ohne Abnahmeformular fortsetzen |
| [hintergrundbetrieb.md](hintergrundbetrieb.md) | Neuer, noch unveröffentlichter Testmodus: Datei-Aufträge unabhängig vom Fenster |
| [einstellungen.md](einstellungen.md) | Sicherung, Zurücksetzen einzelner Bereiche, Einstellungssuche und Projektvorgaben |
| [sprachupdates.md](sprachupdates.md) | Automatisch auf neue Compiler, Laufzeitumgebungen und Sprachserver prüfen |
| [sprache.md](sprache.md) | Regeln für verständliche Beschriftungen, Hinweise und Fehlermeldungen |
| [helfer.md](helfer.md) | Helfer-Lebenszyklus, Modellablage, Aufgaben und Desktop-Bedienung |
| [mcp.md](mcp.md) | MCP: HTTP, stdio, OAuth, Ressourcen, Katalog und Abbruch |
