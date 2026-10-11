# Git-Umfang vor einer Aktion bestimmen

| Auftrag | Geeigneter Ablauf |
| --- | --- |
| „Welche Dateien sind geändert?“ | `git_status` lesen und echte Git-Rückgabe von Sitzungsänderungen unterscheiden |
| „Sichere diese Änderung als Commit“ | Status und Inhalte prüfen; Commit-Umfang eindeutig abgrenzen |
| „Sichere das Projekt auf GitHub“ | Ziel, Datenumfang und GitHub-Zugriff prüfen; tatsächliche Übertragung bestätigen |
| „Lade dieses Repository“ | `git_clone` ohne Ersetzen bestehender Dateien, soweit der Import damit vereinbar ist |
| „Bewerte den aktuellen Stand“ | Dateien und vorhandenen Vergleich lesen; keine Commit- oder Push-Aktion |

## Unabhängige Änderungen

Der normale Agentenaufruf `git_commit` enthält keine Liste von Dateien. Der Companion verwendet für den Standardweg `git add -A`. Dadurch können vorhandene Änderungen des Nutzers aufgenommen werden.

Wenn nur ein Teil gesichert werden soll, reicht eine passend formulierte Commit-Nachricht nicht als Abgrenzung. Ein verfügbarer Weg mit konkreter Dateiauswahl wäre erforderlich; alternativ muss der Nutzer den gesamten gewünschten Umfang ausdrücklich bestimmen. Keine fremden Änderungen löschen oder auslagern, um diesen Konflikt zu umgehen.

## GitHub-Übertragung

`git_push` überträgt Anvils Arbeitsdateien mit einem neuen Commit. Es ist kein allgemein verfügbarer Git-Befehl für beliebige Branch- oder Remote-Aktionen. Aus einer erfolgreichen Rückgabe die tatsächlich erhaltene Ziel- oder Commitangabe verwenden, nicht selbst eine SHA erfinden.

Ein unklarer Ausgang nach einer Übertragung verlangt zuerst eine Zustandsprüfung. Auch Git-Aktionen nicht blind wiederholen, wenn dadurch ein neuer Commit oder eine weitere externe Änderung entstehen könnte.
