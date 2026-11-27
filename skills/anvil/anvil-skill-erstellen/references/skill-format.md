# Ein Anvil-Skill als Paket

## Kleiner Einstieg

Ein Paket enthält eine `SKILL.md`. Beispiel für eine gewünschte projektspezifische Exportprüfung:

```markdown
---
name: export-pruefen
description: Prüft den vereinbarten Export dieses Projekts anhand seiner tatsächlichen Datei und der festgelegten Zielmaße.
---

# Export prüfen

Lies das vereinbarte Exportziel und die Sollmaße aus der Projektbeschreibung.
Nutze die tatsächlich verfügbare Projektschnittstelle.
Vergleiche die erzeugte Datei mit diesen Vorgaben.
Ein Exportauftrag erlaubt keine Veröffentlichung.
```

Der Name gehört zum konkreten Ablauf und sollte andere Aufgaben nicht anziehen. Die Beschreibung hilft bei der Auswahl; der Haupttext führt nur den passenden Auftrag. Für umfangreiche Formatdetails kann eine verlinkte `references/exportformat.md` hinzukommen, sobald sie tatsächlich benötigt wird.

## Drei Entscheidungsfälle

1. **Passender Auftrag:** „Prüfe den vereinbarten Export.“ Der Skill liest das bekannte Ziel und wählt die vorhandene Prüfung.
2. **Ähnlicher, anderer Auftrag:** „Erkläre mir das Dateiformat.“ Die Erklärung darf nicht automatisch einen Export starten oder Dateien verändern.
3. **Fehlende Voraussetzung:** „Prüfe den Export“, aber das Zielprogramm oder Werkzeug fehlt. Den fehlenden Zugang nennen; nicht ohne Auftrag herunterladen oder auf einen anderen Dienst wechseln.

Der Test beurteilt Entscheidungen und Ergebnisse. Ein Textvergleich mit dem gewünschten Wortlaut belegt keine gute Arbeitsweise.

## Pflege

Mit `skill_debug` strukturelle Probleme untersuchen; mit `skill_patch` konkrete Fehler im eigenen Skill korrigieren. Erprobte Abläufe aus tatsächlicher Nutzung ableiten. Dateien, Werkzeuge, Voraussetzungen und Ergebnisgrenzen aktuell halten.

Unterstützende Skripte nur aufnehmen, wenn sie einen wiederkehrenden Ablauf zuverlässiger machen. Ihr Vorhandensein ist keine Erlaubnis, sie auszuführen. Keine geheimen Schlüssel oder persönliche Rechnerpfade ins Paket schreiben.
