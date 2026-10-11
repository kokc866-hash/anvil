---
name: anvil-fehler-beheben
description: "Fehler in Anvil-Projekten anhand von Ausgaben, betroffenen Dateien und gezielten Wiederholungen eingrenzen. Für Diagnose und Reparatur; eine reine Ursachenfrage bleibt ohne Änderungen."
---

# Fehler nachvollziehen und beheben

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-fehler-beheben",resource:"references/fehler-einordnen.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Unterscheide den Auftrag „Erkläre den Fehler“ von „Behebe den Fehler“. Eine reine Diagnose verändert das Projekt nicht. Für eine Reparatur ist das Ziel ein begründeter, überprüfter Eingriff.

## Ursache statt Vermutung

Erfasse den konkreten Auslöser, erwartetes Verhalten, tatsächliche Ausgabe und betroffene Version. Verwende vorhandene Fehlermeldungen und Logs. Keine ausgedachten Konsolenausgaben ergänzen. Mit `grep` Aufrufer suchen und mit `read_file` den fehlerhaften Ablauf verfolgen.

Reproduziere den Fehler nur, wenn Ausführung im Auftrag liegt und ihre Nebenwirkungen zum gewählten Test passen. Verwende `run_file` für passende Programme oder `shell` für erlaubte Testbefehle. Eine nicht gefundene Laufzeit, ein fehlendes Modul, ein verweigerter Werkzeugaufruf und ein Fehler im Programm sind verschiedene Ursachen.

Wenn Python oder JavaScript schrittweise geprüft werden müssen, nutze die verfügbaren Debuggerwerkzeuge: `debug_start`, `debug_breakpoint`, `debug_state`, `debug_watch`, `debug_step` und `debug_continue`. Ausdrücke in `debug_eval` können Zustand verändern; für Diagnose nur beobachtende Ausdrücke verwenden. Einen selbst gestarteten Debugger nach der Prüfung mit `debug_stop` beenden.

## Reparatur und Nachweis

Formuliere eine überprüfbare Ursache, ändere die kleinste sinnvolle Stelle mit `edit_file` und wiederhole den betroffenen Fall. Bei einem dauerhaften Fehler lohnt ein Regressionstest mit einer Aussage über das Verhalten. Keine Tests abschwächen, um einen unerwarteten Fehler zu verstecken.

Wiederholungen brauchen neue Information oder eine konkrete Korrektur. Bei unveränderten Fehlern keine Folge identischer Aufrufe starten. Unterbrochene oder lange laufende Ausführung als solche melden; ein gestarteter Prozess ist keine bestandene Prüfung.

Nenne Ursache, Eingriff und aktuellen Nachweis getrennt. Wenn nur Symptome belegt sind, sage das ausdrücklich. Bei Laufzeit- und Prüferfehlern hilft [references/fehler-einordnen.md](references/fehler-einordnen.md).
