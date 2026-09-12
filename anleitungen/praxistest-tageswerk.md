# Anvil im echten Arbeitsablauf: Tageswerk

12. September 2026 · Anvil 1.3.24 · nativer Praxistest abgeschlossen

**Nachfolgende Produktarbeit:** Einstieg ohne KI, vier geführte Aufgaben, Verbindungsgrenzen, Hilfe und vollständige Rücknahme geladener Dateien sind inzwischen implementiert. Der [Produktabschluss](produktabschluss.md) beschreibt den neueren Stand; Einschränkungen der damaligen Rücknahme im folgenden historischen Testbericht sind dadurch teilweise überholt.

## Nachprüfung der Reparaturen

Die drei unten dokumentierten Anvil-Fehler sind im lokalen Stand repariert. Beim Neustart werden einem vorhandenen Projekt keine Standarddateien mehr hinzugefügt; der Desktop-Ordnername bleibt erhalten. Bereits zwischengespeicherte, unveränderte Standardvorlagen werden nach erfolgreichem Einlesen entfernt, wenn sie im Ordner fehlen; eigene, ungespeicherte und tatsächlich vorhandene Dateien bleiben erhalten. Die Rundenrücknahme markiert nur tatsächlich veränderte Dateien als ungespeichert und erhält deren Vergleichsstand für die Konfliktprüfung.

Ein Abbruch entfernt unvollständige interne Werkzeugobjekte aus dem Antworttext. Normale Texte und vollständige JSON-Beispiele bleiben erhalten. Noch offene Prüfschritte führen zu „Beendet · 1 Schritt offen“ statt „Fertig“; sie werden nicht automatisch abgehakt. Nachträglich eintreffende Abbruchhinweise können keine andere Runde verändern.

**Frische Nachweise:** Typprüfung und Produktionsbuild erfolgreich. Vier Integrationstests für Chat-Abschluss, Rücknahme, CLI-Ergebnisbilder und exklusive Speicherziele bestanden; zusätzlich 45 Plan-/Abbruch-/Parserprüfungen. Die ursprünglichen Fehler wurden vor der Änderung durch fehlschlagende Regressionstests bestätigt.

**Desktop-Abnahme:** Die neu gebaute Electron-Oberfläche wurde mit getrenntem Profil und eigenem leeren Testordner gestartet. Ordner über die Oberfläche geöffnet, Datei angelegt und gespeichert, Electron vollständig beendet und erneut gestartet. Danach stimmen Ordnername und Dateiliste exakt. Eine vorbereitete Teständerung wurde mit beiden echten „Zurück vor diese Runde“-Schaltflächen zurückgenommen und über „Alles speichern“ ohne Zusatzdateien oder Konflikt gesichert. Eine anschließend absichtlich außerhalb Anvils geänderte Datei wurde beim Speichern korrekt geschützt. Auch die sichtbaren Abbruch- und Abschlussmeldungen bestanden; keine Rendererfehler.

Dieser gezielte Wiederholungstest verwendet vorbereitete Agentenantworten und einen ersetzten Ordnerdialog, aber echte Oberfläche, Desktop-Anbindung, Dateizugriffe, Speicherung und Neustart. Er verbraucht keine weiteren Modellanfragen und ersetzt nicht den unten dokumentierten vollständigen Ollama-/Codex-Praxistest.

**Verbleibende Grenze der Rücknahme:** Die Abnahme betrifft Änderungen an vorhandenen Dateien. Die bestehende Rücknahme löscht keine während einer Runde neu angelegten Dateien und unterstützt keinen völlig leeren Ausgangssnapshot. Diese beiden älteren Einschränkungen wurden bei der unabhängigen Codeprüfung ebenfalls reproduziert; eine vollständige Rücknahme beliebiger Projektänderungen wird hier nicht behauptet.

