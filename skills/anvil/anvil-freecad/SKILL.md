---
name: anvil-freecad
description: "FreeCAD-Dokumente über Anvils eingerichtete MCP-Verbindung gezielt konstruieren und ändern. Prüft Dokumentzustand, Neuberechnung, Geometrie, Speicherung und Austauschformate."
compatibility: "Für Anvils Agentenbetrieb mit passender FreeCAD-Anbindung. Verwendet Anvil-Werkzeuge; zusätzliche Dienstwerkzeuge benötigen einen aktuellen freigegebenen Katalog."
metadata:
  version: "1.2.0"
  adaptation: "Anvil-spezifische Arbeitsanleitung; keine unverändert importierte Laufzeit"
  provenance: "references/quellen.json"
---

# Parametrisch mit FreeCAD konstruieren

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-freecad",resource:"references/dokument-und-geometrie.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Arbeite am eindeutig ausgewählten Dokument und erhalte seine Bearbeitbarkeit. Eine Bestandsaufnahme bleibt lesend.

## Verbindung und Dokument prüfen

Mit `mcp_list` Server und Werkzeuge feststellen. Die vorbereitete FreeCAD-Anbindung kann `get_rpc_status`, `list_documents`, `get_objects`, `get_object`, `edit_object` und `execute_code` anbieten. Nur bestätigte Namen und Argumente verwenden. Ein geladener Katalog bedeutet noch keine erreichbare CAD-Anwendung; den RPC-Status und Versionshinweise prüfen.

Dokument, Objekt, Einheiten und Speicherziel vor der Änderung bestimmen. Bestehenden Zustand vor Überschreiben sichern. Nur benötigte neue Dokumente anlegen. Addon und MCP-Paket müssen zusammenpassen; fehlende Voraussetzungen benennen, nicht ungefragt installieren.

## Geometrie bearbeiten

Maße und Abhängigkeiten nachvollziehbar aufbauen. Nach Änderungen neu berechnen und die tatsächliche Geometrie kontrollieren: Ein Eigenschaftenwert beweist keinen gültigen Volumenkörper. Bei Python explizit das gewählte Dokument verwenden und andere geöffnete Dokumente erhalten.

Ausgaben vollständig lesen: Auch bei `isError:false` kann der Text einen Fehler melden. Für lange Aufgaben nur angebotene asynchrone Werkzeuge verwenden und ihren Status prüfen. Unklare Schreibantworten nicht blind wiederholen.

## Prüfen und exportieren

Maße, Körperanzahl, Gültigkeit und gegebenenfalls Volumen prüfen. Eine Ansicht ergänzt diese Kontrolle. FCStd und Exporte im aktiven Workspace unter `Ergebnis/` oder im angegebenen Projektunterordner speichern. Wichtigen STEP-Export erneut einlesen und Geometrie sowie Einheiten prüfen.

Nach dem Wiederöffnen aktuelle Dokumentnamen erneut abfragen; sie können sich aus dem Dateinamen ableiten. Anvils Projektwiederherstellung setzt fremde CAD-Dokumente nicht automatisch zurück.

Maße und Funktionen aus dem Auftrag ableiten. `set_plan` kann mehrstufige Arbeit festhalten; zusätzliche Messfelder oder Abnahmeprozeduren sind nicht erforderlich.

Den endgültigen Stand prüfen und tatsächliche Maße, Abweichungen und Verfahren berichten. Gespeicherten Messbericht oder Datei-Prüfsumme nur liefern, wenn beauftragt. Alte PASS-Zeilen und Platzhalter sind keine Nachweise.

Nach einem Abbruch unklare Aktionen zuerst lesend im tatsächlichen Dokument prüfen. Bestätigte Änderungen erhalten und keinen Schreibaufruf blind wiederholen. Lässt sich ein Ausgang nicht feststellen, diesen konkreten Punkt offen benennen; keine neue Bestätigungsfolge daraus machen.

Für Sicherung, unabhängige Maßprüfung und Exportkontrolle lies [references/dokument-und-geometrie.md](references/dokument-und-geometrie.md). FEM-Ergebnisse oder reale Tragfähigkeit nur berichten, wenn diese ausdrücklich geprüften Verfahren Teil des Auftrags waren.

## Fachliche Vertiefung

Konkrete Hinweise zu parametrischen Objekten und unabhängigen Messfällen stehen in [references/parametrik-und-messfaelle.md](references/parametrik-und-messfaelle.md). Ein generierter Messprüfer ist zunächst ein Entwurf und muss an einem bekannten Fall überprüft werden.

Herkunft und Lizenzhinweise: [references/quellen.md](references/quellen.md).
