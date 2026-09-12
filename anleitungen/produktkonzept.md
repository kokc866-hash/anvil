# Anvil: vom Funktionsumfang zum verständlichen Arbeitswerkzeug

Produktkonzept · 12. September 2026 · Entwurf zur Umsetzung

**Umsetzung fortgeschrieben:** Die konkreten Produktarbeiten 1–6 sind im [Produktabschluss](produktabschluss.md) dokumentiert. Die folgenden konzeptionellen Aussagen sind weiterhin als Vorschläge beziehungsweise historische Beobachtungen zu lesen, nicht als aktuelle Fehlerliste.

**Neuester Praxisnachweis:** Im [Tageswerk-Test](I:/Anvil/anleitungen/praxistest-tageswerk.md) wurde ein Projekt über die echte Anvil-Oberfläche neu angelegt, durch Ollama gebaut, selbst bedient, über Codex korrigiert und nach Neustart weiterbearbeitet. Der Kernablauf trägt. Die dabei belegten Fehler bei Neustart/Rundenrücknahme und Prüf-/Abbruchmeldungen sind inzwischen repariert und in der neu gebauten Desktop-Oberfläche gezielt nachgeprüft. Damit ist die Verlässlichkeit dieses Projektablaufs verbessert; die unten beschriebene Produktpositionierung bleibt ein Vorschlag.

**Empfehlung:** Anvil soll seinen Einstieg um eine erfolgreiche Arbeit am eigenen Projekt aufbauen: öffnen, KI verbinden, ändern, prüfen. Die vorhandenen Funktionen bleiben erhalten; technische Einzelheiten erscheinen dort, wo sie gebraucht werden.

Dieses Konzept beantwortet die vier Punkte der Produktbewertung: Verständlichkeit, Vertrauen beim Start und bei Dateien, Unterschiede der Modellverbindungen und erkennbare Positionierung. Es enthält Vorschläge, keine bereits umgesetzte Neugestaltung.

**Aktualisierung nach Praxistest und Reparatur:** Der [Testbericht](I:/Anvil/anleitungen/produkttest.md) dokumentiert den ursprünglichen Fehler und die erfolgreiche erneute Abnahme. Der Codex-CLI-Ablauf läuft nach der Reparatur trotz eigener Ergebnisbilder bis zum Abschluss. Eindeutige Einstiegskategorien, verständliche lokale Verbindungsfehler und native Ordnerwahl sind ebenfalls umgesetzt. Die positive Nachprüfung des großen Desktop-Layouts bleibt bestehen. Die folgenden früheren Beobachtungen sind jeweils ihrem damaligen Prüfstand zugeordnet; weitergehende Vereinfachungen sind weiterhin Vorschläge.

## 1. Produktversprechen und erste Zielgruppe

**Vorgeschlagener Hauptsatz:** „Deine KI-Werkbank für eigene Projekte. Mit lokalen Modellen oder vorhandenen KI-Zugängen entwickeln, ausführen und prüfen.“

**Darunter:** „Du siehst, was geändert wurde, welches Modell arbeitet und wo deine Daten liegen.“

Als erste Zielgruppe eignen sich Menschen unter Windows, die kleine Anwendungen, Webseiten oder Skripte erstellen und bestehende Projekte weiterentwickeln wollen. Sie möchten ihre Modelle und Zugänge wählen, ohne für jede Aufgabe mehrere Werkzeuge einzurichten. Das ist eine Positionierungshypothese, noch kein belegtes Kundensegment.

Der erste vorführbare Ablauf sollte ein kleines HTML-/JavaScript-Projekt sein. Es lässt sich leichter nachvollziehen als eine Einrichtung mit zahlreichen Compilern. Python und andere vorhandene Laufzeiten bleiben erreichbar.

„Lokal“ muss präzise bleiben: Der Projektordner liegt lokal; eine Cloud- oder Abo-Verbindung verarbeitet gesendete Inhalte beim jeweiligen Anbieter. Ein Modellserver im LAN läuft ebenfalls nicht zwingend auf diesem Rechner.

