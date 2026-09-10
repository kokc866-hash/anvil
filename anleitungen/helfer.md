# Helfer

Stand: Anvil 1.3.22. Vorhandene Helferideen, Schalter, Profile und Projektinhalte bleiben erhalten.

## Verlässliche Zuordnung

Hintergrundaufgaben gehören zu dem Projekt und der Chatrunde, in denen sie begonnen haben. Nach einem Projektwechsel, Chatwechsel oder einer neu begonnenen Runde werden verspätete Ergebnisse verworfen. Das gilt auch für Folgefragen, Dateihinweise, Review-Hinweise und die heuristischen Ersatzantworten. Neuere Vorschläge haben Vorrang vor älteren Anfragen für dieselbe Aufgabe.

Automatisch gelernte Fakten berücksichtigen sowohl **Gedächtnis an** als auch dessen Einstellung **Automatisch verdichten**. Ausschalten während einer laufenden Aufgabe verhindert das spätere Speichern. Manuelle Gedächtnisaktionen bleiben erhalten.

**Autonomie → Aus** unterbindet automatische Modellaufgaben. Ausdrücklich angeklickte Aktionen wie eine Erklärung, die Commit-Zeile oder eine kurze lokale Ask-Antwort bleiben entsprechend ihren eigenen Schaltern verfügbar. Einfache, deterministische Bedienhilfen benötigen weiterhin kein Modell.

## Laden und abbrechen

Gleichzeitige Ladeanforderungen für dasselbe Modell teilen sich einen Ladeauftrag. **Laden abbrechen**, **Entladen** und **Helfer aus** machen einen laufenden Ladeauftrag ungültig. Eine verspätete Fertigmeldung kann den Helfer nicht wieder einschalten. GPU-Worker und direkte GPU-Ausführung bleiben unterstützt; bei einem nicht verfügbaren Worker kann Anvil direkt laden.

Kurze UI-Aufgaben haben eigene Fristen. Andere Aufgaben erhalten ein begrenztes Ausführungsbudget anhand ihrer maximalen Antwortlänge. Nach einem Zeitlimit fordert Anvil den Abbruch an und gibt der laufenden Berechnung kurz Zeit zum Beenden. Solange das nicht bestätigt ist, startet auf derselben Engine keine zweite Berechnung. Nur ein weiterhin blockierter Helfer wird entladen und als Fehler angezeigt. Danach lässt er sich unter **Helfer → Laden** erneut starten.

Leere Antworten und reine Thinking-Blöcke gelten nicht als erfolgreicher Test. Abbruch, Zeitlimit und Fehler erscheinen im begrenzten Helferprotokoll; erfolgreiche Modell-, Cache- und Heuristikantworten bleiben unterscheidbar.

## Modelle und Ablage

- **Neu laden** startet den Helfer mit den gewählten lokalen Einstellungen und vorhandenen Dateien neu.
- **Update prüfen** liest die Online-Revision. Die Aktion verändert nicht den Betriebszustand und blockiert anschließend nicht den Laden-Knopf.
- **Modelle → Aktualisieren** überprüft die Modelldateien anhand ihrer Serverrevision. Gleiche Dateigröße allein genügt nicht, um eine Datei als unverändert anzusehen.
- **Modelle → Weg** beendet ein betroffenes Modell und entfernt dessen Dateien und Cache-Einträge einschließlich der zugehörigen fp32-Variante. Andere Modelle und Pins bleiben bestehen.

Neue Downloads entstehen zunächst in einer getrennten Arbeitsablage. Erst eine vollständige Installation ersetzt die vorherige. Die Prüfung umfasst Gewichtsdateien mit ihren angegebenen Größen, Tokenizer und die Modell-WASM. Fehlerhafte JSON-Dateien, abgeschnittene Downloads und ein Abbruch ersetzen keine vollständige alte Installation. Gleichzeitige Downloads desselben Modells werden zusammengeführt.

Nach einem Anvil-Absturz während des Austauschs stellt der nächste Start eine zurückgelassene ursprüngliche Installation wieder bereit. Eine vollständig heruntergeladene Erstinstallation kann fertiggestellt werden. Vorhandene Modellordner werden dabei nicht überschrieben. Unvollständige Arbeitskopien werden aufgeräumt; Sicherungskopien bleiben erhalten, solange sich das sichtbare Modell nicht als vollständig prüfen lässt.

Übernahme, Download und Entfernen sind pro Modell aufeinander abgestimmt. **Weg** bricht frühere Dateioperationen ab und wartet auf geschlossene Dateien, bevor es löscht. Auch vorgemerkte Updates, ausstehende Manifestabfragen und ältere Vorladeanfragen können das entfernte Modell anschließend nicht wieder installieren. Zugehörige Wiederherstellungskopien werden beim ausdrücklichen Entfernen mit gelöscht; ein später angeklicktes Laden funktioniert weiterhin.

Vollständige ältere Installationen werden beim nächsten Laden lokal übernommen. Dabei wird das ältere `ndarray-cache.json` für die aktuelle Runtime als `tensor-cache.json` bereitgestellt und eine Prüfliste erstellt. Dafür müssen die Gewichte nicht erneut heruntergeladen werden. Beschädigte oder fehlende Dateien benötigen weiterhin eine Reparatur durch Laden bzw. Aktualisieren.

