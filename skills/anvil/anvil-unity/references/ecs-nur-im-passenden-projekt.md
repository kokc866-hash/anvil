# Unity-Komponenten und vorhandene ECS-Projekte

Zuerst Packages/manifest.json, Sperrdatei und betroffene Komponenten lesen. Ein Projekt mit MonoBehaviour wird nicht allein wegen einer allgemeinen ECS-Empfehlung auf DOTS umgebaut. Nur wenn Entities/DOTS tatsächlich vorhanden oder ausdrücklich beauftragt ist, die zum installierten Paket passenden APIs und Testwege verwenden.

Bei ECS-Änderungen Datenkomponenten, Systemabfolge, Abfragen, Lebensdauer und gegebenenfalls Baking getrennt betrachten. Strukturelle Änderungen müssen im passenden Ablauf erfolgen; eine Berechnung mit korrektem Ergebnis kann trotzdem durch einen falschen Update-Zeitpunkt fehlschlagen. Ein vorhandener Burst-/Job-Pfad hat eigene Thread- und Datenzugriffsregeln. Keine neuen Pakete, Compileroptionen oder globalen Engine-Einstellungen aus diesem Skill ableiten.

Für gewöhnliche Komponenten bleiben Serialisierung, Inspector-Zuordnung und Referenzen auf Szenen/Prefabs maßgeblich. Asset und .meta erhalten. Reine Logik durch vorhandene Unit- oder EditMode-Tests prüfen; System-/Szenenverhalten durch passende PlayMode-Fälle. Den tatsächlichen Paket- und Editorstand, ausgeführte Testfälle und offene Plattform-/Performanceprüfungen nennen.

Eine vermutete Optimierung zuerst an der betroffenen Arbeit messen. Nicht aus einem ECS-Umbau automatisch höheren Durchsatz oder kleineren Speicherbedarf behaupten. Bestehende Spielregeln und visuelle Inhalte außerhalb der Aufgabe erhalten.
