---
name: anvil-git
description: "Git-Zustand in Anvil prüfen und beauftragte Commits oder Übertragungen nachvollziehbar vorbereiten. Berücksichtigt den Umfang der Anvil-Werkzeuge und erhält unabhängige Änderungen."
compatibility: "Für Anvils Agentenbetrieb. Benötigt die im Skill genannten Projekt- und Werkzeugzugriffe; allgemeine Agenten können andere Werkzeugnamen verwenden."
metadata:
  version: "1.1.0"
---

# Mit Git arbeiten

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-git",resource:"references/git-umfang.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Passe das Vorgehen an den Auftrag an. Eine Statusfrage oder Bewertung bleibt lesend. Commit, Push und Klonen verändern lokale beziehungsweise externe Zustände und benötigen den dafür erteilten Auftrag sowie die vorhandenen Freigaben.

## Wirklichen Zustand ermitteln

Wenn angeboten, beginne mit `git_status`. Prüfe Projekt, geänderte Dateien und die Bedeutung der Rückgabe. Anvil kann ohne echte Git-Anbindung eine Liste geänderter Sitzungsdateien anzeigen; daraus keine Aussagen über Branch, Index, Remote oder Commit-Historie ableiten. Die tatsächlich angebotenen Werkzeuge bestimmen den verfügbaren Weg.

Lies relevante Dateien oder den bereitgestellten Vergleich. Übernimm fremde Änderungen nicht stillschweigend in die eigene Arbeit. Keine Rücksetzung, Bereinigung oder erzwungene Übertragung durchführen, nur weil sie den Git-Zustand vereinfacht.

## Werkzeugumfang beachten

`git_commit` erhält eine Nachricht; sein Umfang hängt vom Betriebsweg ab. Im nativen Hintergrundbetrieb werden ausschließlich gespeicherte, von diesem Auftrag geänderte Dateien berücksichtigt. Ein bereits vorgemerkter Git-Index wird abgelehnt und nicht bereinigt. Unabhängige Änderungen innerhalb derselben Datei müssen trotzdem zum beauftragten Commit-Umfang passen.

Im Vordergrund führt der normale Companion-Commit dagegen standardmäßig `git add -A` aus und kann damit auch unabhängige Dateien aufnehmen. Eine passende Nachricht grenzt diese Auswahl nicht ein. Nur einen Weg verwenden, dessen tatsächlicher Umfang dem Auftrag entspricht; keine fremden Änderungen löschen oder auslagern, um ihn passend zu machen.

Native `git_push`- und `git_clone`-Aktionen stehen im Hintergrundbetrieb nicht zur Verfügung. Im Vordergrund kann `git_push` einen Commit mit anschließender Übertragung ausführen; es ist kein bloßer Push vorhandener Commits. Das dort angebotene `git_clone` lädt ein GitHub-Projekt in den Arbeitsbereich. `replace:true` entfernt vorhandene Arbeitsdateien und ist keine harmlose Importoption.

Fehlende Aktionen nicht erfinden und nicht ungefragt in einen anderen Betriebsweg wechseln. Eine bereits eingerichtete MCP-Verbindung nur verwenden, wenn sie die konkret beauftragte Aktion tatsächlich anbietet. Ziel und Umfang müssen zum Auftrag passen; Zugangsdaten gehören in die Verbindungseinstellungen.

## Abschluss

Prüfe nach einer Mutation den tatsächlichen Rückgabewert und bei Bedarf erneut den Status. Nenne das erreichte Ergebnis mit verfügbaren Commit- oder Zielangaben. Ein lokaler Commit ist noch keine Sicherung auf dem Remote; ein fehlgeschlagener Push bleibt fehlgeschlagen. Praktische Entscheidungsfälle stehen in [references/git-umfang.md](references/git-umfang.md).
