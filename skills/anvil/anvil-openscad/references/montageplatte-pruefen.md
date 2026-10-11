# Eine Montageplatte unabhängig prüfen

Dieses Beispiel ist für einen entsprechenden Modellauftrag oder einen ausdrücklich gewählten Test gedacht. Es wird nicht automatisch in einem anderen Projekt angelegt.

## Vorgabe

Eine Platte misst 80 × 50 × 3 mm. Vier Bohrungen haben 3,2 mm Durchmesser. Ihre Mittelpunkte liegen jeweils 10 mm von den angrenzenden Außenkanten entfernt. Ursprung und Orientierung vor der Konstruktion festlegen; bei einem Ursprung an einer Ecke liegen die Mittelpunkte bei (10,10), (70,10), (10,40) und (70,40).

Den Bohrungskörper für einen durchgehenden Schnitt so positionieren, dass keine nur berührenden oder liegengebliebenen Deckflächen entstehen. Die konkreten Booleschen Parameter hängen vom gewählten Modell ab.

## Erwartete Geometrie

- Grenzabmessungen: 80 × 50 × 3 mm.
- Alle vier Bohrungen gehen durch die Platte.
- Ein zusammenhängender geschlossener Körper ohne unbeabsichtigte weitere Teile.
- Erwartetes Volumen: `80 * 50 * 3 - 4 * pi * 1.6^2 * 3`, ungefähr 11.903,49 mm³.

Vergleiche die Messung des erzeugten Modells mit diesen unabhängig aus der Vorgabe berechneten Werten. Tessellierung kann bei runden Bohrungen kleine Abweichungen verursachen; die gewählte Toleranz begründen. Nicht denselben fehlerhaften Modellparameter zugleich als unabhängigen Sollwert verwenden.

## Nachweise

`validate` prüft die angebotenen Syntax- und Modellbefunde. `measure` liefert tatsächliche Geometrieinformationen; Ergebnisfelder und Einheiten aus dem aktuellen Schema lesen. `render` ergänzt eine Ansicht, ersetzt die Messung aber nicht. Nach `export_model` die erzeugte Datei beziehungsweise ein erneutes Einlesen prüfen, soweit die Anbindung es ermöglicht.

Die OpenSCAD-Dokumentation unterscheidet Vorschau und vollständige Geometrieberechnung: [OpenSCAD-Handbuch](https://files.openscad.org/documentation/manual/OpenSCAD_User_Manual.html). Der konkrete MCP-Weg ist im [Maintainer-Repository](https://github.com/RobertCoop/openscad-mcp) beschrieben. Eine digitale Prüfung bestätigt keine reale Passung oder Fertigungsqualität.
