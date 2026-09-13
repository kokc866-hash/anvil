# Verbindungen

Unter **Einstellungen → Agent** den Verbindungstyp wählen.

Dokumentationsstand: 13. September 2026, Release 1.3.28. Die beschriebenen CLI-Erweiterungen gehören zu diesem Stand.

| Typ | Zugang | Einrichtung |
| --- | --- | --- |
| Lokal | HTTP zum eigenen Modellserver | Anbieter, API-URL und Modell; API-Key bei Bedarf |
| Cloud | Anbieter-API | API-Key des Anbieters; bei Azure zusätzlich Resource-URL und Deployment |
| Abo | Installierte Anbieter-CLI | CLI installieren, **Anmelden** wählen und CLI-Konto autorisieren |
| Custom | OpenAI-kompatibler eigener Endpunkt | API-URL, Modell und optionaler API-Key |

## Abo über CLI

| Anbieter | Programm | Anmeldung im Terminal |
| --- | --- | --- |
| ChatGPT / Codex | `codex` | `codex login` |
| Claude Code | `claude` | `claude auth login` |
| GitHub Copilot | `copilot` | `copilot login` |

Eine aktuelle CLI muss auf dem Rechner installiert sein, auf dem Anvil Desktop läuft. Nach einer Installation Anvil neu starten, damit der neue Suchpfad verfügbar ist. Die Schaltfläche **Anmelden** startet die jeweilige CLI-Anmeldung. Ausgaben mit Anmeldelinks oder Gerätecodes erscheinen im Einstellungsbereich. Eine laufende Anmeldung lässt sich abbrechen.

Anvil übergibt Gespräch und Werkzeugkatalog an die CLI. Werkzeuganforderungen kommen zurück an Anvil und laufen durch dessen vorhandenen Agentenablauf. Das CLI-Programm verwaltet Zugangsdaten und Token-Erneuerung. Anvil importiert keine Modell-OAuth-Tokens in den Browser und wechselt bei Abo-Fehlern nicht auf einen API-Key. API-Zugangsdaten aus der Umgebung werden dem CLI-Prozess nicht übergeben.

**CLI-Status laden** zeigt Installation und den von Codex bzw. Claude gemeldeten Kontotyp. Copilot bietet hierfür keinen entsprechenden nichtinteraktiven Statusbefehl: Anvil zeigt die erkannte CLI-Version; die eigentliche Berechtigung wird beim Senden durch Copilot geprüft. Ein Statuscheck verbraucht keine Modellanfrage.

**Neu in Release 1.3.28:** Alle drei CLI-Verbindungen können angehängte Bilder übertragen und eintreffenden Antworttext während der Anfrage anzeigen. Eine API-Verbindung ist dafür nicht grundsätzlich erforderlich. Das gewählte Modell muss Bilder verstehen können; die Fähigkeit des Transports ist keine Zusage für jedes Modell.

| CLI | Bildübertragung | Antwortanzeige |
| --- | --- | --- |
| Codex | Bildinhalte über den Codex-App-Server | Eintreffende Textteile aus dem App-Server |
| Claude Code | Bildinhalte im strukturierten Eingabeformat | Teilantworten aus dem strukturierten Ausgabestrom |
| GitHub Copilot | Bildinhalte mit der CLI-Anfrage | Eintreffende Textteile aus dem strukturierten Ausgabestrom |

Unterstützt werden mitgelieferte PNG-, JPEG-, WebP- und GIF-Bilddaten: höchstens acht Bilder, 5 MiB je Bild und 20 MiB insgesamt je CLI-Anfrage. Das gilt auch für Bilder aus Run/Play und MCP-Ergebnissen; ihre Zuordnung zum Gespräch bleibt erhalten. Externe Bildadressen werden nicht stillschweigend heruntergeladen. Unzulässige Formate oder zu große Eingaben führen zu einer verständlichen Meldung. Ein in Anvil angezeigtes Bild beweist weiterhin nicht, dass ein bestimmtes Modell es inhaltlich geprüft hat.

Thinking lässt sich in Anvil anhand der unterstützten CLI- und Modellstufen wählen; **Auto** verwendet die Vorgabe. [Thinking im Detail](thinking.md). Temperatur und Antwortlimit bleiben beim jeweiligen CLI-Verhalten. Anvils Kontextbudget gilt für das übergebene Gespräch. Das eingestellte harte Zeitlimit und **Stop** beenden laufende CLI-Prozesse. Die CLI führt Anvils Projektwerkzeuge nicht eigenständig aus: Nur vollständig geprüfte Werkzeuganforderungen laufen durch Anvils Agentenablauf. Eintreffender unvollständiger Text verändert noch keine Datei.

Für die beschriebenen Bild- und Teilantwortfunktionen ist Anvil 1.3.28 erforderlich. Der ältere Adapter in 1.3.26 überträgt nur Text und übernimmt die Antwort nach Abschluss.

