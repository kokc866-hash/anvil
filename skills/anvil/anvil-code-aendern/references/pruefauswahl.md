# Prüfungen nach der Änderung wählen

Eine Prüfung soll eine Aussage über die geänderte Funktion liefern. Wähle den kleinsten geeigneten Nachweis und erweitere ihn, wenn betroffene Schnittstellen oder Fehler es erfordern.

| Änderung | Geeigneter Nachweis | Was damit offen bleibt |
| --- | --- | --- |
| Berechnung oder Parser | Bestehende Tests mit normalem Fall und relevantem Randfall | Darstellung und Anbindung an die Anwendung |
| Datenformat oder Speicherung | Schreib-/Lesezyklus mit künstlichen Daten und dem vereinbarten Format | Andere Clients und alte Daten ohne Migrationstest |
| Formular oder Schaltfläche | Betroffene Bedienfolge, sichtbarer Zustand, Fehlerausgabe | Andere Ansichten und nicht bediente Pfade |
| Abbruch oder Wiederaufnahme | Kontrollierter Auftrag, Abbruch, erwarteter Endzustand | Verhalten eines fremden Servers ohne dortigen Nachweis |
| Engine-Szene | Passender Engine-Check und konkrete betroffene Interaktion | Nicht getestete Plattformen und Packaging |

Bei einer neuen Funktion über mehrere Dateien prüfen, ob jede Verbindung tatsächlich benutzt wird. Ein exportierter Helfer ohne Aufrufer oder ein gespeicherter Wert ohne Verbraucher vervollständigt den Ablauf nicht.

Für ein kleines Verhalten, etwa eine Sortierung, genügt häufig ein gezielter Fall mit unterschiedlicher Reihenfolge. Ein zusätzlicher Test, der lediglich denselben Sortierausdruck wiederholt, erhöht die Sicherheit kaum.

Lesende Projektaufträge brauchen keine Ausführung. Ist ein Lauf für eine Aussage erforderlich, kann die geeignete Prüfung als offen beschrieben werden. Bei erlaubter Ausführung Laufzeit, Daten und Nebenwirkungen berücksichtigen; ein Test darf kein echtes Konto verändern, nur weil dieses bereits verbunden ist.

In `set_plan` Prüf- und Ausführungsschritte passend einordnen. Ein Schritt ist erst erfolgreich, wenn ein aktueller Werkzeugnachweis den jeweiligen Inhalt bestätigt. Frühere Ausgaben nur für den dazugehörigen Stand verwenden.
