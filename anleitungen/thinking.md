# Thinking in Anvil

Recherche und Abgleich: 12. September 2026; Qwen AI und DeepSeek am 11. Oktober 2026 ergänzt. Unter **Einstellungen → Agent → Denkaufwand** lässt sich der Denkaufwand für die gewählte Verbindung einstellen. Die Auswahl gilt pro Verbindung und wird in Profilen und Sicherungen gespeichert.

**Auto** überlässt die Denkstufe der CLI beziehungsweise dem Modell. **Aus** erscheint nur bei Modellen, die Abschalten unterstützen. Ist eine gespeicherte Stufe beim Modellwechsel nicht verfügbar, zeigt Anvil den Hinweis und verwendet Auto; die gespeicherte Auswahl bleibt erhalten. Unbekannte Modelle verwenden ihre Vorgabe. Lokale Anbieter bieten Aus/Auto/Low/Mid/High.

## CLI-Verbindungen

| Verbindung | Übertragung pro Anfrage | Modellabhängige Grenzen |
| --- | --- | --- |
| Codex | `-c model_reasoning_effort="…"` | GPT-5.6 und GPT-6 Astra: Low bis Max; GPT-5.5 bis XHigh. Die CLI-Modellmetadaten bieten hier kein Aus. |
| Claude Code | `--effort …`, bei Aus zusätzlich Sitzungseinstellung und `MAX_THINKING_TOKENS=0` | Fable 5, Opus 5, Sonnet 5 und Opus 4.7/4.8 bis Max einschließlich XHigh; Opus/Sonnet 4.6 ohne XHigh. Fable lässt sich nicht abschalten. |
| Ältere Claude-Code-Modelle | `MAX_THINKING_TOKENS` nur für den Kindprozess | Low/Mid/High entsprechen Budgets von 2.048/8.192/32.768 Tokens; Aus entspricht 0. Kein nicht unterstütztes Effort-Flag. |
| Copilot | `--effort=…` | Die CLI unterstützt Low/Mid/High/XHigh/Max; Anvil begrenzt diese anhand des gewählten Modells. Kein Aus-Flag. |

