# Fehlerbehebung mit überprüfbarer Ursache

## Einen aussagekräftigen Ausgangsfall herstellen

Notiere Auslöser, erwartetes Ergebnis, tatsächliches Ergebnis und den betroffenen Dateistand. Suche den kleinsten Fall, der denselben Fehler zeigt. Ein anderer Importfehler oder ein Test im falschen Programm ist keine Reproduktion. Wenn Ausführung nicht verfügbar ist, statische Befunde und die noch fehlende Laufprüfung getrennt berichten.

Vor einer Änderung eine überprüfbare Vermutung formulieren: Welcher Datenfluss oder Zustandswechsel erklärt den Fehler, und welche Beobachtung würde diese Erklärung widerlegen? Nur die dazu nötige Stelle ändern. Danach den ursprünglichen Fall und einen benachbarten gültigen Fall prüfen. Bereits vorhandene, unabhängige Änderungen erhalten.

## Reparaturschleifen verhindern

Ein neuer Versuch braucht eine geänderte Hypothese, neue Ausgabe oder einen anderen begründeten Prüfweg. Notiere bei Bedarf eine kurze Tabelle: Vermutung – Beobachtung – Folgerung. Bei identischem Aufruf und unveränderter Ausgabe nicht erneut auf denselben Erfolg hoffen. Zuerst Laufzeit, tatsächliche Eingaben, Werkzeugantwort und Projektzuordnung prüfen.

Lange aktive Modellberechnung ist keine nachgewiesene Wiederholungsschleife. Ein Timeout eines Dienstes bedeutet nicht, dass dessen Aktion sicher nie ausgeführt wurde. Bei unklarem Schreibausgang den tatsächlichen Zustand zunächst lesen; keinen zweiten Schreibaufruf auf Verdacht starten.

## Den Auftrag erhalten

Eine Diagnosefrage bleibt lesend. Bei einem ausdrücklich absichtlichen Negativtest den tatsächlichen Fehler nachweisen und nicht ungefragt reparieren. Tests und Erwartungen nicht schwächen, um einen unerwarteten Fehler grün erscheinen zu lassen. Weder zusätzliche Freigabephasen noch pauschales Verwerfen bestehender Implementierung aus fremden Arbeitsweisen übernehmen.

## Ergebnis

Ursache, Korrektur, geprüfter Dateistand und tatsächliche Prüfausgabe nennen. Ein grüner Teiltest ist ein Teilnachweis. Kein vollständiges Funktionieren aus erfolgreichem Start, gespeicherter Datei oder eigener Abschlussbehauptung ableiten.
