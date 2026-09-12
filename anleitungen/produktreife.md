# Anvil bis zur Produktreife

12. September 2026 · Arbeitsplan auf Grundlage des lokalen Codes und der Desktop-Praxistests

**Fortgeschriebener Stand:** Die folgenden Abschnitte dokumentieren die ursprünglichen Lücken und Abnahmekriterien. Punkte 1 bis 6 wurden inzwischen technisch umgesetzt und nachgeprüft; die aktuellen Funktionen, Nachweise und verbleibenden Grenzen stehen im [Produktabschluss](produktabschluss.md). Insbesondere sind Zwangsbeenden und die unvollständige Dateirücknahme aus der ursprünglichen Bestandsaufnahme inzwischen behoben. Herausgeber, Lizenz, Supportkontakt und Signierung bleiben auf ausdrücklichen Wunsch für später offen. Die Freigabe ist damit nicht als erteilt zu verstehen.

## Entscheidung

**Als nächstes eine verlässliche Windows-Beta für eigene kleine Projekte fertigstellen.** Anvil hat den Kern dafür: Projektdateien, gewähltes Modell, Änderungen, Ausführung und fortsetzbare Arbeit. Der nächste Reifeschritt ist ein durchgängiger Ablauf vom Download bis zur zweiten Arbeitssitzung, den ein neuer Nutzer ohne Hilfe bewältigt.

Das ist eine vorgeschlagene erste Zielgruppe: Menschen, die Webseiten, kleine Anwendungen und Skripte mit ihren vorhandenen Modellen oder Zugängen bauen und weiterentwickeln möchten. Es ist noch kein gemessener Markt. Die vorhandenen erweiterten Funktionen bleiben erhalten; eine breitere Zusage für beliebige große Softwareprojekte wäre durch unsere Tests nicht gedeckt.

**Produktversprechen:** „Deine KI-Werkbank für eigene Projekte. Du wählst das Modell, siehst die Änderungen und prüfst das Ergebnis direkt.“

## Was bereits trägt

Der Tageswerk-Test belegt einen zusammenhängenden Arbeitsablauf: leeres Projekt über die Oberfläche anlegen, durch Ollama bauen lassen, selbst bedienen, mit Codex CLI verbessern, speichern, neu starten und weiterarbeiten. Die danach gefundenen Fehler bei Standarddateien, Rücknahme/Speichern und Abschlussmeldungen sind im lokalen Stand repariert und gezielt nachgeprüft.

Bereits vorhanden sind außerdem eine Ersteinrichtung, Installer-/ZIP-Erzeugung, Release-Prüfungen, Update-Anbindung, Profile, Thinking-Einstellungen, Anleitungen, Skills und MCP. Diese Grundlagen müssen vervollständigt und am ausgelieferten Paket belegt werden. Eine weitere allgemeine Funktionsliste löst die folgenden Lücken nicht.

## 1. Installation und Updates schützen die laufende Arbeit

**Vorrang vor einer breiteren Beta.** Der bestehende Installer-Test installiert das Paket, prüft die EXE und deinstalliert wieder. Er startet die installierte App nicht. Der Windows-Buildjob hat Node.js und Python eingerichtet; er belegt deshalb keinen Start auf einem normalen Rechner ohne Entwicklungsumgebung.

Im Setup steht zudem ein erzwungenes Beenden aller `Anvil.exe`-Prozesse. Daraus ergibt sich ein Risiko für ungespeicherte Arbeit. Das ist ein Codebefund, kein in dieser Prüfung herbeigeführter Datenverlust.

**Arbeitspaket:** Setup und Update müssen Anvil regulär schließen lassen oder verständlich auf das noch laufende Programm warten. Das tatsächliche Paket bekommt einen eigenen Abnahmetest.

**Fertig, wenn:**

