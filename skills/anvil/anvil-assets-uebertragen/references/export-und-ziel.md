# Export und Zielverwendung

| Übergang | Zu vergleichen |
| --- | --- |
| Blender nach Engine | Gewählte Objekte/Szene, Grenzabmessungen, Skalierung, Achsen, Materialzuweisungen und tatsächlich referenziertes Zielasset. |
| CAD nach STEP-Verbraucher | Körperanzahl, Gültigkeit, Maße und Einheiten nach erneutem Einlesen. Parametrische Bearbeitbarkeit bleibt im nativen Dokument gesondert erhalten. |
| CAD nach STL-/Netz-Verbraucher | Maße, geschlossene Geometrie, Tessellierungsbedarf und Einschränkung auf ein Netz. Aus einer STL-Datei keine vorhandene Konstruktionshistorie ableiten. |
| Austausch eines vorhandenen Engine-Assets | Bestehende Kennungen und Referenzen, übertragene Daten und zugehörige Szene. Nur dieselbe sichtbare Dateibezeichnung genügt nicht. |

Für einen vereinbarten Test eignet sich ein künstliches Objekt mit unabhängig bekannten Abmessungen und unterschiedlichen Achslängen. Nach Export und Import müssen die Längen in den richtigen Einheiten und die erwartete Orientierung erhalten bleiben. Ein Würfel mit gleichen Seiten erkennt einen Achsentausch schlechter.

Bei einer verlangten Wiederherstellung Quellzustand, Exportdatei und Zielprojekt getrennt sichern und anschließend getrennt prüfen. Ein bereits geöffneter Editor kann noch einen älteren importierten Zustand anzeigen. Die konkrete Aktualisierung über die vorhandene Projektschnittstelle nachweisen.
