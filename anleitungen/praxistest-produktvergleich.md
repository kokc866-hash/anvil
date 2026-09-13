# Anvil: fünf Produktaufgaben im Praxistest

13. September 2026 · lokaler Stand nach Release 1.3.26 · Erstprüfung abgeschlossen. Die anschließenden Reparaturen und die Korrektur des SVG-Befunds stehen in [Praxistest-Reparaturen](praxistest-reparaturen.md).

**Ergebnis:** Fehlerkorrektur, Mehrdatei-Erweiterung und lesender Notion-Aufruf funktionieren. Der Erstnutzungsablauf funktioniert im frischen Profil. Die Godot-Anbindung und Rücknahme funktionieren einschließlich Neustart, aber der Agent verändert beim Farbauftrag zusätzlich die Bildgeometrie. Damit besteht die enge Vorgabe „nur diese Eigenschaften ändern“ nicht vollständig. Für eine pauschale Gleichwertigkeit mit Konkurrenzprodukten liefert dieser kleine Test keine Grundlage.

## Methode

Die echte Desktop-App wurde neu gestartet und über ihre Oberfläche bedient. Die vorhandene Codex-CLI-Anmeldung, Modell gpt-5.6-terra und Thinking Low wurden verwendet. Keine simulierten Modellantworten. Getrennte Projekte liegen unter `artifacts/praxis-20260913`. Die Testvorbereitung und unabhängige Auswertung stammen vom Prüfer; die Reparatur und Erweiterungen schreibt Anvils Agent selbst.

Die Testprojekte wurden im nativen Windows-Dialog geöffnet. Browserausgaben wurden in Anvils tatsächlichem Run-Fenster bedient. Zustandsdaten werden zur Nachweisführung gelesen; Agentenantworten und Projektsicherungen wurden nicht künstlich gesetzt. Es wurden keine vertraulichen Notion-Seiteninhalte abgefragt und keine Dienstdaten verändert. Zum Abschluss wurden das vorherige Ollama-Modell und der Aufgabenplaner wiederhergestellt. Beim abschließenden Rückwechsel blieb die native Auswahl ohne Projektwechsel; Anvils vorhandene Öffnen-Funktion mit dem bekannten Ordnerpfad funktionierte anschließend. Diese Aufräumaktion wird nicht als bestandener Dialogtest gewertet.

Dies ist eine Abnahme kleiner, gezielt gewählter Aufgaben auf einem Rechner, kein Vergleichsbenchmark und kein Test mit unabhängigen Erstnutzern. Die Konkurrenz wurde nicht ausgeführt. Geldkosten sind mangels belastbarer Abrechnung nicht angegeben.

## Ergebnisse

| Aufgabe | Ergebnis | Nachweis |
|---|---|---|
| Fehler finden, beheben und prüfen | Bestanden | Vorher zwei von drei Tests rot; nach Anvils Reparatur alle drei grün. Oberfläche: 10 % Rabatt auf 60 Euro ergibt 54 Euro, 50 % ergibt 30 Euro. |
| Funktion über mehrere Dateien | Bestanden mit Ablaufmängeln | Logik, Ereignisbehandlung, HTML und Tests geändert. Fünf Tests bestehen. Sichtbare Ergebnisse: 58,90 Euro; ohne Versand 54 Euro; mit 50 % Rabatt und Versand 34,90 Euro. |
| Engine-Szene und Assets ändern und zurücknehmen | Teilweise bestanden | Anvil ändert Szene und SVG, prüft und startet Godot erfolgreich. Titel, Position und Farbe stimmen, aber Bildgröße und Rundungen wurden zusätzlich verändert. Rücknahme nach vollständigem Anvil-Neustart stellt alle fünf Ausgangsdateien bytegenau wieder her. Nach erneutem Import und Szenenstart durch Anvil ist die ursprüngliche Darstellung wieder sichtbar. |
| Angemeldeten Dienst tatsächlich nutzen | Bestanden, lesender Umfang | Nach Anvil-Neustart ohne Anmeldung oder manuelles Nachladen: Notion-Kontoinformation und echte Suche nach „Anvil“ erfolgreich. Antwort `results: []`, korrekt als keine Treffer dargestellt. |
| Erster Erfolg ohne Erklärung | Technischer Ablauf bestanden | Frisches, getrenntes Desktop-Profil. „Beispiel ohne KI starten“ öffnet den Zähler. Zweimal „Eins dazu“ ergibt 2. 21 Sekunden zwischen Beispielstart und Nachweis einschließlich automatisierter Beobachtung; keine gemessene menschliche Einarbeitungszeit. |

