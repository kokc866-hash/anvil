# Fehler einordnen

Die Ausgaben sind der Ausgangspunkt; dieselbe kurze Meldung kann verschiedene Ursachen haben.

| Befund | Nächste sinnvolle Untersuchung |
| --- | --- |
| Programm nicht gefunden | Verwendete Laufzeit oder Engine und ihre Anvil-Verfügbarkeit prüfen |
| Fehlende Abhängigkeit | Manifest, tatsächlich vorhandene Installation und Startweg lesen |
| Syntax- oder Typfehler | Angegebene Datei, Zeile und relevante Aufrufer untersuchen |
| Prozess abgebrochen oder Zeitlimit erreicht | Abbruchursache und tatsächlichen Prozesszustand unterscheiden |
| Werkzeug verweigert | Vorhandene Freigabe und unterstützte Aktion prüfen; nicht umgehen |
| Dienstfehler nach Schreibaufruf | Zustand lesend prüfen, bevor die Änderung erneut gesendet wird |
| Anwendung läuft, Ergebnis ist falsch | Konkreten Zustand und den Weg zur Ergebnisberechnung verfolgen |

„Programm nicht gefunden“ ist kein Fehler der Fachlogik. Ein eigener Codeeingriff kann die fehlende Installation nicht zuverlässig ersetzen. Ebenso ist ein ausdrücklich abgebrochener Test kein fehlgeschlagener Funktionstest.

Bei einer Reproduktion notieren, welche Eingabe und welcher Stand den Fehler auslösen. Danach nur eine begründete Ursache verfolgen oder die Hypothese ausdrücklich verwerfen. Mehrfaches Lesen einer unveränderten Datei ohne neue Frage liefert keinen zusätzlichen Nachweis.

Eine Regression ist belegt, wenn derselbe nachvollziehbare Fall vor der Reparatur fehlschlägt und am korrigierten Stand erfolgreich geprüft wurde. Fehlt ein ausgeführter Vorher-Fall, kann die Ursache dennoch aus dem Code begründet sein; diese Beleglage muss in der Erklärung erhalten bleiben.

Ein lokales Modell kann einen Erfolg behaupten, obwohl ein Werkzeug einen Fehler meldet. Maßgeblich sind Werkzeugausgabe, beobachtetes Verhalten und aktuelle Dateien.
