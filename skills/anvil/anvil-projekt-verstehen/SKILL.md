---
name: anvil-projekt-verstehen
description: "Bestehende Projekte in Anvil gezielt untersuchen und ihren Aufbau anhand von Dateien erklären. Für Einarbeitung, Architekturfragen und die Vorbereitung einer Änderung; verändert und startet das Projekt nicht."
compatibility: "Für Anvils Agentenbetrieb. Benötigt die im Skill genannten Projekt- und Werkzeugzugriffe; allgemeine Agenten können andere Werkzeugnamen verwenden."
metadata:
  version: "1.1.0"
---

# Projekt verstehen

Erstelle eine nachvollziehbare Erklärung zum geöffneten Projekt. Richte die Tiefe nach der Frage: Für „Wo wird die Anmeldung verarbeitet?“ genügt der zugehörige Ablauf; eine vollständige Architekturübersicht braucht mehrere zusammenhängende Bereiche.

## Gezielt lesen

Verwende `list_files` für die Struktur und `grep` für Begriffe, Symbole und ihre Aufrufer. Lies mit `read_file` zunächst die vorhandene Projektbeschreibung, passende Manifeste und die Einstiegspunkte. Bei abgeschnittenen Ergebnissen den angegebenen Dateibereich fortsetzen. Nicht dieselbe vollständige Datei wiederholt lesen.

Verfolge einen konkreten Weg: Eingabe oder Ereignis → Verarbeitung → gespeicherte Daten oder sichtbares Ergebnis. Prüfe dabei die tatsächlichen Verbindungen zwischen Modulen. Ein Dateiname belegt noch keine aktive Funktion. Beispieldaten, generierte Dateien und frühere Testausgaben getrennt von produktiv verwendeten Dateien betrachten.

Eine vorhandene Projekttafel oder Ablaufbeschreibung kann über `harness_read`, `board_read` beziehungsweise `read_file` helfen. Überprüfe relevante Aussagen am aktuellen Quellcode; gespeicherte Übersichten können veraltet sein.

## Umfang einhalten

Diese Arbeitsweise bleibt lesend. Keine Dateien, Einstellungen, Checklisten im Projekt oder Git-Zustände verändern, keine Programme starten und keine Installationen ausführen. Ein Auftrag zur Erklärung erlaubt auch keine zusätzliche Reparatur. Wenn eine sichere Aussage erst nach Ausführung möglich wäre, kennzeichne sie als offen und benenne die passende Prüfung.

## Ergebnis

Nenne den wichtigsten Zusammenhang zuerst und verweise auf konkrete Pfade, bei Bedarf mit Zeilen. Trenne belegte Funktionen, plausible Schlussfolgerungen und unbekannte Laufzeitbedingungen. Bei der Vorbereitung einer Änderung die betroffenen Schnittstellen und vorhandenen Prüfungen nennen. Empfiehl nur Schritte, die sich aus der Frage und dem gelesenen Projekt ergeben.

