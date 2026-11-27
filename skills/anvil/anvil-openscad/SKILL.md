---
name: anvil-openscad
description: "Parametrische OpenSCAD-Bauteile über Anvils eingerichtete Verbindung entwickeln und ihre Syntax, tatsächliche Geometrie, Maße und Exporte prüfen. Trennt Vorschau und belastbaren Modellnachweis."
compatibility: "Für Anvils Agentenbetrieb mit passender OpenSCAD-Anbindung. Verwendet Anvil-Werkzeuge; zusätzliche Dienstwerkzeuge benötigen einen aktuellen freigegebenen Katalog."
metadata:
  version: "1.1.0"
---

# Bauteile mit OpenSCAD entwickeln

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-openscad",resource:"references/montageplatte-pruefen.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Übersetze die gewünschten Maße und Funktionen in nachvollziehbare Parameter. Verwende bestehende Konstruktionen weiter, wenn der Auftrag eine Änderung verlangt. Eine reine Erklärung von OpenSCAD-Code bleibt lesend.

## Voraussetzungen und Auftrag

Mit `mcp_list` die eingerichtete Verbindung und Argumente prüfen. Anvils Vorlage verwendet RobertCoops `openscad-mcp`. Diese Anbindung kann `check_openscad`, `validate`, `measure`, `render` und `export_model` bereitstellen; Namen und Schemas im aktuellen Katalog verifizieren. `check_openscad` bestätigt, ob das CAD-Programm tatsächlich gefunden wird.

Modell, Speicherziel, Einheiten und geforderte Maße feststellen. Für neue Dateien `write_file`, für vorhandenen Code `edit_file` verwenden. Speichere neue eigenständige SCAD-Dateien, Renderings und Exporte im aktiven Workspace unter `Ergebnis/` oder im beauftragten Projektunterordner. Nutze das im Werkzeug angebotene Speicherziel und prüfe die gespeicherten Dateien mit `list_files`. Fehlende Software oder Verbindung präzise benennen. Der Skill erlaubt keine automatische Installation und wechselt nicht ungefragt auf ein ähnlich benanntes Serverpaket.

## Konstruieren und messen

Benannte Parameter für zusammengehörige Abmessungen verwenden. Bohrungen, Wandstärken und Abstände aus dem Auftrag ableiten. Bei Booleschen Operationen und Exporten die erzeugte Geometrie prüfen; eine plausibel aussehende Vorschau bestätigt noch keinen geschlossenen, maßhaltigen Volumenkörper.

Fehlermeldungen und strukturierte Ergebnisse von `validate` und `measure` auswerten. Ein erfolgreicher Prozesscode allein kann Modellfehler übersehen. Grenzabmessungen, Volumen und gegebenenfalls offene oder nicht mannigfaltige Kanten anhand des tatsächlich erzeugten Modells überprüfen.

## Ausgabe und Grenzen

Eine passende Ansicht rendern und im vereinbarten Format in das festgelegte Ziel exportieren. Wichtige Exporte erneut prüfen, wenn die verfügbaren Werkzeuge dies unterstützen. Ein STL-Export ist ein Netz; daraus keine zugesicherte parametrische Weiterbearbeitung ableiten.

Für eine konkrete Montageplatte mit unabhängig berechenbaren Maßen und Volumen lies [references/montageplatte-pruefen.md](references/montageplatte-pruefen.md). Das Beispiel dient ausschließlich der verlangten Konstruktion oder einem vereinbarten Test. Es ersetzt keine Fertigungsfreigabe, Materialprüfung oder reale Passprobe.
