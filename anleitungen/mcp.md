# MCP im Desktop-Programm

Verfügbar ab Anvil 1.3.20. Bestehende HTTP-Konfigurationen bleiben verwendbar. MCP ist unabhängig von der Modellverbindung: Local, Cloud, Custom und Abo über CLI verwenden denselben Anvil-MCP-Client.

## Verbindung einrichten

Im Bereich **MCP** einen Server hinzufügen, aktivieren und **Tools laden** wählen. Der Status zeigt den geladenen Katalog mit Tool- und Ressourcenanzahl. Ein geladener Katalog bestätigt noch keinen erfolgreichen Tool-Aufruf.

| Verbindung | Eingaben |
|---|---|
| HTTP | Vollständige MCP-URL, optional Bearer. Auch LAN-Adressen sind erlaubt. Die Desktop-App überträgt die Anfragen nativ, ohne Browser-CORS. |
| stdio | Installiertes Programm, Argumente als JSON-Liste, optional Arbeitsordner und Umgebungswerte als JSON-Objekt. Beispielsweise `npx` mit `["-y", "@anbieter/mcp-server"]`. Programm und Argumente werden getrennt gestartet. |
| OAuth über HTTP | OAuth auswählen und **Anmelden** drücken. Der Browser öffnet die Anmeldung des Anbieters. Anvil empfängt den Rücksprung auf einer lokalen Adresse mit zufälligem Statuswert und PKCE. Eine vorab registrierte Client-ID kann angegeben werden; sonst muss der Server dynamische Registrierung unterstützen. |

Programme für stdio müssen auf dem Rechner verfügbar sein. Ein Arbeitsordner für einen externen Server wird ausdrücklich konfiguriert. Der lokale Anvil-Workspace wird fremden Tools nicht automatisch als `cwd` zugesendet.

OAuth-Zugangsdaten werden mit dem Betriebssystem-Schlüsselspeicher verschlüsselt und an Serveradresse, Client-ID und OAuth-Aussteller gebunden. Ein gesperrter Speicher wird als Fehler gemeldet und nicht überschrieben. **Abmelden** entfernt die lokal gespeicherten Zugangsdaten; eine gegebenenfalls zusätzliche serverseitige Widerrufsfunktion des Anbieters bleibt davon unabhängig. Bearer und stdio-Umgebung bleiben in Anvils Schlüsselspeicher, getrennt von den normalen Einstellungen. Nach einer URL-Änderung muss ein vorhandener Bearer für die neue Adresse erneut eingetragen werden.

Der Companion-Token wird ausschließlich an den unter Companion konfigurierten `/mcp`-Endpunkt gesendet, auch im LAN. Andere lokale MCP-Server erhalten diesen Token nicht.

## Agent und Werkzeuge

**Hier arbeiten** wählt einen MCP-Server als Arbeitsfläche. **Eine Fläche** beschränkt den Agenten auf diese MCP-Fläche. **Brücke** erlaubt zusätzlich Anvil-Dateien und weitere konfigurierte MCP-Server. Ask behält seine Beschränkung auf lesende Funktionen.

| Agent-Tool | Aufgabe |
|---|---|
| `mcp_list` | Tools mit vollständigem Argumentschema sowie Ressourcen/Vorlagen finden. `server` und `query` grenzen ein, `cursor` und `limit` blättern durch den Katalog. |
| `mcp_call` | Exaktes Tool aufrufen: `server` als Server-ID, `name` als Toolname, `arguments` als JSON-Objekt. |
| `mcp_read_resource` | Ressourcen über Server-ID und URI lesen. Bei Vorlagen die Platzhalter durch konkrete Werte ersetzen. |
| `mcp_read_output` | Bereits empfangene große Ergebnisse anhand ihrer `outputId` und `nextOffset` weiterlesen. Die ursprüngliche Aktion wird dabei nicht erneut ausgeführt. |

Im kompakten oder textbasierten Toolmodus stehen auf einer exklusiven MCP-Fläche die MCP-Werkzeuge bereits in der ersten Runde bereit. Es braucht kein besonderes Schlüsselwort im Benutzerauftrag. Der Standardmodus behält den vollständigen bisherigen Werkzeugumfang.

Anvil prüft die Argumente gegen das vom Server gelieferte JSON-Schema. Kontextwerte werden nur in ausdrücklich deklarierte Felder eingesetzt; explizite Argumente haben Vorrang. Zahlen, Boolean-Werte und Objekte müssen zum Feldtyp passen. Ungültige Argumente führen zu einer Fehlermeldung vor dem externen Aufruf.

## Ergebnisse, Abbruch und Grenzen

Strukturierte Daten, Text, Bilder, Ressourcen und `isError` bleiben im empfangenen Ergebnis erhalten. MCP-Bilder werden nicht als Canvas-/Graph-Aufnahme bezeichnet. Modelle ohne bekannte Bildunterstützung und Abo-CLIs erhalten die Text-/Strukturdaten; Bilder bleiben in Anvil sichtbar. Im Modellkontext erscheinen höchstens vier passende Bilder bis jeweils 8 MiB Base64-Text. Große Ergebnisse erhalten einen Verweis zum Nachlesen. Der Sitzungsspeicher hält bis zu 16 Ergebnisse und insgesamt 32 MiB; ältere Ergebnisse können auslaufen. Ein ausgelaufener Verweis ist kein Anlass, eine schreibende Aktion automatisch zu wiederholen.

**Stop** bricht die ausstehende MCP-Anfrage ab. Bei gemeinsam genutztem Katalogaufbau kann eine reine Kataloganfrage für einen anderen wartenden Aufrufer weiterlaufen. Deaktivieren, Entfernen und Verbindungsänderungen löschen den betroffenen Katalog und schließen die native Verbindung. Nach einem Verbindungsverlust wird ein möglicherweise bereits ausgeführtes Tool nicht automatisch wiederholt. Ein Abbruch kann eine serverseitig bereits abgeschlossene Änderung nicht rückgängig machen.

Der native Client handelt das aktuelle MCP-Protokoll mit Rückfall auf ältere Initialisierung aus. HTTP verwendet Streamable HTTP einschließlich SSE-Antworten; separate alte GET-SSE-Endpunkte sind damit nicht gemeint. Server, die interaktive Elicitation/Sampling-Schritte benötigen, werden nicht durch erfundene Antworten bedient: Anvil meldet den zusätzlichen Interaktionsbedarf. Kataloge mit endlosen oder wiederholten Seitencursorn werden als Serverfehler angezeigt.

## Gezielte Entwicklerprüfung

`npm run test:mcp` prüft die betroffenen Parser-, Schema-, Katalog-, Agent- und Transportwege. Lokale HTTP-/stdio-Gegenstellen und ein lokaler OAuth-Aussteller prüfen Protokollverhandlung, PKCE, Abbruch und Zugangsdatenbindung. Es werden keine echten Modelle oder kostenpflichtigen Anbieter aufgerufen.
