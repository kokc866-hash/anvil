# Abnahme eines Agentenauftrags

Ein beendeter Auftrag hat einen eigenen Abnahmestatus. Eine erfolgreiche Ausführung
und grüne To-do-Haken belegen zunächst, welche Aktionen ausgeführt wurden. Die
Gesamtabnahme vergleicht zusätzlich die gemeldeten Messwerte mit den vorher
festgelegten Kriterien.

## Kriterien vor Arbeitsbeginn

Der Agent legt die Kriterien mit `set_plan` vor der ersten Änderung oder Ausführung
fest. Bestehende Kriterien bleiben für diesen Auftrag verbindlich. Eine nachträglich
gelockerte Toleranz oder eine entfernte Pflichtprüfung kann den Auftrag nicht grün
machen. Mit `criteria_change_reason` begründete Änderungsvorschläge bleiben sichtbar
protokolliert und werden nicht angewendet. Geänderte Anforderungen brauchen einen
neuen Auftrag mit einem neuen Vertrag.

Beispiel für eine maximale STEP-Maßabweichung von 0,1 mm:

```json
{
  "criteria": [
    {
      "id": "step-bbox",
      "label": "STEP-Maßabweichung",
      "operator": "eq",
      "expected": 0,
      "tolerance": 0.1,
      "unit": "mm",
      "required": true
    }
  ]
}
```

Es sind maximal 64 Kriterien möglich. `eq` vergleicht Zahlen innerhalb der absoluten
Toleranz; Wahrheitswerte und Zeichenketten müssen genau übereinstimmen. `lte` und
`gte` vergleichen Zahlen mit einer Ober- bzw. Untergrenze. Ohne `required` gilt eine
Prüfung als verpflichtend. Mindestens eine Pflichtprüfung ist nötig.

Für eine Bewegung über neun Positionen sind beispielsweise neun stabile IDs oder
ein Prüfer sinnvoll, der alle neun Positionen auswertet und den größten Fehler
meldet. Prüfumfang und Grenzwerte gehören vorab in den Vertrag.

## Messwerte aus abgeschlossenen Prüfungen

Das ausgeführte Prüfprogramm gibt ein JSON-Objekt aus. Anvil verarbeitet dieses
Format aus abgeschlossenen `run_file`-, `shell`-, `engine_run`- und `mcp_call`-
Ergebnissen, auch aus MCP-Textausgaben und protokollierten JSON-Zeilen:

```json
{
  "anvil_acceptance": {
    "observations": [
      {
        "criterion": "step-bbox",
        "actual": 4,
        "artifact": "exports/stage.step",
        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    ]
  }
}
```

`sha256` muss der vom Prüfprogramm berechnete SHA-256 des geprüften Artefakts sein;
der Beispielwert ist ein Platzhalter. Die Anzeige nennt Sollwert, Istwert, Artefakt,
Hash und die zugehörige Werkzeugnachweis-ID. Im Beispiel scheitern 4 mm am
verbindlichen Grenzwert von 0,1 mm, selbst wenn der Prüfprozess mit Exitcode 0 endet.

Ein gelesener Bericht, eine Modellbehauptung oder ein noch laufendes Werkzeug
erzeugt keinen bestandenen Messnachweis. Identische MCP-Ausgaben werden einmal
bewertet. Widersprüchliche Werte desselben Kriteriums in einem Aufruf verhindern
eine bestätigte Abnahme.

Die Werte und der Dateihash stammen aus dem Prüfprogramm. Anvil prüft den Vergleich
mit den Kriterien; die fachliche Richtigkeit und Unabhängigkeit des Prüfprogramms
müssen fachliche Prüfungen absichern. Ein reproduzierbares Prüfskript gehört deshalb
zum Ergebnis. CAD-Prüfungen sollten die gespeicherten Dateien neu öffnen und dabei
Geometrie, Parameteränderungen, Bewegung, Kollisionen und Exporte untersuchen.

## Status und Wiederaufnahme

- **Bestanden:** Alle Pflichtkriterien besitzen passende aktuelle Messnachweise;
  offene Arbeit oder eine fehlgeschlagene Ausführungsprüfung verhindern diesen Status.
- **Nicht bestanden:** Mindestens eine Pflichtprüfung oder die Ausführungsprüfung
  ist fehlgeschlagen.
- **Teilweise bestätigt:** Es gibt bestandene Nachweise, aber noch offene
  Pflichtprüfungen, offene Arbeit oder einen fehlgeschlagenen optionalen Check.
- **Erneute Prüfung nötig:** Eingaben wurden geändert oder die Nachweishistorie ist
  unvollständig bzw. widersprüchlich.
- **Nicht nachgewiesen:** Ein verbindlicher Vertrag oder passende Nachweise fehlen.

Kriterien, Messhistorie und abgelehnte Änderungen werden im Ablaufzustand gesichert
und bei einer ausdrücklich angeforderten Wiederaufnahme wiederhergestellt. Anvil
berechnet den Status aus diesen Daten neu. Ein gespeichertes Wort „Bestanden“ genügt
nicht. Änderungen am Prüfstand und weitere Ausführungen ohne neue Messnachweise
können vorherige Nachweise ungültig machen.

Alte Aufträge ohne Vertrag erhalten keine nachträgliche erfolgreiche Abnahme. Der
ursprüngliche Auftrag und seine Dateien bleiben nachvollziehbar; das Öffnen allein
startet keine neue Prüfung.

Bei einem unterbrochenen Auftrag genügt **Fortsetzen**. Fehlt die Rückmeldung einer
früheren Aktion, prüft der Agent zunächst den aktuellen Stand. Diese Aktion bleibt
unbestätigt und gegen Wiederholung gesperrt. Dafür musst du keine Erklärung oder
Vermutung eintragen. Die optionale manuelle Klärung befindet sich in den
Auftragsdetails und ist nur für einen tatsächlich bekannten Ausgang gedacht.
Solange eine solche Aktion unbestätigt bleibt, wird die Gesamtabnahme nicht als
bestanden angezeigt.
