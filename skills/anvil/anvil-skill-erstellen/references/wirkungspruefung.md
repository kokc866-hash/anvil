# Einen Skill an tatsächlichen Aufgaben beurteilen

Beschreibe zuerst beobachtbare Zielergebnisse und klare Nicht-Anwendungsfälle. Ein präziser Trigger hilft mehr als eine lange Liste allgemeiner Schlagwörter. Die Hauptanleitung kurz halten und fachliche Details mit skill_read aus dem eigenen Ressourcenordner nachladen.

Wähle mindestens einen passenden Auftrag, einen ähnlich formulierten unpassenden Auftrag und einen Fall mit fehlender Voraussetzung. Beispiele: FreeCAD-Messung statt beliebiger UI-Änderung; Aufgabenabhängigkeiten statt automatischem Paketupdate; ein fehlender Dienst darf nicht als erfolgreiche Konstruktion erscheinen. Fehlende Voraussetzungen konkret benennen und den restlichen möglichen Auftrag fortführen, ohne eine neue Bestätigungsoberfläche zu verlangen.

Für einen beauftragten Modellvergleich dieselben künstlichen Eingaben, Projektstände, Anbieter, Modellparameter und Grenzen verwenden. Einen Durchlauf ohne Skill mit einem passenden Durchlauf mit Skill vergleichen. Den tatsächlich ausgewählten Zugang verwenden; kein Claude-CLI, keine fremden Hostkommandos und keinen separaten Modellserver voraussetzen.

Bewerte überprüfte Dateiergebnisse, Verhaltenstests, überflüssige Wiederholungen, Werkzeugfehler und den tatsächlich bekannten Kontextverbrauch. Aktive langsame Berechnung darf länger dauern; ein reproduziertes wiederholtes Fehlverhalten ist ein anderer Befund. Zeit, Kosten und Nebenwirkungen nur innerhalb des erteilten Testumfangs aufwenden.

Statische Format-/Referenzprüfung und ein Modellurteil sind keine unabhängige Funktionsprüfung. skill_outcome bleibt eine Rückmeldung. Bei fehlendem echten Test nicht behaupten, Erfolgsquote, GPU-Verhalten oder Dienstzuverlässigkeit verbessert zu haben. Ergebnis und Grenzen beim geprüften Skill-Stand festhalten.
