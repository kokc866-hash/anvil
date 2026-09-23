# MCP im Desktop-Programm

Verfügbar ab Anvil 1.3.20. Bestehende HTTP-Konfigurationen bleiben verwendbar. MCP ist unabhängig von der Modellverbindung: Lokale Modelle, Cloud-Anbieter, eigene Verbindungen und Abonnements über CLI verwenden denselben Anvil-MCP-Client.

## Verbindung einrichten

Füge im Bereich **MCP** einen Server hinzu, aktiviere ihn und wähle **Werkzeuge laden**. Die Statusanzeige nennt die Anzahl der geladenen Werkzeuge und Ressourcen. Ein geladener Katalog bestätigt noch keinen erfolgreichen Werkzeugaufruf.

Für verwaltete OAuth-Verbindungen unter **Erweiterungen → Dienste** ist der Ablauf einfacher: Bereits angemeldete und aktive Dienste laden ihre Werkzeuge seit 1.3.26 nach einem Neustart automatisch. **Werkzeuge laden** bleibt für eine sofortige zusätzliche Prüfung verfügbar. Freigaben werden erhalten; neue Werkzeuge bleiben ausgeschaltet. Details: [Externe Dienste](dienste.md).

| Verbindung | Eingaben |
|---|---|
| HTTP | Vollständige MCP-URL, optional Bearer. Auch LAN-Adressen sind erlaubt. Die Desktop-App überträgt die Anfragen nativ, ohne Browser-CORS. |
| stdio | Installiertes Programm, Argumente als JSON-Liste, optional Arbeitsordner und Umgebungswerte als JSON-Objekt. Beispielsweise `npx` mit `["-y", "@anbieter/mcp-server"]`. Programm und Argumente werden getrennt gestartet. |
| OAuth über HTTP | OAuth auswählen und **Anmelden** drücken. Der Browser öffnet die Anmeldung des Anbieters. Anvil empfängt den Rücksprung auf einer lokalen Adresse mit zufälligem Statuswert und PKCE. Eine vorab registrierte Client-ID kann angegeben werden; sonst muss der Server dynamische Registrierung unterstützen. |

Programme für stdio müssen auf dem Rechner verfügbar sein. Einen Arbeitsordner für einen externen Server legst du ausdrücklich fest. Der lokale Anvil-Projektordner wird fremden Werkzeugen nicht automatisch als `cwd` übermittelt.

OAuth-Zugangsdaten werden mit dem Betriebssystem-Schlüsselspeicher verschlüsselt und an Serveradresse, Client-ID und OAuth-Aussteller gebunden. Ein gesperrter Speicher wird als Fehler gemeldet und nicht überschrieben. **Abmelden** entfernt die lokal gespeicherten Zugangsdaten; eine gegebenenfalls zusätzliche serverseitige Widerrufsfunktion des Anbieters bleibt davon unabhängig. Bearer und stdio-Umgebung bleiben in Anvils Schlüsselspeicher, getrennt von den normalen Einstellungen. Nach einer URL-Änderung muss ein vorhandener Bearer für die neue Adresse erneut eingetragen werden.

Der Companion-Token wird ausschließlich an den unter Companion konfigurierten `/mcp`-Endpunkt gesendet, auch im LAN. Andere lokale MCP-Server erhalten diesen Token nicht.

## Agent und Werkzeuge

**Hier arbeiten** wählt einen MCP-Server als Arbeitsfläche. **Nur aktive Arbeitsfläche** beschränkt den Agenten auf diese MCP-Arbeitsfläche. **Brücke** erlaubt zusätzlich den Zugriff auf Anvil-Dateien und weitere konfigurierte MCP-Server. Im Modus **Fragen** bleiben ausschließlich lesende Funktionen verfügbar.

| Agentenwerkzeug | Aufgabe |
|---|---|
| `mcp_list` | Werkzeuge mit vollständigem Argumentschema sowie Ressourcen und Vorlagen finden. `server` und `query` grenzen die Suche ein; `cursor` und `limit` ermöglichen das Blättern durch den Katalog. |
| `mcp_call` | Ein bestimmtes Werkzeug aufrufen: `server` enthält die Server-ID, `name` den Werkzeugnamen und `arguments` die Argumente als JSON-Objekt. |
| `mcp_read_resource` | Ressourcen über Server-ID und URI lesen. Bei Vorlagen die Platzhalter durch konkrete Werte ersetzen. |
| `mcp_read_output` | Bereits empfangene große Ergebnisse anhand ihrer `outputId` und `nextOffset` weiterlesen. Die ursprüngliche Aktion wird dabei nicht erneut ausgeführt. |

