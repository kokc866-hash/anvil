---
name: anvil-freecad
description: "FreeCAD-Dokumente über Anvils eingerichtete MCP-Verbindung gezielt konstruieren und ändern. Prüft Dokumentzustand, Neuberechnung, Geometrie, Speicherung und Austauschformate."
---

# Parametrisch mit FreeCAD konstruieren

Die verlinkte Referenz bei Bedarf mit `skill_read({name:"anvil-freecad",resource:"references/dokument-und-geometrie.md"})` lesen. Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.

Erhalte die Bearbeitbarkeit des gewünschten Bauteils und arbeite am eindeutig ausgewählten Dokument. Eine Bestandsaufnahme verändert weder Geometrie noch Dokumente.

## Verbindung und Dokument prüfen

Mit `mcp_list` Server und Werkzeuge feststellen. Die vorbereitete FreeCAD-Anbindung kann `get_rpc_status`, `list_documents`, `get_objects`, `get_object`, `edit_object` und `execute_code` anbieten. Nur bestätigte Namen und Argumente verwenden. Ein geladener Katalog bedeutet noch keine erreichbare CAD-Anwendung; den RPC-Status und Versionshinweise prüfen.

Vor der Änderung Dokumentnamen, gewünschtes Objekt, Einheiten und Speicherziel bestimmen. Bevor ein bestehendes Dokument überschrieben wird, einen zum Auftrag passenden Rückweg sichern. Neue Dokumente nur erstellen, wenn sie gebraucht werden. Addon-Server und externes MCP-Paket müssen zusammenpassen; fehlende Software oder Werkzeuge benennen, nicht ungefragt installieren.

## Geometrie bearbeiten

Für parametrische Konstruktionen Maße und Abhängigkeiten nachvollziehbar aufbauen. Nach einer Änderung das Dokument neu berechnen und tatsächliche Geometrie kontrollieren. Ein geänderter Eigenschaftenwert beweist nicht, dass ein gültiger Volumenkörper entstanden ist. Bei Python-Werkzeugen explizit das gewählte Dokument verwenden und andere geöffnete Dokumente erhalten.

Ausgaben vollständig lesen: Ein Anbieter kann einen Fehler im Text melden, obwohl `isError:false` zurückgegeben wird. Für lange Aufgaben nur angebotene asynchrone Werkzeuge verwenden und deren Status abfragen; bei einem unklaren Ergebnis keinen schreibenden Auftrag blind wiederholen.

## Prüfen und exportieren

Maße, Körperanzahl, Gültigkeit und gegebenenfalls Volumen prüfen. Eine Ansicht ergänzt diese Kontrolle. FCStd für das bearbeitbare Dokument und ein gewünschtes Austauschformat separat behandeln. Für wichtigen STEP-Austausch den Export erneut einlesen und Geometrie sowie Einheiten prüfen.

Nach dem Wiederöffnen aktuelle Dokumentnamen erneut abfragen; sie können sich aus dem Dateinamen ableiten. Anvils Projektwiederherstellung setzt fremde CAD-Dokumente nicht automatisch zurück.

Vor der ersten Änderung mit `set_plan` messbare Kriterien festlegen: Anzahlen als Zahlen, Existenz als Wahrheitswert. Fachliche Funktionen statt vorübergehender Objektnamen prüfen. Bestehende Kriterien nicht nachträglich lockern oder umschreiben.

Den endgültigen gespeicherten Stand messen und einen Bericht mit echter Datei-Prüfsumme liefern. Das Ausgabeformat und ein Beispiel stehen in der Referenz. Alte PASS-Zeilen und Platzhalter sind keine Nachweise.

Nach einem Abbruch unklare Aktionen zuerst lesend prüfen. Der Nutzer kann sie einzeln samt Prüfergebnis klären und anschließend ausdrücklich fortsetzen. Die Klärung führt nichts aus und bestätigt keine Geometrieabnahme.

Für Sicherung, unabhängige Maßprüfung und Exportkontrolle lies [references/dokument-und-geometrie.md](references/dokument-und-geometrie.md). FEM-Ergebnisse oder reale Tragfähigkeit nur berichten, wenn diese ausdrücklich geprüften Verfahren Teil des Auftrags waren.