Quellen: [Codex-Konfiguration](https://developers.openai.com/codex/config-reference/), [Claude Code: Modellkonfiguration](https://code.claude.com/docs/en/model-config), [Copilot: Befehlsreferenz](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference). Zusätzlich wurden die installierte Codex-CLI und ihre Modellmetadaten geprüft; der Konfigurationsparser akzeptiert Max. Die allgemeine Codex-Referenz führt derzeit noch eine kürzere Werteliste auf. Anvils Auswahl enthält keine zusätzlichen Orchestrierungsmodi wie Ultra/Ultracode.

CLI-Anmeldung, Werkzeugbeschränkungen, Temperatur und Antwortlimit bleiben beim bisherigen Verhalten. Thinking-Overrides verändern keine globalen CLI-Konfigurationsdateien.

## Cloud-Verbindungen

| Anbieter | Thinking-Parameter | Besonderheiten |
| --- | --- | --- |
| OpenAI / Azure | Chat: `reasoning_effort`; Responses: `reasoning.effort` | Aus wird als `none` gesendet, soweit unterstützt. GPT-6 Astra benötigt mindestens Low; GPT-5.6 unterstützt Max, GPT-5.5 maximal XHigh. Azure benötigt eine erkennbare Modell-ID. |
| Anthropic | Neuere Modelle: `thinking.type="adaptive"` und `output_config.effort`; ältere: `thinking.type="enabled"` und `budget_tokens` | Fable/Mythos erlauben kein Abschalten. Neue Modelle lehnen die alte Budget-Variante ab. |
| Gemini | `reasoning_effort` am OpenAI-kompatiblen Endpunkt | Gemini 2.5 Flash erlaubt `none`; 2.5 Pro und Gemini 3 erlauben kein Abschalten. Minimal/Low/Mid/High werden nach Googles Tabelle übersetzt. |
| OpenRouter | `reasoning.effort` | Bekannte Modellfamilien verwenden ihre passenden Stufen. Dynamische Router und unbekannte Modelle bleiben auf Auto. |
| xAI | `reasoning_effort` | Grok 4.5: Low/Mid/High; Grok 4.6 zusätzlich XHigh; beide ohne Aus. |
| Qwen AI | Qwen 3.8: `enable_thinking` und `reasoning_effort`; ältere unterstützte Modelle: `thinking_budget` | 3.8: Aus/Auto/Niedrig/Mittel/Sehr hoch; reine Thinking-Modelle ohne Aus. Effort und Budget werden nicht gleichzeitig gesendet. Unbekannte Modelle bleiben auf Auto. |
| DeepSeek Flash / V4 | `thinking.type` und `reasoning_effort` | Aus/Auto/Low/High/Max. Mid und XHigh wären nur Umleitungen auf High und werden deshalb nicht angeboten. |

Quellen: [OpenAI: Reasoning](https://developers.openai.com/api/docs/guides/reasoning), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [Claude: Effort](https://platform.claude.com/docs/en/build-with-claude/effort), [Claude: Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), [Claude: alte Budgets](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), [Gemini: OpenAI-Kompatibilität](https://ai.google.dev/gemini-api/docs/openai), [OpenRouter: Reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [xAI: Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning), [DeepSeek: Thinking](https://api-docs.deepseek.com/guides/thinking_mode/).

Die dynamischen Modelllisten, API-Einrichtung und Übermittlung der Denk-Daten bei Werkzeugaufrufen für Qwen und DeepSeek sind unter [Qwen AI und DeepSeek](qwen-und-deepseek.md) beschrieben. Die Bedeutung des Ausgabelimits hängt vom Anbieter ab; Qwen trennt bei einigen Modellen Antwortlänge und Denkbudget. Das bestehende Antwortlimit bleibt wirksam.

## Lokale Modelle und KI Studio

Ollama erhält sein Ausgabelimit als `options.num_predict`. Lokale OpenAI-kompatible Verbindungen, einschließlich **Custom**, senden zusätzlich ein wirksames Limit auf oberster Ebene, etwa `max_tokens`. Bei direktem llama.cpp heißt das Denkbudget `reasoning_budget_tokens`. KI Studio übersetzt die älteren Anvil-Felder in die zum aktiven Backend passenden Parameter. Ein ausdrücklich gesetztes Antwortlimit wird nicht durch die Denkstufe vergrößert. Muss Anvil die Anfrage an sein Kontextbudget anpassen, bleibt das gesendete Denkbudget innerhalb des gesendeten Ausgabelimits; die gespeicherte Einstellung bleibt erhalten.

Bei lokalen Modellen steuern Low/Mid/High das Denkbudget. Ob die Modellvorlage zusätzlich benannte native Effort-Werte unterstützt, ist davon unabhängig. Anvil erzwingt deshalb nicht allein wegen der Auswahl „High“ einen nativen `reasoning_effort=high`. KI Studio prüft ausdrücklich angeforderte native Werte gegen die aktive Vorlage, bevor eine Generierung startet.

Das angeforderte Kontextbudget ist keine Bestätigung des vom Server tatsächlich zugeteilten Modellfensters. Servereinstellungen und GPU-Zuordnung bleiben beim Betreiber.

Der Schleifenschutz prüft ausschließlich Denktext: mindestens fünf unmittelbar aufeinanderfolgende, exakt gleiche Abschnitte mit zusammen mindestens 4.096 Zeichen. Eine langsame Antwort oder eine lange Folge neuer Gedanken löst ihn nicht aus. Sichtbare Antworten und Werkzeugargumente werden nicht auf solche Denktext-Schleifen geprüft. Der Schutz hält die betroffene Modellantwort an, erhält bisherige Arbeit und führt vorgemerkte Werkzeuge nicht aus. Er startet keine automatische Wiederholung und benötigt kein zusätzliches Bestätigungsfenster. Ein selbst eingestellter harter Stop bleibt unabhängig davon wirksam.

## Lokale Prüfung

Die Regressionstests prüfen CLI-Argumente, Prozessumgebung, Anbieter-Payloads, Profilwechsel und Sicherungen. `node scripts/thinking.browser.mjs` startet eine getrennte Anvil-Testinstanz und prüft die sichtbare Auswahl sowie den Weg vom Agenten über die Desktop-Brücke. Modellantworten werden dort lokal ersetzt; es werden keine kostenpflichtigen Modellanfragen gestellt. Screenshots und Ergebnis liegen unter `artifacts/thinking-qa`.