Die lokale Verbindung bleibt durch einen Zugangstoken geschützt. Die Cache-Adresse enthält stattdessen Modell und Dateirevision; wechselnde Ports oder Tokens erzeugen keine zusätzlichen Modellkopien bei jedem Anvil-Neustart. Beim Entfernen werden auch Einträge früherer lokaler Token-Adressen berücksichtigt. OPFS-, IndexedDB- und ältere Cache-Ablagen werden modellbezogen behandelt.

Explizit gewählte kleine und 4B-Modelle, Custom-IDs und Pins werden beim Neustart nicht mehr durch eine pauschale Standardmodell-Migration ersetzt.

## Wirksame Helfereinstellungen

**GPU High-Performance** wird auch bei der eigentlichen Modellausführung berücksichtigt. Es bleibt eine Adapterpräferenz; das System entscheidet, welcher Adapter verfügbar ist. Context, Sliding und GPU-Einstellungen gelten nach **Neu laden**. Die Statusanzeige nennt die tatsächlich geladenen Vorgaben.

**GPU warm halten** sendet bei eingeschalteter Option nach 70 Sekunden Leerlauf einen kurzen Ping. Während Agent-Arbeit, einer anderen Helferaufgabe, einer Pause, im verborgenen Fenster und bei Autonomie Aus bleibt er aus. Ausschalten oder Entladen entfernt den Timer.

Der gewählte Context überschreibt die Standardbelegung der Runtime (zum Beispiel 4K); ausdrücklich hinterlegte Modellgrenzen bleiben erhalten. Es gibt keine pauschale 8K-Grenze oder vorsorgliche Kürzung anhand der GPU-Puffergröße. Mit **Puffer anpassen** wird nur nach einem GPU-Speicherfehler einmal mit 2K erneut geladen. Dein gewählter Wert und dein Modellprofil bleiben dabei erhalten. Die Statusanzeige nennt bei einer Anpassung den geladenen und gewünschten Context sowie den Grund. Auch ein erneuter Versuch ohne nicht unterstütztes Sliding verändert die gespeicherte Einstellung nicht.

Modellspezifische RNN-History-Vorgaben bleiben erhalten. Qwen3-Vorlagen nutzen für kurze Helferaufgaben den von WebLLM unterstützten Modus ohne zusätzliche Thinking-Ausgabe. Thinking-Blöcke werden nicht als Titel, Fakten oder Codevorschläge ausgegeben.

## Integration

Wird eine Helfer-Antwort durch einen neuen Chat-Auftrag, Stop oder ein Zeitlimit ungültig, kann der Chat sofort weiterarbeiten. Bereits gestartete GPU-Berechnungen dürfen bis zu 30 Sekunden auslaufen; ihre veralteten Ergebnisse werden verworfen. Währenddessen startet keine zweite Helfer-Berechnung auf derselben GPU-Engine. Antwortet die GPU wieder, bleibt das Modell geladen. Erst wenn sie danach weiterhin belegt ist, wird der Helfer entladen; die Fehlermeldung nennt die betroffene Aufgabe und den Auslöser.

Die Run-Auswahl darf ausschließlich ausführbare Projektdateien auswählen. Bei einer nicht ausführbaren aktiven Datei kann der eingeschaltete Run-Helfer eine dieser Startdateien empfehlen. Markdown, JSON, Referenzen und interne Projektdateien gelangen dadurch nicht in den Compiler.

**Unterschlangen beheben** kann den eingeschalteten Helfer für einen kurzen Hinweis an den Agenten verwenden. Die ursprünglichen Fehlermeldungen bleiben maßgeblich und werden weitergegeben.

Review- und Diff-Hinweise erhalten begrenzte Ausschnitte der tatsächlichen Änderungen. Ein bloßes Dateiverzeichnis wird nicht mehr als erfolgreiches Review ausgegeben. Die Anzeige nennt Modellhinweise ausdrücklich **Helfer-Hinweis**. Eine lokale Ask-Antwort erhält Frage und Kontext getrennt; langer Gedächtniskontext verdrängt die eigentliche Frage nicht mehr.

Der Antwortcache berücksichtigt Modelllaufzeit, Temperatur, Ausgabelimit, Wiederholungsstrafe, Stop-Zeichen und JSON-Anforderungen. Änderungen dieser Vorgaben liefern keine unpassende alte Antwort. Sichtbare Modellantworten beachten die eingestellte Sprache.

## Prüfung

`npm run test:helper` prüft Lebenszyklus, Projektzuordnung, Zeitlimits, Cache, Modellwahl sowie simulierte Downloads und die Übernahme älterer Installationen. Enthalten sind auch Unterbrechungen während des Modellupdates, die Wiederherstellung beim Neustart und das Entfernen bei laufender Übernahme oder Manifestabfrage. `npm run test:helper:browser` prüft die Desktop-Bedienung; mit `-- --production` läuft sie gegen den Desktop-Produktionsbuild. Dabei werden keine Modelle heruntergeladen und keine Anbieter angesprochen.

Eine echte Inferenz auf der Windows-GPU ist durch diese Simulationen nicht abgedeckt.

Nach einem festhängenden Abbruch oder GPU-Verlust werden auch der Ladefortschritt und die zuletzt geladene Konfiguration zurückgesetzt. Dadurch erscheinen „bereit“ und „Nicht geladen“ nicht gleichzeitig. Die bereits vorhandenen längeren, auftragsbezogenen Zeitlimits und die Abbruchfrist bleiben erhalten; eine langsame, erfolgreich abgebrochene Anfrage entlädt das Modell nicht pauschal.
