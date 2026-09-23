# Einstellungen

Die beschriebenen Einstellungen gelten für Release Anvil **1.3.29**. Die Bedienung ist für das Desktop-Programm ausgelegt.

## Sichern und wiederherstellen

Unter **Daten → Exportieren** enthält die Sicherung nun auch den aktiven API-/Abo-Modus, die getrennten Anbieterzustände, Helferprofile und deren Optionen, Modellbibliotheks-Einstellungen sowie die vollständigen Layoutvorgaben. Sie enthält weiterhin Gedächtnisinhalte. API-Schlüssel und CLI-Anmeldungen werden separat auf diesem Rechner verwaltet; lokale Installationspfade gehören nicht in die Einstellungsdatei.

Der Import prüft alle enthaltenen Bereiche vor der Übernahme. Ein ungültiger Wert nennt das betroffene Feld und lässt die Einstellungen unverändert. Beim Anbieterwechsel wird dessen lokal gespeicherter Schlüssel zusammen mit der Verbindung eingesetzt. Vorhandene benannte Profile und MCP-Verbindungen bleiben erhalten; Einträge mit derselben ID werden aktualisiert.

Neue Sicherungen verwenden Format 2. Format 1 und ältere flache Einstellungsdateien bleiben lesbar. Fehlt bei einem Anbieter mit API- und Abo-Zugang der Modus, wird er aus einem eindeutig passenden Profil oder der bereits ausgewählten Verbindung bestimmt. Ist das nicht möglich, erklärt der Import, welchen Anbieter und Modus du vor einem erneuten Import auswählen musst. ChatGPT-Abo bleibt die eigene Codex-CLI-Verbindung; OpenAI bleibt der API-Anbieter.

## Zurücksetzen

**Bereich zurücksetzen** links unten setzt nur die Einstellungen der ausgewählten Kategorie zurück. **Daten → Nur Einstellungen zurücksetzen** umfasst alle Bedien- und Laufzeiteinstellungen, einschließlich Helfer, Modellbibliothek und Layout.

Benannte Profile, gespeicherte Anbieterzustände, MCP-Verbindungen, gelernte Werkzeugzuordnungen, Zugangsdaten, Projektdateien und Gedächtnisinhalte bleiben dabei erhalten. Beim Zurücksetzen des Agenten werden der aktive Anbieter und seine Einstellungen auf die Standardwerte zurückgesetzt. Das Zurücksetzen eines Projekts bleibt eine eigene Aktion.

## Modell wechseln

Beim Wechsel des Modells bleiben manuell eingestellte Kontextgröße, Denkaufwand, Temperatur und Antwortlimit erhalten. Ist die automatische Kontextgröße aktiviert, richtet sie sich weiterhin nach dem gewählten Modell. Beim Wechsel zwischen bereits verwendeten Anbietern oder API- und Abo-Zugängen werden deren gespeicherte Einstellungen wiederhergestellt.

## Projektvorgaben und Tafel

Unter **Agent → Automatische Ausführung und Prüfung → Automatisch weiterarbeiten** steuerst du die Fortsetzung langer Aufträge. Standardmäßig ist diese Option eingeschaltet: Der Agent arbeitet am selben Auftrag ohne festes Limit für Runden oder Werkzeugaufrufe weiter. **Runden ohne Fortschritt** legt fest, nach wie vielen aufeinanderfolgenden Modellrunden ohne neuen erfolgreichen Arbeitsschritt Anvil unterbricht (12, 24, 32 oder 48). Wiederholte Aufrufe zählen nicht erneut als Fortschritt. Ist die Automatik ausgeschaltet, gilt die Zahl als festes Rundenlimit. Du kannst den Auftrag weiterhin stoppen; auch eingestellte Zeitlimits bleiben aktiv. Die Auswahl wird mit den Anvil-Einstellungen gespeichert, exportiert und importiert. **Bereich zurücksetzen** aktiviert die Automatik wieder.

**Agent → Ins Projekt übernehmen** aktualisiert die angezeigten Einstellungen in `.anvil/harness.json`. Weitere Felder wie `maxTools` und `stopOn` bleiben erhalten. Eine vorhandene `.anvil/graph.json` und die Tafel mit ihren Positionen, Verbindungen und Kameraeinstellungen werden bei der normalen Übernahme nicht verändert. Fehlende Dateien werden für neue Projekte angelegt. Ob die Änderungen bereits im Projektordner gespeichert sind, hängt von deinen Speichereinstellungen ab.

**Vorschlag erstellen** erkennt mögliche Projektabläufe und trägt passende Einstellungen ein, ändert aber noch keine Projektdateien. Erst **Ins Projekt übernehmen** übernimmt den Vorschlag. Dabei werden fehlende Verbindungen und Werkzeugknoten auf der Tafel ergänzt; vorhandene Ideen und Positionen bleiben erhalten. Ungültige Projektdateien werden mit ihrem Dateinamen gemeldet, bevor Änderungen geschrieben werden.

Unter **Wirksame Einstellungen im Projekt** zeigt eine Tabelle die tatsächlich verwendeten Werte und ihre Quelle. Die Einstellungen für Ausführung, Tests, Graph und Engine in Anvil haben Vorrang. Die Anzahl der Korrekturversuche kann die Projektdatei vorgeben. **Aus Projekt laden** übernimmt die vorhandenen Projektwerte in die Anvil-Einstellungen.

## Suchen und bedienen

Die Suche berücksichtigt sichtbare Bezeichnungen, Hinweise und Auswahltexte in der eingestellten Sprache. Bei mehreren Suchwörtern müssen alle im Ergebnis vorkommen. Groß- und Kleinschreibung wird nicht unterschieden. Umlaute kannst du auch als a, o oder u eingeben. Ohne Treffer erscheint ein eindeutiger Hinweis. Die Seitenleiste bleibt während der Suche sichtbar.

Das Tippen in der Suche startet keine automatischen Modell-, Compiler- oder Helfer-Abfragen. Vorhandene laufende Editoraufgaben sind davon unabhängig. Die ausdrücklichen Prüf- und Aktualisierungsaktionen bleiben nutzbar. Ein Kategorienwechsel leert die Suche und zeigt den neuen Bereich von oben. Schalter und Auswahlgruppen tragen zugängliche Namen und melden ihren ausgewählten Zustand.
