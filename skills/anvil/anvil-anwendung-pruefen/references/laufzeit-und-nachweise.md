# Laufzeit und Funktion getrennt prüfen

| Projekt / Befund | Passender Weg | Unzulässige Schlussfolgerung |
| --- | --- | --- |
| HTML lädt ein JavaScript mit DOM-Zugriff | Den HTML-Einstieg in der unterstützten Vorschau öffnen; Laufzeitfehler und verlangte Bedienung prüfen. | `document is not defined` unter Node belegt keinen Fehler des Browserprogramms. |
| Node-Programm mit eigenem Kommandozeileneinstieg | Vorhandenes Manifest und Startkonvention lesen; passenden Programmeinstieg oder Testbefehl verwenden. | Eine einzelne importierte Hilfsdatei auszuführen prüft nicht die Anwendung. |
| React-/Framework-Projekt | Vorhandenen Aufbau erhalten und den tatsächlich angebotenen Entwicklungs-/Browserweg verwenden. | Eine einzelne Ersatz-HTML-Datei beweist nicht, dass das Framework-Projekt funktioniert. |
| Python mit optionaler Hardware | Vorhandenen Simulations- oder Testweg verwenden und Hardwaregrenzen nennen. | Erfolgreicher Import bestätigt keine reale Hardwarefunktion. |
| Engine-Projekt | Unterstützte Import-/Buildprüfung und passende konkrete Szene beziehungsweise Interaktion unterscheiden. | Editorstart oder Import bestätigen kein Gameplay. |

Für eine Schaltfläche vor und nach der Eingabe einen relevanten Zustand vergleichen. Eine Sortierung muss die Reihenfolge ändern, ein Speichern nach erneutem Laden den vereinbarten Zustand erhalten. Testdaten nicht mit derselben fehleranfälligen Berechnung erzeugen wie das erwartete Ergebnis.

Gibt es nur DOM-Text und Konsolenmeldungen, können Ladefehler und bestimmte Inhalte belegt werden. Eine nicht ausgeführte Maus-, Tastatur- oder Engine-Interaktion bleibt ungeprüft. Dass die gewünschte Funktion von außen nicht prüfbar ist, erlaubt keine erfundene globale API oder eine Attrappe, die nur den Fehler verschwinden lässt.
# Ergebnisanzeigen und Testfolge

Die Vorschau liefert `elements` für Bedienelemente und `observations` für sichtbare Ergebnisanzeigen wie Status, Zähler und Tabellenzeilen. Lies daraus die echten Selektoren und den Ausgangszustand. Bestimme das Soll-Ergebnis aus dem Auftrag, bevor du handelst. Beispiel für einen Transport: Auftrag anlegen, genau einen neuen Auftrag nachweisen, starten und anschließend einen erhöhten Abschlusszähler prüfen. Einen gerade beobachteten Wert unverändert als Erwartung zu bestätigen beweist keine Transportfunktion. Eine fehlgeschlagene `assert`-Prüfung nennt Soll- und Ist-Wert; nutze diesen Unterschied im Fehlerbericht. Wiederhole nicht unverändert Start oder Neuladen, wenn das erwartete Ergebnis ausbleibt.

