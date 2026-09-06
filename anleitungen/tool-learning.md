# Gelernte Tool-Aufrufe

Anvil erkennt bestimmte abweichende Aufrufformen eines Modells, ordnet deren Felder einem vorhandenen Werkzeug zu und merkt sich erfolgreiche Zuordnungen. Beispiel:

```json
{"tool":"read","file":"src/main.ts"}
```

wird im aktiven Text-Tool-Modus zu:

```json
{"name":"read_file","arguments":{"path":"src/main.ts"}}
```

Die Übersetzung läuft unmittelbar vor der vorhandenen Tool-Ausführung. Sie trainiert keine Modellgewichte und verwendet kein zweites Modell. Zusätzliche Probe-, Reparatur- oder Modellladeanfragen entstehen dadurch nicht.

## Einschalten und verwalten

Unter **Einstellungen → Agent → Gelernte Tool-Aufrufe** gilt die Auswahl für den aktuellen Anbieter, die konkrete Serveradresse, das Protokoll und das Modell.

| Modus | Verhalten |
|---|---|
| Aus | Keine neue Erkennung; vorhandene Übersetzungen werden nicht verwendet. |
| Beobachten | Vorschläge sammeln; der bestehende Ausführungsweg bleibt aktiv. |
| Lernen & anwenden | Eindeutige, vollständig validierte Zuordnungen verwenden und ihre Ausführungsergebnisse zählen. |

Ohne eigene Auswahl startet **Bisherig** mit **Beobachten**. Bei **Kompakt** und **Text** startet **Lernen & anwenden**. Die gültigen nativen Aufrufe brauchen keine Lernregeln und werden weiter direkt verarbeitet. Die Abo-Verbindung verwendet weiterhin die CLI; CLI und der integrierte Grok-Weg erhalten diese Übersetzung nicht.

Eine neue Regel steht zunächst auf **Beobachtet**. Erst erfolgreiche Tool-Ausführungen in **zwei getrennten normalen Agent-Aufträgen** führen zu **Bewährt**. Mehrere gleiche Aufrufe innerhalb eines Auftrags zählen einmal. „Bewährt“ belegt die technische Ausführbarkeit, nicht die inhaltliche Richtigkeit jedes Modellauftrags. Fehlgeschlagene, gesperrte, abgebrochene, noch laufende oder beim Transportwechsel bereits ausgeführte Aktionen gelten nicht als Lernerfolg.

Die Liste zeigt Aufrufformat, Zielwerkzeug, Feldzuordnung und Erfolgs-/Fehlerzähler. **Zuordnung bestätigen** legt ein Ziel ausdrücklich fest. **Sperren** verhindert die Verwendung der Regel, **Freigeben** hebt diese Sperre auf. **Löschen** entfernt sie; bei weiter aktivem Lernen kann ein späterer Auftrag einen neuen Vorschlag erzeugen. Alle Regeln des aktuellen Modells lassen sich gemeinsam löschen.

Aus, Sperren und Löschen werden unmittelbar vor einer übersetzten Ausführung erneut geprüft. Sie starten oder stoppen keinen bereits laufenden Prozess; dafür bleibt **Stop** zuständig. Auch verspätete Ergebnisse können eine gelöschte Regel nicht wiederherstellen.

## Welche Varianten erkannt werden

- Strukturierte native Aufrufe mit eindeutiger Schreibweise wie `readFile` oder `functions.read_file`.
- Im Text-Tool-Modus ausschließlich eine vollständige JSON-Antwort: `name`, `tool` oder `function` als Werkzeugname; `arguments`, `args`, `parameters` oder `params` als Argumentobjekt. Ein Argumentobjekt als vollständiger JSON-String und flache Argumentfelder werden ebenfalls erkannt. Der Wrapper `{"function":{"name":"…","arguments":{…}}}` ist möglich.
- Begrenzte bekannte Kurzformen, etwa `read`, `write`, `append`, `edit` und `search`, sofern Name **und** Argumente ein eindeutiges Werkzeug ergeben.
- Bekannte Feldvarianten wie `file`/`filename`/`file_path` → `path`, `text` → `content`, `pattern` → `query` und `startLine` → `start_line`, sofern das konkrete Werkzeug diese Felder besitzt.

