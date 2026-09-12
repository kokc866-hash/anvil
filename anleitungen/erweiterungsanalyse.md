# Anvil: Welche Erweiterungen sich als Nächstes lohnen

Stand: 12. September 2026 · Produkt- und Erweiterungsanalyse

**Umsetzungsstand:** Die erste Ausbaustufe dieser Analyse samt dauerhaftem Entfernen eigener Plugins ist inzwischen lokal implementiert. Bedienwege, Abnahmen und die ausdrücklich begrenzte ACP-Vorschau stehen in [Erweiterungen in Anvil](erweiterungen.md). Die folgenden Abschnitte dokumentieren die ursprüngliche Bewertung vor der Umsetzung.

## Executive Summary

Anvil besitzt bereits eigene Plugins, Skills, MCP-Anbindungen, Projektvorlagen, Run und Tests. Der nächste Produktgewinn liegt darin, daraus wiederverwendbare, nachvollziehbar geprüfte Aufgaben zu machen.

**Empfohlene Reihenfolge:** erst den Skill-Austausch und ein kleines Aufgabenpaket sauber machen; anschließend gespeicherte Bedienprüfungen für HTML-Projekte entwickeln. Eine gemeinsame Startprüfung und wenige geprüfte MCP-Pakete ergänzen das. ACP für externe Agenten verdient einen begrenzten Prototyp, einen vollständigen Marktplatz würde ich zurückstellen.

Die Priorisierung ist meine qualitative Einschätzung anhand des lokalen Codes, der bisherigen Produktabnahme und aktueller Primärquellen vom 12. September 2026. Sie ist keine Messung von Nachfrage, Umsatz oder eingesparter Zeit.

## Was bereits vorhanden ist

| Grundlage | Nachweis im lokalen Projekt | Konsequenz für Erweiterungen |
|---|---|---|
| Eigene Plugins | src/lib/plugins/host.ts und index.ts | Befehle, Dateien und weitere Werkzeuge sind bereits angebunden. |
| VSIX-Import | src/lib/plugins/vscode.ts | Sprachbeiträge und Snippets werden gelesen; Aktivierungscode mit dem vscode-Modul wird ausdrücklich übersprungen. |
| Eigene Skills | src/lib/learn-parse.ts, learn.ts, skill-seeds.ts | Anleitungen und geführte Aufgaben existieren; der Austausch mit anderen Skill-Sammlungen ist ausbaufähig. |
| MCP | anleitungen/mcp.md | HTTP, stdio, OAuth, Werkzeuge, Ressourcen und Argumentprüfung sind vorhanden. |
| Vorlagen, Ausführen, Testen | src/lib/starters.ts, run-tests.ts, agent-core.ts | Kein neuer Startbildschirm oder zweiter Testbereich erforderlich. |
| Rücknahme und Sicherung | anleitungen/produktabschluss.md; Einstellungen zur Ablage | Bestehendes ausbauen; eine Rundenrücknahme deckt nicht sämtliche Projektdateien oder externe Aktionen ab. |

Die frühere schmale Vorschau ist kein Beleg dafür, dass Anvils große Desktop-Oberfläche grundsätzlich umgebaut werden müsste. Erweiterungen sollten in die vorhandenen Arbeitsabläufe passen.

## Zuerst: austauschbare Skills und Aufgabenpakete

