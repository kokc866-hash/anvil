# Bedienung statt nur Darstellung prüfen

Wähle Fälle, die die geänderte Oberfläche tatsächlich unterscheiden.

| Bereich | Konkrete Prüfung |
| --- | --- |
| Formular | Gültige Eingabe, relevantes ungültiges Feld, sichtbares Ergebnis nach Senden |
| Auswahl oder Filter | Änderung wählen und prüfen, ob sich die richtigen Inhalte ändern |
| Dialog | Öffnen, erreichbare Aktionen, Schließen und Rückkehr zum sinnvollen Fokus |
| Langer Text | Sichtbarkeit, Umbruch, Scrollen und Zugriff auf Bedienelemente |
| Speicherung | Vereinbarter Schreib-/Leseweg; nach Neuladen bleibt nur ausdrücklich gespeicherter Zustand |
| Responsives Layout | Relevante schmale und breite Ansicht ohne verdeckte Kernfunktion |
| Tastatur | Benötigte Elemente in sinnvoller Reihenfolge erreichen, bedienen und den Fokus nach Schließen zurückfinden |
| Beschriftung und Fehler | Zweck der Aktion erkennen, ein betroffenes Feld benennen und einen sinnvollen nächsten Schritt verstehen |
| Status und Tooltip | Wichtige Informationen ohne Überdeckung erreichen; Fokus und sichtbare Rückmeldung auch ohne dauerndes Überfahren erhalten |

Eine Vorschauaufnahme kann fehlende Inhalte, Überlappungen oder schlechte Lesbarkeit zeigen. Sie bestätigt keine Funktion, die noch nicht ausgelöst wurde. Ein sauberer DOM- oder Konsolencheck ist ebenfalls kein Bediennachweis.

Für einen gezielten Formularfall gültige Eingaben absenden und das tatsächliche Ergebnis prüfen. Anschließend eine wichtige ungültige Eingabe senden: Die verständliche Meldung muss zum betroffenen Feld führen und bereits eingegebene Daten sollen im vorgesehenen Umfang erhalten bleiben. Den erwarteten Fehler nicht durch automatisches Entfernen der Validierung „beheben“.

`play` bietet Tastatur, Maus und expliziten Text in der HTML-Vorschau. Ein Beispiel ist `actions:[{type:"click",selector:"#speichern"},{type:"assert",selector:"#status",text:"Gespeichert"}]`. Selektoren und Feldwerte aus der aktuellen Vorschau lesen; kein unsichtbares oder mehrdeutiges Ziel als bedient ausgeben. Für Code- und Speicherlogik zusätzlich passende Tests verwenden. Wenn eine weitere Browser- oder MCP-Anbindung benötigt wird, zuerst ihren Katalog und ihre tatsächlichen Möglichkeiten prüfen.

Externe Ressourcen können von Anvils Vorschau blockiert sein. Diese Einschränkung in der Auswertung nennen; keine Erfolgsaussage auf Inhalte stützen, die nicht geladen wurden. Eine lokale Alternative nur einbauen, wenn sie den Nutzerauftrag erfüllt.

Keine globale `Anvil.run`- oder ähnliche API voraussetzen. Im Code nach der tatsächlich definierten Schnittstelle suchen. Fehlende Projekt-APIs gezielt behandeln, statt eine leere Attrappe einzuführen, die nur den Fehler verschwinden lässt.
