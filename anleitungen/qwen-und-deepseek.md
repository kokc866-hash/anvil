# Qwen AI und DeepSeek einrichten

Stand: 11. Oktober 2026, lokaler Entwicklungsstand 1.3.35.

Beide Anbieter stehen unter **Einstellungen → Agent → Cloud**. Anvil verwendet ihre API. Die Anmeldung auf der jeweiligen Chat-Webseite ersetzt keinen API-Schlüssel. Deine lokale Qwen-Verbindung über Ollama bleibt eine eigene Verbindung.

## Qwen AI

1. In Alibaba Cloud Model Studio einen API-Schlüssel erstellen. Die Schaltfläche **Einrichtung beim Anbieter** in Anvil führt zur offiziellen Anleitung.
2. **Qwen AI** auswählen und den Schlüssel unter **API-Schlüssel** eintragen.
3. Die OpenAI-kompatible **API-URL** aus der Model-Studio-Konsole übernehmen. Region, Arbeitsbereich und Schlüssel müssen zusammenpassen. Die URL endet gewöhnlich auf `/compatible-mode/v1`. Das Feld ist absichtlich zunächst leer, weil Anvil deinen Arbeitsbereich nicht kennen kann.
4. **Modellliste aktualisieren** wählen und ein tatsächlich zurückgegebenes Modell auswählen. Im Modellfeld lässt sich suchen oder eine vollständige Modellkennung direkt eintragen.

Anvil fragt den Model-Studio-Katalog an derselben Serveradresse über `/api/v1/models` ab und lädt dessen Folgeseiten. Der Anzeigename wird nicht mit der Modellkennung verwechselt. Soweit geliefert, übernimmt Anvil Kontextgröße und Bildfähigkeit aus den Modellangaben. Der Katalog ist keine feste Liste im Programm.

Für einen **Coding Plan** den dafür vorgesehenen Schlüssel und seine eigene API-URL verwenden, beispielsweise `https://coding-intl.dashscope.aliyuncs.com/v1`. Schlüssel und Adresse nicht mit dem regulären Model-Studio-Zugang mischen. Anvil versucht hier die Modellabfrage über `/models`. Falls dieser Tarif keinen Katalog bereitstellt, bleibt der Fehler sichtbar; die Modellkennung lässt sich aus der Tarifkonsole übernehmen. Anvil wechselt nicht automatisch zu einem anderen Tarif-Endpunkt.

Quellen: [Erster API-Aufruf](https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen), [Modellkatalog](https://www.alibabacloud.com/help/en/model-studio/list-models), [Coding Plan](https://www.alibabacloud.com/help/en/model-studio/coding-plan).

## DeepSeek

1. Im [DeepSeek-API-Portal](https://platform.deepseek.com/) einen API-Schlüssel erstellen.
2. Unter **Cloud → DeepSeek** den Schlüssel eintragen. Anvil verwendet `https://api.deepseek.com/v1`.
3. **Modellliste aktualisieren** wählen und ein Modell aus der Antwort auswählen. Neue Modellkennungen werden ohne Programmänderung übernommen; eine vorhandene Auswahl wird durch die Aktualisierung nicht ersetzt.

Kontextgröße und Bildfähigkeit stammen aus den Angaben des Katalogs, soweit vorhanden. Eine alte gespeicherte Modellkennung bleibt erhalten. Lehnt der Anbieter sie inzwischen ab, wähle nach der Aktualisierung eine verfügbare Kennung.

Quelle: [DeepSeek-Modellkatalog](https://api-docs.deepseek.com/api/list-models/).

## Denkaufwand und Werkzeuge

Die Auswahl unter **Denkaufwand** richtet sich nach der erkannten Modellfamilie. **Auto** überlässt die Vorgabe dem Anbieter; unbekannte Modelle beginnen mit Auto.

Qwen 3.8 verwendet `reasoning_effort`; ältere unterstützte Qwen-Modelle verwenden ein Denkbudget. Anvil sendet beide Verfahren nicht gleichzeitig. Thinking-Modelle erhalten automatische Werkzeugauswahl. DeepSeek verwendet seinen eigenen Thinking-Schalter und die unterstützten Effort-Stufen. Zurückgegebene Denk-Daten bleiben getrennt vom sichtbaren Antworttext und werden bei weiteren Werkzeugrunden wieder übermittelt.

Beide Anbieter funktionieren im bisherigen Agenten und im zuschaltbaren **Hintergrundbetrieb (Test)**. Bestehende Werkzeugfreigaben, Dateiprüfungen und Abbruchregeln gelten weiterhin.

Quellen: [Qwen-Chat-Schnittstelle](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions), [Qwen-Werkzeugaufrufe](https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling), [DeepSeek-Thinking](https://api-docs.deepseek.com/guides/thinking_mode/).

## Was die Verbindungsprüfung bestätigt

Eine erreichbare Modellliste bestätigt den Katalogzugriff. Ob dein Konto das ausgewählte Modell ausführen darf, ob Bilder unterstützt werden und welche Nutzung abgerechnet wird, entscheidet der Anbieter bei der Anfrage. Eine fehlerhafte oder unvollständige Liste wird nicht durch fest eingebaute Modelle ersetzt. Die Schaltfläche fragt den Katalog erneut ab.

Die technische Einbindung wird mit künstlichen Modelllisten, echten lokalen HTTP-Verbindungen, dem Hintergrundprozess und einer getrennten Desktop-Testinstanz geprüft. Eine erfolgreiche kostenpflichtige Modellanfrage bei Qwen oder DeepSeek ist damit nicht nachgewiesen.