- Setup und ZIP starten auf einer sauberen Windows-Umgebung ohne separat installiertes Node.js; die vollständige Oberfläche erscheint.
- Erstinstallation, zweiter Start und Aktualisierung einer älteren Version erhalten Projekt, Profil und Einstellungen.
- Ein Update bei ungespeicherten Änderungen bietet einen nachvollziehbaren Weg zum Speichern oder Abbrechen; kein erzwungenes Beenden.
- Ein frei gewählter beschreibbarer Installationsordner funktioniert. Fehlende Schreibrechte werden erklärt, ohne stillen Wechsel nach AppData.
- Deinstallation erhält Projektdateien und bewusst aufbewahrte Nutzerdaten. Die Oberfläche erklärt, was erhalten bleibt.
- Ergebnisse gehören zum genau geprüften Paket; ein erfolgreicher Quellcode-Test allein gibt es nicht zur Veröffentlichung frei.

**Signierung:** Im gesichteten Release-Workflow ist kein Signierweg belegt. Vor breiter Verteilung den Herausgeber und die Signatur des tatsächlichen Pakets prüfen und einen Signierweg einrichten. Electron empfiehlt Signierung für verteilte Anwendungen; eine garantierte Abwesenheit sämtlicher Windows-Warnungen wird daraus nicht abgeleitet. [Electron-Dokumentation](https://www.electronjs.org/docs/latest/tutorial/code-signing), [electron-builder für Windows](https://www.electron.build/docs/win/).

## 2. Wiederherstellung entspricht ihrem Namen

**Vorrang für das Vertrauen in Dateiänderungen.** Die reparierte Rücknahme setzt Änderungen an vorhandenen Dateien zurück. Sie entfernt neu entstandene Dateien noch nicht und unterstützt keinen leeren Ausgangsstand. „Zurück vor diese Runde“ kann deshalb mehr versprechen, als sie leistet.

**Arbeitspaket:** Vor der Aktion eine vollständige Liste zeigen: welche Dateien zurückgesetzt, wiederhergestellt oder entfernt würden. Eigene Änderungen nach der Runde erkennen und einen Konflikt erklären. Solange die vollständige Wiederherstellung fehlt, den sichtbaren Umfang ausdrücklich auf vorhandene Dateiänderungen begrenzen.

**Fertig, wenn:** Die Fälle leeres Projekt, neue Datei, bearbeitete Datei, gelöschte Datei, Umbenennung und spätere eigene Änderung haben jeweils einen festgelegten, getesteten Ausgang. Kein stilles Überschreiben späterer Arbeit. Datei-Rücknahme behauptet nicht, externe Aktionen rückgängig zu machen.

## 3. Der erste Erfolg braucht kein Wissen über Anvils Aufbau

**Nächster sichtbarer Produktfortschritt.** Die Ersteinrichtung existiert und ist bereits verbessert. Unbewiesen ist, ob neue Nutzer damit selbstständig ans Ziel kommen. Helfer, Companion und Intern sind weiterhin zusätzliche Begriffe, die vor dem ersten Ergebnis möglichst keine Entscheidung verlangen sollten.

**Arbeitspaket:** Den ersten Ablauf auf Projekt → KI → kleine Änderung → Ergebnis prüfen zuschneiden. Ein eingebautes kleines HTML-Beispiel kann ohne Compilerwahl geöffnet und ausgeführt werden. Fehlende KI-Anmeldung blockiert die KI-Aufgabe, nicht das Kennenlernen des Editors.

**Fertig, wenn:**

- Ein neuer Nutzer versteht, wo sein Projekt liegt, welches Modell arbeitet und welche Aktion als nächstes sinnvoll ist.
- Anmeldung, erreichbarer Server, verfügbare Modelle und erfolgreiche Antwort werden nicht gleichgesetzt.
- Nach dem ersten Auftrag sind geänderte Dateien, Prüfstatus und Run leicht auffindbar.
- Bestehende Profile und Layouts bleiben erhalten; die große Desktop-Oberfläche wird nicht aufgrund früherer schmaler Vorschaubilder umgebaut.

## 4. Modellwahl erklärt die tatsächlichen Möglichkeiten

**Vorrang vor weiteren Anbietern.** Thinking ist inzwischen einstellbar. Die Verbindungswege unterscheiden sich trotzdem: Der aktuelle CLI-Adapter überträgt keine Bilder und liefert die eigentliche Antwort nach dem jeweiligen CLI-Aufruf. Ein angezeigtes Ergebnisbild beweist nicht, dass das Modell es sehen konnte.

**Arbeitspaket:** Neben jedem Zugang eine kurze, aus den tatsächlichen Adapterfähigkeiten abgeleitete Erklärung: Verarbeitungsort, Anmeldung/Abrechnung, Bilder, Antwortanzeige und Thinking. Dieselben Fähigkeiten steuern Auswahl, Anhänge und Senden.

**Fertig, wenn:** Eine nicht unterstützte Eingabe wird vor dem Senden erklärt. Wartezeiten sind verständlich. Ein Modellwechsel erfolgt bewusst. Bei API-Abrechnung bleibt erkennbar, wessen Zugang genutzt wird. Nicht geprüfte Fähigkeiten werden als unbekannt statt unterstützt angezeigt.

## 5. Skills führen zu einem Ergebnis

**Nach dem zuverlässigen Einstieg.** Anvil hat bereits Skill-Grundlagen und MCP. Für die erste Beta sollen vier klare Aufgaben daraus entstehen:

1. **Projekt verstehen:** Startweg und wichtige Dateien erklären, zunächst ohne Änderungen.
2. **Änderung umsetzen:** Bestehende Stelle finden, ändern und passend prüfen.
3. **Fehler beheben:** Fehler nachvollziehen, Ursache eingrenzen, Korrektur nachprüfen.
4. **Änderung prüfen:** Auswirkungen, Nachweise und offene Punkte verständlich zeigen.

Jeder Ablauf braucht Erfolgsbeispiele und Gegenbeispiele. Ein Textwechsel verlangt keine unnötige Programmausführung. Eine fehlende Laufzeit darf nicht zu endlosen Wiederholungen führen. Plugins werden angeboten, wenn die Aufgabe sie braucht; ein Plugin-Katalog ist keine Voraussetzung für den ersten Erfolg.

**Fertig, wenn:** Der Nutzer erhält das angekündigte Ergebnis oder einen konkreten nächsten Schritt bei einem Hindernis. Die Prüfung passt zur Aufgabe; Erfolgsmeldung und tatsächliche Nachweise stimmen überein.

## 6. Hilfe und ein klarer Veröffentlichungsrahmen

**Vor einer öffentlichen Beta.** Es gibt umfangreiche Anleitungen, aber vor dieser Überarbeitung keine README am Projektanfang. Die kurze Anleitung trug noch die ältere Versionsnummer 1.3.2. Diese Einstiegslücke ist jetzt behoben; aktuelle Paketverfügbarkeit wurde in diesem Durchlauf nicht live bestätigt.

Noch als zusammenhängenden Nutzerweg festzulegen:

- Ein auffindbarer Kontakt für Fehler, mit Version, erwarteter Funktion und Schritten zum Nachstellen.
- Eine vom Nutzer einsehbare und bereinigte Diagnose für Support; keine automatische Weitergabe seiner Projektinhalte oder Zugangsdaten.
- Eine kompakte Erklärung der tatsächlichen Datenwege: Anvil-Profil, Projekte, Modellanbieter und externe Werkzeuge. Vorhandene Ablageanzeigen und Anleitungen dafür verwenden.
- Ein festgelegter Lizenz-/Nutzungsrahmen, Herausgeber und Supportumfang. Eine Projektlizenz liegt im gesichteten Wurzelverzeichnis nicht vor; die Auswahl bleibt eine Entscheidung des Eigentümers.
- Verständliche Release-Hinweise mit bekannten Grenzen und nachvollziehbarem Updateweg.

Ein Preis, ein Abonnement und ein Zahlungsdienst sind damit noch nicht festgelegt. Eine Verkaufsversion verlangt zusätzlich einen begründeten Preis, tragfähigen Support und klare Leistungszusagen. Dafür fehlen bisher echte Nutzungs- und Nachfragebelege.

## 7. Menschen außerhalb der Entwicklung schaffen den Ablauf

**Der Beweis für Produktreife kommt nach den technischen Tests.** Unser eigener erfolgreicher Praxistest zeigt Funktionsfähigkeit, aber nicht, ob jemand Neues Anvil versteht und erneut benutzen möchte.

**Vorgeschlagener Beta-Versuch:** Fünf neue Nutzer arbeiten jeweils an einem eigenen kleinen Projekt. Mindestens vier schaffen Öffnen, Verbinden, Ändern, Prüfen und Wiederöffnen ohne Erklärung der internen Begriffe. Ziel für den ersten Erfolg: zehn Minuten nach fertiger Installation und vorhandenem Zugang; Downloads und Anmeldung werden separat erfasst.

Diese Zahlen sind vorgeschlagene Abnahmekriterien, keine gemessenen Resultate. Erfasst werden benötigte Hilfe, Abbruchstellen, Fehlversuche, Dateiverständnis und freiwillige Wiederverwendung nach einer Woche. Eine kleine Gruppe findet Hürden; sie belegt noch keine breite Marktnachfrage.

**Fertig, wenn:** Beobachtungen sind dokumentiert, schwerwiegende Start-/Dateifehler behoben und die wichtigsten Hürden nachgeprüft. Niemand muss zur Erledigung seiner ersten Aufgabe auf einen manuellen Eingriff des Entwicklers warten.

## Umsetzungsreihenfolge

1. **Paket und Updates:** Erzwungenes Beenden ersetzen; Installation und Aktualisierung am echten Paket abnehmen.
2. **Dateivertrauen:** Rücknahme vervollständigen oder ihre sichtbare Zusage bis dahin korrekt begrenzen.
3. **Erster Erfolg:** Beispielprojekt und Verbindungserklärung in einen einfachen Ablauf bringen.
4. **Vier Aufgaben:** Vorhandene Skills als verständliche Arbeitswege anbieten und prüfen.
5. **Beta-Veröffentlichung:** Signierung, Nutzerhilfe, Daten-/Nutzungsinformationen und Release-Nachweise zusammenführen.
6. **Fremde Nutzung:** Moderierte Versuche durchführen, Hürden verbessern, Wiederverwendung prüfen.

Für die technische Umsetzung sind keine neuen Plugins erforderlich. Entscheidungen über Herausgeber, Signierkonto, Lizenz, Supportkontakt und Verkaufspreis werden nicht stillschweigend erfunden. Sie hindern nicht daran, Paketprüfungen, Wiederherstellung und Einstieg bereits umzusetzen.

## Quellen und Abgrenzung

Maßgeblich sind der lokale Arbeitsstand und der [Tageswerk-Praxistest](praxistest-tageswerk.md), ergänzend das [Produktkonzept](produktkonzept.md). Im Code geprüft: `.github/workflows/release.yml`, `scripts/verify-installer.ps1`, `build/installer.nsh`, `electron/data-home.mjs`, `src/lib/cli-protocol.ts`, `src/components/ide/first-run.tsx`, die Agent-/Speichereinstellungen und vorhandene Skill-Seeds.

Produktpositionierung und Beta-Zielwerte sind Vorschläge. Es gibt in den vorliegenden Belegen keine belastbaren Daten zu aktiven Fremdnutzern, Wiederverwendung, Zahlungsbereitschaft oder Supportaufwand. Daraus wird weder eine Marktgröße noch ein erfundener Reifegrad in Prozent abgeleitet. Dieser Plan ist keine Bescheinigung, dass eine öffentliche oder kostenpflichtige Veröffentlichung bereits abgenommen ist.
