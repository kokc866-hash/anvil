# Aussagekräftige Testfälle

## Beispiel: Fälligkeitssortierung

Die Aufgabe ergänzt eine Sortierung nach Fälligkeit. Ein geeigneter Test erstellt mehrere künstliche Einträge mit unterschiedlicher Fälligkeit und mindestens einen Eintrag ohne Datum. Das erwartete Verhalten für fehlende Termine aus dem Auftrag oder vorhandener Konvention ableiten.

Prüfe die tatsächliche Ausgabe des öffentlichen Sortierwegs. Berechne das erwartete Ergebnis nicht mit demselben Sortierausdruck wie die Implementierung. Bei einer Oberfläche zusätzlich prüfen, ob die ausgewählte Sortierung den angezeigten Zustand verändert; der Unit-Test der Hilfsfunktion bestätigt diese Verbindung nicht.

## Auswertung

- Ein erfolgreicher Test bestätigt seine Assertions für den getesteten Stand.
- Übersprungene Tests nennen und nicht als bestandene Fälle zählen.
- Null ausgeführte Tests belegen keine gewünschte Funktion.
- Ein Prozess ohne ermittelbaren Exitcode darf keinen erwarteten negativen Exitcode bestätigen.
- Ein Fehler in der Testumgebung getrennt von einer fehlgeschlagenen fachlichen Assertion ausweisen.

Bei einer negativen Eingabe meistens das erwartete Ergebnis oder die erwartete Fehlermeldung im Test prüfen. Ein global erwarteter Fehlercode kann mehrere verschiedene Ursachen verdecken.

Ein absichtlich fehlerhafter Prüfgegenstand bleibt erhalten, wenn der Nutzer gerade die Ablehnung testen möchte. Beispielsweise muss ein ungültiger JSON-Import das erwartete Fehlerergebnis liefern und vorhandene Nutzdaten erhalten. Den Importinhalt ungefragt zu korrigieren würde den Testgegenstand beseitigen. Ein Fehler in der tatsächlichen Importprüfung ist davon zu unterscheiden.

## Den Prüfeinstieg wählen

Ein Browsermodul mit DOM-Zugriff wird über den zugehörigen HTML- oder Framework-Einstieg geprüft. Ein Node-Fehler wegen `document` bestätigt nur, dass der direkte Node-Start nicht zu diesem Modul passt. Ein Konsolenprogramm und seine Tests haben ebenfalls eigene Einstiege. Für eine reine Berechnungsänderung kann ein öffentlicher, DOM-unabhängiger Funktionsweg gezielt geprüft werden; das ersetzt nicht den vollständigen Browsertest.

## Passender Umfang

Ein kleiner Text- oder Formatierungseingriff braucht nicht automatisch eine neue Testsuite. Bei Datenverlust, Wiederholung externer Aktionen oder Wiederaufnahme von Aufträgen sind dagegen Zustands- und Nebenwirkungsprüfungen wesentlich.

Für Dienste ein separates Testobjekt nur erstellen, wenn die dafür notwendigen Änderungen im Auftrag liegen. Gespeicherte Kontozugänge erlauben keinen beliebigen Test gegen echte Nutzerdaten. Externe Ergebnisse und ihre Aufräumaktionen getrennt dokumentieren.
