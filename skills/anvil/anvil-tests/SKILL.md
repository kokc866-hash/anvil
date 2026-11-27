---
name: anvil-tests
description: "Aussagekräftige Tests für Anvil-Projekte erstellen, vorhandene Tests gezielt ausführen und Ergebnisse nach ihrem tatsächlichen Umfang beurteilen. Für Funktions- und Regressionstests, keine rein formalen Codekopien."
compatibility: "Für Anvils Agentenbetrieb. Benötigt die im Skill genannten Projekt- und Werkzeugzugriffe; allgemeine Agenten können andere Werkzeugnamen verwenden."
metadata:
  version: "1.2.0"
  adaptation: "Anvil-spezifische Arbeitsanleitung; keine unverändert importierte Laufzeit"
  provenance: "references/quellen.json"
---

# Tests entwickeln und ausführen

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-tests",resource:"references/testfaelle.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Prüfe das Verhalten, das für den Auftrag wichtig ist. Ein neuer Test soll einen Fehler entdecken können; das bloße Nachbilden derselben Berechnung oder Abgleichen eigener Implementierungsdetails ist wenig aussagekräftig.

## Vorhandene Wege nutzen

Lies Projektmanifest, Testkonfiguration und relevante bestehende Tests. Übernimm deren Datenaufbau und Ausführung. Wähle einen normalen Fall, einen für die Änderung wichtigen Randfall und gegebenenfalls den beobachteten Fehlerfall. Kleine künstliche Daten helfen, echte Konten und Projektinhalte aus dem Test herauszuhalten.

Wähle die tatsächliche Laufzeit: Browser-Code über den vorgesehenen HTML-/Framework-Einstieg, ein Kommandozeilenprogramm über seinen Programmeinstieg und Engine-Verhalten über einen passenden Engine-Weg. Eine beliebige JavaScript-Datei direkt mit Node zu starten prüft keine DOM-Anwendung. Ein Import- oder Ladefehler in der falschen Laufzeit ist zunächst ein Fehler des Prüfwegs.

Mit `shell` stehen begrenzte Befehle zur Verfügung, darunter `npm test`, `pytest`, `python -m pytest`, `go test`, `cargo test` und `dotnet test`. Maßgeblich bleibt die tatsächliche Werkzeugfreigabe. Der Skill erweitert weder die Befehlsliste noch installiert er fehlende Pakete. Bei unbekannter Testumgebung erst die Voraussetzung erklären.

## Nachweise auswerten

Lies Prozesscode, Fehlerausgabe, Anzahl ausgeführter Tests und gegebenenfalls übersprungene Fälle. „Keine Tests gefunden“ ist kein Nachweis der gewünschten Funktion. Ein unerwarteter Fehler darf nicht durch `expected_exit_code` umgedeutet werden; dieses Feld ist ausschließlich für einen ausdrücklich erwarteten negativen Prozessfall gedacht. Meist beschreibt eine Assertion den negativen Fall genauer.

Ist ein Fehler absichtlich Teil des beauftragten Negativtests, die erwartete Ablehnung am unveränderten Fall prüfen und berichten. Diesen Fehler nicht ungefragt reparieren. Ein Test auf falsche Eingaben darf dagegen normale Implementierungsfehler aufdecken; der aktuelle Auftrag bestimmt, ob sie zu beheben oder nur zu melden sind.

Bei Änderungen zunächst betroffene Tests ausführen. Weitere Prüfungen sind sinnvoll, wenn berührte Schnittstellen, neue Fehler oder ein erforderlicher Projektstandard sie rechtfertigen. Nach einer erneuten Codeänderung den dafür relevanten Test wiederholen. Bereits erfolgreiche, unveränderte Prüfungen nicht ohne Grund in Schleifen ausführen.

## Ergebnis

Nenne den getesteten Stand, Befehl beziehungsweise Testgruppe, Ergebnis und wesentliche Begrenzungen. Interaktion, visuelle Darstellung, Engine-Verhalten und externe Dienste können andere Nachweise verlangen als Unit-Tests. Die passenden Unterschiede und ein Beispiel stehen in [references/testfaelle.md](references/testfaelle.md).

## Fachliche Vertiefung

Vertiefung zu unabhängigen Erwartungen und einem sinnvollen Regressionstest: [references/verhalten-und-regression.md](references/verhalten-und-regression.md). Bei einer echten Invariante kann der ergänzende Skill anvil-eigenschaftstests helfen; er ersetzt keine Bedienprüfung.

Herkunft und Lizenzhinweise: [references/quellen.md](references/quellen.md).
