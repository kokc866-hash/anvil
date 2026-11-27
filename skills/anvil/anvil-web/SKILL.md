---
name: anvil-web
description: "Weboberflächen in Anvil gezielt entwickeln und ihre Darstellung sowie Bedienung prüfen. Beachtet die Grenzen der HTML-Vorschau, vorhandene Frameworks und tatsächlich verfügbare Schnittstellen."
compatibility: "Für Anvils Agentenbetrieb. Benötigt die im Skill genannten Projekt- und Werkzeugzugriffe; allgemeine Agenten können andere Werkzeugnamen verwenden."
metadata:
  version: "1.2.0"
  adaptation: "Anvil-spezifische Arbeitsanleitung; keine unverändert importierte Laufzeit"
  provenance: "references/quellen.json"
---

# Weboberflächen entwickeln

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-web",resource:"references/bedienpruefung.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Verbessere das gewünschte Verhalten der Webanwendung und erhalte ihren vorhandenen Aufbau. Ein bestehendes React- oder Framework-Projekt wird nicht ohne Auftrag in eine einzelne HTML-Datei umgebaut.

## Anwendung und Vorschau unterscheiden

Lies Einstiegspunkt, Styles, Zustandsverwaltung und vorhandene Abhängigkeiten. Eine ausführbare HTML-Datei kann mit `run_file` in Anvils Vorschau geöffnet werden. `open_preview` und `see_run` helfen bei der Darstellung. Ein Manifest oder eine Bibliotheksdatei ist kein ausführbarer Einstiegspunkt; die Vorschau unterstützt nicht automatisch jede Entwicklungsumgebung.

Browser-JavaScript mit `document`, Canvas oder DOM-Ereignissen über den zugehörigen HTML- beziehungsweise Framework-Einstieg prüfen. Ein direkter Node-Start derselben Datei ist kein gleichwertiger Browser-Test. Wegen „document is not defined“ keine DOM-Attrappe in das Projekt einbauen und den bestehenden Framework-Aufbau nicht durch eine Ersatzseite umgehen.

Anvils Vorschau stellt keine beliebige globale `Anvil`-API bereit. Verwende eine solche Schnittstelle nur, wenn sie für dieses Projekt tatsächlich existiert und dokumentiert ist. Ein Fehler wie „Anvil is not defined“ wird durch das Korrigieren der betroffenen Abhängigkeit oder eine passende Projektschnittstelle gelöst, nicht durch eine erfundene globale Variable.

## Gezielt umsetzen und prüfen

Ändere vorhandenen Code mit `edit_file` und ergänze nur benötigte Dateien mit `write_file`. Behalte Eingabefokus, Tastaturbedienung, verständliche Fehlermeldungen und das Verhalten bei schmalen Ansichten im Blick. Erkläre Datenablage und externe Übertragung nur dort, wo sie für eine Nutzerentscheidung relevant sind.

Bedienelemente brauchen einen erkennbaren Zweck, verständliche Beschriftungen und eine sinnvolle Fokusreihenfolge. Für eine geänderte Funktion auch Tastaturzugriff und sichtbare Rückmeldung prüfen, soweit die vorhandenen Werkzeuge dies erlauben. Eine lange Anweisung oder ein Tooltip darf den benötigten Inhalt nicht verdecken.

Prüfe sichtbare Inhalte, Konsolenfehler und geänderte Bedienung. `play` bietet Tastatur, Maus und Text in der HTML-Vorschau. Nutze aktuelle Selektoren aus `run_file`/`see_run` und vergleiche erwartete Zustände mit `actions/type:"assert"`. Grenzen stehen im Schema; nicht erreichbare Funktionen bleiben ungeprüft.

Eine gezeichnete Oberfläche oder ein geöffnetes Dokument bestätigt noch keinen erfolgreichen Ablauf. Externe Ressourcen können in der Vorschau gesperrt sein. Diese Grenze nicht durch zusätzliche Downloads oder geänderte Schutzmaßnahmen umgehen; vorhandene lokale Inhalte oder eine benannte Voraussetzung nutzen.

Bei Formularen, Zuständen und Layouts hilft [references/bedienpruefung.md](references/bedienpruefung.md). Berichte getestete Bedienfälle und offene Einschränkungen konkret.

## Fachliche Vertiefung

Für eine konkrete Nutzerfolge statt bloßem Startnachweis lies [references/browser-funktionstest.md](references/browser-funktionstest.md). Bei einem vorhandenen React-Projekt kann anvil-react vertiefen; für Beschriftungen und Bedienabläufe anvil-bedienung-verbessern.

Herkunft und Lizenzhinweise: [references/quellen.md](references/quellen.md).
