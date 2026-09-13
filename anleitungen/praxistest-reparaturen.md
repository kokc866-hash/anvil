# Reparaturen aus dem Produkt-Praxistest

13. September 2026 · lokaler Entwicklungsstand nach 1.3.26.

## Was geändert wurde

1. **Checkliste:** Neue Agentenpläne ordnen Schritte ausdrücklich dem Lesen, Ändern, Starten, Prüfen, Dienstaufruf oder Berichten zu. Erfolgreiche Werkzeugaufrufe aktualisieren den passenden Schritt; eine spätere Vergleichsprüfung wird nicht durch frühes Lesen abgehakt. Bestehende Pläne bleiben lesbar. Unbelegte Schritte bleiben offen; die Anzeige ist kein Beweis, dass jede inhaltliche Vorgabe korrekt umgesetzt wurde.
2. **Abschluss:** Modelltext und Anvils Prüfmeldung sind getrennt. Ein erfolgreicher automatischer Run ersetzt eine überholte Warnung. Fehlgeschlagene Schreibvorgänge und Prüfungen bleiben sichtbar; eine unerwartete Ausführungsstörung wird nicht von bereits gestreamtem Erfolgstext verdeckt.
3. **Run-Fenster:** Eine erneute Verwendung hebt den noch ausstehenden Schließtimer der vorherigen Agentenaktion auf. Der konkrete Ablauf wurde vor der Änderung reproduziert. Ob er auch den einzelnen ursprünglichen Fehler verursachte, lässt sich rückwirkend nicht beweisen.
4. **Änderungsumfang und Bilddaten:** SVG-Quelltext ist beim Lesen und Suchen zugänglich. Anvil behält Originaldateien im Arbeitsstand und schreibt interne Bildbeschreibungen nicht mehr am Rundenende zurück. Bereits angewandte Dateien werden nicht nochmals über neuere Änderungen kopiert. Für vollständige Ersetzungen vorhandener Dateien muss der Agent begründen, warum eine gezielte Bearbeitung nicht ausreicht. Diese Begründung ersetzt keine inhaltliche Prüfung der Änderung.
5. **Engine-Zeiten:** Millisekunden des lokalen Dienstes werden beim Übergang in die Konsolenausgabe in Sekunden umgerechnet. Andere Laufzeiten werden nicht nochmals umgerechnet.
6. **Projektzuordnung:** Ein Projektwechsel entfernt aktuelle Tests und Konsolenausgaben des vorherigen Projekts. Spät eintreffende Tests und Konsolenbefehle schreiben nicht in das neue Projekt. Historische Chatnachweise bleiben erhalten.

Zusätzlich wurden zwei im weiteren Test belegte Fehler behoben: Ungültige verschachtelte CLI-Werkzeugargumente gelangen zur normalen Fehlerkorrektur des Modells, ohne teilweise ausgeführt zu werden. Unkorrigierte Fehler bleiben fehlgeschlagen. Bei der Wiederherstellung älterer Helfermodelle wartet Anvil sämtliche Metadaten-Lesevorgänge ab, damit Windows keine noch geöffneten Dateien verschieben muss.

## Nachweise und Grenzen

Gezielte Regressionen prüfen positive und negative Fälle: fehlgeschlagene oder veraltete Runs, spätere Benutzeränderungen, unveränderte SVG- und Binärbilddaten, fehlerhafte CLI-Aufrufe, Projektwechsel während einer laufenden Prüfung und das Schließen wiederverwendeter Run-Fenster.

Die praktische Prüfung verwendet den gebauten Desktop-Stand in einem getrennten Profil, die vorhandene Codex-Anmeldung mit gpt-5.6-terra und Godot 4.7.1. Die offene Benutzersitzung wird nicht geschlossen. Der lokale Prüfdienst ist getrennt; die ersten Versuche scheiterten an einer Kollision im Prüfaufbau mit dem Helferdienst und an zunächst deaktivierten Engine-Werkzeugen. Diese Versuche zählen nicht als erfolgreiche Abnahme.