Nachweise: [Ablauftest](I:/Anvil/scripts/product-workflow.browser.mjs), [Ergebnis](I:/Anvil/artifacts/product-workflow/result.json), [Rücknahme](I:/Anvil/artifacts/product-workflow/restart-rollback.png), [echter Konflikt](I:/Anvil/artifacts/product-workflow/real-conflict.png), [offene Prüfung](I:/Anvil/artifacts/product-workflow/unfinished-check.png).

Abschließend wurde auch das normale Profil sauber neu gestartet: Tageswerk, Chat und das bisherige Ollama-Modell sind erhalten. Die Dateiliste stimmt mit den vier vorhandenen Projektdateien überein; die fehlende `rules.md`-Vorlage wird nicht mehr angezeigt. Run zeigt weiterhin die beiden gespeicherten Aufgaben. Alte, bereits gespeicherte Abbruchtexte werden durch die Änderung nicht nachträglich umgeschrieben.

## Ursprünglicher Praxistest

**Ergebnis:** Eine neue Anwendung wurde vollständig durch Anvils Agenten gebaut, anschließend durch echte Bedienung geprüft, anhand eines gefundenen Mangels verbessert und nach Neustart weiterbearbeitet. Der Kernablauf funktioniert. Der wichtigste neu belegte Anvil-Fehler betrifft zusätzlich eingeblendete Standarddateien nach dem Neustart und deren Konflikte beim Speichern einer Rundenrücknahme.

**Fertige Anwendung:** `I:\Anvil\data\Anvil-Praxistest-Aufgabenplaner\index.html`. Anvil und das Run-Fenster bleiben mit diesem Projekt geöffnet. Das vorherige Ollama-Profil wurde zum Schluss wieder ausgewählt.

## Vorgehen

Die normale Windows-App wird über ihre Oberfläche bedient. Ein neuer leerer Ordner wurde im echten Windows-Ordnerdialog unter `I:\Anvil\data\Anvil-Praxistest-Aufgabenplaner` erstellt und in Anvil geöffnet. Kein vorbereiteter Anwendungscode und kein Ersatz für den Ordnerdialog. Der Auftrag wurde in Anvils Chat eingegeben; ausgewählt blieb das vorhandene lokale Modell `qwen3.8:27b-mtp-q8_0` über Ollama, Thinking Low.

Auftrag: Ein deutscher Aufgabenplaner als einzelne `index.html`, ohne externe Bibliotheken, mit Anlegen, Erledigen/Wiederöffnen, Bearbeiten/Speichern/Abbrechen, Löschen, Statusfiltern, Zählern und lokaler Speicherung. Die Anwendung wird durch Anvils Agenten geschrieben. Die anschließende Prüfung ist unabhängig von dessen Erfolgsmeldung.

## Beobachtungen

- Anvil startet und stellt den bisherigen Arbeitsplatz wieder her.
- Die maximierte Oberfläche bietet Platz für Explorer, Editor, Spur und Chat. Die frühere schmale Vorschau ist keine Grundlage für eine Layoutkritik.
- Über „Mehr → Desktop-Ordner“ öffnet sich der native Ordnerdialog. „Neuer Ordner“ erstellt das Testprojekt. Die Auswahl lädt null Dateien und wechselt zu einem leeren Chat.
- Im leeren Arbeitsplatz werden Gerüste, „Neue Datei“ und „Agent“ angeboten; der freie Bauauftrag lässt sich unmittelbar senden.

## Tatsächlich durchgeführte Prüfungen

