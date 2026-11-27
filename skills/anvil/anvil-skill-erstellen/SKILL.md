---
name: anvil-skill-erstellen
description: "Eigene Anvil-Skills aus wiederkehrenden, belegten Arbeitsabläufen entwickeln oder gezielt verbessern. Hält Anwendungsbereich, Voraussetzungen und Befugnisse auseinander und ergänzt nur benötigte Referenzen."
compatibility: "Für Anvils Agentenbetrieb. Benötigt die im Skill genannten Projekt- und Werkzeugzugriffe; allgemeine Agenten können andere Werkzeugnamen verwenden."
metadata:
  version: "1.2.0"
  adaptation: "Anvil-spezifische Arbeitsanleitung; keine unverändert importierte Laufzeit"
  provenance: "references/quellen.json"
---

# Eigene Skills entwickeln

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-skill-erstellen",resource:"references/skill-format.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Erstelle eine wiederverwendbare Arbeitsanleitung für die gewünschte Aufgabe. Ein Skill soll Entscheidungen verbessern, nicht den Auftrag ersetzen oder neue Berechtigungen schaffen. Aus einem einzelnen Fehler keinen universellen Zwang für jedes Projekt ableiten.

## Zweck und Umgebung

Mit `skill_list` nach vorhandenen Arbeitsweisen suchen und passende Einträge mit `skill_read` prüfen. Vermeide konkurrierende Anleitungen für dieselbe Aufgabe. Beschreibe konkret, wann der Skill hilft, welche Voraussetzungen er braucht und welche Ergebnisse ihn belegen. Nur Werkzeuge nennen, die Anvil tatsächlich anbietet; dynamische MCP-Werkzeuge aus dem aktuellen Katalog ableiten.

Eine gespeicherte Vorliebe und eine mehrstufige Arbeitsanleitung sind unterschiedliche Inhalte. Skills brauchen keinen zusätzlich angelegten Gedächtniseintrag. Zugangsdaten, persönliche Systempfade und Inhalte eines fremden Projekts nicht als allgemeine Anweisungen übernehmen.

## Passend speichern

Für eine Arbeitsweise im aktuellen Projekt `skill_write` mit `scope:"project"` verwenden. Ein projektübergreifender Nutzer-Skill braucht den entsprechenden Auftrag. Bestehende eigene Skills mit `skill_patch` gezielt verbessern. Eingebaute Anvil-Skills sind die gepflegte Grundlage; lokale Anpassungen als eigene Variante behandeln.

Für ein importierbares Paket gehört der Einstieg in eine `SKILL.md` mit `name` und `description`. Ausführliche, nur bedingt benötigte Details in verlinkte Referenzen auslagern. Keine Skripte, Abhängigkeiten oder Beispieldateien hinzufügen, die der Ablauf nicht benötigt.

## Prüfen und verbessern

Mit `skill_debug` Format, vorhandene Referenzen und bekannte Werkzeugnamen getrennt prüfen. Fehlende Ressourcenindizes und dynamische MCP-Namen bleiben als ungeprüft erkennbar. Diese statischen Prüfungen bestätigen keine zuverlässige Arbeitsweise. Zusätzlich einen passenden und einen unpassenden Beispielauftrag sowie fehlende Voraussetzungen beurteilen: Hilft der Skill beim passenden Fall und hält er beim anderen den Umfang ein? Externe Testaktionen nur innerhalb eines dafür erteilten Auftrags ausführen.

Nach tatsächlicher Anwendung kann `skill_outcome` eine Modellrückmeldung mit `ok`, `fail` oder `reject` erfassen. Sie ist keine unabhängig gemessene Erfolgsquote und ersetzt keine Funktionsprüfung. Nicht pauschal Erfolg melden, nur weil der Text gespeichert wurde. Formatbeispiel und Entscheidungsfälle stehen in [references/skill-format.md](references/skill-format.md).

## Fachliche Vertiefung

Für positive und negative Triggerfälle sowie einen auftragsgebundenen Vergleich mit und ohne Skill lies [references/wirkungspruefung.md](references/wirkungspruefung.md). Die vorhandenen Anvil-Werkzeuge verwenden; ein fremder Claude-Eval-Runner ist keine Voraussetzung.

Herkunft und Lizenzhinweise: [references/quellen.md](references/quellen.md).
