# Verbindungen

Unter **Einstellungen → Agent** wählst du, wie Anvil auf dein KI-Modell zugreift.

Dokumentationsstand: 13. September 2026, Release 1.3.29. Die beschriebenen CLI-Erweiterungen gehören zu diesem Stand.

| Typ | Zugang | Einrichtung |
| --- | --- | --- |
| Lokal | Verbindung zu deinem Modellserver | Anbieter, API-Adresse und Modell; bei Bedarf ein API-Schlüssel |
| Cloud | API eines Anbieters | API-Schlüssel; bei Azure zusätzlich Ressourcenadresse und Bereitstellung (Deployment) |
| Abo | Installiertes Befehlszeilenprogramm des Anbieters (CLI) | CLI installieren, **Anmelden** wählen und den Kontozugriff bestätigen |
| Benutzerdefiniert | Eigener OpenAI-kompatibler Endpunkt | API-Adresse, Modell und optional ein API-Schlüssel |

## Abo über CLI

| Anbieter | Programm | Anmeldung im Terminal |
| --- | --- | --- |
| ChatGPT / Codex | `codex` | `codex login` |
| Claude Code | `claude` | `claude auth login` |
| GitHub Copilot | `copilot` | `copilot login` |

Eine aktuelle CLI muss auf dem Rechner installiert sein, auf dem Anvil Desktop läuft. Nach einer Installation Anvil neu starten, damit der neue Suchpfad verfügbar ist. Die Schaltfläche **Anmelden** startet die jeweilige CLI-Anmeldung. Ausgaben mit Anmeldelinks oder Gerätecodes erscheinen im Einstellungsbereich. Eine laufende Anmeldung lässt sich abbrechen.

Anvil übergibt das Gespräch und den Werkzeugkatalog an die CLI. Fordert das Modell ein Werkzeug an, wird dieser Aufruf von Anvil geprüft und ausgeführt. Die CLI verwaltet ihre Zugangsdaten und erneuert die Anmeldung bei Bedarf. Anvil übernimmt diese OAuth-Zugangsschlüssel nicht in den Browserspeicher und wechselt bei einem Abo-Fehler nicht automatisch zu einem API-Schlüssel. API-Zugangsdaten aus den Umgebungsvariablen werden dem CLI-Prozess nicht übergeben.

**CLI-Status laden** zeigt, ob die CLI installiert ist und welchen Kontotyp Codex oder Claude melden. Copilot bietet keinen entsprechenden Statusbefehl für den automatisierten Abruf. Deshalb zeigt Anvil hier die erkannte CLI-Version; Copilot prüft die Zugriffsberechtigung erst beim Senden. Die Statusprüfung selbst stellt keine Modellanfrage.

**Neu in Release 1.3.29:** Alle drei CLI-Verbindungen können angehängte Bilder übertragen und die Antwort bereits während ihrer Erstellung anzeigen. Dafür ist nicht grundsätzlich eine API-Verbindung erforderlich. Das gewählte Modell muss Bildinhalte verarbeiten können; die Bildübertragung allein garantiert dies nicht.

| CLI | Bildübertragung | Antwortanzeige |
| --- | --- | --- |
| Codex | Bildinhalte über den Codex-App-Server | Eintreffende Textteile aus dem App-Server |
| Claude Code | Bildinhalte im strukturierten Eingabeformat | Teilantworten aus dem strukturierten Ausgabestrom |
| GitHub Copilot | Bildinhalte mit der CLI-Anfrage | Eintreffende Textteile aus dem strukturierten Ausgabestrom |

Unterstützt werden angehängte Bilder in den Formaten PNG, JPEG, WebP und GIF: höchstens acht Bilder, 5 MiB je Bild und 20 MiB insgesamt je CLI-Anfrage. Das gilt auch für Aufnahmen aus der Vorschau und für Bilder aus MCP-Ergebnissen. Ihre Zuordnung zum Gespräch bleibt erhalten. Bilder von externen Adressen werden nicht automatisch heruntergeladen. Nicht unterstützte Formate oder zu große Anhänge werden mit einer entsprechenden Meldung abgewiesen. Dass Anvil ein Bild anzeigt, bestätigt noch nicht, dass das Modell dessen Inhalt geprüft hat.

