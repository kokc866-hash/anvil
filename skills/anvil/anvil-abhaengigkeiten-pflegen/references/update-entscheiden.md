# Ein Update begründet auswählen

| Situation | Sinnvolle Entscheidung |
| --- | --- |
| Verwendete Version ist laut Primärquelle betroffen | Korrigierte Version und ihre Kompatibilität ermitteln; innerhalb des Updateauftrags gezielt aktualisieren. |
| Meldung betrifft eine transitive Abhängigkeit | Abhängigkeitspfad und korrigierte übergeordnete Version prüfen. Einen Override nur mit begründetem Kompatibilitätsnachweis erwägen. |
| Keine konkrete betroffene Version belegt | Inventar und Quelle nachlesen. Nicht pauschal das gesamte Projekt aktualisieren und Erfolg behaupten. |
| Paketmanager oder Netzwerk fehlt | Die fehlende Voraussetzung melden; keine globalen Installationen oder kopierten Lockdateien erfinden. |
| Nutzer möchte nur Analyse | Befund, Versionen und mögliche nächste Schritte berichten; keine Manifeständerung vornehmen. |

Für die Prüfung mindestens den tatsächlich aufgelösten Paketstand und einen relevanten Verbraucher der geänderten Schnittstelle heranziehen. Ein Test darf nicht ausschließlich die neu eingetragene Versionszeichenfolge mit sich selbst vergleichen.

Eine abgeschlossene künstliche Updateprüfung kann bekannte Manifest- und Lockdaten gegen eine bereitgestellte Sicherheitsmeldung auswerten. Sie belegt die Entscheidungslogik für diese Daten, aber keine aktuellen Online-Meldungen, reale Installation oder vollständige Anwendungskompatibilität. Solche Ebenen im Ergebnis ausdrücklich trennen.
