---
name: anvil-auftrag-fortsetzen
description: "Einen ausdrücklich fortzusetzenden Anvil-Auftrag am aktuellen Projektstand weiterführen. Gleicht gespeicherten Fortschritt und offene Schritte ab und vermeidet doppelte externe Aktionen nach Unterbrechungen."
compatibility: "Für Anvils Agentenbetrieb mit vorhandenem Projekt- und Auftragskontext. Eine Anleitung ersetzt keine technische Wiederaufnahmefunktion."
metadata:
  version: "1.0.0"
---

# Einen Auftrag zuverlässig fortsetzen

Setze den Auftrag fort, den der Nutzer jetzt meint. Ein alter Plan oder eine gespeicherte Zusammenfassung kann veraltet sein. Ein neues Ziel des Nutzers hat Vorrang vor früheren Annahmen; aus alten Fehlern keine neuen Verbote ableiten.

## Den tatsächlichen Stand bestimmen

Lies den vorhandenen Auftragskontext und die betroffenen Projektdateien. Mit `list_files`, `grep` und `read_file` feststellen, welche Änderungen wirklich vorliegen. Vorhandene Projektnotizen, eine mit `harness_read` erreichbare Ablaufbeschreibung oder eine Tafel mit `board_read` können helfen; ihre Existenz nicht voraussetzen und ihre Aussagen am aktuellen Stand prüfen.

Teile die Arbeit in bereits belegte Ergebnisse, noch offene Schritte und Aktionen mit unklarem Ausgang. Einen bestehenden Plan mit `set_plan` passend aktualisieren. Erledigte Schritte nicht allein aufgrund einer früheren Abschlussantwort abhaken und den Auftrag nicht ohne Grund von vorn beginnen.

## Nebenwirkungen nicht wiederholen

Nach einer Unterbrechung kann ein gestarteter Schreibaufruf bei einem Dienst bereits ausgeführt worden sein. Mit `mcp_list` einen passenden lesenden Weg finden und den tatsächlichen Zustand über `mcp_call` prüfen, bevor dieselbe Änderung erneut gesendet wird. Ein vorhandenes Ergebnis mit `mcp_read_output` weiterlesen, statt die ursprüngliche Aktion zu wiederholen.

Fehlt ein sicherer Nachweis, den betreffenden Schritt offenlassen und an unabhängig ausführbaren Schritten weiterarbeiten. Nur die Information erfragen, die für die verbleibende Aktion wirklich fehlt. Eine Abbruchmeldung oder lange Rechenzeit ist kein Beweis für einen Programmfehler.

## Gezielt weiterarbeiten

Prüfe vor einer neuen Änderung, ob betroffene Dateien seit dem gespeicherten Stand geändert wurden. Erhalte unabhängige Arbeit. Wiederhole nach einer Korrektur den zugehörigen Test; unveränderte erfolgreiche Prüfungen nicht ohne Anlass erneut ausführen.

Berichte, was erhalten blieb, was neu erledigt wurde und was noch offen ist. Ein Skill startet keinen gestoppten Dienstauftrag außerhalb der vorhandenen Anvil-Funktion und bestätigt keine fremde Serveraktion.

Für typische Unterbrechungen lies bei Bedarf [references/unterbrechungen.md](references/unterbrechungen.md) mit `skill_read` und diesem relativen Ressourcenpfad.
