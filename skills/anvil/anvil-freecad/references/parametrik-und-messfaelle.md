# Parametrik und unabhängige Messfälle

## Gewähltes Dokument und nachvollziehbare Konstruktion

Mit dem aktuellen FreeCAD-MCP-Katalog die tatsächlich angebotenen Dokument-, Objekt- und Python-Werkzeuge bestimmen. Interne Name-Kennungen und sichtbare Labels unterscheiden. Bei Python das eindeutig ausgewählte Dokument verwenden. Ein globales ActiveDocument kann zu einem anderen geöffneten Projekt gehören.

Bauteile anhand der verlangten Bearbeitbarkeit aufbauen: bemaßte Skizzen, nachvollziehbare Features und Eigenschaften statt unverbundener sichtbarer Kopien. Part und PartDesign haben unterschiedliche Objekt- und Körperkonzepte. Vorhandene Referenzen und Abhängigkeiten erhalten. Bei FeaturePython die Datenberechnung von der GUI-Darstellung trennen; keine neue Workbench allein zum Ausführen dieses Skills installieren.

## Einen Messfall vor der Änderung festlegen

Aus dem Auftrag unabhängige Sollwerte gewinnen: Einheiten, Außenmaße, Bohrungslage und -durchmesser, durchgehende Öffnungen, Körperanzahl oder Bewegungsgrenzen. Passende absolute und gegebenenfalls relative Toleranzen nach Einheit und Geometrie wählen. Eine selbst erzeugte Formel mit einem bekannten einfachen Fall prüfen, statt sie als unabhängige Wahrheit auszugeben.

Für die Montageplatte aus dokument-und-geometrie.md lässt sich das Volumen unabhängig aus Grundkörper minus Bohrungen berechnen. Zusätzlich prüfen, dass genau die verlangten Öffnungen an den richtigen Stellen entstanden sind. Ein positiver Volumenwert allein erkennt weder eine Sackbohrung noch ein falsches Lochbild.

## Nach der Änderung

Dokument neu berechnen, Objektfehler und Form prüfen. Bei vorhandenen Python-Schnittstellen die tatsächlichen Shape-, Solid-, BoundBox- und Volume-Daten auswerten; Namen und API der verwendeten FreeCAD-Version berücksichtigen. Leere, ungültige oder zusätzliche Formen als Fehler berichten. Eine tessellierte Vorschau ersetzt diese Daten nicht.

Parameter gezielt ändern und erneut prüfen, wenn die geforderte Parametrik dadurch nachgewiesen werden soll. Nur bei beauftragter Rücknahme den gesicherten Wert wiederherstellen und den zurückgesetzten Stand erneut kontrollieren. Das native FCStd-Dokument und einen Export gesondert sichern; für wichtigen STEP-Austausch erneut einlesen und geometrische Gleichwertigkeit innerhalb der Toleranzen prüfen.

Nach Unterbrechung oder unbestätigter Schreibantwort zunächst aktuelle Dokumente und Objekte lesen. Keine opaken Python-Aktionen blind wiederholen. Ergebnisse als gemessene Werte mit geprüfter Einheit berichten; keine zusätzlichen Anvil-Messfelder, Abnahmeformulare oder Bestätigungsfolgen verlangen.