Den **Denkaufwand** kannst du entsprechend den von CLI und Modell unterstützten Stufen einstellen. **Automatisch** verwendet deren Vorgabe. Weitere Informationen findest du unter [Denkaufwand](thinking.md). Temperatur und Antwortlimit werden von der jeweiligen CLI gesteuert. Anvils Kontextbudget begrenzt das übergebene Gespräch.

Das eingestellte harte Zeitlimit und **Stoppen** beenden laufende CLI-Prozesse. Projektwerkzeuge werden weiterhin von Anvil ausgeführt, nachdem die vollständige Werkzeuganforderung geprüft wurde. Eintreffende Textteile allein verändern keine Datei.

Für die beschriebenen Bild- und Teilantwortfunktionen ist Anvil 1.3.29 erforderlich. Der ältere Adapter in 1.3.26 überträgt nur Text und übernimmt die Antwort nach Abschluss.

Offizielle Referenzen: [Codex CLI](https://developers.openai.com/codex/cli/reference), [Codex im nichtinteraktiven Modus](https://developers.openai.com/codex/noninteractive), [Claude Code CLI](https://code.claude.com/docs/en/cli-reference), [Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [Copilot mit Standardeingabe](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically).

## Cloud und eigene Endpunkte

Die Verbindungsart **Benutzerdefiniert** erwartet eine OpenAI-kompatible Chat-Completions-API. Beispiele:

- `http://127.0.0.1:1234` wird zu `http://127.0.0.1:1234/v1`.
- `https://model.example/inference` behält den angegebenen API-Pfad.
- Bei `https://model.example/api/v2/chat/completions` wird der gemeinsame Basis-Pfad `https://model.example/api/v2` verwendet.

Die API-Adresse darf keine Zugangsdaten, Abfrageparameter oder URL-Fragmente enthalten. Ein optionaler API-Schlüssel wird als Bearer-Token gesendet. Ohne Schlüssel wird kein Platzhalter ergänzt. Die direkte Verbindung der Desktop-App und Companion unterstützen LAN, Tailscale-Adressen, private IPv6-Adressen und ausdrücklich konfigurierte eigene Domains. Beim Browserbetrieb ohne Desktop-App oder Companion muss der Modellserver passende CORS-Freigaben bereitstellen.

Anvil legt den Verbindungsweg vor dem Senden fest. Ein HTTP-Fehler des Anbieters wird angezeigt; dieselbe Anfrage wird nicht zusätzlich über einen anderen Proxy wiederholt. Erforderliche Anfrage-Header für Azure und Anthropic bleiben erhalten. Wenn du eine laufende Antwort stoppst, wird auch die Verbindung zum Anbieter geschlossen.

**Modellliste laden** meldet HTTP-Fehler, ungültige Antworten und leere Listen. **Modellliste geladen · N Modelle** bestätigt, dass der Server seine Liste geliefert hat. Ob das gewählte Modell antwortet, zeigt erst eine Chat-Anfrage. Der Chat zeigt Vorbereitung, Modellanfrage, Denkphase, Antwort und Werkzeugausführung als getrennte Phasen an. Ein mitgelieferter Modellkatalog hilft bei der Auswahl, bestätigt aber keine Verbindung. Ein selbst gewähltes Modell wird durch das Laden der Liste nicht ersetzt. Bei Azure wird der Ressourcenzugriff über die [Models-List-API](https://learn.microsoft.com/en-us/rest/api/azureopenai/models/list?view=rest-azureopenai-2024-10-21) geprüft; die gewählte Bereitstellung erst bei der Modellanfrage.

Azure-Responses-Anfragen verwenden den [v1-Endpunkt ohne datierten Versionsparameter](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle).

GitHub Models wurde am 30. Juli 2026 eingestellt. Copilot wird deshalb ausschließlich unter Abo angeboten. Hugging Face wird über Cloud mit einem Inference-Token eingerichtet. [GitHub zur Einstellung von Models](https://docs.github.com/en/github-models).

## Gespeicherte Einstellungen

Anvil speichert API- und Abo-Einstellungen getrennt. Beim Wechsel zwischen Ollama, LM Studio und anderen lokalen Anbietern behält jeder Anbieter seine gespeicherte Adresse beziehungsweise seinen Standardport.

Profile speichern Verbindungstyp, Anbieter, Adresse, Modell, Kontext und Modellparameter. Zugangsdaten werden getrennt verwaltet. Ältere Profile ohne Verbindungstyp gelten als API-Profile; Codex und Copilot werden als CLI-Abos behandelt. Bei der Übernahme älterer Einstellungen werden frühere Copilot-Endpunkte nicht mehr als HTTP-Ziel verwendet. Alte Kopien von Abo-Zugangsschlüsseln werden aus Anvils Browserspeicher entfernt. Die Anmeldedaten der installierten CLIs bleiben dort erhalten.

Anvil Desktop speichert API-Schlüssel, GitHub- und Companion-Zugangsschlüssel sowie Tresoreinträge verschlüsselt mithilfe der Betriebssystemfunktionen von Electron. Eine bisherige Kopie im Browserspeicher wird erst entfernt, wenn die verschlüsselte Speicherung bestätigt wurde. Ist der Schlüsselspeicher des Betriebssystems nicht verfügbar, erscheint ein Hinweis unter dem Feld für den API-Schlüssel. Neue Schlüssel bleiben dann nur für die aktuelle Sitzung im Arbeitsspeicher. Vorhandene Dateien bleiben erhalten, auch wenn sie nicht entschlüsselt werden können. Im Browserbetrieb wird weiterhin der separate Browserspeicher verwendet. Details zur Übernahme älterer Daten und ihren Grenzen stehen unter [Optimierungen](06-optimierungen.md).

## Entwicklung und Prüfung

Die Regressionstests liegen bei `electron/cli-runner.test.mjs`, `electron/llm-pipe.test.mjs`, `src/lib/connection.test.ts` und `scripts/connection-state.test.mjs`. Sie prüfen echte Unterprozesse und HTTP-Streams mit lokalen Testservern sowie die tatsächlichen Einstellungsfunktionen. Sie benötigen keine persönlichen Zugangsdaten und erzeugen keine kostenpflichtigen Modellanfragen.

Die neue CLI-Erweiterung wird zusätzlich durch `scripts/cli-stream.test.mjs`, `scripts/cli-client.test.mjs` und `scripts/cli-run-frame.test.mjs` geprüft. Die Tests decken getrennte Bilddaten, sichtbare Teilantworten, ausgeblendete Werkzeugargumente, Abbruch, verspätete Ereignisse, unbekannte Werkzeuge und widersprüchliche Endantworten ab. Claude Code und Copilot wurden anhand ihrer offiziellen Schnittstellen mit isolierten Testdaten für den Nachrichtenaustausch geprüft. Eine echte Anmeldung und Modellanfrage bei diesen beiden Anbietern wurde dabei nicht durchgeführt.

Ein separater echter Codex-Aufruf mit `gpt-5.6-terra` und niedrigem Denkaufwand erkannte die dominante Farbe eines neu erzeugten roten Testbildes korrekt. Die erste dekodierte Textausgabe traf nach 3.400 ms ein, der Aufruf endete nach 3.647 ms. Teilantworten und Endantwort stimmten überein; es wurde kein Werkzeug aufgerufen. Nachweis: `artifacts/cli-live-smoke-result.json`. Das bestätigt Bildübertragung und Teilantworten für diesen einzelnen Aufruf. Daraus lässt sich keine allgemeine Zusage zur Geschwindigkeit oder Qualität anderer Modelle ableiten.

```sh
npm run test:connections
npm run typecheck
npm run build
```

Erfolgreiche Tests mit simulierten CLI-Antworten bestätigen, dass Anvil diese Antworten wie vorgesehen verarbeitet. Anmeldung, Abo-Berechtigung und die tatsächlich installierte CLI-Version müssen zusätzlich auf dem Zielrechner funktionieren.
