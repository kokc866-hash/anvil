# Helfer

Die beschriebenen Helferfunktionen sind im veröffentlichten Anvil 1.3.26 enthalten. Vorhandene Helferideen, Schalter, Profile und Projektinhalte bleiben erhalten.

## Verlässliche Zuordnung

Hintergrundaufgaben gehören zu dem Projekt und der Chatrunde, in denen sie begonnen haben. Nach einem Projektwechsel, Chatwechsel oder einer neu begonnenen Runde werden verspätete Ergebnisse verworfen. Das gilt auch für Folgefragen, Dateihinweise, Review-Hinweise und die heuristischen Ersatzantworten. Neuere Vorschläge haben Vorrang vor älteren Anfragen für dieselbe Aufgabe.

Automatisch gelernte Fakten werden nur gespeichert, wenn unter Gedächtnis sowohl **Gedächtnis verwenden** als auch **Wissen automatisch ableiten** aktiviert sind. Wenn du eine dieser Optionen während einer laufenden Aufgabe ausschaltest, wird deren Ergebnis nicht nachträglich gespeichert. Manuelle Gedächtnisaktionen bleiben davon unberührt.

**Autonomie → Aus** unterbindet automatische Modellaufgaben. Ausdrücklich angeklickte Aktionen wie eine Erklärung, die Commit-Zeile oder eine kurze lokale Antwort im Modus „Fragen“ bleiben entsprechend ihren eigenen Schaltern verfügbar. Einfache, deterministische Bedienhilfen benötigen weiterhin kein Modell.

## Laden und abbrechen

Gleichzeitige Ladeanforderungen für dasselbe Modell teilen sich einen Ladeauftrag. **Laden abbrechen**, **Entladen** und **Helfer aus** machen einen laufenden Ladeauftrag ungültig. Eine verspätete Fertigmeldung kann den Helfer nicht wieder einschalten. GPU-Worker und direkte GPU-Ausführung bleiben unterstützt; bei einem nicht verfügbaren Worker kann Anvil direkt laden.

Kurze UI-Aufgaben haben eigene Fristen. Andere Aufgaben erhalten ein begrenztes Ausführungsbudget anhand ihrer maximalen Antwortlänge. Nach einem Zeitlimit fordert Anvil den Abbruch an und gibt der laufenden Berechnung kurz Zeit zum Beenden. Solange das nicht bestätigt ist, startet auf derselben Engine keine zweite Berechnung. Nur ein weiterhin blockierter Helfer wird entladen und als Fehler angezeigt. Danach lässt er sich unter **Helfer → Laden** erneut starten.

Leere Antworten und reine Denkverläufe ohne Antwort gelten nicht als erfolgreicher Test. Abbruch, Zeitlimit und Fehler erscheinen im begrenzten Helferprotokoll. Dort bleibt erkennbar, ob eine erfolgreiche Antwort vom Modell, aus dem Zwischenspeicher oder aus festen Auswertungsregeln stammt.

## Modelle und Ablage

- **Neu laden** startet den Helfer mit den gewählten lokalen Einstellungen und vorhandenen Dateien neu.
- **Aktualisierung prüfen** fragt den online verfügbaren Modellstand ab. Die Aktion verändert nicht den Betriebszustand und blockiert anschließend nicht die Schaltfläche **Laden**.
- **Modelle → Aktualisieren** überprüft die Modelldateien anhand ihrer Serverrevision. Gleiche Dateigröße allein genügt nicht, um eine Datei als unverändert anzusehen.
- **Modelle → Entfernen** beendet das betroffene Modell und entfernt dessen Dateien und Cache-Einträge einschließlich der zugehörigen fp32-Variante. Andere Modelle und angeheftete Modelle bleiben erhalten.

Neue Downloads entstehen zunächst in einer getrennten Arbeitsablage. Erst eine vollständige Installation ersetzt die vorherige. Die Prüfung umfasst Gewichtsdateien mit ihren angegebenen Größen, Tokenizer und die Modell-WASM. Fehlerhafte JSON-Dateien, abgeschnittene Downloads und ein Abbruch ersetzen keine vollständige alte Installation. Gleichzeitige Downloads desselben Modells werden zusammengeführt.

