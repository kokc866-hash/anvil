# Live-Test der Dienstverbindungen

Datum: 12. September 2026. Prüfung direkt in der laufenden lokalen Anvil-Desktop-App unter Erweiterungen → Dienste → Werkzeug selbst ausführen. Persönliche Zugangsdaten wurden nicht ausgelesen oder exportiert.

| Dienst | Tatsächlicher Werkzeugaufruf | Ergebnis |
| --- | --- | --- |
| Notion | `notion-fetch` mit `{"id":"self"}` | Erfolgreiche Antwort des offiziellen Notion-MCP-Servers; verbundener Workspace, Benutzer und werkzeugspezifischer Zugriffsstatus vorhanden; `isError: false`. |
| Linear | `list_issues` mit `{"limit":3,"fields":["id","title","status"]}` | Drei tatsächliche Aufgaben mit Kennung, Titel und Status zurückgegeben; weitere Ergebnisse vorhanden; `isError: false`. |

Die Kataloge enthielten 43 Notion- und 65 Linear-Werkzeuge. Der Test prüfte echte Aufrufe über Anvils vorhandene Verbindung, nicht nur die Anzeige der Kataloge. Es wurden keine Inhalte erstellt, geändert oder gelöscht und keine Werkzeugfreigaben verändert.

Notion meldet Unterschiede zwischen sichtbaren Werkzeugen und tatsächlich verfügbarem Zugriff: unter anderem `ai_search` und `query_meeting_notes` mit `plan_required`, `download_skill` mit `not_enabled`, `query_multiple_data_sources` mit `full_version_required` und `query_data_sources` mit `available_with_limit`. Eine Freigabe in Anvil hebt Anbieterbeschränkungen nicht auf.

Geprüfter Umfang: authentifizierte Leseaufrufe beider Dienste. Nicht geprüft: sämtliche angebotenen Werkzeuge, Schreibaktionen, langfristige Token-Erneuerung und selbstständige Werkzeugauswahl des Modells. Die detaillierten Antworten blieben in Anvil; dieser Bericht enthält keine Kontokennungen, E-Mail-Adressen oder Zugangsdaten.

Beobachtung zur Bedienung: Bei der manuellen Werkzeugausführung bleibt die vollständige Beschreibung offen und kann das Eingabeformular weit nach unten schieben. Die kompakte Auswahlansicht funktioniert; das separate Ausführungsformular kann entsprechend vereinfacht werden.
