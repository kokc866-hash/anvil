# Git-Umfang vor einer Aktion bestimmen

| Auftrag | Geeigneter Ablauf |
| --- | --- |
| „Welche Dateien sind geändert?“ | `git_status` lesen und echte Git-Rückgabe von Sitzungsänderungen unterscheiden |
| „Sichere diese Änderung als Commit“ | Status und Inhalte prüfen; Commit-Umfang eindeutig abgrenzen |
| „Sichere das Projekt auf GitHub“ | Ziel, Datenumfang und GitHub-Zugriff prüfen; tatsächliche Übertragung bestätigen |
| „Lade dieses Repository“ | Nur einen tatsächlich angebotenen Importweg nutzen; im Vordergrund kann `git_clone` ohne Ersetzen bestehender Dateien verfügbar sein |
| „Bewerte den aktuellen Stand“ | Dateien und vorhandenen Vergleich lesen; keine Commit- oder Push-Aktion |

## Unabhängige Änderungen

Der Agentenaufruf `git_commit` enthält keine frei wählbare Dateiliste. Seine Umsetzung unterscheidet sich nach Betriebsweg:

| Betriebsweg | Tatsächlicher Commit-Umfang |
| --- | --- |
| Nativer Hintergrundbetrieb | Der Dienst prüft den gespeicherten Auftragsstand und berücksichtigt nur die von diesem Auftrag geänderten Dateien. Ein bestehender vorgemerkter Index wird abgelehnt. Andere Dateien bleiben außerhalb der Auswahl. |
| Vordergrund über Companion | Der normale Aufruf verwendet standardmäßig `git add -A`; dadurch können unabhängige Änderungen und unversionierte Dateien aufgenommen werden. |
| Reiner Dateientwurfsmodus | Keine Git-Ausführung. Gespeicherte Entwürfe sind kein Commit. |

Auch im begrenzten Hintergrundweg enthält ein Commit den vollständigen geänderten Dateistand, nicht automatisch nur die eigenen Zeilen. Änderungen des Nutzers in derselben Datei prüfen. Bei einer Ablehnung wegen vorgemerkter Änderungen den tatsächlichen Zustand berichten; den Index nicht zurücksetzen oder ausräumen.

Im Companion-Weg reicht eine passend formulierte Commit-Nachricht nicht als Abgrenzung. Ist der tatsächliche Umfang für den Auftrag ungeeignet, keinen solchen Commit ausführen. Einen bereits verfügbaren, passend begrenzten Weg nutzen oder die fehlende Fähigkeit konkret benennen. Keine fremden Änderungen löschen oder auslagern, um diesen Konflikt zu umgehen.

## GitHub-Übertragung

Im nativen Hintergrundbetrieb sind `git_push` und `git_clone` nicht verfügbar. Ein lokaler Hintergrund-Commit ist daher noch keine Remote-Sicherung. Eine vorhandene GitHub-MCP-Verbindung ist ein eigener Weg mit eigenem Katalog und eigenen Freigaben; ihre Aktionen nicht aus dem Namen der Verbindung ableiten.

Im Vordergrund kann `git_push` einen Commit des Arbeitsstands mit anschließender Übertragung ausführen. Es ist kein allgemeiner Git-Befehl für beliebige Branch- oder Remote-Aktionen. Aus einer erfolgreichen Rückgabe die tatsächlich erhaltene Ziel- oder Commitangabe verwenden, nicht selbst eine SHA erfinden.

Ein unklarer Ausgang nach einer Übertragung verlangt zuerst eine Zustandsprüfung. Auch Git-Aktionen nicht blind wiederholen, wenn dadurch ein neuer Commit oder eine weitere externe Änderung entstehen könnte.
