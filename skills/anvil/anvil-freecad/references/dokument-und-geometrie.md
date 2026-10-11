# FreeCAD-Dokument und Geometrie prüfen

## Eindeutige Objekte

Mit den verfügbaren Lesewerkzeugen aktuelle Dokument- und Objektnamen bestimmen. Anzeigename und interne Kennung können unterschiedlich sein. Nach Wiederöffnen oder `reload_document` erneut abfragen; keine alte Kennung ungeprüft weiterverwenden.

Für Änderungen über Python das gewählte Dokument explizit ansprechen. Ein global aktives Dokument kann ein anderes sein als der Auftrag meint. Nach Parameteränderungen neu berechnen und Fehlerzustand sowie erzeugte Form prüfen.

## Beispiel: Parametrische Montageplatte

Für einen vereinbarten Test eine neue Platte mit 80 × 50 × 3 mm und vier durchgehenden Bohrungen von 3,2 mm anlegen. Die Bohrungsmittelpunkte liegen 10 mm von den angrenzenden Kanten entfernt. Bemaßung und Abhängigkeiten sollen eine gezielte Änderung ermöglichen.

Prüfe Grenzabmessungen, Anzahl der Volumenkörper, Gültigkeit und das unabhängig berechnete Volumen:
`80 * 50 * 3 - 4 * pi * 1.6^2 * 3`, ungefähr 11.903,49 mm³. Bei einer verlangten Änderungs- und Rücksetzprüfung zuerst eine Eigenschaft ändern, erneut berechnen und messen, anschließend den gesicherten Wert wiederherstellen und noch einmal prüfen.

## Speicherung und Austausch

Das native FCStd-Dokument und den STEP-Export getrennt bestätigen. Nach einem wichtigen STEP-Export in einem getrennten Dokument erneut einlesen und Maße sowie gültige Körper prüfen. Das wieder eingelesene STEP-Modell ist kein Nachweis, dass die ursprüngliche parametrische Historie darin erhalten geblieben ist.

Eine Ansicht ergänzt die Prüfung, belegt aber keine Maße. Textfehler auch bei `isError:false` beachten. Vor Wiederholung eines unklaren Schreibaufrufs den tatsächlichen Zustand lesen.

## Den endgültigen Prüfstand nachweisen

Nach der letzten Änderung neu berechnen, speichern und die gespeicherte FCStd-Datei erneut öffnen. Eine Ausführung ohne Fenster prüft einen eigenen Prozess; das offene GUI-Dokument zeigt diesen Dateistand erst nach gezieltem Neuladen. Parameteränderungen, Bewegungsprüfungen und Austauschformate für den endgültigen Stand wiederholen. Alte PASS-Zeilen aus einem Zwischenstand nicht in den Abschluss übernehmen.

Bei Bohrungen ihre Anzahl, Lage, Maße und Durchgängigkeit prüfen; ein Objektname wie `UpperPlatform_Holed` ist keine allgemeine Funktionsanforderung. Körperanzahlen pro Bauteil von der gesamten Baugruppe unterscheiden. Für Zahlen und Wahrheitswerte in Kriterien und Messergebnissen dieselben JSON-Typen verwenden.

Bereits festgelegte Sollwerte bleiben auch bei einem versehentlich falschen Datentyp verbindlich. Den Fehler berichten; ein neuer Prüfauftrag braucht korrekt vereinbarte Kriterien. Anvil wertet vollständiges JSON auch innerhalb einer mehrzeiligen FreeCAD-Ausgabe aus. Die echte Datei-Prüfsumme bestätigt die Zuordnung des Berichts, nicht die fachliche Unabhängigkeit des Prüfers.

Beispiel für einen kleinen gespeicherten Messbericht und die dazugehörige Ausgabe in einem angebotenen Python-Werkzeug; `project` und `solid_count` stammen aus dem tatsächlich gewählten Projekt und der tatsächlich geprüften Form:

```python
import hashlib, json
from pathlib import Path

report = Path(project) / "checks" / "geometry.json"
report.parent.mkdir(parents=True, exist_ok=True)
report.write_text(json.dumps({"single_solid": solid_count}, indent=2), encoding="utf-8")
digest = hashlib.sha256(report.read_bytes()).hexdigest()
print(json.dumps({"anvil_acceptance": {"observations": [{
    "criterion": "single_solid", "actual": solid_count,
    "artifact": "checks/geometry.json", "sha256": digest
}]}}, indent=2))
```

Der Bericht muss die wirklich ausgeführten Prüfungen und den geprüften CAD-Dateistand nennen. Für die vollständige Abnahme alle vereinbarten Pflichtkriterien liefern. Die Datei-Prüfung ist pro Werkzeugaufruf auf 32 Dateien, insgesamt 512 MB und 15 Sekunden begrenzt. Dateien außerhalb des Projekts, geschützte Pfade und Verknüpfungen werden nicht als Nachweis gelesen. Bei einem fehlenden oder falschen Nachweis bleibt die Abnahme offen.

Die Brücke, Versionsprüfung und Dokumentwerkzeuge beschreibt die [Maintainer-Dokumentation](https://github.com/neka-nat/freecad-mcp/blob/main/docs/installation.md). FEM-Solver, Werkstoffannahmen und reale Belastbarkeit sind eigene Voraussetzungen und Nachweise.
