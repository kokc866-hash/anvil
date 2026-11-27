---
name: anvil-eigenschaftstests
description: "Eigenschaftsbasierte Tests für Parser, Import/Export, Normalisierung und Datenstrukturen entwickeln. Nutzt Invarianten und reproduzierbare Gegenbeispiele; ersetzt weder Browserbedienung noch Benchmark oder Sicherheitsfreigabe."
compatibility: "Für Anvils Agentenbetrieb. Verwendet vorhandene Projekt- und Werkzeugzugriffe; diese Anleitung erteilt keine zusätzlichen Rechte und installiert keine Programme."
license: CC-BY-SA-4.0
metadata:
  version: "1.0.0"
  adaptation: "Anvil-spezifische Arbeitsanleitung; keine unverändert importierte Laufzeit"
  provenance: "references/quellen.json"
---

# Eigenschaften mit generierten Daten prüfen

Suche eine belastbare Regel, die viele gültige Eingaben erfüllen müssen. Verwende die vorhandene Testumgebung und eine passende öffentliche Schnittstelle. Für reine UI-Bedienung oder eine einmalige Textänderung ist dieser Skill meistens nicht nötig. Binärfuzzer, Mutationstests und Benchmarks brauchen eigene Werkzeuge; dieser Skill stellt sie nicht bereit.

Mit `read_file` und `grep` Projektmanifest, vorhandene Tests und Datenmodell lesen. Bei einem Import/Export kann eine semantische Roundtrip-Eigenschaft passen, bei Normalisierung Idempotenz, bei Aufgaben ein unveränderter Datenbestand außerhalb des Eingriffs. Erwartete Ergebnisse aus dem Vertrag oder einer unabhängigen Referenz ableiten; nicht dieselbe Implementierung als Sollwert kopieren.

Gültige Eingaben gezielt erzeugen und ungültige getrennt prüfen. Grenzen, leere Werte und Unicode berücksichtigen, soweit der Vertrag sie erlaubt. Zufallsseed und kleinstes Gegenbeispiel festhalten, damit ein Fehler wiederholt werden kann. Eine nach vielen Filtern leere Testmenge ist kein Erfolg.

Bestehende Bibliotheken wie fast-check, Hypothesis oder proptest verwenden, wenn sie im Projekt vorhanden sind. Der Skill ist kein Auftrag zur Installation zusätzlicher Abhängigkeiten. Fehlt eine geeignete Bibliothek, einen kleinen deterministischen Fall oder vorhandenen Generator nutzen und die Begrenzung nennen.

Nur erlaubte Testbefehle mit `shell` beziehungsweise passende Testdateien mit `run_file` ausführen. Bei Fehlern zuerst unterscheiden, ob Generator, Sollregel, Prüfweg oder Anwendung falsch ist. Absichtliche Fehler eines beauftragten Negativtests nicht ungefragt reparieren. Konkrete Fälle und Grenzen stehen in [references/eigenschaften-und-gegenbeispiele.md](references/eigenschaften-und-gegenbeispiele.md).

Berichte geprüften Stand, Eigenschaften, tatsächlich ausgeführte Fälle, reproduzierbaren Fehler und offene Grenzen. Eine endliche Testmenge beweist nicht die Korrektheit für alle Eingaben. Quellen und Lizenz dieser Anpassung stehen in [references/quellen.md](references/quellen.md).
