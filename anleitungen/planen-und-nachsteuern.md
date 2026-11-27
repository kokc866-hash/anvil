# Planen und laufende Aufträge korrigieren

## Erst planen, dann umsetzen

Neben **Agent** und **Fragen** gibt es **Planen**. Dieser freiwillige Modus liest das Projekt und erstellt einen Vorschlag. Er ändert keine Projektdateien, startet keine Programme und führt keine schreibenden Dienstwerkzeuge aus.

Der Plan erscheint zusammengeklappt im Chat. Öffne ihn, wähle **Bearbeiten** und speichere den überarbeiteten Text. Jede inhaltliche Änderung erhält eine neue Version. Über **Version** lassen sich die letzten bis zu 16 gespeicherten Fassungen auswählen. Pläne bleiben dem Projekt zugeordnet und werden in Anvils vorhandener Profilablage gespeichert.

**Version … umsetzen** erteilt einen normalen Agentenauftrag mit genau dieser Fassung. Läuft bereits ein Auftrag, wird die Umsetzung eingereiht. Wenn du den Plan danach bearbeitest, verändert das den eingereihten oder bereits laufenden Auftrag nicht. Die gewählte Fassung enthält auch den ursprünglichen Auftrag, damit dessen Umfang erhalten bleibt.

Du kannst weiterhin direkt im Modus **Agent** arbeiten. Eine Planung oder Bestätigung ist dafür nicht erforderlich. Eine gespeicherte Planung wird nach einem Programmabbruch nicht automatisch umgesetzt. Ein während der Erstellung unterbrochener Plan bleibt als unterbrochen gekennzeichnet.

## Während eines Auftrags etwas ändern

Solange ein Auftrag läuft, bietet die Eingabe zwei Wege:

- **Danach ausführen** stellt einen eigenständigen Folgeauftrag in die bestehende Warteschlange. Das bleibt der Standard.
- **Im laufenden Auftrag berücksichtigen** sendet eine Textkorrektur an den aktuellen Auftrag. Beispielsweise: „Den Datenexport bitte weglassen und nur die Tabellenansicht fertigstellen.“

Anvil nimmt die Korrektur am nächsten sicheren Modell- oder Werkzeugübergang auf. Ein bereits gestartetes Werkzeug darf sein Ergebnis zurückmelden. Noch nicht gestartete Aktionen aus einer inzwischen überholten Werkzeugliste werden verworfen; das Modell entscheidet mit der Korrektur über die nächsten Schritte. Bestätigte Aktionen werden nicht wiederholt.

Eine Korrektur macht bereits ausgeführte Aktionen nicht rückgängig. Wenn du eine Änderung zurücknehmen möchtest, benenne sie ausdrücklich oder verwende die vorhandene Dateiwiederherstellung. Eine Präzisierung hebt frühere Vorgaben wie „Keine Dateien ändern“ oder einen absichtlichen Negativtest nicht stillschweigend auf. **Fragen** und **Planen** bleiben auch nach einer Korrektur schreibgeschützt.

Es sind bis zu 16 noch nicht aufgenommene Textkorrekturen mit jeweils höchstens 8000 Zeichen möglich. Bilder gehören in einen neuen Auftrag. Ist der Auftrag bereits beendet oder passt das Projekt nicht, wird nichts zugestellt und dein Entwurf bleibt erhalten. Im Hintergrundbetrieb zeigt **Auftragsdetails → Nutzerkorrekturen**, ob eine Korrektur vorgemerkt, berücksichtigt oder abgelehnt wurde.

## Getrennte Aufgaben und Änderungen prüfen

Für unabhängige Bearbeitungen gibt es [getrennte Git-Arbeitsstände](getrennte-arbeitsstaende.md). Bis zu zwei Hintergrundaufträge können in getrennten echten Projektordnern laufen. Die Auftragsauswahl wechselt die Ansicht; sie überträgt keine fremden Dateien in das geöffnete Projekt.

[Änderungen prüfen](aenderungen-pruefen.md) startet im Git-Bereich eine freiwillige Prüfung mit einer benannten Vergleichsbasis. Gelesene Dateien, offene Bereiche, übersprungene Dateien und einzelne Befunde bleiben unterscheidbar. Ein Befund kann als gezielter Folgeauftrag übernommen werden. Es entsteht kein zusätzliches Abnahmeformular.

[Projektregeln](projektregeln.md) werden für die tatsächlich bearbeiteten Dateien nachgeladen. Dieselbe Anleitung erklärt die komponentenweise Kompatibilitätsanzeige importierter Plugins.