Anvil meldete für die Agentenrunden 41,5 Sekunden (Fehlerkorrektur), 116,0 Sekunden (Versandfunktion) und 50,8 Sekunden (Godot-Änderung). Einrichtung und unabhängige Prüfungen sind darin nicht enthalten. Bei keiner dieser drei Runden griff der Prüfer korrigierend in die erstellten Dateien ein. Die acht zusätzlichen Rechenprüfungen außerhalb des Agentenprojekts bestehen ebenfalls. Die Engine-Abnahme betrifft Godot; Unity und Unreal wurden in diesem Durchlauf nicht getestet. Das Bild ist ein SVG; dieser Lauf ersetzt keinen separaten Test großer binärer Engine-Assets.

## Produktbefunde

1. **Checkliste und Ergebnis laufen auseinander.** Bei erfolgreicher Fehlerkorrektur und erfolgreicher Notion-Suche bleiben Schritte offen. Die Anzeige behauptet richtigerweise keine vollständig abgeschlossene Checkliste, verlangt dem Nutzer aber unnötige Interpretation ab.
2. **Abschluss nach automatischem Run ist widersprüchlich.** Die Versandrunde zeigt gleichzeitig „Aktueller Stand noch nicht durch Run bestätigt“ und „Automatischer Run nach der letzten Änderung erfolgreich“. Die unabhängige Bedienprüfung bestätigt die Endfassung. Die Meldung muss aus dem zuletzt geprüften Stand neu abgeleitet werden.
3. **Ein Run-Aufruf antwortete zwischenzeitlich nicht.** Anvil meldete den Fehler ehrlich und erreichte später ohne Korrekturauftrag des Prüfers eine funktionierende Ausgabe. Während dieses Abschnitts wurde eine zweite Instanz mit getrenntem Profil für den Erstnutzungstest gestartet. Die Ursache und Reproduzierbarkeit des Run-Problems sind noch nicht nachgewiesen; es wird nicht als gesicherter Fehler im Einzelinstanzbetrieb ausgegeben.
4. **Der Agent erweitert den Änderungsumfang ohne Auftrag.** Aus dem roten SVG mit 128 × 128 Pixeln und Eckenradius 16 wird ein grünes Rechteck mit 120 × 80 Pixeln ohne Rundungen. Nur die Farbe war beauftragt. Das ist ein Fehler der erzeugten Änderung; die Engine-Anbindung führt sie korrekt aus. Die bytegenaue Rücknahme beseitigt auch diese unbeabsichtigte Änderung.
5. **Engine-Zeiten werden falsch dargestellt.** Der Check dauert ungefähr zwei Sekunden, die Konsole zeigt „1937.00s“; beim Start „2509.00s“. Die Spur zeigt dagegen zwei Sekunden. Millisekunden und Sekunden werden im Ausgabepfad uneinheitlich behandelt.
6. **Alte Testergebnisse wirken im neuen Projekt weiter.** Beim Wechsel vom Warenkorb zur Godot-Szene steht weiter „Tests 5/5“. Die Ausgabe enthält noch die Warenkorb-Prüfung. Ohne sichtbare Zuordnung kann das als Prüfung des neuen Projekts missverstanden werden.

## Konsequenz für das Produkt

Die Stärke ist jetzt anhand echter Arbeitsabläufe belegbar: Modellzugang, Dateien, Tests, externe Dienste und Godot arbeiten zusammen; Änderungen überstehen Neustarts und lassen sich zurücknehmen. Die nächste Qualitätsstufe verlangt konsistente Abschluss- und Prüfanzeigen sowie strengere Einhaltung des beauftragten Änderungsumfangs. Mehr Katalogeinträge würden diese Befunde nicht lösen. In diesem Auftrag wurden die Befunde dokumentiert, keine Anvil-Produktionsdateien repariert.

## Belege

`artifacts/praxis-20260913/bug-round.json`, `feature-round.json`, `notion-result.json`, `first-use.json`, `shop-independent-result.json`, `godot-round.json`, `godot-before-hashes.json`, `godot-after-files.json`, `godot-restore-result.json`, `godot-recheck-round.json`; Screenshots `bug-preview.png`, `feature-preview.png`, `first-use-start.png`, `first-use-result.png`, `godot-before.png`, `godot-after.png`, `godot-restore-preview.png`, `godot-restored.png`. Die nachträgliche unabhängige Rechenprüfung steht in `verify-shop.mjs` außerhalb des vom Agenten bearbeiteten Projekts.
