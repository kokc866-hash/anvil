---
name: anvil-git
description: "Git-Zustand in Anvil prüfen und beauftragte Commits oder Übertragungen nachvollziehbar vorbereiten. Berücksichtigt den Umfang der Anvil-Werkzeuge und erhält unabhängige Änderungen."
---

# Mit Git arbeiten

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-git",resource:"references/git-umfang.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Passe das Vorgehen an den Auftrag an. Eine Statusfrage oder Bewertung bleibt lesend. Commit, Push und Klonen verändern lokale beziehungsweise externe Zustände und benötigen den dafür erteilten Auftrag sowie die vorhandenen Freigaben.

## Wirklichen Zustand ermitteln

Beginne mit `git_status`. Prüfe Projekt, geänderte Dateien und die Bedeutung der Rückgabe. Anvil kann ohne echte Git-Anbindung eine Liste geänderter Sitzungsdateien anzeigen; daraus keine Aussagen über Branch, Index, Remote oder Commit-Historie ableiten.

Lies relevante Dateien oder den bereitgestellten Vergleich. Übernimm fremde Änderungen nicht stillschweigend in die eigene Arbeit. Keine Rücksetzung, Bereinigung oder erzwungene Übertragung durchführen, nur weil sie den Git-Zustand vereinfacht.

## Werkzeugumfang beachten

`git_commit` bietet dem Agenten eine Commit-Nachricht, aber keine Dateiauswahl. Der aktuelle Companion kann dabei sämtliche Änderungen aufnehmen. Sind unabhängige Änderungen vorhanden und ist der gewünschte Commit-Umfang damit nicht sichergestellt, die Abgrenzung vor dem Commit klären oder einen bereits verfügbaren, passend eingeschränkten Weg verwenden.

`git_push` ist in Anvil eine kombinierte Commit- und GitHub-Übertragung des Arbeitsstands. Den Aufruf nicht als reinen Push bereits vorhandener Commits behandeln. Ziel und Umfang müssen zum Nutzerauftrag passen; Zugangsdaten gehören in die Verbindungseinstellungen, nicht in Dateien oder Ausgaben.

`git_clone` kann ein GitHub-Projekt in den Arbeitsbereich laden. `replace:true` entfernt vorhandene Arbeitsdateien und ist keine harmlose Importoption. Der Auftrag zum Klonen allein erlaubt dieses Ersetzen nicht.

## Abschluss

Prüfe nach einer Mutation den tatsächlichen Rückgabewert und bei Bedarf erneut den Status. Nenne das erreichte Ergebnis mit verfügbaren Commit- oder Zielangaben. Ein lokaler Commit ist noch keine Sicherung auf dem Remote; ein fehlgeschlagener Push bleibt fehlgeschlagen. Praktische Entscheidungsfälle stehen in [references/git-umfang.md](references/git-umfang.md).