Nach einem Anvil-Absturz während des Austauschs stellt der nächste Start eine zurückgelassene ursprüngliche Installation wieder bereit. Eine vollständig heruntergeladene Erstinstallation kann fertiggestellt werden. Vorhandene Modellordner werden dabei nicht überschrieben. Unvollständige Arbeitskopien werden aufgeräumt; Sicherungskopien bleiben erhalten, solange sich das sichtbare Modell nicht als vollständig prüfen lässt.

Übernahme, Download und Entfernen sind pro Modell aufeinander abgestimmt. **Entfernen** bricht frühere Dateioperationen ab und wartet, bis die Dateien geschlossen sind, bevor sie gelöscht werden. Auch vorgemerkte Updates, ausstehende Manifestabfragen und ältere Vorladeanfragen können das entfernte Modell anschließend nicht wieder installieren. Zugehörige Wiederherstellungskopien werden beim ausdrücklichen Entfernen ebenfalls gelöscht. Du kannst das Modell später jederzeit erneut laden.

Vollständige ältere Installationen werden beim nächsten Laden lokal übernommen. Dabei wird das ältere `ndarray-cache.json` für die aktuelle Runtime als `tensor-cache.json` bereitgestellt und eine Prüfliste erstellt. Dafür müssen die Gewichte nicht erneut heruntergeladen werden. Beschädigte oder fehlende Dateien benötigen weiterhin eine Reparatur durch Laden bzw. Aktualisieren.

Die lokale Verbindung bleibt durch einen Zugangstoken geschützt. Die Cache-Adresse enthält stattdessen Modell und Dateirevision; wechselnde Ports oder Tokens erzeugen keine zusätzlichen Modellkopien bei jedem Anvil-Neustart. Beim Entfernen werden auch Einträge früherer lokaler Token-Adressen berücksichtigt. OPFS-, IndexedDB- und ältere Cache-Ablagen werden modellbezogen behandelt.

Ausdrücklich gewählte kleine Modelle und Modelle mit 4 Milliarden Parametern, eigene Modell-IDs und angeheftete Modelle werden beim Neustart nicht durch ein Standardmodell ersetzt.

## Wirksame Helfereinstellungen

**Leistungsstarke GPU bevorzugen** wird auch bei der eigentlichen Modellausführung berücksichtigt. Die Einstellung ist eine Präferenz; das System entscheidet, welche Grafikkarte verfügbar ist. Änderungen an Kontextlänge, gleitendem Kontextfenster und GPU-Einstellungen gelten nach **Neu laden**. Die Statusanzeige nennt die tatsächlich geladenen Einstellungen.

**GPU einsatzbereit halten** sendet nach 70 Sekunden Leerlauf eine kurze Anfrage. Während eines Agentenauftrags, einer anderen Helferaufgabe oder einer Pause sowie bei verborgenem Fenster oder ausgeschalteter Autonomie werden keine solchen Anfragen gesendet. Wenn du die Option ausschaltest oder das Modell entlädst, endet auch die regelmäßige Prüfung.

Die gewählte Kontextlänge überschreibt die Standardbelegung der Laufzeitumgebung (zum Beispiel 4K). Ausdrücklich hinterlegte Modellgrenzen bleiben erhalten. Es gibt keine pauschale 8K-Grenze oder vorsorgliche Kürzung anhand der GPU-Puffergröße. Mit **Puffer anpassen** wird das Modell nur nach einem GPU-Speicherfehler einmal mit 2K erneut geladen. Dein gewählter Wert und dein Modellprofil bleiben dabei erhalten. Die Statusanzeige nennt bei einer Anpassung die geladene und die gewünschte Kontextlänge sowie den Grund. Auch ein erneuter Versuch ohne das nicht unterstützte gleitende Kontextfenster verändert die gespeicherte Einstellung nicht.