| Ablauf | Ergebnis | Beobachtung |
|---|---|---|
| Leeres Projekt erstellen | Bestanden | Echter Windows-Dialog, neuer Ordner, null Dateien, neuer Projektchat. |
| Anwendung durch Ollama bauen | Bestanden | Erste ausführbare Fassung nach knapp fünf Minuten; Abschlussanzeige nach 5:20 Minuten. Eine eigenständige HTML-Datei mit CSS und JavaScript. |
| Run selbst starten | Bestanden | Die App öffnet sich in Anvils eigenem Ausgabefenster. |
| Leerer Titel und nur Leerzeichen | Funktion zunächst korrekt, Rückmeldung mangelhaft | Keine zusätzliche Aufgabe; zunächst keine sichtbare Erklärung. Anschließend durch Anvils Agenten korrigiert. |
| Anlegen per Enter | Bestanden | `   Küche & Büro prüfen   ` wird als Aufgabe angelegt. Der Code trimmt den Titel; Umlaute und & werden korrekt dargestellt. |
| Anlegen per Button | Bestanden | Zweiter Eintrag „Unterlagen sortieren“; Alle 2, Offen 2, Erledigt 0. |
| Erledigen | Bestanden | Alle 2, Offen 1, Erledigt 1; richtiger Eintrag durchgestrichen. |
| Filter Offen/Erledigt/Alle | Bestanden | Nur passende Einträge sichtbar; die Gesamtzähler bleiben richtig. |
| Wiederöffnen im Erledigt-Filter | Bestanden | Alle 2, Offen 2, Erledigt 0; passende Meldung „Noch keine erledigten Aufgaben“. |
| Bearbeiten und Abbrechen | Bestanden | „Diese Änderung verwerfen“ wird nicht übernommen; Originaltitel bleibt. |
| Leere Titeländerung speichern | Bestanden mit anfänglichem Rückmeldemangel | Bearbeitung bleibt offen, bisheriger Titel wird nicht überschrieben. Nach Korrektur erscheint die Fehlermeldung. |
| Gültige Titeländerung speichern | Bestanden | „Unterlagen morgen sortieren“ wird übernommen. |
| Einen Eintrag löschen | Bestanden | Nur dieser eigene Testeintrag verschwindet; „Küche & Büro prüfen“ bleibt, Zähler 1/1/0. |
| Run erneut ausführen | Bestanden | Die gespeicherte Aufgabe bleibt erhalten. |
| Anvil vollständig schließen und neu starten | App und Daten bestanden; Projektanzeige auffällig | Code, Chat und Aufgabe sind vorhanden. Der Projektname wird zunächst durch „Dateien“ ersetzt und drei zusätzliche Standarddateien erscheinen. |
| Speichern auf Festplatte | Bestanden für die Anwendungsdatei | Datei nach initialem Speichern, CLI-Korrektur und Rundenrücknahme tatsächlich im gewählten Ordner geprüft. |
| Modellwechsel Ollama → Codex CLI | Bestanden | Bestehender Zugang, `gpt-5.6-terra`, Thinking Low; Folgeauftrag schließt nach 1:11 Minuten ab. |
| Gefundenen App-Mangel durch Anvil korrigieren | Bestanden | Fehlertext direkt am Feld, kein Dialog; gültige Eingabe entfernt die Meldung. Beide Wege – Anlegen und Bearbeiten – selbst geprüft. Escape verwirft die Bearbeitung korrekt. |
| Laufenden Auftrag abbrechen und fortsetzen | Bestanden mit Darstellungsfehler | Abbruch nach angezeigten 14 Sekunden, Zustand „Gestoppt“, neue Eingabe möglich. Fortsetzung per Chat erfolgreich nach 33 Sekunden. Im Abbruchtext bleibt ein unvollständiges Werkzeugobjekt sichtbar. |
| Änderung ansehen und Runde zurücknehmen | Teilweise bestanden | Untertitel „Dein Aufgabenplaner“ → „Rücknahme-Test“ im Vergleich sichtbar. „Zurück vor diese Runde“ stellt den alten Untertitel wieder her und erhält die Validierung. Speichern der zusätzlich als geändert markierten Standarddateien schlägt fehl; Details unten. |
| Konflikt über normalen Projektweg verlassen | Bestanden als Umgehung | Testordner erneut geöffnet, nur die drei problematischen Standarddateien verworfen. Keine offenen Änderungen mehr; Projektname wieder sichtbar. |
| Endfassung erneut starten | Bestanden | Ursprünglicher Untertitel und zwei Aufgaben vorhanden: „Korrektur erfolgreich prüfen“, „Küche & Büro prüfen“. |

