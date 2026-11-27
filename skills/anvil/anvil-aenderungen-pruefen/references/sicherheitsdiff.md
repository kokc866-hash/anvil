# Sicherheitsrelevante Änderungen lesend prüfen

Diese Anvil-Anpassung des Differential-Review-Verfahrens von Trail of Bits steht unter CC-BY-SA-4.0. Quelle, Commit, Änderungen und Lizenz stehen in quellen.md und quellen.json; die Originalbedingungen in lizenz-trail.txt. Die Lizenz betrifft diese Referenz, nicht das gesamte Anvil-Programm.

Zuerst den vorhandenen Vergleichsstand und Umfang bestimmen. Jede Behauptung an gelesene Änderungen und erforderliche Aufrufer binden. Ohne belastbaren Vorher-Stand die Einschränkung nennen. Ein fehlender Kontext darf nicht durch erfundene Diff-Zeilen ersetzt werden.

Bei der betroffenen Änderung Daten vom Eingang bis zur Wirkung verfolgen: Wer darf aufrufen, welche Eingaben sind unzuverlässig, wo werden Rechte oder Projektzuordnung geprüft, welche Dateien oder externen Aktionen werden berührt? Nach Umgehungen bei alternativen Aufrufern, Fehlerpfaden, Abbruch, Wiederaufnahme und wiederholten Zustellungen suchen. Nicht das ganze Projekt ohne Bezug zur Änderung durchsuchen.

Einen Befund mit Auslöser, Datei/Stelle, konkreter Folge und Begründung beschreiben. Beobachtete Fehler von einer noch ungeprüften Möglichkeit unterscheiden. Wenn ein vorhandener Test die Stelle abdeckt, seinen tatsächlichen Stand und Umfang prüfen; nur vorhandene Ergebnisse auswerten. Fehlende Tests benennen, bei einem lesenden Review aber weder Tests anlegen noch Programme starten oder reparieren.

Die Arbeit kann nacheinander erfolgen. Ein fremdes Task-/Unteragenten-Werkzeug, eine neue Scanner-CLI oder eine zusätzliche menschliche Abnahme ist dafür nicht erforderlich. Ein überprüfter Teilpfad ergibt keine pauschale Sicherheitsfreigabe.