Modellspezifische RNN-History-Vorgaben bleiben erhalten. Qwen3-Vorlagen nutzen für kurze Helferaufgaben den von WebLLM unterstützten Modus ohne zusätzlichen Denkverlauf. Denkverläufe werden nicht als Titel, Fakten oder Codevorschläge ausgegeben.

## Integration

Wird eine Helfer-Antwort durch einen neuen Chat-Auftrag, durch Stoppen oder durch ein Zeitlimit ungültig, kann der Chat sofort weiterarbeiten. Die gestartete Modellanfrage darf bis zu 30 Sekunden auslaufen; ihre veralteten Ergebnisse werden verworfen. Währenddessen startet keine zweite Helfer-Berechnung auf derselben GPU-Engine. Antwortet die Laufzeit wieder, bleibt das Modell geladen. Bleibt die Anfrage nach der Abbruchfrist offen, wird der Helfer entladen; die Fehlermeldung nennt die betroffene Aufgabe und den Auslöser.

JSON-Aufgaben wie die Nutzungsauswertung (`usage`) fordern JSON über den Prompt an und prüfen die Antwort vor der Übernahme. Sie verwenden nicht die Grammatikvorbereitung von WebLLM 0.2.84: Deren Fehlerbehandlung kann eine Anfrage dauerhaft offen lassen. Ungültige Antworten werden nicht gecacht; die vorhandenen Ersatzverfahren bleiben aktiv. Ein Zeitlimit allein beweist keinen GPU-Defekt.

Als Startdateien kommen ausschließlich ausführbare Projektdateien infrage. Ist die aktive Datei nicht ausführbar, kann die aktivierte Ausführungshilfe eine passende Startdatei empfehlen. Markdown, JSON, Referenzen und interne Projektdateien gelangen dadurch nicht in den Compiler.

**Fehlermarkierungen beheben** kann den eingeschalteten Helfer für einen kurzen Hinweis an den Agenten verwenden. Die ursprünglichen Fehlermeldungen bleiben maßgeblich und werden weitergegeben.

Review- und Diff-Hinweise erhalten begrenzte Ausschnitte der tatsächlichen Änderungen. Ein bloßes Dateiverzeichnis wird nicht mehr als erfolgreiches Review ausgegeben. Die Anzeige nennt Modellhinweise ausdrücklich **Helfer-Hinweis**. Eine lokale Antwort im Modus „Fragen“ erhält Frage und Kontext getrennt; langer Gedächtniskontext verdrängt die eigentliche Frage nicht mehr.

Der Antwortcache berücksichtigt Modelllaufzeit, Temperatur, Ausgabelimit, Wiederholungsstrafe, Stop-Zeichen und JSON-Anforderungen. Änderungen dieser Vorgaben liefern keine unpassende alte Antwort. Sichtbare Modellantworten beachten die eingestellte Sprache.

## Prüfung

`npm run test:helper` prüft Lebenszyklus, Projektzuordnung, Zeitlimits, Cache, Modellwahl sowie simulierte Downloads und die Übernahme älterer Installationen. Enthalten sind auch Unterbrechungen während des Modellupdates, die Wiederherstellung beim Neustart und das Entfernen bei laufender Übernahme oder Manifestabfrage. `npm run test:helper:browser` prüft die Desktop-Bedienung; mit `-- --production` läuft sie gegen den Desktop-Produktionsbuild. Dabei werden keine Modelle heruntergeladen und keine Anbieter angesprochen.

Eine echte Inferenz auf der Windows-GPU ist durch diese Simulationen nicht abgedeckt.

Nach einem festhängenden Abbruch oder GPU-Verlust werden auch der Ladefortschritt und die zuletzt geladene Konfiguration zurückgesetzt. Dadurch erscheinen „bereit“ und „Nicht geladen“ nicht gleichzeitig. Die bereits vorhandenen längeren, auftragsbezogenen Zeitlimits und die Abbruchfrist bleiben erhalten; eine langsame, erfolgreich abgebrochene Anfrage entlädt das Modell nicht pauschal.