**Konkrete Lücke:** Der aktuelle Parser liest name und when, aber nicht description; zudem kürzt er den Anweisungstext auf 8.000 Zeichen. Das übliche Agent-Skills-Format verlangt name und description und sieht ergänzende Dateien vor. [Agent-Skills-Spezifikation](https://agentskills.io/specification)

**Vorschlag:** Import und Export kompatibel machen, alte Anvil-Skills erhalten und referenzierte Dateien sauber mitführen. Lange Anleitungen entweder vollständig bedarfsgerecht laden oder eine Grenze sichtbar melden. Importieren darf beiliegende Skripte nicht automatisch ausführen. Anvil muss Rechte selbst durchsetzen; Metadaten ersetzen das nicht.

Darauf zunächst ein Paket **„Kleine Webanwendung“** aufbauen: passende Vorlage, Arbeitsanleitung, Startprüfung und nachvollziehbare Funktionsprüfung. Ein zweites Paket **„Dateien verarbeiten“** erst danach: Beispieldaten, Vorschau der Änderungen und klarer Ausgabeordner.

**Nutzen:** Weniger wiederholtes Erklären; wiederholbare Arbeitsweise statt einer Sammlung langer Prompts. Der Nutzer wählt eine Aufgabe und sieht, welche Werkzeuge sie benötigt.

**Aufwand:** mittel für den begrenzten Import samt einem Paket. Vollständige Kompatibilität mit beliebigem ausführbarem Fremdcode gehört nicht dazu.

**Abnahme:** Ein externes Skill-Verzeichnis behält Beschreibung und Referenzen; bestehende Anvil-Skills funktionieren weiter; Namenskollisionen werden sichtbar behandelt; Deaktivierung wirkt nach Neustart; der Import führt nichts aus.

## Nächster Produktbaustein: gespeicherte Bedienprüfungen

**Vorhanden:** Anvil kann Programme und Testdateien ausführen, die Ausgabe ansehen und Tasteneingaben über play senden. Im geprüften Ablauf fehlt als durchgängige Produktfunktion eine gespeicherte Bedienfolge mit verbindlichen Erwartungen und erneutem Ausführen.

**Vorschlag:** Für HTML-Projekte eine verständliche Prüfung speichern, zum Beispiel: „Aufgabe eintragen → hinzufügen → Seite neu laden → Aufgabe noch vorhanden“. Anvil zeigt jeden Schritt, Erwartung, tatsächliches Ergebnis und den geprüften Projektstand.

Playwright bietet dafür unter anderem wartende Prüfungen auf Texte, Werte und Elementanzahlen. Ob es direkt in Anvils Run-Umgebung eingesetzt werden kann, muss ein technischer Prototyp klären. [Playwright: Assertions](https://playwright.dev/docs/test-assertions)

**Nutzen:** Eine Änderung lässt sich erneut prüfen. Eine erfolgreiche KI-Antwort allein ist kein Nachweis, dass die erzeugte Anwendung funktioniert.

**Aufwand:** groß für eine zuverlässige Produktfunktion, deshalb zunächst nur HTML und wenige Aktionen. Native Programme und Spiele bleiben vorerst außerhalb dieses Umfangs.

**Abnahme:** Ein absichtlich eingebauter Fehler lässt die Prüfung scheitern; nach Behebung besteht dieselbe Prüfung. Abbruch und fehlende Laufzeit werden als offen ausgewiesen. Nach einer weiteren Änderung gilt ein alter Erfolg nicht als aktueller Nachweis. Testdaten bleiben vom normalen Projektgebrauch getrennt.

## Kleine Ergänzung: eine gemeinsame Startprüfung

**Vorhanden:** Anvil besitzt Startwege, Laufzeitkonfiguration und Informationen über Verbindungen. Die Erweiterung wäre ein gemeinsames, projektbezogenes Ergebnis.

**Vorschlag:** „Projekt startklar?“ zeigt passende Startdatei, vorhandene Laufzeit, fehlende Voraussetzungen und den tatsächlichen Zustand der gewählten Modellverbindung. Eine erkannte Anmeldung oder ein geladener Modellkatalog darf weiterhin nicht als erfolgreiche Modellantwort gelten.

**Nutzen:** Der Nutzer sieht vor dem ersten Auftrag, welcher konkrete Schritt fehlt. Das adressiert die früheren Startprobleme unmittelbar.

**Aufwand:** klein bei einem zusammenfassenden Check vorhandener Informationen. Ein universeller automatischer Paketinstaller ist ausdrücklich nicht Bestandteil dieser Schätzung.

**Abnahme:** Ein Projekt mit fehlender Laufzeit erhält einen passenden Hinweis. Ein Beispiel ohne KI benötigt keine Modellanmeldung. Es entstehen keine zusätzlichen Datenordner auf C und keine versteckten Downloads.

## Danach: wenige geprüfte MCP-Pakete

**Vorhanden:** Die Verbindungstechnik ist weitgehend vorhanden. Noch nicht unterstützt werden interaktive Elicitation- und Sampling-Schritte; Anvil meldet diesen zusätzlichen Bedarf.

**Vorschlag:** Pakete nach Aufgabe zusammenstellen, beispielsweise eine externe Projektquelle lesen. Jedes Paket beschreibt Anbieter, erforderliche Programme, Version, benötigte Rechte, Datenziel und einen tatsächlichen Verbindungstest. Vorhandene direkte Anbindungen werden bevorzugt weiterverwendet.

Die offizielle MCP Registry liefert Installations- und Konfigurationsmetadaten und befindet sich derzeit in Preview. Ein Eintrag allein ist keine Sicherheitsprüfung des ausführbaren Servers. [MCP Registry](https://modelcontextprotocol.io/registry/about)

**Nutzen:** Weniger Einrichtung und weniger Verwechslung zwischen „Server gefunden“ und „Aufgabe funktioniert“.

**Aufwand:** mittel für eine kleine geprüfte Auswahl; dauerhaft zusätzlich Pflege bei Anbieteränderungen.

**Abnahme:** Eine harmlose Probe funktioniert wirklich; fehlerhafte Anmeldung bleibt klar erkennbar; Deaktivierung stoppt die Nutzung. Eine Paketaktualisierung darf geänderte Rechte nicht unbemerkt übernehmen. Zusätzliche Protokollfunktionen erst entwickeln, wenn ein ausgewählter Anwendungsfall sie benötigt.

## Strategischer Prototyp: externe Agenten über ACP

In den durchsuchten Anwendungsbereichen src, electron, companion und server habe ich keine explizite ACP-Anbindung gefunden.

ACP verhandelt unter anderem Protokollversion, Fähigkeiten und Authentifizierung zwischen Anwendung und Agent. Zed verwendet es bereits für externe Agenten; eine solche Anbindung allein wäre daher kein Alleinstellungsmerkmal. [ACP-Initialisierung](https://agentclientprotocol.com/protocol/v1/initialization), [Zed: externe Agenten](https://zed.dev/docs/ai/external-agents)

**Vorschlag:** Zunächst genau einen Agenten anbinden und prüfen, ob dieser Weg Anvils heutigen CLI-Ablauf tatsächlich verbessert. Bilder, Einstellungen und Sitzungsfortsetzung nur anbieten, wenn der konkrete Agent sie unterstützt.

**Nutzen:** Potenziell bessere Integration externer Agenten und weniger individuelle Sonderbehandlung pro Anbieter.

**Aufwand:** groß bis zur produktiven Nutzung; ein begrenzter Machbarkeitsversuch ist davor sinnvoll. Externer Agent und Anvils eigener Agent dürfen nicht gleichzeitig widersprüchlich dieselbe Aufgabe steuern.

**Abnahme:** Abbruch, Verbindungsfehler, Dateischreibrechte und ungespeicherte Änderungen sind sauber behandelt. Kein automatischer erneuter Auftrag nach unklarem Ausgang. Keine Behauptung, Anvils Skills und Berechtigungen würden beim externen Agenten unverändert gelten.

## Was ich zurückstellen würde

**Offener Plugin-Marktplatz und volle VS-Code-Kompatibilität:** Der jetzige Plugin-Host führt Aktivierungscode über new Function aus und bietet breite Arbeitswerkzeuge an. Es existiert eine Aktivierungs-/Vertrauensverwaltung; daraus folgt jedoch noch keine Isolation beliebigen fremden Codes. Für einen offenen Marktplatz wären ein belastbares Berechtigungsmodell, Ausführungsisolation, Versionierung, Aktualisierung und Widerruf eigenständige Arbeitspakete. Das ist eine Architekturgrenze, keine Behauptung eines hier nachgewiesenen Angriffs.

**Vollständige Projekt-Sicherungspunkte:** Sinnvoll, sobald Nutzer auch Bilder, Binärdateien oder externe Werkzeuge einbeziehen. Die vorhandene Rücknahme zuerst ergänzen und die Grenze zwischen Datei-, Datenbank- und externer Aktion sichtbar halten.

**Teamkonten, Cloud-Synchronisierung und parallele Agenten:** Dafür fehlt bisher ein belegter Bedarf. Sie würden Datenhaltung, Konflikte und Support erheblich erweitern.

**Automatische kostenbasierte Modellwahl:** Erst sinnvoll, wenn Kosten und Leistungsunterschiede je Verbindungsweg verlässlich bekannt sind. Budgets und bestehende Einstellungen erhalten.

## Entscheidung und nächste Untersuchung

Als nächstes ein enges Vorhaben wählen: **Standard-Skills importieren und mit einem Web-Aufgabenpaket verbinden.** Die gemeinsame Startprüfung darin mitliefern. Danach eine gespeicherte HTML-Bedienprüfung entwickeln und mit einem absichtlich fehlerhaften Beispiel abnehmen.

Vor einem breiten Ausbau mit neuen Nutzern prüfen: Finden sie die passende Aufgabe ohne Erklärung? Erreichen sie ein verwendbares Ergebnis? Verstehen sie fehlende Voraussetzungen? Können sie nach einer Änderung selbst feststellen, ob das Ergebnis noch funktioniert?

ACP und weitere MCP-Pakete bekommen Vorrang, wenn diese Beobachtungen zeigen, dass Agenten- oder Werkzeuganbindungen den Arbeitsfluss tatsächlich begrenzen. Ein Paketkatalog ist kein Erfolgskriterium für sich.

## Aussagegrenzen

Dies ist eine Analyse, keine Umsetzung oder neue Abnahme. Grundlage sind lokale Codeprüfung, dokumentierte Produktprüfungen und offizielle technische Quellen; keine Nutzungsstatistik oder systematische Marktstudie. Die bisherigen internen Praxistests ersetzen keine Beobachtung unabhängiger Erstnutzer.

Die Aufwandseinstufungen beschreiben den begrenzten vorgeschlagenen Umfang und sind Schätzungen: klein = vorwiegend vorhandene Informationen zusammenführen; mittel = vorhandene Bausteine mit neuer Import-/Paketlogik verbinden; groß = neue Ausführungs- oder Sitzungssteuerung. Sie sind weder Termine noch ein Verhältnis von Arbeitsstunden.

Die noch offene öffentliche Veröffentlichung — einschließlich der von dir vertagten Eigentümerangaben und Signierung sowie fehlender Abnahme in einer sauberen Windows-Umgebung — wird durch Erweiterungen nicht automatisch abgeschlossen.