## Neu belegte Anvil-Befunde

### 1. Neustart, Standarddateien und Rundenrücknahme passen nicht zusammen

**Priorität: hoch für die Verlässlichkeit des Projektablaufs.**

Vor dem Neustart hatte der Testordner `index.html` und `.anvil/session.md`. Nach dem Neustart zeigte Anvil zusätzlich `.anvil/rules.md`, `ref/README.md` und `README.md`; der Ordnername in der Seitenleiste fehlte. Die nachfolgende echte CLI-Änderung erreichte weiterhin die richtige `index.html` auf Festplatte. Ein Verlust des Speicherziels wurde deshalb nicht nachgewiesen.

Nach einer weiteren Änderung ausschließlich am Untertitel wurde „Zurück vor diese Runde“ gewählt. Anvil markierte alle fünf Dateien als geändert. Beim anschließenden Speichern erschien:

> Datei extern geändert: .anvil/rules.md. Neu laden oder Änderungen abgleichen. Datei extern geändert: ref/README.md. Neu laden oder Änderungen abgleichen. Datei extern geändert: README.md. Neu laden oder Änderungen abgleichen.

Eine unmittelbar anschließende Auflistung des Projektordners enthielt weiterhin nur `index.html` und `.anvil/session.md`. Die Anwendungsdatei hatte bereits wieder „Dein Aufgabenplaner“ und enthielt weiterhin die korrigierte Validierung. Damit ist der Fehler genauer eingegrenzt: Rundenrücknahme und Speichern scheitern zusätzlich an Dateien, die Anvil im Arbeitsbereich führt, die zu diesem Zeitpunkt aber nicht im Ordner existieren.

Um den Test in einem brauchbaren Zustand zu beenden, wurde derselbe Ordner über „Desktop-Ordner“ erneut geöffnet. Im Dialog für drei ungespeicherte Dateien wurde „Verwerfen“ gewählt. Danach war der Projektname wieder sichtbar und es gab keine offenen Änderungen. Zum Testende liegen neben der Anwendung und der Sitzungsdatei auch zwei kleine README-Dateien im Projektordner. Das ist eine Umgehung des Konflikts, **keine Reparatur des Anvil-Fehlers**. Die genaue Ursache im Wiederherstellungsablauf wurde in diesem Bedienversuch nicht abschließend diagnostiziert.

**Produktanforderung:** Nach einem Neustart müssen Dateibaum, Ordnerinhalt und Speicherziel konsistent sein. Die Rücknahme einer Runde darf unbeteiligte Standarddateien nicht als externe Konflikte behandeln. Für diesen Ablauf sollte eine eigene Abnahme gelten: leeren Desktop-Ordner öffnen → Datei erzeugen → speichern → App neu starten → eine Zeile ändern → Runde zurücknehmen → alle Dateien speichern.

### 2. „Fertig“ und die Aufgabenliste widersprechen sich

Der erste lokale Auftrag meldet „Fertig“, während die Aufgabenliste bei 2/3 bleibt und „Funktionsprüfung per Snapshot“ offen ist. Gleichzeitig beschreibt die Abschlussantwort die Logik als geprüft. Das ist kein Beleg für einen Fehler der generierten Funktionen; es ist eine unklare Aussage über den Prüfstand. Im CLI-Korrekturauftrag ist die Grenze besser formuliert: Der Agent sagt ausdrücklich, dass er die Bildvorschau nicht inhaltlich prüfen konnte.

