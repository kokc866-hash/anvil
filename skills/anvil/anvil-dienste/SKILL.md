---
name: anvil-dienste
description: "Eine konkrete Aufgabe über Anvils verbundene MCP-Dienste erledigen. Wählt passende Werkzeuge aus dem aktuellen Katalog, prüft Zugriff und vermeidet doppelte Änderungen nach Unterbrechungen."
---

# Mit verbundenen Diensten arbeiten

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-dienste",resource:"references/zugriff-und-wiederholung.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Nutze die für den Auftrag passende eingerichtete Verbindung. Login, Werkzeugkatalog, freigegebene Werkzeuge und tatsächlicher Zugriff sind getrennte Zustände. Keine zusätzlichen Dienste oder Konten allein aufgrund dieses Skills verbinden.

## Werkzeug und Ziel wählen

Mit `mcp_list` nach dem benötigten Dienst oder der Funktion suchen. Große Kataloge eingrenzen und bei Bedarf mit dem gelieferten Cursor weiterlesen. Schema, Beschreibung und freigegebene Verwendung des konkreten Werkzeugs prüfen. Gleiche Werkzeugnamen können auf unterschiedlichen Servern andere Daten oder Wirkungen betreffen.

Vor einem Aufruf Ziel eindeutig bestimmen: beispielsweise Seite, Datenbank, Projekt oder Repository. Fehlende Angaben nur dann klären, wenn sie für Zugriff oder Änderung entscheidend sind. Lesende Aufgaben bleiben lesend. Ein verknüpftes Konto erlaubt keine beliebigen Änderungen und keine Nachricht an Dritte ohne den dafür erteilten Auftrag.

## Ausführen und Ergebnis sichern

Werkzeuge über `mcp_call` mit den tatsächlich erforderlichen Argumenten aufrufen. Ressourcen bei Bedarf mit `mcp_read_resource` lesen. Zugangsdaten weder in Argumenten als Klartext weiterreichen noch in Projektdateien speichern.

Große, zurückgehaltene Ergebnisse mit `mcp_read_output` anhand ihrer ID und nächsten Position weiterlesen. Das Ergebnislesen benötigt keine Wiederholung der ursprünglichen externen Aktion. Bei Dienstfehlern Ursache, Zugriff und erforderliche Voraussetzung auseinanderhalten; denselben fehlschlagenden Aufruf nicht ohne neue Information wiederholen.

## Unterbrechung und Abschluss

Nach Zeitüberschreitung oder Verbindungsabbruch kann eine schreibende Aktion bereits ausgeführt worden sein. Mit einem passenden Leseaufruf den tatsächlichen Zustand prüfen, bevor du sie erneut sendest. Falls das nicht möglich ist, den unklaren Ausgang benennen und die nächste Entscheidung klären.

Abschluss mit bestätigtem Ergebnis, verfügbarem Objektlink oder relevanten Identifikatoren. Eine bloße Erfolgsmeldung des Modells, ein geladener Katalog oder eine lokal gespeicherte Anmeldung reichen nicht. Praktische Lese- und Schreibfälle stehen in [references/zugriff-und-wiederholung.md](references/zugriff-und-wiederholung.md).
