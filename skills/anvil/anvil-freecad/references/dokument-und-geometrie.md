# FreeCAD-Dokument und Geometrie prüfen

## Eindeutige Objekte

Mit den verfügbaren Lesewerkzeugen aktuelle Dokument- und Objektnamen bestimmen. Anzeigename und interne Kennung können unterschiedlich sein. Nach Wiederöffnen oder `reload_document` erneut abfragen; keine alte Kennung ungeprüft weiterverwenden.

Für Änderungen über Python das gewählte Dokument explizit ansprechen. Ein global aktives Dokument kann ein anderes sein als der Auftrag meint. Nach Parameteränderungen neu berechnen und Fehlerzustand sowie erzeugte Form prüfen.

## Beispiel: Parametrische Montageplatte

Für einen vereinbarten Test eine neue Platte mit 80 × 50 × 3 mm und vier durchgehenden Bohrungen von 3,2 mm anlegen. Die Bohrungsmittelpunkte liegen 10 mm von den angrenzenden Kanten entfernt. Bemaßung und Abhängigkeiten sollen eine gezielte Änderung ermöglichen.

Prüfe Grenzabmessungen, Anzahl der Volumenkörper, Gültigkeit und das unabhängig berechnete Volumen:
`80 * 50 * 3 - 4 * pi * 1.6^2 * 3`, ungefähr 11.903,49 mm³. Bei einer verlangten Änderungs- und Rücksetzprüfung zuerst eine Eigenschaft ändern, erneut berechnen und messen, anschließend den gesicherten Wert wiederherstellen und noch einmal prüfen.

## Speicherung und Austausch

Nutze für neue FCStd-Dokumente und Austauschdateien den Ausgabeordner `Ergebnis/` im aktiven Workspace, sofern kein anderer Projektunterordner beauftragt ist. Übergib beim Speichern per FreeCAD-Python den absoluten Zielpfad. Prüfe anschließend die Ausgabedateien mit `list_files` und den Dokumentstand in FreeCAD.

Das native FCStd-Dokument und den STEP-Export getrennt bestätigen. Nach einem wichtigen STEP-Export in einem getrennten Dokument erneut einlesen und Maße sowie gültige Körper prüfen. Das wieder eingelesene STEP-Modell ist kein Nachweis, dass die ursprüngliche parametrische Historie darin erhalten geblieben ist.

Eine Ansicht ergänzt die Prüfung, belegt aber keine Maße. Textfehler auch bei `isError:false` beachten. Vor Wiederholung eines unklaren Schreibaufrufs den tatsächlichen Zustand lesen.

## Den endgültigen Prüfstand nachweisen

Wenn eine gespeicherte Abgabe verlangt ist, den endgültigen Stand neu berechnen und speichern. Bei einer erforderlichen Dateiprüfung erneut öffnen und die betroffenen Eigenschaften kontrollieren. Eine Ausführung ohne Fenster prüft einen eigenen Prozess; das offene GUI-Dokument zeigt diesen Dateistand erst nach gezieltem Neuladen. Nur tatsächlich verlangte und durch Änderungen betroffene Maß-, Bewegungs- oder Austauschprüfungen wiederholen. Alte PASS-Zeilen aus einem Zwischenstand nicht in den Abschluss übernehmen.

Bei Bohrungen ihre Anzahl, Lage, Maße und Durchgängigkeit prüfen; ein Objektname allein bestätigt diese Funktionen nicht. Körperanzahlen pro Bauteil von der gesamten Baugruppe unterscheiden. Falls ein Messbericht Zahlen und Wahrheitswerte enthält, diese konsistent und mit eindeutigen Einheiten ausgeben.

Vergleiche die gemessenen Werte selbst mit den verlangten Maßen. Berichte konkrete Abweichungen und fehlgeschlagene Prüfungen. Dafür sind kein Abnahmevertrag, keine speziellen Anvil-Messfelder und keine Bestätigung durch den Nutzer erforderlich.

Falls der Auftrag einen gespeicherten Messbericht verlangt, genügt eine normale JSON-Datei. Beispiel für ein angebotenes Python-Werkzeug; `project` und `solid_count` stammen aus dem tatsächlich gewählten Projekt und der tatsächlich geprüften Form:

```python
import json
from pathlib import Path

report = Path(project) / "checks" / "geometry.json"
report.parent.mkdir(parents=True, exist_ok=True)
measurements = {"solid_count": solid_count}
report.write_text(json.dumps(measurements, indent=2), encoding="utf-8")
print(json.dumps({"report": "checks/geometry.json", "measurements": measurements}, indent=2))
```

Der Bericht nennt die tatsächlich ausgeführten Prüfungen und den geprüften CAD-Dateistand. Er ist ein Arbeitsergebnis des Agenten und kein zusätzlicher Freigabeschritt in Anvil.

Die Brücke, Versionsprüfung und Dokumentwerkzeuge beschreibt die [Maintainer-Dokumentation](https://github.com/neka-nat/freecad-mcp/blob/main/docs/installation.md). FEM-Solver, Werkstoffannahmen und reale Belastbarkeit sind eigene Voraussetzungen und Nachweise.
