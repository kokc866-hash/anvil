# Godot-Tests mit belastbarem Ergebnis

## Version und tatsächlicher Ausführungsweg

Projektversion, projekt.godot, verwendete Skripte und vorhandenen Testaufbau lesen. Die Upstream-Anleitung beschreibt Godot 4.7; Anvil darf daraus kein Upgrade oder eine andere installierte Version ableiten. Godot 3 und 4 sowie Test-Addons unterscheiden sich. Ressourcen- und Signalverbindungen mit den tatsächlich eingesetzten APIs erhalten.

Eine Importprüfung verarbeitet Ressourcen, führt aber keine Spieltests aus. engine_run nur mit den Aktionen des erkannten Projekts aufrufen. Ein zusätzlicher Headless-Runner kann über einen bereits vorhandenen und im Auftrag freigegebenen Testweg ausgeführt werden; keine neue engine_run-Aktion oder Shell-Freigabe erfinden.

## Ein Runner braucht ein Ende

Ein GDScript-Runner muss ausgeführte Fälle und Fehler zählen und explizit mit einem vom Ergebnis abhängigen Prozesscode enden. push_error() allein bewirkt nicht zwingend einen fehlgeschlagenen Prozess. Ein fehlgeschlagenes assert() kann die Ausführung vor dem vorgesehenen Ende unterbrechen. Prüfe deshalb einen absichtlich fehlschlagenden künstlichen Testfall des Runners, sofern dieser Negativtest im Auftrag liegt; den absichtlichen Fehler dabei nicht ungefragt beseitigen.

Bei asynchronen Tests ein passendes Zeitlimit für die konkrete Operation und einen kontrollierten Abbruch vorsehen. Eine lange aktive Berechnung nicht pauschal wegen geringer Schrittzahl als Schleife behandeln. stdout, stderr, Prozesscode, Anzahl und Namen der Testfälle zusammen auswerten. Null ausgeführte Tests sind kein Verhaltensnachweis.

## Richtige Aussagen treffen

Reine Berechnungen lassen sich ohne Fenster prüfen. Szenenabhängiges Verhalten braucht den passenden Szenenbaum, Signale und gegebenenfalls Frames. Sichtbare Bewegung, Eingaben, Kollision oder Darstellung benötigen jeweils einen konkreten Test oder eine tatsächlich beobachtete Interaktion. Headless-Erfolg bestätigt keine visuelle Qualität und keinen Plattformexport.

Bei wiederholten Lese-/Änderungsversuchen konkrete neue Information prüfen. Bestehende Szenen, Kennungen, Assets und nicht betroffene Projektteile erhalten. Keine Test-Addons oder fremden CLI-Wrapper ohne einen entsprechenden Auftrag installieren.