Godot-Prüfung und Szenenstart funktionieren. In der Konsole stehen 2,244 beziehungsweise 2,511 Sekunden. Nach Abschluss stimmt die SVG-Datei bytegenau mit der Ausgangsdatei überein, abgesehen von der beauftragten Farbe; 128 × 128 Pixel und Eckenradius 16 bleiben erhalten. Die gestartete Szene zeigt das grüne, abgerundete Quadrat.

Die ursprüngliche Rücknahme wurde im ersten Praxistest korrekt ausgeführt. Bei der anschließenden reinen Engine-Runde wurde die SVG-Datei jedoch durch die alte Abschlussverarbeitung wieder beschädigt. Dieser nachträglich entdeckte Fehler korrigiert die damalige Schlussfolgerung zur dauerhaften Unverändertheit. Das beschädigte Testbild wurde aus dem passenden, per SHA-256 bestätigten Sicherungsstand wiederhergestellt; der fehlerhafte Inhalt bleibt als Nachweis erhalten.

Die Dienstzuordnung der Checkliste wird an der Werkzeuggrenze geprüft. Notion wird in diesem getrennten Profil nicht erneut angemeldet; die erfolgreiche echte Notion-Suche aus dem ersten Praxistest bleibt ein früherer Nachweis. Unity und Unreal sind nicht Bestandteil dieser Reparaturabnahme.

Lokale Belege: `artifacts/praxis-reparatur-20260913/`. Der abschließende Build und die Ergebnisse sind unten ergänzt.

## Abschließende Abnahme

- **Gesamte Testsuite:** 1.015 bestanden, 0 fehlgeschlagen, 6 übersprungen (`final-tests.log`).
- **Desktop-Build:** Typprüfung, Produktionsbuild und Verpackung der Oberfläche erfolgreich (`final-build.log`). Die Prüfung auf fehlerhafte Änderungen mit `git diff --check` ist ebenfalls erfolgreich.
- **Echter Agentenauftrag über mehrere Dateien:** Anvil hat im Warenkorb Rabatt, optionalen Versand, Oberfläche und Tests angepasst. Die vier fachlichen Tests bestehen; die Checkliste zeigt 6/6 und der Abschluss einen erfolgreichen automatischen Run (`shop-final.json`).
- **Unabhängige Bedienprüfung:** In Anvils laufender Vorschau ergeben 60 Euro und 10 Prozent Rabatt 54,00 Euro. Nach Aktivieren von „Mit Versand“ und Berechnen stehen 58,90 Euro bei 4,90 Euro Versand. Die Vorschau wurde sichtbar geprüft; keine unbehandelten Seitenfehler (`shop-browser.json`, `shop-shipping.png`).
- **Projektwechsel:** Beim Wechsel des tatsächlichen Prüfprojekts sind aktuelle Testergebnisse und Konsole leer (`project-switch.json`).
- **Godot im endgültigen Build:** Erkennung, Importprüfung und Szenenstart erfolgreich; Checkliste 5/5, Abschluss „Fertig“. Die Konsole zeigt 2,131 Sekunden für die Prüfung und 2,505 Sekunden für den Start. Die native Szene wurde sichtbar geprüft und die SVG-Datei anschließend erneut bytegenau gegen die Ausgangsdatei mit ausschließlich geänderter Farbe verglichen. Keine unbehandelten Seitenfehler (`godot-final.json`, `godot-final-green.png`, `final-built-anvil.png`).

Vor dieser letzten erfolgreichen Runde war beim vorbereiteten Ordnerwechsel eine inzwischen vorhandene `.anvil/session.md` nicht mit eingelesen worden. Anvil verweigerte den Speicherabgleich und kennzeichnete die Engine-Prüfung als fehlgeschlagen. Nach vollständigem Einlesen und Abgleichen verlief die Wiederholung erfolgreich. Auch dieser Fehler des Prüfaufbaus bleibt dokumentiert (`godot-final-setup-failure.json`).

Die Prüfprojekte und Verbindungen wurden im getrennten Profil vorbereitet; die Modellaufträge liefen über Anvils Eingabefeld und echte Werkzeugausführung. Automatisierte Tests mit ersetzten Systemgrenzen sind davon getrennte Regressionen. Der Stand ist lokal gebaut; es wurde kein Release veröffentlicht.