**Produktanforderung:** Schreiben, erfolgreiches Starten und tatsächliche Bedienprüfung müssen als unterschiedliche Nachweise erkennbar sein. Ein Screenshot allein beweist keine korrekte Bearbeiten-, Löschen- oder Speicherfunktion.

### 3. Beim Abbruch erscheint interner Werkzeugtext

Der bewusst gestoppte CLI-Auftrag endet mit „Gestoppt“, darunter steht ein unvollständiges Objekt beginnend mit `{"action": "set_plan",`. Abbruch und anschließende Fortsetzung funktionieren. Der technische Resttext ist für einen Nutzer aber keine brauchbare Zusammenfassung des erreichten Zustands.

**Produktanforderung:** Abbruch sollte knapp nennen, welche Dateien bereits geändert wurden und wie es weitergeht. Unvollständige Werkzeugsyntax sollte nicht als Antwort erscheinen.

## Was dieser Test für das Produkt bedeutet

Das konkrete Versprechen „Mit eigener KI eine kleine Anwendung bauen, direkt ausprobieren und gezielt verbessern“ wurde praktisch erfüllt. Ein neuer Entwurf, ein echter Bedienmangel, ein Modellwechsel und dessen Korrektur gelangen im selben Projekt. Die normale große Desktop-Oberfläche war dafür brauchbar; ein grundsätzlicher Layoutumbau lässt sich aus diesem Test nicht ableiten.

Die nächste Produktpriorität ist die zuverlässige Fortsetzung nach Neustart und Rücknahme. Danach folgen eindeutige Aussagen darüber, was tatsächlich geprüft wurde, und verständliche Abbruchmeldungen. Neue Skills oder Plugins lösen diese beobachteten Grundprobleme nicht. Ein späteres eingebautes Beispielprojekt könnte genau den hier durchlaufenen Erfolg demonstrieren – einschließlich einer echten Prüfung nach erneutem Öffnen.

Die gemessenen 5:20 Minuten des ersten lokalen Auftrags und 1:11 Minuten der CLI-Korrektur sind **kein Geschwindigkeitsvergleich der Modelle**: Die Aufträge hatten erheblich unterschiedlichen Umfang. Sie dokumentieren nur die erlebte Wartezeit dieser beiden Schritte.

## Nachweise und Grenzen

![Aufgabe bleibt nach vollständigem Neustart erhalten](I:/Anvil/anleitungen/produktkonzept-bilder/15-tageswerk-neustart.png)

![Sichtbare Validierung nach echter CLI-Korrektur](I:/Anvil/anleitungen/produktkonzept-bilder/16-tageswerk-validierung.png)

![Fertige Testrunde und Abbruchtext](I:/Anvil/anleitungen/produktkonzept-bilder/17-tageswerk-ruecknahme-vorher.png)

![Arbeitsbereich mit zusätzlichen problematischen Standarddateien](I:/Anvil/anleitungen/produktkonzept-bilder/18-tageswerk-speicherkonflikt.png)

![Endstand nach Rücknahme und erneutem Öffnen](I:/Anvil/anleitungen/produktkonzept-bilder/19-tageswerk-endstand.png)

Alle Anwendungsänderungen stammen aus Aufträgen, die in Anvils Oberfläche eingegeben wurden. Es wurde kein Anwendungscode als externe Testvorlage vorgeschrieben und keine Modellantwort simuliert. Die ergänzenden Datei- und Quelltextlesungen dienten der Kontrolle des Speicherergebnisses und der Eingrenzung beobachteter Probleme.

Dies ist ein ausführlicher Test eines zusammenhängenden Produktablaufs, keine vollständige Abnahme sämtlicher Anvil-Funktionen. Git, MCP, Plugin-Installation, andere Programmiersprachen, Cloud-API-Anbieter, große Projekte, Langzeitbetrieb und umfassende Barrierefreiheit waren hier nicht Gegenstand. Die neuen Anvil-Befunde sind dokumentiert, aber in diesem Test nicht im Produktcode repariert.