Im kompakten oder textbasierten Werkzeugmodus stehen auf einer exklusiven MCP-Arbeitsfläche die MCP-Werkzeuge bereits in der ersten Runde bereit. Dafür ist kein besonderes Schlüsselwort in deinem Auftrag nötig. Der Standardmodus behält den vollständigen bisherigen Werkzeugumfang.

Anvil prüft die Argumente gegen das vom Server gelieferte JSON-Schema. Kontextwerte werden nur in ausdrücklich deklarierte Felder eingesetzt; explizite Argumente haben Vorrang. Zahlen, Boolean-Werte und Objekte müssen zum Feldtyp passen. Ungültige Argumente führen zu einer Fehlermeldung vor dem externen Aufruf.

## Ergebnisse, Abbruch und Grenzen

Strukturierte Daten, Text, Bilder, Ressourcen und `isError` bleiben im empfangenen Ergebnis erhalten. MCP-Bilder werden nicht als Canvas-/Graph-Aufnahme bezeichnet. Modelle ohne bekannte Bildunterstützung erhalten die Text-/Strukturdaten; Bilder bleiben in Anvil sichtbar. In Release 1.3.29 überträgt der CLI-Adapter passende MCP-Bilder zusätzlich an Codex, Claude Code und Copilot; dafür gelten die [CLI-Bildgrenzen](05-verbindungen.md#abo-über-cli) und die tatsächliche Bildfähigkeit des gewählten Modells.

Im MCP-Modellkontext erscheinen höchstens vier passende Bilder bis jeweils 8 MiB Base64-Text; eine nachgelagerte Modellverbindung kann engere Grenzen haben. Große Ergebnisse erhalten einen Verweis zum Nachlesen. Der Sitzungsspeicher hält bis zu 16 Ergebnisse und insgesamt 32 MiB; ältere Ergebnisse können auslaufen. Ein ausgelaufener Verweis ist kein Anlass, eine schreibende Aktion automatisch zu wiederholen.

**Stoppen** bricht die ausstehende MCP-Anfrage ab. Wird der Werkzeugkatalog gleichzeitig für mehrere Anfragen geladen, kann das Laden für die übrigen Anfragen weiterlaufen. Deaktivieren, Entfernen und Verbindungsänderungen löschen den betroffenen Katalog und schließen die native Verbindung. Nach einem Verbindungsverlust wird ein möglicherweise bereits ausgeführter Werkzeugaufruf nicht automatisch wiederholt. Ein Abbruch kann eine serverseitig bereits abgeschlossene Änderung nicht rückgängig machen.

Der native Client handelt das aktuelle MCP-Protokoll mit Rückfall auf ältere Initialisierung aus. HTTP verwendet Streamable HTTP einschließlich SSE-Antworten; separate alte GET-SSE-Endpunkte sind damit nicht gemeint. Server, die interaktive Elicitation/Sampling-Schritte benötigen, werden nicht durch erfundene Antworten bedient: Anvil meldet den zusätzlichen Interaktionsbedarf. Kataloge mit endlosen oder wiederholten Seitencursorn werden als Serverfehler angezeigt.

Fehlende optionale Methoden für Ressourcen oder Ressourcenvorlagen blockieren seit 1.3.26 den Werkzeugkatalog nicht mehr. Damit bleibt beispielsweise ein Dienst mit funktionierendem `tools/list` nutzbar, obwohl er auf eine Ressourcenabfrage mit `Method not found` antwortet. Authentifizierungs-, Netzwerk- und andere tatsächliche Fehler bleiben Fehler; sie werden nicht pauschal übergangen.

## Gezielte Entwicklerprüfung

`npm run test:mcp` prüft die betroffenen Parser-, Schema-, Katalog-, Agent- und Transportwege. Lokale HTTP-/stdio-Gegenstellen und ein lokaler OAuth-Aussteller prüfen Protokollverhandlung, PKCE, Abbruch und Zugangsdatenbindung. Es werden keine echten Modelle oder kostenpflichtigen Anbieter aufgerufen.
