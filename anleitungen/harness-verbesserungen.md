# Verbesserungen für lange Agentenaufträge

Stand: 17. Oktober 2026, lokaler Entwicklungsstand 1.3.35.

Der Vergleich mit OpenCode 2 und DeepSeek Harness wurde für Anvils vorhandenen Agentenbetrieb umgesetzt. Es gibt dafür keine zusätzlichen Einstellungen.

## Große Ausgaben und tatsächliche Ergebnisse

Bei langen Compiler-, Shell- und Dienstausgaben bleiben Anfang und Ende sichtbar. Die Vorschau zeigt, wenn der Mittelteil gekürzt wurde. Fehlermeldungen, Abbruchstatus und Exitcodes bleiben erkennbar. Eine laufende Ausführung wird dem Modell als laufend gemeldet; eine fehlende Rückmeldung gilt nicht als Erfolg.

Große Werkzeugergebnisse kann der Agent im laufenden Auftrag über `read_tool_output` seitenweise nachlesen. Das wiederholt den ursprünglichen Befehl nicht. Die Aufbewahrung ist pro Auftrag auf 16 Ergebnisse und insgesamt 16 MiB begrenzt. Nach dem Auftragsende, bei einer Wiederaufnahme als neuer Lauf oder nach Verdrängung eines alten Ergebnisses ist dessen Kennung nicht mehr verfügbar. Anvil weist darauf hin; der frühere Befehl wird dadurch nicht automatisch erneut ausgeführt.

Für MCP-Dienste bleibt die vorhandene Nachlesefunktion `mcp_read_output` maßgeblich. Ihre Serverfreigaben und Bildübertragung gelten weiterhin.

Nachlesbar ist der vollständige zurückgegebene Werkzeugdatensatz. Bereits im Werkzeug begrenzte Prozessausgaben werden dadurch nicht nachträglich vervollständigt; die vorhandenen Ausgabegrenzen bleiben wirksam.

## Kontext komprimieren und nach Unterbrechungen weiterarbeiten

Beim Verkleinern des Kontexts bleiben zusammengehörige Werkzeugaufrufe und Antworten verbunden, auch wenn zwischen ihnen zusätzliche Kontextnachrichten stehen. Der vollständige aktuelle Nutzerauftrag bleibt erhalten. Eine unvollständige Werkzeuggruppe wird nicht durch erfundene Ergebnisse ergänzt.

Eine zusätzliche Modellzusammenfassung wird nur übernommen, wenn sie einschließlich ihres Hinweises tatsächlich weniger Kontext benötigt als die vorhandene Zusammenfassung. Sie wird als historischer Kontext gekennzeichnet.

Nach einem Verbindungsfehler berücksichtigt der Agent die bereits vorliegenden Ergebnisse und die für den aktuellen Auftrag verfügbaren Werkzeuge. Das gilt ebenso für Dienste und CAD-Aufgaben. Bereits erledigte Aktionen sollen nicht erneut ausgeführt werden.

## Plugins

Wenn ein Plugin beim Start fehlschlägt, entfernt Anvil seine bis dahin registrierten Befehle und Ereignisbehandlungen. Zuvor überschriebene Befehle anderer Plugins werden wiederhergestellt. Zurückbehaltene API-Zugriffe des fehlgeschlagenen Starts bleiben ungültig.

Die bestehende Freigabe für ausführbare Plugins gilt weiterhin. OpenCode- oder DeepSeek-JavaScript wird durch diese Verbesserung nicht automatisch als Anvil-Plugin gestartet.

Der separate Abnahmeablauf bleibt entfernt. Fortsetzen und Wiederholen benötigen keine Ergebnisformulare.
