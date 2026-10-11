# Blender speichern und exportieren

## Vorhandene Daten

Szene und Ziel vor schreibenden Aktionen lesen. Eine neue Aufgabe erlaubt nicht pauschal das Löschen aller Blender-Objekte. Prüfe, ob das gewählte Dokument weitere Szenen, Sammlungen oder bereits bearbeitete Objekte enthält.

Bei einem bestehenden Dokument eine geeignete Sicherung nur im dafür erforderlichen Umfang anlegen. Die Speicherung muss innerhalb des vereinbarten Ziels erfolgen. Eine Erfolgsmeldung ohne tatsächlichen Dateinachweis lässt die Speicherung offen.

## Beispiel: GLB für eine Engine

Wenn GLB Teil des Auftrags ist, das gewünschte Objektset, aktive Szene, Abmessungen, Transformationen und Materialzuweisungen prüfen. Auswahl und aktive Szene sind verschiedene Filter. Bei unterstützten Blender-Versionen können `use_selection` und `use_active_scene` gemeinsam den Export eingrenzen; Parameter im verfügbaren Werkzeug beziehungsweise der passenden Blender-API prüfen.

Lies den Export erneut in eine getrennte Szene oder einen gesonderten Prüfablauf ein, wenn dies mit den verfügbaren Werkzeugen und dem Auftrag möglich ist. Vergleiche die erwarteten Grenzabmessungen und Materialien. Eine importierte Datei bestätigt nicht automatisch, dass das Zielspiel sie korrekt rendert oder nutzt.

## Version und Sprache

Bei Nodes nach stabilen Typen wie `bl_idname` und passenden RNA-Eigenschaften suchen. Lokalisierte Namen wie „Hintergrund“ oder „Background“ nicht als unveränderliche Kennung voraussetzen. Für unbekannte Operatorparameter verfügbare API-Auskunft prüfen.

## Verbindung und Grenzen

MCP-for-Blender verbindet einen externen Server mit einem Addon in Blender. Der Verbindungsstatus ist getrennt von der Modellprüfung. Installation, zusätzliche Asset-Dienste und mögliche Generierungskosten gehören nicht automatisch zu einem Modellierungsauftrag.

Primärquelle für die Brücke: [MCP-for-Blender](https://github.com/ahujasid/mcp-for-blender). Für versionsabhängige Exportdetails die Dokumentation der tatsächlich verwendeten Blender-Version heranziehen.
