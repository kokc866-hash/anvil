---
name: anvil-code-aendern
description: "Funktionen in vorhandenen Anvil-Projekten ergänzen oder gezielt überarbeiten. Verbindet passende Dateiänderungen mit vorhandenen Prüfungen und erhält unabhängige Arbeit sowie bestehende Schnittstellen."
---

# Code gezielt ändern

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-code-aendern",resource:"references/pruefauswahl.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Setze die gewünschte Funktion im vorhandenen Projekt um. Übernimm dessen Aufbau, Sprache und Bedienabläufe. Eine ausdrückliche Vorgabe des Nutzers geht vor einem Beispiel aus diesem Skill.

## Änderung eingrenzen

Lies die betroffene Datei und ihre relevanten Aufrufer mit `read_file` und `grep`. Prüfe Datenformate, Fehlerbehandlung, Konfiguration und vorhandene Tests, soweit sie für die Änderung eine Rolle spielen. Bei Arbeiten über mehrere Dateien zuerst festlegen, wie Eingaben und Ergebnisse zwischen ihnen übertragen werden.

Verwende `edit_file` für kleine, eindeutige Ersetzungen. Neue Dateien mit `write_file` erstellen; eine vorhandene Datei nur vollständig ersetzen, wenn der Auftrag dies tatsächlich erfordert und `overwrite_reason` den Grund beschreibt. Andere Funktionen, Kommentare, Assets und bereits vorhandene Änderungen erhalten. Ein langer Leseausschnitt ist kein Grund zum Neuaufbau der Datei.

## Prüfen und abschließen

Wähle Prüfungen nach dem geänderten Verhalten. Ein ausführbares Einzelprogramm kann mit `run_file` gestartet werden, eine vorhandene Testsuite mit dem freigegebenen `shell`-Befehl. Engine-Projekte über `engine_detect` und tatsächlich unterstützte `engine_run`-Aktionen prüfen. Eine Weboberfläche braucht zusätzlich eine sichtbare oder gezielte Bedienprüfung. Eine erfolgreiche Übersetzung bestätigt noch keine korrekte Bedienung.

Nutze `format_file` nur für passende geänderte Dateien, wenn dadurch die bestehende Formatierung erhalten bleibt. Keine zusätzlichen Abhängigkeiten, globalen Einstellungen oder Veröffentlichungen allein zur Vereinfachung der Umsetzung einführen.

Bei mehrstufiger Arbeit kann `set_plan` die Arbeitsschritte mit aktuellen Werkzeugnachweisen verbinden. Vor der Abschlussantwort den tatsächlichen Stand abgleichen. Nach einer fehlgeschlagenen Prüfung erst Ursache und Ausgabe lesen; nur mit einer neuen begründeten Änderung erneut versuchen.

Berichte konkret, welches Verhalten sich geändert hat, welche Prüfungen dafür ausgeführt wurden und welche Voraussetzungen fehlen. Für anspruchsvollere Prüffälle lies [references/pruefauswahl.md](references/pruefauswahl.md).
