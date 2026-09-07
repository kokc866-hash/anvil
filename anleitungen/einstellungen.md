# Einstellungen

Interner Entwicklungsstand nach **1.3.19**. Noch nicht veröffentlicht. Die Bedienung ist für das Desktop-Programm ausgelegt.

## Sichern und wiederherstellen

Unter **Daten → Exportieren** enthält die Sicherung nun auch den aktiven API-/Abo-Modus, die getrennten Anbieterzustände, Helferprofile und deren Optionen, Modellbibliotheks-Einstellungen sowie die vollständigen Layoutvorgaben. Sie enthält weiterhin Gedächtnisinhalte. API-Schlüssel und CLI-Anmeldungen werden separat auf diesem Rechner verwaltet; lokale Installationspfade gehören nicht in die Einstellungsdatei.

Der Import prüft alle enthaltenen Bereiche vor der Übernahme. Ein ungültiger Wert nennt das betroffene Feld und lässt die Einstellungen unverändert. Beim Anbieterwechsel wird dessen lokal gespeicherter Schlüssel zusammen mit der Verbindung eingesetzt. Vorhandene benannte Profile und MCP-Verbindungen bleiben erhalten; Einträge mit derselben ID werden aktualisiert.

Neue Sicherungen verwenden Format 2. Format 1 und ältere flache Einstellungsdateien bleiben lesbar. Fehlt bei einem Anbieter mit API- und Abo-Zugang der Modus, wird er aus einem eindeutig passenden Profil oder der bereits ausgewählten Verbindung bestimmt. Ist das nicht möglich, erklärt der Import, welchen Anbieter und Modus du vor einem erneuten Import auswählen musst. ChatGPT-Abo bleibt die eigene Codex-CLI-Verbindung; OpenAI bleibt der API-Anbieter.

## Zurücksetzen

**Bereich zurücksetzen** links unten setzt nur die Einstellungen der ausgewählten Kategorie zurück. **Daten → Nur Einstellungen zurücksetzen** umfasst alle Bedien- und Laufzeiteinstellungen, einschließlich Helfer, Modellbibliothek und Layout.

Benannte Profile, gespeicherte Anbieterzustände, MCP-Verbindungen, gelernte Tool-Zuordnungen, Zugangsdaten, Projektdateien und Gedächtnisinhalte werden dabei erhalten. Der aktive Anbieter und dessen aktive Vorgaben werden beim Zurücksetzen des Agenten auf Standard gestellt. Das Löschen eines Workspace bleibt eine eigene Aktion.

## Modell wechseln

Beim Wechsel des Modells bleiben manuell eingestellte Kontextlänge, Thinking, Temperatur und Ausgabelimit erhalten. Ist die Kontext-Automatik aktiv, wird die Kontextlänge weiterhin anhand des gewählten Modells bestimmt. Ein Wechsel zwischen bereits verwendeten Anbietern oder API-/Abo-Modi stellt die jeweils gespeicherten Vorgaben wieder her.

## Projektvorgaben und Tafel

**Agent → Ins Projekt** aktualisiert die angezeigten Vorgaben in `.anvil/harness.json`. Weitere Felder wie `maxTools` und `stopOn` bleiben erhalten. Eine vorhandene `.anvil/graph.json` und die Tafel mit ihren Positionen, Verbindungen und Kameraeinstellungen werden beim normalen Speichern nicht verändert. Fehlende Dateien werden für neue Projekte angelegt.

**Raten · Vorschlag** erkennt mögliche Projektabläufe und füllt die angezeigten Vorgaben, schreibt aber noch keine Projektdateien. Erst **Ins Projekt** übernimmt den Vorschlag. Dabei werden fehlende Graph-Kanten und Tool-Knoten ergänzt; vorhandene Ideen und Positionen bleiben erhalten. Ungültige Projektdateien werden mit ihrem Dateinamen gemeldet, bevor Änderungen geschrieben werden.

Unter **Wirksame Einstellungen im Projekt** zeigt eine Tabelle die tatsächlich verwendeten Werte und ihre Quelle. Die Run-, Test-, Graph- und Engine-Schalter in Anvil haben Vorrang. Die Versuchszahl kann die Projektdatei vorgeben. **Laden** übernimmt die vorhandenen Projektwerte in die Anvil-Vorgaben.

## Suchen und bedienen

Die Suche berücksichtigt sichtbare Bezeichnungen, Hinweise und Auswahltexte in der eingestellten Sprache. Mehrere Suchwörter müssen gemeinsam passen; Großschreibung und Umlaute sind dabei tolerant. Ohne Treffer erscheint ein eindeutiger Hinweis. Die feste Seitenleiste bleibt für die Desktop-Navigation erhalten.

Das Tippen in der Suche startet keine automatischen Modell-, Compiler- oder Helfer-Abfragen. Vorhandene laufende Editoraufgaben sind davon unabhängig. Die ausdrücklichen Prüf- und Aktualisierungsaktionen bleiben nutzbar. Ein Kategorienwechsel leert die Suche und zeigt den neuen Bereich von oben. Schalter und Auswahlgruppen tragen zugängliche Namen und melden ihren ausgewählten Zustand.
