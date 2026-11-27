# Verhalten und Regression unabhängig prüfen

Leite erwartete Ergebnisse aus dem Auftrag oder einem unabhängigen Sollwert ab. Ein Test, der dieselbe Formel oder denselben privaten Zustand wie die Implementierung kopiert, kann denselben Fehler übersehen. Benutze nach Möglichkeit die öffentliche Funktion, Datei- oder Benutzerschnittstelle.

Bei einer Reparatur zuerst einen kleinen Regressionstest wählen, der den tatsächlichen Fehler erkennen kann. Wenn ohne Risiko möglich, vor dem Eingriff sein Fehlschlagen und danach sein Bestehen prüfen. Vorhandene Implementierung nicht löschen, nur weil sie nicht testgetrieben entstanden ist. Für eine kleine reversible Textänderung sind Vergleich und Darstellungsprüfung oft angemessener als eine neue Testsuite.

Wähle gezielt Normalfall, relevanten Randfall und den beobachteten Fehler. Für Import/Export, Normalisierung, Parser und Aufgabenabhängigkeiten kann der Skill anvil-eigenschaftstests mit allgemeinen Regeln und generierten Eingaben helfen. Vorhandene Frameworks verwenden; aus einer Testempfehlung entsteht kein Auftrag zur Installation einer neuen Bibliothek.

Beim Testlauf ausgeführte Fälle, übersprungene Fälle, Prozessabschluss und Fehlermeldungen lesen. Ein leerer Lauf prüft keine Funktion. Bei asynchronen Zuständen eine konkrete Bereitschaft beobachten; eine dauerhaft offene Verbindung muss nicht zum Stillstand kommen. Für Browseranwendungen den HTML-/Framework-Einstieg und tatsächliche Interaktion verwenden, nicht eine DOM-Datei mit Node starten.

Ein absichtlicher Negativtest bleibt unverändert und wird an der erwarteten Ablehnung beurteilt. Ein unerwarteter Fehler ist ein fehlgeschlagener Test. Erfolg nur für den tatsächlich geprüften Umfang und Stand berichten, offene visuelle, Engine- oder Dienstprüfungen separat benennen.