Continue bietet bereits mehrere Modellanbieter einschließlich Ollama und verschiedene Modellrollen. Cursor verbindet Projektanalyse, Dateibearbeitung, Ausführung und Wiederherstellung. Diese Funktionen allein sind deshalb keine belastbare Abgrenzung. Anvil muss die Qualität seines gesamten Arbeitsablaufs zeigen. Quellen: [Continue: Models](https://docs.continue.dev/customize/models), [Cursor: Agent](https://prod.cursor.com/help/ai-features/agent).

## 2. Prüfung des heutigen Einstiegs

Geprüft wurde die aktuelle lokale Oberfläche in einer getrennten Browser-Vorschau bei 786 × 912 Pixeln. Alle vier Bilder wurden in dieser Untersuchung aufgenommen und gespeichert. Dieses Vorschaufenster war für Anvils Arbeitsplatz zu klein, wie der Nutzer anschließend klargestellt hat. Die dadurch zusammengedrängte Darstellung ist kein Beleg für ein Layoutproblem im vorgesehenen Fenster. Aussagen über Platzbedarf und sichtbare Informationsdichte müssen bei geeigneter Fenstergröße erneut geprüft werden. Native Anmeldung, Installation und echte Modellantworten wurden dabei nicht getestet.

**Nachprüfung am selben Tag:** Anvil 1.3.24 wurde direkt auf dem Rechner aus `I:\Anvil` geöffnet und mit dem vorhandenen Projekt im maximierten Desktop-Fenster bei 2560 × 1392 Pixeln betrachtet. Für Schritt 3 ersetzt diese Beobachtung die Layoutbewertung aus der Browser-Vorschau. Es wurde keine neue Modellanfrage gesendet und kein Projektinhalt bearbeitet.

### Schritt 1 – Ersteinrichtung: hoher Verbesserungsbedarf

![Ersteinrichtung mit Modellfeldern und Verbindungsfehler](I:/Anvil/anleitungen/produktkonzept-bilder/01-einstieg.png)

**Gut:** Der Einstieg benennt drei Schritte und einen Projektordner. **Problem:** Schon die Modellwahl verlangt Serveradresse, Schlüssel und Modellnamen. Zwei Kategorien heißen „Eingebaut“. Die nicht erreichbare Standardverbindung zeigt einen technischen Fehler einschließlich HTTP-/Verbindungsdetails. **Vorschlag:** verständliche Zugangsarten, Erkennung vorhandener Verbindungen und ein Fehler mit einer passenden Handlung.

**Barrierefreiheit:** Der ausgelesene Fokus lag beim geöffneten Einrichtungsdialog im Hintergrundeditor. Das ist ein Hinweis für eine gezielte Tastaturprüfung des Dialogs, noch kein vollständig reproduzierter Fokusfehler. Der fehlende Ollama-Server gehört zur unkonfigurierten Vorschau und belegt keinen neuen Fehler der installierten App.

### Schritt 2 – Einrichtung fortsetzen: zu viele Entscheidungen

![Compiler- und Sprachserveroptionen vor Abschluss der Einrichtung](I:/Anvil/anleitungen/produktkonzept-bilder/02-einrichtung-details.png)

**Gut:** Überspringen ist möglich; die unterstützten Laufzeiten sind konkret benannt. **Problem:** Compiler, Sprachserver und deren Detailwerte verlängern den Einstieg erheblich. „Fertig, loslegen“ steht nach diesen Optionen. **Vorschlag:** Laufzeiten erst anbieten, wenn das gewählte Projekt sie benötigt; Details bleiben unter „Erweitert“.

**Barrierefreiheit:** Die lange Folge ähnlicher Schaltflächen erhöht den Navigationsaufwand. Tastaturreihenfolge, eindeutige zugängliche Namen und Erreichbarkeit des Abschlusses bei Vergrößerung müssen geprüft werden.

### Schritt 3 – Arbeitsplatz: im tatsächlichen Desktop-Fenster klar aufgeteilt

![Anvil direkt auf dem Rechner im maximierten Fenster](I:/Anvil/anleitungen/produktkonzept-bilder/05-arbeitsplatz-desktop.png)

**Gut:** Der Editor hat viel Platz; Spur und Chat stehen klar getrennt rechts, die Konsole darunter. Im betrachteten Zustand sind keine überlagerten Arbeitsbereiche zu sehen. Die Spur zeigt konkrete Lese-, Änderungs-, Run- und Play-Schritte einschließlich Ergebnisbildern. Das macht Anvils Arbeitsablauf am vorhandenen Projekt nachvollziehbar. **Korrektur:** Der Eindruck eines zusammengedrängten Arbeitsplatzes entstand durch das zu kleine Vorschaufenster. Eine Umgestaltung oder zusätzliche Einklappfunktion lässt sich daraus nicht begründen.

**Statusanzeige:** Die Desktop-Ansicht zeigt Anbieter und Modell sowie Statusangaben für Helfer und Companion. Die zuvor sichtbare fehlgeschlagene Ollama-Verbindung gehörte zur getrennten Vorschau; hier ist ein Codex-Abo-Profil ausgewählt. Deshalb ist der frühere Verbindungsbefund nicht auf diesen Desktop-Zustand übertragbar. Eine echte neue Modellanfrage oder ein absichtlich ausgelöster Verbindungsfehler wurde nicht geprüft.

**Barrierefreiheit:** Aus dieser visuellen Nachprüfung folgt keine vollständige Bewertung von Namen, Fokus, Kontrast und Tastaturbedienung. Die alte kleine Browseraufnahme bleibt nur als Dokumentation der ungeeigneten Prüfgröße erhalten.

### Schritt 4 – Verbindungseinstellungen: leistungsfähig, erklärungsbedürftig

![Agenteneinstellungen mit zahlreichen Kategorien und Anbieterwahl](I:/Anvil/anleitungen/produktkonzept-bilder/04-verbindung.png)

**Gut:** Suche, Anbietergruppen und der Hinweis auf Einschränkungen der Browser-Vorschau sind vorhanden. **Problem:** Dreizehn Kategorien sowie die Erklärung von Hauptmodell, App und Helfer vermitteln zuerst Anvils Aufbau. Anbieterbeschreibungen gehen schnell in Serverdetails über. **Vorschlag:** vor den Details eine kurze Zusammenfassung der gewählten Verbindung und eine aufgabenbezogene Orientierung.

**Barrierefreiheit:** Die Kombination aus Anbieter-Liste und scrollendem Einstellungsbereich kann die Orientierung erschweren. Fokusführung und Scrollen per Tastatur sowie Kontraste sind gesondert zu prüfen. Eine vollständige Barrierefreiheitsprüfung ist nicht erfolgt.

## 3. Der neue Einstieg – drei tatsächliche Schritte

### 1. „Woran möchtest du arbeiten?“

Zwei Hauptaktionen: **„Projektordner öffnen“** und **„Mit einem Beispiel starten“**. Das Beispiel ist ein mitgeliefertes, funktionierendes kleines Projekt. Vor dem Anlegen zeigt Anvil seinen Zielordner. Ein vorhandener Ordner wird nicht durch Beispieldateien überschrieben.

Das Beispiel kann ohne Modellanfrage geöffnet und ausgeführt werden. Damit lässt sich Anvils Arbeitsplatz kennenlernen, auch wenn ein Zugang noch fehlt.

### 2. „Welche KI möchtest du verwenden?“

| Auswahl | Erklärung | Nach der Auswahl sichtbar |
|---|---|---|
| Vorhandenes KI-Abo | „Einen unterstützten CLI-Zugang verwenden.“ | Anbieter, Installation, Anmeldestatus, Modell, Thinking |
| Modell auf diesem Rechner | „Ein bereits installiertes Modell verbinden.“ | Gefundene Server und Modelle; Einrichtung nur bei Bedarf |
| API-Zugang | „Mit einem Schlüssel deines Anbieters verbinden.“ | Anbieter, Schlüssel, Modell; Hinweis auf dessen Abrechnung |
| Weitere Verbindung | „Eigenen Server oder andere Adresse verwenden.“ | Bisherige erweiterten Felder |

Erkennung unterscheidet **installiert**, **angemeldet**, **erreichbar** und **Modell verfügbar**. Eine geladene Liste beweist noch keine erfolgreiche Antwort. Verbindungsprüfungen lösen keine verdeckte kostenpflichtige Testanfrage aus. Eine echte Testanfrage bekommt eine ausdrücklich beschriftete Aktion.

Statt roher Fehler:

> Ollama ist unter der eingestellten Adresse nicht erreichbar. Starte deinen Modellserver oder wähle eine andere Verbindung.
>
> Erneut prüfen · Verbindung ändern · Technische Details

Eine fehlende Verbindung blockiert nicht das Öffnen und Bearbeiten eines Projekts. Sie blockiert nur die dazugehörige KI-Anfrage.

### 3. „Probiere eine Änderung aus“

Für das Beispiel: **„Füge eine Schaltfläche zum Zurücksetzen hinzu.“** Vor dem Start sind Modell und Verarbeitungsort erkennbar. Danach zeigt Anvil die betroffenen Dateien, den Prüfstatus und die Vorschau. Der Nutzer kann die Änderung nachvollziehen und eine Wiederherstellung bewusst auslösen.

Companion und benötigte Laufzeiten werden im Kontext der Ausführung erklärt: „Zum Ausführen dieses Python-Projekts fehlt Python.“ Ein Download zeigt Größe und Zielort. Bereits vorhandene Pakete werden wiederverwendet. Eine Cloud-Ausweichroute muss vor ihrer Verwendung erkennbar sein.

## 4. Verständlichkeit ohne Funktionsverlust

Zunächst bleiben die bisherigen Kategorien bestehen. Verständliche Untertitel, bessere Reihenfolge innerhalb der Bereiche und einklappbare Details sind ein kleinerer, überprüfbarer Schritt als eine neue Gesamtnavigation.

| Vorhandener Begriff | Vorgeschlagene Erklärung |
|---|---|
| Agent | „KI für dein Projekt – Verbindung, Modell und Denkaufwand“ |
| Companion | „Programme ausführen – Laufzeiten und lokale Werkzeuge“ |
| Helfer | „Optionale Unterstützung für kleine Zusatzaufgaben“ |
| Gedächtnis | „Gespeichertes Wissen und gelernte Abläufe“ |
| Intern | „Diagnose und Wiederherstellung“ |
| Graph | „Automatische Arbeitsschritte und ihre Verbindungen“ |
| Spur | „Verlauf der Arbeit und ihrer Ergebnisse“ |

Im Agent-Bereich stehen Verbindung, Modell und Thinking zuerst. Wiederholungen, Kontextdetails, automatische Abläufe und andere Feinsteuerung bleiben unter „Erweitert“ erreichbar. Die Suche findet auch eingeklappte Einstellungen und öffnet den passenden Abschnitt. Bestehende Profile, Werte und Layouts bleiben erhalten; es gibt keine automatische Neukonfiguration alter Nutzer.

Die lokale Thinking-Erweiterung ist bereits vorhanden. Das Konzept verlangt keinen zweiten Umbau dieser Funktion. Veraltete Aussagen wie „Thinking wird von der CLI gesteuert“ in älteren Anleitungen müssen mit dem tatsächlichen Stand abgeglichen werden.

## 5. Vor der Auswahl zeigen, was eine Verbindung kann

Jedes Profil erhält eine kurze Zusammenfassung. Sie beschreibt die Unterstützung **in Anvil**, nicht nur die theoretischen Fähigkeiten des Anbieters.

| Eigenschaft | Abo über CLI: aktueller Anvil-Weg | API / Modellserver |
|---|---|---|
| Eingaben an das Modell | Text; Bilder werden nicht mitgesendet | Bilder nur bei passender Modell- und Adapterunterstützung |
| Antwortanzeige | Eigentliche Antwort nach Abschluss des CLI-Aufrufs | Laufende Textausgabe, soweit vom Adapter unterstützt |
| Thinking | Einstellbar, mit modellabhängigen Stufen | Ebenfalls modell- und anbieterabhängig |
| Zugang | Anmeldung über die jeweilige CLI | API-Schlüssel oder Serverkonfiguration |
| Verarbeitungsort | Anbieter der gewählten Verbindung | Dieser Rechner, LAN oder externer Anbieter laut Zieladresse |

Beispieltext während einer CLI-Anfrage:

> Das Modell arbeitet. Diese CLI-Verbindung liefert die Antwort nach Abschluss.
>
> Abbrechen

Keine erfundenen Prozentwerte und kein fingierter Antwortstrom. Empfangene Statusmeldungen dürfen angezeigt werden. Eine Aktion darf nicht still zu einem anderen Anbieter wechseln. „Unbekannt“ ist eine zulässige Fähigkeit, bis sie verifiziert wurde. Eine gemeinsame Fähigkeitsbeschreibung sollte Auswahl, Anhänge und Anfrageversand steuern; die vorhandene Thinking-Logik ist dafür ein Ausgangspunkt.

## 6. Vertrauen: Start, Ablage und Wiederherstellung

Die bereits bearbeiteten Start- und Datenprobleme werden als Ausgangspunkt berücksichtigt. Sie sind keine pauschale Behauptung über einen weiterhin defekten Stand. Die wichtigste Ergänzung ist ein nachweisbar verlässlicher Weg für ausgelieferte Versionen.

**Start:** Die installierte Version hat einen eindeutigen Startpunkt. Die Anleitung trennt Installation und Arbeiten am Quellcode. Der Test des tatsächlich ausgelieferten Windows-Pakets umfasst einen Rechner ohne separat installiertes Node.js, den ersten Start, einen Neustart und erhaltene Einstellungen. Die vorhandenen Release-Prüfungen werden dafür erweitert.

**Ablage:** Eine Übersicht zeigt tatsächliche Pfade und Größe für Projektdateien, Anvil-Profil, Modelle, Pakete und Protokolle. Dazu „Ordner öffnen“ und, wo bereits unterstützt, „Speicherort ändern“. Die aktuelle Regel bleibt: standardmäßig `data` im Anvil-Verzeichnis; ausdrücklich gewählte Pfade bleiben gültig. Schreibfehler werden erklärt, ohne still nach AppData auszuweichen.

Das Versprechen gilt für Anvils eigene Ablage. Externe CLIs und Werkzeuge können eigene Profil- und Cacheordner verwenden. Die Oberfläche muss diese Grenze verständlich machen, statt pauschal „alles bleibt in diesem Ordner“ zu behaupten.

**Wiederherstellung:** Vor dem Zurücksetzen zeigt Anvil, was betroffen ist. Eigene spätere Dateiänderungen dürfen nicht unbemerkt überschrieben werden. Ein Dateistand macht bereits ausgeführte externe Aktionen nicht automatisch rückgängig.

## 7. Skills und Plugins mit einer konkreten Aufgabe

Für diese Ausarbeitung wurden die installierten Skills **Product Design / Audit**, **Plugin Management** und die Browserprüfung genutzt. Zusätzliche Plugins sind dafür nicht erforderlich. Für eine spätere Implementierung stehen bereits Skills für Codearbeit und unabhängige Prüfung bereit.

Auch **in Anvil selbst** können Skills den Einstieg verbessern. Vorhandene Grundlagen liegen in `src/lib/skill-seeds.ts`; MCP ist ebenfalls bereits integriert. Der Vorschlag ist, ausgewählte Abläufe sichtbar anzubieten und ihre Qualität zu prüfen, statt ein weiteres System daneben zu bauen.

| Sichtbarer Ablauf | Konkretes Ergebnis | Grenze |
|---|---|---|
| Projekt kennenlernen | Einstiegspunkte, Startweg und wichtige Dateien erklären | Zunächst nur lesen |
| Kleine Änderung umsetzen | Bestehende Stelle finden, gezielt ändern, geeignete Prüfung ausführen | Kein unnötiges Neuanlegen oder Umschreiben |
| Fehler untersuchen | Fehler nachvollziehen, Ursache eingrenzen, Korrektur prüfen | Nach begrenzten erfolglosen Versuchen Ursache und offenen Stand nennen |
| Änderung prüfen | Unterschied, Prüfungsergebnis und verbleibende Unsicherheit zeigen | Wiederherstellung gesondert auslösen |

Diese Abläufe können an bestehende Seeds wie `suche-zuerst`, `nach-write-pruefen`, `debugger` und `run-budget` anknüpfen. Eine Prüfung muss zur Aufgabe passen: Eine reine Textänderung braucht keinen Programmstart. Jeder Ablauf benötigt Beispiele, bei denen er hilft, und Gegenbeispiele, bei denen er nicht greifen soll.

**Plugins/MCP:** erst aufgabenbezogen anbieten, etwa eine bereits konfigurierte Engine-Verbindung bei einem Engine-Projekt. Vor der Nutzung zeigen: Zweck, Zielsystem und verfügbare Aktionen. Ein geladener Werkzeugkatalog ist noch kein bestandener Funktionstest. Keine automatische Aktivierung fremder Server und kein notwendiger Plugin-Shop im ersten Start.

## 8. Umsetzbare Arbeitspakete

Die Größen S/M/L sind relative Einschätzungen, keine Zeit- oder Lieferzusagen. P0 bedeutet Vorrang vor weiterer Funktionsverbreiterung.

| Paket | Priorität / Größe | Konkreter Umfang | Fertig, wenn … |
|---|---|---|---|
| A – Erster Start | P0 / M | Drei Schritte, eindeutige Zugangsnamen, Details bei Bedarf, verständliche Fehler | Neuer Nutzer erreicht ein Beispiel ohne Compilerwahl; fehlender Server blockiert nur KI; Tastaturfokus bleibt im Dialog |
| B – Start und Ablage absichern | P0 / M | Windows-Paketprüfung ergänzen; Pfadübersicht; Startanleitung abgleichen | Paket startet ohne separates Node.js; Neustart erhält Profil; kein stiller AppData-Rückfall; fehlendes Schreibrecht ist verständlich |
| C – Verbindungen erklären | P1 / M | Gemeinsame Fähigkeiten und Zustände im Einstieg und in der Auswahl | CLI-Bildgrenze steht vor dem Senden fest; Antwortverhalten ist sichtbar; Thinking folgt vorhandenen Modellgrenzen; kein stiller Anbieterwechsel |
| D – Einstellungen verständlicher | P1 / S–M | Untertitel, eingeklappte Details, Suche öffnet Treffer | Alte Profile bleiben identisch; alle bisherigen Optionen bleiben auffindbar; Tastatur und vergrößerte Schrift funktionieren |
| E – Vier geführte Abläufe | P1 / M | Vorhandene Skills auswählen, begrenzen und mit Beispielen prüfen | Jeder Ablauf liefert sein beschriebenes Ergebnis oder benennt einen konkreten Blocker; Dateiänderungen und Prüfung sind sichtbar |
| F – Produktversprechen belegen | P2 / S–M | Ein nachvollziehbares Demo-Projekt und Nutzertest | Gleiche Aufgabe mit gewähltem Zugang gelingt; Hilfeaufwand und Fehler werden dokumentiert; Aussagen entsprechen der ausgelieferten Version |

**Abhängigkeiten:** A nutzt die Zustandsdefinitionen aus C. B kann unabhängig vorbereitet werden. D bleibt ein eigener kleiner Eingriff. E baut auf einem verlässlichen ersten Start auf. Die öffentliche Produktdarstellung aus F folgt den belegten Ergebnissen.

**Code-Anknüpfung:** A: `src/components/ide/first-run.tsx`; C/D: `src/components/ide/settings/agent.tsx`, `settings-pane.tsx`, `src/lib/cli-protocol.ts`, `electron/thinking-support.mjs`; B: `electron/main.mjs`, `electron/data-home.mjs`, `src/components/ide/settings/storage.tsx`, `.github/workflows/release.yml`; E: `src/lib/skill-seeds.ts` und bestehende Skill-Ausführung. Vor Änderungen sind jeweilige Zustands- und Testpfade nochmals gezielt zu lesen.

## 9. Woran wir den Fortschritt messen

Ein erster moderierter Versuch mit fünf neuen Nutzern reicht, um grobe Hürden zu finden; er belegt noch keine Marktnachfrage. Jeder öffnet ein Beispiel, verbindet einen eigenen verfügbaren Zugang, lässt eine kleine Änderung machen, prüft sie und findet den Datenordner.

Vorgeschlagene Ziele für diesen Versuch: mindestens vier von fünf schaffen den Ablauf ohne Erklärung der internen Begriffe; der erste erfolgreiche Durchlauf dauert nach vorhandener Installation und vorhandenem Zugang höchstens zehn Minuten; alle können Verarbeitungsort und Ablage richtig benennen. Downloads und externe Anmeldedauer werden separat erfasst. Nach einer Woche wird freiwillige Wiederverwendung erfragt. Diese Ziele sind noch nicht gemessen.

Ein Vergleich mit anderen Werkzeugen nutzt dieselbe Aufgabe, vergleichbare Modelle und dieselbe Ausgangslage. Bewertet werden benötigte Hilfe, Fehlversuche und nachvollziehbare Ergebnisse. Eine schnellere Einzelantwort ist kein ausreichender Produktbeweis.

**Empfohlener erster Umsetzungsschritt:** Paket A zusammen mit der minimalen Verbindungsübersicht aus C. Das verbessert die auffälligste Hürde, erhält Anvils Stil und Funktionen und lässt sich klar gegen den jetzigen Einstieg prüfen.
