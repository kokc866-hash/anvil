---
name: anvil-assets-uebertragen
description: "Modelle und andere Assets zwischen einer vorhandenen Blender-/CAD-Quelle und einem Zielprojekt übertragen. Prüft Einheiten, Exportumfang, Import und tatsächliche Nutzung im Ziel statt nur die Existenz einer Datei."
compatibility: "Für Anvils Agentenbetrieb. Benötigt die zum beauftragten Quell- und Zielprogramm passenden, freigegebenen Verbindungen."
metadata:
  version: "1.0.0"
---

# Assets in ihr Zielprojekt übertragen

Bearbeite den verlangten Übergang zwischen Quelle und Ziel. Eine einzelne Modellierungs- oder Architekturfrage startet keinen Export. Bestehende native Dokumente und unabhängige Inhalte erhalten.

## Quelle, Ziel und Format bestimmen

Lies Projektbeschreibung und relevante Dateien. Für ein Engine-Ziel mit `engine_detect` Projektart und genaue Projektwurzel bestimmen. Mit `mcp_list` die tatsächlichen Möglichkeiten des Quellprogramms und gegebenenfalls des Zieleditors prüfen. Ein installierter Editor oder ein Dateiname belegt keine erreichbare Importfunktion.

Bestimme das gewählte Objektset, Maße und Einheiten, Achsenorientierung, Maßstab, Materialbedarf sowie das verlangte Austauschformat. Ein STL-Netz und ein parametrisches CAD-Dokument sind unterschiedliche Ergebnisse. Für eine Änderung am vorhandenen Modell den erforderlichen Rückweg sichern; eine Anvil-Projektrücknahme setzt das Quellprogramm nicht automatisch zurück.

## Export und Import zusammen prüfen

Verwende über `mcp_call` nur bestätigte Werkzeugnamen und Parameter. Einen Export auf die vereinbarten Objekte begrenzen, Datei und Ziel prüfen und bestehende Assets nicht beiläufig ersetzen. Bei Unity beispielsweise die zugehörigen Asset-Kennungen erhalten; bei anderen Engines ihre Ressourcenverweise berücksichtigen.

Den Export in das beauftragte Ziel importieren, soweit ein geeigneter Werkzeugweg vorhanden ist. Anschließend Maße, Orientierung und erforderliche Materialien anhand des tatsächlich importierten Ergebnisses abgleichen. Eine vorbereitete Datei ist noch kein erfolgreicher Import. Ein verwendetes Szenenobjekt und eine sichtbare oder funktionale Wirkung brauchen ihren eigenen Nachweis.

## Ergebnis und Grenzen

Berichte native Quelle, Export und Zielverwendung getrennt. Fehlende Programme, Werkzeuge oder Prüfmöglichkeiten konkret nennen; keine automatische Installation und keinen Wechsel in ein anderes Projekt daraus ableiten. Eine digitale Geometrieprüfung ersetzt keine reale Fertigungs- oder Passprobe.

Für konkrete Prüfungen und Unterschiede zwischen Formaten lies [references/export-und-ziel.md](references/export-und-ziel.md) bei Bedarf mit `skill_read`.