Offizielle Referenzen: [Codex CLI](https://developers.openai.com/codex/cli/reference), [Codex im nichtinteraktiven Modus](https://developers.openai.com/codex/noninteractive), [Claude Code CLI](https://code.claude.com/docs/en/cli-reference), [Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [Copilot mit Standardeingabe](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically).

## Cloud und eigene Endpunkte

Custom erwartet eine OpenAI-kompatible Chat-Completions-API. Beispiele:

- `http://127.0.0.1:1234` wird zu `http://127.0.0.1:1234/v1`.
- `https://model.example/inference` behält den angegebenen API-Pfad.
- Bei `https://model.example/api/v2/chat/completions` wird der gemeinsame Basis-Pfad `https://model.example/api/v2` verwendet.

Die API-URL enthält keine Zugangsdaten, Query-Parameter oder Fragmente. Ein optionaler API-Key wird als Bearer-Token gesendet. Ohne Key wird kein künstlicher Bearer-Token ergänzt. Native Modellleitung und Companion unterstützen LAN, Tailscale-Adressen, private IPv6-Adressen und explizit konfigurierte Custom-Domains. Browserbetrieb ohne Desktop/Companion setzt passende CORS-Freigaben des Modellservers voraus.

Anvil wählt vor der Anfrage einen Transport. Ein HTTP-Fehler des Anbieters wird weitergegeben; eine bereits gesendete Anfrage wird nicht zusätzlich über einen anderen Proxy abgespielt. Header für Azure und Anthropic bleiben erhalten. Beim Abbrechen eines Streams wird auch die vorgelagerte Verbindung geschlossen.

**Modellliste laden** meldet HTTP-Fehler, ungültige Antworten und leere Listen. **Modellliste geladen · N Modelle** bedeutet, dass der Server seine Liste geliefert hat. Ob das gewählte Modell eine Antwort erzeugt, zeigt erst eine Chat-Anfrage. Der Chat nennt Vorbereitung, Modellanfrage, Denken, Antwort und laufende Werkzeuge als getrennte Phasen. Ein mitgelieferter Modellkatalog ist eine Auswahlhilfe, kein Verbindungsnachweis. Ein selbst gewähltes Modell wird durch eine Modellabfrage nicht ersetzt. Azure prüft den Resource-Zugang über die [Models-List-API](https://learn.microsoft.com/en-us/rest/api/azureopenai/models/list?view=rest-azureopenai-2024-10-21); das Deployment wird bei der Modellanfrage geprüft.

Azure-Responses-Anfragen verwenden den [v1-Endpunkt ohne datierten Versionsparameter](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle).

GitHub Models wurde am 30. Juli 2026 eingestellt. Copilot wird deshalb ausschließlich unter Abo angeboten. Hugging Face wird über Cloud mit einem Inference-Token eingerichtet. [GitHub zur Einstellung von Models](https://docs.github.com/en/github-models).

## Gespeicherte Einstellungen

API und Abo erhalten getrennte Einstellungsplätze. Beim Wechsel zwischen Ollama, LM Studio und anderen lokalen Anbietern bleibt jeder Anbieter bei seiner eigenen gespeicherten URL bzw. seinem Standardport.

Profile speichern Verbindungstyp, Anbieter, URL, Modell, Kontext und Modellparameter. Zugangsdaten bleiben separat. Alte Profile ohne Verbindungstyp werden als API-Profil behandelt; Codex und Copilot werden als CLI-Abo behandelt. Alte Copilot-Endpunkte werden bei der Migration nicht mehr als HTTP-Ziel verwendet. Alte Abo-Tokenkopien werden aus Anvils Browser-Speicher entfernt; die Anmeldedaten der installierten CLIs bleiben bei den CLIs.

Anvil Desktop speichert API-Schlüssel, GitHub-Token, Companion-Token und Tresoreinträge verschlüsselt über die Betriebssystem-Funktionen von Electron. Die bisherige Browser-Kopie wird erst nach bestätigter verschlüsselter Speicherung entfernt. Ist der Betriebssystem-Schlüsselspeicher nicht verfügbar, zeigt Anvil das unter dem API-Key an; neue Schlüssel bleiben dann nur für die Sitzung im Arbeitsspeicher. Eine vorhandene, nicht entschlüsselbare Datei wird erhalten. Im Browserbetrieb bleibt die separate Browser-Ablage bestehen. Details zur Migration und ihren Grenzen stehen unter [Optimierungen](06-optimierungen.md).

## Entwicklung und Prüfung

Die Regressionstests liegen bei `electron/cli-runner.test.mjs`, `electron/llm-pipe.test.mjs`, `src/lib/connection.test.ts` und `scripts/connection-state.test.mjs`. Sie prüfen echte Unterprozesse und HTTP-Streams mit lokalen Testservern sowie die tatsächlichen Einstellungsfunktionen. Sie benötigen keine persönlichen Zugangsdaten und erzeugen keine kostenpflichtigen Modellanfragen.

Die neue CLI-Erweiterung wird zusätzlich durch `scripts/cli-stream.test.mjs`, `scripts/cli-client.test.mjs` und `scripts/cli-run-frame.test.mjs` geprüft: getrennte Bilddaten, Ausgabe vor Abschluss, keine Werkzeugargumente im sichtbaren Antwortstrom, Abbruch, spätere Ereignisse, unbekannte Werkzeuge und eine widersprüchliche Endantwort. Claude Code und Copilot wurden für diesen Ausbau anhand ihrer offiziellen Schnittstellen und mit isolierten Protokoll-Fixtures geprüft. Eine echte Anmeldung und Modellanfrage dieser beiden Anbieter wurde dabei nicht durchgeführt.

Ein separater echter Codex-Aufruf mit `gpt-5.6-terra` und Thinking Low erkannte die dominante Farbe eines neu erzeugten roten Testbildes korrekt. Die erste dekodierte Textausgabe traf nach 3.400 ms ein, der Aufruf endete nach 3.647 ms; gestreamter Text und Endantwort stimmten überein, ohne Werkzeugaufruf. Nachweis: `artifacts/cli-live-smoke-result.json`. Das belegt Bildübertragung und Teilantworten für diesen Aufruf, keine allgemeine Laufzeit- oder Qualitätszusage für alle Modelle.

```sh
npm run test:connections
npm run typecheck
npm run build
```

Ein erfolgreicher Test mit simulierten CLI-Antworten bestätigt den Adaptervertrag. Anmeldung, Abo-Berechtigung und die konkrete installierte CLI-Version müssen zusätzlich auf dem Zielrechner funktionieren.
