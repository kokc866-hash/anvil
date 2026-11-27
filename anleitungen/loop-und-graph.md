# Loop, Graph und Ablaufvorlagen

Der Loop führt einen Agentenauftrag durch seine Arbeitsschritte. Der Graph beschreibt, welche Prüfung auf eine Änderung oder ein bestätigtes Ergebnis folgen soll. In der Tafel kannst du diese Verbindungen ansehen und bearbeiten.

## Einen Ablauf ergänzen

1. Öffne die **Tafel** über die Graph-Anzeige im Chat oder die Befehlssuche.
2. Wähle rechts eine **Ablaufvorlage** und ihr **Projektziel**.
3. Klicke auf **Vorlage ergänzen** und anschließend auf **Speichern**.

Vorlagen ergänzen den vorhandenen Ablauf. Bestehende Einstellungen, ausgeschaltete Verbindungen und getrennte Knoten bleiben erhalten. Eine Vorlage aktiviert keine Ausführungsberechtigung und schaltet den Hintergrundbetrieb nicht ein.

| Vorlage | Ablauf |
| --- | --- |
| Code und Tests | Die ausgewählte Programmdatei ausführen, vorhandene Testdateien prüfen und anschließend die Änderungen ansehen. Fehlen Tests, weist die Vorlage darauf hin. |
| HTML-Vorschau | Die ausgewählte HTML-Datei laden und eine Aufnahme prüfen. Eine bereits vorhandene Aufnahme wird wiederverwendet. Die gezielte Bedienung bleibt ein ausdrücklicher Werkzeugaufruf. |
| Engine-Prüfung | Ein ausgewähltes Engine-Projekt mit dem verfügbaren Prüfwerkzeug prüfen. Die tatsächliche Szene anschließend gezielt testen. Fehlende Prüfwege werden nicht als bestanden angezeigt. |

Bei mehreren Engine-Projekten musst du das Ziel auswählen. Die Voraussetzungen bleiben dieselben wie bei einem normalen Agentenauftrag: eingerichtete Programme, freigegebene Werkzeuge und die gewählten Loop-Einstellungen.

## Verbindungen und Auslöser

Die Beschreibung einer Verbindung erklärt ihren Zweck. Der **Auslöser** bestimmt ihre Bedingung: nach einer Dateiänderung, einer erfolgreichen Ausführung, einer fehlgeschlagenen Prüfung oder bestandenen Tests. **Nur auf Auftrag des Agenten** verlangt einen ausdrücklichen Werkzeugaufruf.

Phase und Vorgänger gehören zum Ablauf. Eine abhängige Prüfung wartet auf aktuelle, bestätigte Vorgänger. Deaktivierte und getrennte Knoten werden nicht ausgeführt. Dienstaktionen, Git-Schreibzugriffe, eigene Shell-Befehle und interaktive Aktionen werden durch eine Projektvorlage nicht automatisch freigegeben.

## Ergebnisse verstehen

In der Tafel zeigt **Aktueller Auftrag** die gesicherten Prüfzustände und ihre Gründe.

| Anzeige | Bedeutung |
| --- | --- |
| Bestätigt | Die Prüfung ist für den erfassten Dateistand abgeschlossen. |
| Wartet auf Nachweis | Ein Ergebnis oder ein notwendiger Vorgänger ist noch unbestätigt. Ein gestarteter Prozess genügt nicht als Prüfergebnis. |
| Erneut prüfen | Relevante Dateien oder Ablaufregeln haben sich seit der Prüfung geändert. |
| Fehlgeschlagen | Das Werkzeug hat einen Fehler gemeldet oder eine Prüfung ist fehlgeschlagen. |
| Nicht verfügbar | Für die vorgesehene automatische Prüfung fehlt ein verfügbarer oder freigegebener Prüfweg. Der Grund steht daneben. |

Lesen unveränderter Dateien startet keine erneute Prüfung. Änderungen an Code, ausführbaren Skills, Konfiguration und Assets entwerten ältere Nachweise. Reine Dokumentationsänderungen tun das normalerweise nicht. Dokumente, deren Pfad im Programm ausdrücklich als Eingabe vorkommt, werden ebenfalls berücksichtigt. Dynamisch zusammengesetzte Dateipfade müssen bei Bedarf zusätzlich geprüft werden.

Das Starten eines Engine-Editors bestätigt den Start. Es bestätigt weder bestandene Tests noch das richtige Verhalten einer Szene. Ein Bild zeigt einen sichtbaren Zustand; erst gezielte Bedienung prüft eine Funktion.

## Unterbrechung und Wiederaufnahme

Anvil speichert Ablaufzustand und Werkzeugprotokoll vor Werkzeugaktionen und nach deren Rückmeldung. Vordergrund- und Hintergrundbetrieb verwenden dieselbe Ablaufverwaltung. Bei einer kontrollierten Wiederaufnahme bleiben Nachweiskennungen und bestätigte Ergebnisse erhalten, solange sie zum aktuellen Dateistand passen.

Ist der Ausgang einer externen Aktion nach einem Abbruch unklar, wird sie nicht automatisch wiederholt. Prüfe zuerst den Dienst oder das Werkzeugprotokoll. Das gilt besonders für Aktionen, die Einträge erstellen, Änderungen übertragen oder andere externe Wirkungen haben. Das Zurücknehmen eines Projekts nimmt solche Wirkungen nicht automatisch zurück.

Eine lokale Stoppmeldung bestätigt den Abbruch auf der Anvil-Seite. Sie belegt keine serverinterne Abbruchbestätigung eines Netzwerkmodells.
