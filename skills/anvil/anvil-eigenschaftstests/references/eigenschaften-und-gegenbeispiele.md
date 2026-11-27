# Eigenschaften auswählen und Gegenbeispiele verstehen

Diese Anvil-Anpassung steht unter CC-BY-SA-4.0; Herkunft und Änderungen sind in quellen.md dokumentiert.

## Passende Eigenschaft

- Roundtrip: Ein erlaubter JSON-Wert bleibt nach Export und Import semantisch gleich. Den Eingabebereich auf echte JSON-Werte mit endlichen Zahlen begrenzen; undefined, Funktionen und Date-Objekte besitzen einen anderen Vertrag. Eine geforderte Byteidentität ist von semantischer Gleichheit zu unterscheiden.
- Idempotenz: Zweifache Normalisierung ergibt dasselbe Ergebnis wie die erste. Zusätzlich mindestens einen bekannten erwarteten Normalfall prüfen; die Identitätsfunktion wäre ebenfalls idempotent, aber möglicherweise fachlich falsch.
- Erhaltung: Sortierung erhält alle Elemente einschließlich Duplikaten und erfüllt die geforderte Ordnung. Nur zu prüfen, dass das Ergebnis sortiert ist, übersieht verlorene Elemente.
- Zustandsinvariante: Eine Aktion verändert nur die beauftragte Aufgabe; Kennungen anderer Aufgaben bleiben erhalten. Nach Rücknahme gilt der dokumentierte Rücknahmevertrag, nicht automatisch ein externer Dienstzustand.

## Generator und Auswertung

Fachlich gültige Daten direkt erzeugen. Nicht fast alle Zufallswerte verwerfen und dann einen leeren Lauf als Erfolg zählen. Ungültige Pfade, unbekannte Kennungen oder zyklische Abhängigkeiten als eigene Eingabeklassen mit der erwarteten Ablehnung prüfen. Ein Pfadgenerator darf keine tatsächlichen Dateien außerhalb des künstlichen Testprojekts ändern.

Vorhandene Seed-/Shrinking-Funktionen nutzen. Bei einem Fund Seed, minimalen Eingabefall, konkrete Ausgabe und geprüften Dateistand sichern. Das kleinste Gegenbeispiel zuerst gegen den Vertrag prüfen: Vielleicht verlangt die Sollregel eine Eigenschaft, die nie zugesichert war. Den Prüfer nicht allein deshalb lockern, weil die Anwendung scheitert.

Eine absichtlich fehlerhafte Testdatei, die der Nutzer als Negativtest beauftragt hat, bleibt unverändert. Unerwartete Anwendungsfehler nur reparieren, wenn der Auftrag dies einschließt. Nach einer begründeten Korrektur den kleinsten Fehlerfall und die relevante Testgruppe wiederholen. Keine unveränderten Dauerschleifen und keine Behauptung einer vollständigen Sicherheitsfreigabe.
