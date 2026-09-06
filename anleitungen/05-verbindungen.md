# Verbindungen

Unter **Einstellungen → Agent** den Verbindungstyp wählen.

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

Der Adapter überträgt derzeit Text. Bilder benötigen eine API-Verbindung. Thinking, Temperatur und Antwortlimit werden von der CLI gesteuert; Anvils Kontextbudget gilt für das übergebene Gespräch. Das eingestellte harte Zeitlimit und **Stop** beenden laufende CLI-Prozesse. Antworten werden nach Abschluss des CLI-Aufrufs in Anvil übernommen; CLI-Ausgaben signalisieren währenddessen Aktivität.

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

```sh
npm run test:connections
npm run typecheck
npm run build
```

Ein erfolgreicher Test mit simulierten CLI-Antworten bestätigt den Adaptervertrag. Anmeldung, Abo-Berechtigung und die konkrete installierte CLI-Version müssen zusätzlich auf dem Zielrechner funktionieren.
