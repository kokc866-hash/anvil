# Änderungen prüfen

Im Git-Bereich lässt sich **Änderungen prüfen** aufklappen. Wähle einen vorhandenen Ausgangsstand und bei Bedarf einzelne Dateien. **Prüfung starten** sendet den Auftrag über den vorhandenen Fragen-Modus an das eingestellte Hauptmodell. Es verändert keine Projektdateien und führt keine Programme aus.

Der bisherige Befehl **Änderungen vom Agenten prüfen lassen** im Git-Bereich, Kontextmenü und in der Befehlssuche nutzt denselben Prüfablauf direkt. Er verwendet die bekannten Ausgangsinhalte oder einen passenden Sicherungspunkt. Ist kein vollständiger Ausgangsstand bekannt, wird die fehlende Vergleichsbasis ausdrücklich ausgewiesen. Der Befehl startet keine automatische Formatierung oder Reparatur. Für eine andere Basis oder einen kleineren Prüfbereich dient der aufklappbare Bereich.

Anvil hält die Review-ID, das Projekt, die gewählte Vergleichsbasis und Fingerabdrücke der aufgenommenen Dateien fest. Verfügbare Ausgangsinhalte werden begrenzt gespeichert. Fehlt ein Ausgangsstand oder passt er nicht vollständig ins Budget, wird das ausdrücklich angezeigt. Ein Sicherungspunkt aus einem anderen Projekt dient nicht als Vergleichsbasis.

Die Anzeige unterscheidet:

- **Geprüft:** Das Modell hat einen Bericht abgegeben. Erfolgreiche native Lesezugriffe decken den vollständigen aufgenommenen Dateistand ab.
- **Übersprungen:** Das Modell hat die Datei ausdrücklich mit einem Grund ausgelassen.
- **Offen:** Ein Bericht oder vollständige passende Lesebelege fehlen. Nicht im Teilbericht erwähnte Dateien bleiben offen.
- **Veraltet:** Der aktuelle Inhalt unterscheidet sich vom aufgenommenen Stand. Historische Befunde bleiben erkennbar; ihr Folgeauftrag ist gesperrt, bis erneut geprüft wurde.

Entfernte Dateien erhalten eine gesonderte Prüfung ihrer gespeicherten Vergleichsbasis. Ein Lesen einer aktuellen gleichnamigen Datei zählt dafür nicht. Große Dateien können in mehreren lückenlosen Fenstern gelesen werden. Abgeschnittene Antworten, Bildplatzhalter und vom Modell erfundene Belege vervollständigen keine Abdeckung.

Ein konkreter Befund enthält Datei, Zeile, Titel und Begründung. **Nur diesen Befund bearbeiten** erstellt einen eng begrenzten normalen Agentenauftrag. Vor dem Senden vergleicht Anvil den Dateistand erneut. Nach einer Änderung benötigt der neue Inhalt ein neues Review.

„Abdeckung abgeschlossen“ bezeichnet nur die dokumentierte Review-Abdeckung. Die fachliche Bewertung stammt vom Modell. Fingerabdrücke und Leseprotokolle beweisen weder Fehlerfreiheit noch bestandene Tests, sichtbares Rendering oder korrektes Bedienverhalten. Es gibt keine automatische Freigabe und keine Nutzerzertifizierung.

## Speicherung und Grenzen

Review-Metadaten und begrenzte Ausgangsinhalte verwenden Anvils vorhandene lokale Sicherung. Die Historie enthält höchstens acht Reviews je Projekt, insgesamt 24 Reviews und 12 MiB. Ein Auftrag umfasst höchstens 500 Dateien; Berichte und Befunde haben zusätzliche Größen- und Anzahlgrenzen. Persönliche Profile oder Modellzugänge werden dafür nicht kopiert. Die üblichen Geheimnispfade bleiben ausgeschlossen.

Die native Grundlage `electron/review-artifacts.mjs` speichert ausgewählte Prüfmedien außerhalb des kleinen Job-Snapshots. Ein Manifest verbindet Artefakt-ID, Projekt, Auftrag, Auftragsversion, Werkzeug, Schrittnummer, Beleg-ID, Dateifingerabdrücke und SHA-256 der gespeicherten Bytes. Standardgrenzen: 10 MiB je Artefakt, 128 MiB und 256 Artefakte insgesamt. Eine volle Ablage löscht keine vorhandenen Nachweise automatisch.

Beim Öffnen werden fehlende, veränderte und veraltete Artefakte unterschieden. Ohne übergebenen aktuellen Datei- und Auftragsstand ist die Aktualität ausdrücklich unbekannt. Ein Screenshot bleibt eine Bildaufnahme; er wird durch die Speicherung nicht zum Beweis eines bestätigten Zielverhaltens. Angaben über beobachtetes Verhalten stammen vom ausführenden Werkzeug beziehungsweise Aufrufer.