`save`, `open`, `run`, `execute` und `delete` benötigen eine ausdrückliche Zuordnungsbestätigung. Anvil entscheidet nicht anhand des gerade angebotenen Katalogausschnitts, dass ein mehrdeutiger Name plötzlich eindeutig wäre. Ein bestätigtes Ziel bleibt an dieselbe Aufrufform und denselben Argumentvertrag gebunden. Ändert sich der Vertrag, muss die Zuordnung erneut bestätigt werden.

Unbekannte Namen werden nicht anhand einer vagen Ähnlichkeit ausgeführt. Fehlende Argumente werden nicht erfunden, Typen nicht umgewandelt, überzählige Felder nicht verworfen und abgeschnittenes JSON nicht ergänzt. Bei einem mehrdeutigen Vorschlag hält der Auftrag mit einem Hinweis auf die Einstellungen an.

## Ausführungsgrenzen

Die neue Erkennung durchsucht weder Denktext noch Prosa, Markdown-Codeblöcke, XML oder zitierte Beispiele. In einer nativen Antwort wird deren normaler Text nicht für neue Lernregeln ausgewertet. Ein ganzes JSON-Aufrufobjekt im ausdrücklich aktiven Text-Tool-Protokoll ist dagegen eine Ausführungsanweisung. Das ältere Verhalten des Modus **Bisherig** wird durch die Lernfunktion nicht nachträglich umgebaut.

Ein übersetzter Aufruf muss zum tatsächlich angebotenen Werkzeug passen. Ask-Modus, Flächenbeschränkungen, Harness-Budget, bestehende Datei-/Befehlsprüfungen und Stop gelten weiter. Bestätigen einer Zuordnung erteilt keine zusätzlichen Rechte.

MCP bleibt über `mcp_list` und `mcp_call` erreichbar. Die Übersetzung kann etwa `mcpCall` normalisieren, erfindet aber keinen MCP-Server und kein externes Werkzeug. Das verschachtelte `arguments`-Objekt eines MCP-Aufrufs wird unverändert weitergegeben. Der Server muss wie bisher verbunden und das Werkzeug verfügbar sein.

## Speicherung und Import

Gespeichert werden Verbindungsidentität, Aufrufform, Werkzeug-/Feldnamen, Schemas und Zähler. Konkrete Argumentwerte, Dateiinhalte, Prompts, Pfade aus Aufrufen und Zugangsdaten werden nicht in Lernregeln gespeichert. Die Regeln gehören zu den lokalen Anvil-Einstellungen und werden mit diesen exportiert. Beim Import sind Zuordnungen erneut zu bestätigen; ein normaler Neustart erhält bestehende Bestätigungen.

Der Speicher ist auf 24 Verbindungen und 24 Regeln je Verbindung begrenzt. Innerhalb einer Verbindung werden alte automatisch entstandene Einträge zuerst verdrängt; gesperrte und manuell bestätigte Regeln bleiben erhalten. Sind alle Regelplätze so belegt, werden keine weiteren Übersetzungen hinzugefügt. Bei mehr als 24 Verbindungen werden die zuerst gespeicherten Verbindungen verdrängt.

## Technische Prüfung

`tool-learning.test.ts` prüft Erkennung, Eindeutigkeit, Bestätigung, erfolgreiche Aufträge, Schemawechsel, Sperren und Import. `test:tools:browser` führt Übersetzungen durch den tatsächlichen Agent-Loop mit Ollama-/Cloud-Transport-Fixtures aus und prüft gemeinsame Berechtigungen, Stop und Wiederholungsschutz. `test:tools:learning -- --production` bedient den echten Chat und die Einstellungen im gebauten Release einschließlich Neustart. Diese Prüfungen benötigen keine bezahlten Modellanfragen.
