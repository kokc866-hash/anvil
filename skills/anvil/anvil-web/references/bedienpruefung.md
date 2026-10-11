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

Eine Vorschauaufnahme kann fehlende Inhalte, Überlappungen oder schlechte Lesbarkeit zeigen. Sie bestätigt keine Funktion, die noch nicht ausgelöst wurde. Ein sauberer DOM- oder Konsolencheck ist ebenfalls kein Bediennachweis.

`play` bietet die dokumentierten Tasten für die HTML-Vorschau. Eine Schaltfläche, die damit nicht erreichbar ist, kann nicht als angeklickt gelten. Wenn eine zusätzliche Browser- oder MCP-Anbindung vorhanden ist, ihren Katalog und ihre tatsächlichen Möglichkeiten zuerst prüfen.

Externe Ressourcen können von Anvils Vorschau blockiert sein. Diese Einschränkung in der Auswertung nennen; keine Erfolgsaussage auf Inhalte stützen, die nicht geladen wurden. Eine lokale Alternative nur einbauen, wenn sie den Nutzerauftrag erfüllt.

Keine globale `Anvil.run`- oder ähnliche API voraussetzen. Im Code nach der tatsächlich definierten Schnittstelle suchen. Fehlende Projekt-APIs gezielt behandeln, statt eine leere Attrappe einzuführen, die nur den Fehler verschwinden lässt.
