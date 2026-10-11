---
name: anvil-aenderungen-pruefen
description: "Vorhandene Codeänderungen in Anvil lesend auf Verhalten, Schnittstellen und konkrete Fehler prüfen. Für Reviews und Bewertungen; repariert nichts und startet keine zusätzlichen Prüfprogramme."
---

# Änderungen prüfen

Prüfe die gewünschten Änderungen auf konkrete Auswirkungen. Die Untersuchung bleibt lesend: keine Reparaturen, Formatierungen, neuen Tests, Programmausführungen oder Git-Mutationen. Ein vorhandenes Testergebnis kann ausgewertet werden, gilt aber nur für den Stand und Umfang, den es tatsächlich belegt.

## Ausgangslage klären

Verwende `git_status`, wenn eine echte Projektverbindung besteht. Kennzeichne eine Ersatzanzeige ungespeicherter Dateien als solche; sie ersetzt keinen vollständigen Git-Vergleich. Lies bereitgestellte Diffs, betroffene Dateien und erforderliche Aufrufer mit `read_file` und `grep`. Fehlt der Vorher-Zustand, erkläre den aktuellen Code und nenne die eingeschränkte Vergleichsgrundlage.

Suche vor allem nach unbeabsichtigten Verhaltensänderungen: ungültige Eingaben, fehlende Fehlerpfade, verlorene Daten, falsche Zustände, nicht verbundene Funktionen und gebrochene Schnittstellen. Bei asynchronen Abläufen auch Abbruch, Wiederholung und Reihenfolge berücksichtigen. Nicht jedes denkbare Risiko ist ein Befund; benenne einen Auslöser und die konkrete Folge.

## Befunde begründen

Für jeden belastbaren Fehler die betroffene Stelle, eine nachvollziehbare Situation und ihre Auswirkung nennen. Ungeklärte Annahmen als Fragen oder offene Prüfungen kennzeichnen. Stilgeschmack nicht mit Funktionsfehlern vermischen und den Umfang der Prüfung nicht ohne Auftrag auf das gesamte Projekt ausweiten.

Eine Vorlage oder Modellbeschreibung zählt nicht als erfolgreicher Lauf. Ein grüner Teiltest bestätigt nicht die gesamte Anwendung; ein Build bestätigt nicht die Darstellung. Ist Ausführung für eine Aussage notwendig, beschreibe die passende Prüfung, statt sie bei einem ausdrücklich lesenden Review selbst zu starten.

## Ergebnis

Wichtige Befunde zuerst, anschließend verbleibende Unsicherheiten und vorhandene Nachweise. Gibt es keinen belastbaren Befund, sage das mit dem geprüften Umfang. Keine absolute Fehlerfreiheit versprechen. Konkrete Pfade und relevante Zeilen machen die Bewertung nachprüfbar. Eine anschließende Reparatur erfolgt nur im dafür erteilten Auftrag.

