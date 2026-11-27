# Den Ausgang einer Unterbrechung prüfen

| Letzter bekannter Schritt | Geeigneter Nachweis vor dem Weiterarbeiten |
| --- | --- |
| Datei gespeichert | Aktuellen Inhalt lesen und mit der gewünschten Änderung abgleichen; unabhängige spätere Änderungen erhalten. |
| Test gestartet | Tatsächlichen Endzustand und vorhandene Ausgabe auswerten. Ein alter erfolgreicher Lauf gilt nur für seinen Dateistand. |
| Externes Objekt erstellt | Über einen passenden Leseaufruf nach dem erwarteten Objekt suchen, vorhandene Kennung verwenden. |
| CAD-Dokument geändert | Dokument und Objekte in der Anwendung neu abfragen, Änderungen und Speicherziel prüfen. Die Anvil-Projektrücksetzung setzt das fremde Dokument nicht automatisch zurück. |
| Neues Ziel genannt | Den aktuellen Nutzerauftrag übernehmen; frühere Restarbeit nicht als zusätzliches Ziel hineinmischen. |

Ein konkreter Wiederaufnahmetest kann eine Dateiänderung, eine bestätigte externe Aktion und einen offenen Prüfschritt enthalten. Nach einer Unterbrechung muss die Datei erhalten bleiben, die bestätigte Aktion genau einmal vorkommen und nur der offene Schritt weiterbearbeitet werden. Eine künstliche Zeitüberschreitung beweist nicht, dass ein echter Dienst die Anfrage abgebrochen hat.

Wenn der gespeicherte Stand keine verlässliche Entscheidung zulässt, ist eine präzise offene Angabe besser als ein neuer Schreibversuch. Prüfergebnis und Auftragsfortschritt sind verschiedene Dinge: Ein erfolgreich wieder aufgenommenes Verfahren kann weiterhin einen fachlichen Fehler finden.
