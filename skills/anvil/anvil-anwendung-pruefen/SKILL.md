---
name: anvil-anwendung-pruefen
description: "Eine vorhandene oder geänderte Anwendung über ihren richtigen Einstieg und konkrete Funktionen prüfen. Unterscheidet Browser, Node, Python und Engine, tatsächliche Interaktion sowie fehlende Testmöglichkeiten."
compatibility: "Für Anvils Agentenbetrieb mit geöffnetem Projekt und passender freigegebener Laufzeit oder Dienstverbindung."
metadata:
  version: "1.0.0"
---

# Eine Anwendung passend prüfen

Prüfe die verlangte Funktion am aktuellen Stand. Ein Prüfauftrag erlaubt keine ungefragte Reparatur; insbesondere einen beauftragten Negativfall erhalten und dessen tatsächliches Ergebnis berichten.

## Den richtigen Einstieg wählen

Mit `list_files` und `read_file` Projektbeschreibung, Manifest und Einstiegspunkte untersuchen. Die Dateiendung allein reicht nicht: Browser-JavaScript mit `document` oder Canvas gehört zum HTML- beziehungsweise Framework-Einstieg. Es wird nicht als eigenständiges Node-Programm gestartet. Eine Bibliotheksdatei, ein Manifest und eine Testdatei erfüllen unterschiedliche Aufgaben.

Eine unterstützte HTML-Anwendung mit `run_file` über ihren HTML-Einstieg prüfen. Für ein freigegebenes Programm den tatsächlichen Programmeinstieg verwenden, für eine vorhandene Testsuite den passenden `shell`-Befehl. Engine-Projekte mit `engine_detect` erkennen und nur angebotene `engine_run`-Aktionen verwenden. Eine fehlende Laufzeit oder nicht unterstützte Entwicklungsumgebung als Voraussetzung benennen; keinen anderen Startweg als gleichwertigen Erfolg ausgeben.

## Ein beobachtbares Ergebnis prüfen

Leite aus dem Auftrag eine unterscheidbare Bedienfolge oder Funktionsausgabe ab. Bei einer Sortierung etwa verschiedene Eingaben und die tatsächlich angezeigte Reihenfolge prüfen. Eine Aufnahme mit `see_run` und saubere Konsolenausgabe bestätigen noch keinen geklickten Button. `play` bedient die aktuelle HTML-Vorschau mit Tasten, Maus und Texteingabe; lies das tatsächliche Schema. Nutze die von `run_file`/`see_run` gelieferten Selektoren und nach der Eingabe `actions` mit `type:"assert"` für ein konkretes erwartetes Ergebnis, etwa Text, Feldwert, Auswahl oder Elementanzahl. Eine zugestellte Eingabe allein ist kein bestandener Funktionstest. Keine beliebigen Testfälle außerhalb der beauftragten Änderung erzwingen. Zusätzliche Browser- oder MCP-Werkzeuge vorher aus ihrem tatsächlichen Katalog lesen.

Für Datenablage einen passenden Schreib-/Lesezyklus mit künstlichen Daten verwenden. Bei einer vorgesehenen ungültigen Eingabe die erwartete Ablehnung prüfen, ohne den absichtlichen Fehler umzubauen. Externe Konten und echte Projekte nur innerhalb des erteilten Testauftrags verändern.

`elements` nennt Bedienelemente und Auswahlzustände, `observations` Ergebnisanzeigen mit echten Selektoren und Ist-Werten. Leite Sollwerte vor der Aktion aus dem Auftrag ab. Fehlprüfungen nennen den Soll-/Ist-Unterschied.

## Das Ergebnis richtig einordnen

Ein gestarteter Prozess, ein erfolgreicher Build, eine sichtbare Oberfläche und eine bediente Funktion sind eigene Nachweise. Nach Änderungen nur dafür relevante Prüfungen wiederholen. Fehlt die Interaktionsmöglichkeit, diesen Teil offenlassen; keine Eingabe erfinden und keinen gesamten Erfolg aus einem Teiltest ableiten.

Nenne Einstieg, tatsächlich ausgeführte Fälle, Ergebnis und offene Grenzen. Für die Auswahl des Nachweises lies [references/laufzeit-und-nachweise.md](references/laufzeit-und-nachweise.md) bei Bedarf mit `skill_read`.
