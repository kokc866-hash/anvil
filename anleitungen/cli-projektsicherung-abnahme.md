# CLI und Projektsicherung — lokale Abnahme

13. September 2026. Lokaler Entwicklungsstand nach dem veröffentlichten Release 1.3.26; diese Änderungen sind noch nicht in dessen Downloads enthalten.

## CLI

- Codex, Claude und Copilot: Bildübertragung und laufende Textausgabe implementiert. Anvil prüft die vollständige Antwort und freigegebene Werkzeugnamen weiterhin vor der Ausführung.
- Gezielte Prüfungen für Bildzuordnung, Stream-/Endantwortabgleich, Abbruch, Aufräumen und den einfachen Bildanalyseweg bestanden. Der Chat-Versand erhält Bilder bei allen drei CLI-Verbindungen.
- Ein echter Codex-Aufruf mit einem künstlichen roten Testbild antwortete „Die dominante Farbe ist Rot.“. Erster Text nach 3.400 ms, Abschluss nach 3.647 ms, keine Werkzeugaufrufe. Nachweis: `artifacts/cli-live-smoke-result.json`.
- Claude und Copilot wurden anhand ihrer offiziellen Schnittstellen und isolierter Prozess-/Nachrichten-Fixtures geprüft. Eine Live-Abnahme mit installierten CLIs und echten Konten steht für diese beiden noch aus.

## Projektsicherung

- Native Dateisystemtests für Binärdateien, nicht geladene Dateien, Löschen, Umbenennen, leere Ordner, spätere Änderungen, beschädigte Sicherungen, Verknüpfungen und unterbrochene Wiederherstellung bestanden.
- Integration mit dem tatsächlichen Editorzustand geprüft: vorher speichern, danach sichern, Wiederaufnahme mit gespeicherten Metadaten, bytegetreue Binärdaten im Editor, unveränderte ausgeschlossene Dateien sowie Abbruch bei fehlgeschlagener Sicherung oder Projektwechsel.
- Gebaute Desktop-App mit echten IPC-Aufrufen geprüft: gemeinsame Vorschau, Abbrechen ohne Änderungen, Hinweise zu externen Werkzeugaufrufen, vollständiger Neustart, Konfliktschutz und Wiederherstellung über die Schaltflächen. Screenshots visuell geprüft.
- Nachweise: `artifacts/project-checkpoints-browser/result.json`, `asset-preview.png`, `asset-restored.png` sowie `artifacts/project-checkpoint-integration/final-targeted.log`.

Externe Dienstaktionen und laufende Datenbanktransaktionen werden nicht automatisch zurückgenommen. Ausnahmen und Grenzen stehen im [Editor-Handbuch](editor.md).

## Gesamtprüfung

Typprüfung und Desktop-Produktionsbuild bestanden. Der Markt-Regressionslauf bleibt erfolgreich. In den beiden Blöcken der vollständigen Testsammlung bestanden 462 beziehungsweise 517 Tests; sechs waren bedingt übersprungen. Ein bestehender Helfer-Wiederherstellungstest scheiterte im Gesamtlauf wiederholt an einer Windows-Dateisperre (`EPERM` beim Umbenennen eines temporären Testordners). Derselbe Helfer-Testblock bestand einzeln mit elf Tests. Der Gesamtlauf wird deshalb ausdrücklich nicht als vollständig grün bezeichnet; am Helfer-Code wurde für diese Arbeit nichts geändert.

Vollständige Protokolle: `artifacts/project-checkpoint-integration/all-tests-recheck.log`, `typescript-tests.log` und `helper-recheck.log`.
