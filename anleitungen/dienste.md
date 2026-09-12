# Externe Dienste in Anvil

Stand: 12. September 2026. Lokaler Entwicklungsstand.

Unter **Erweiterungen → Dienste** verbindet sich Anvil mit externen Anbietern und nutzt deren angebotene Werkzeuge über die vorhandene MCP-Brücke. Notion ist vorausgewählt. Der [Dienstkatalog](dienstkatalog.md) enthält 50 Angebote für Aufgaben, Wissen, Gestaltung, Dateien, Kundenarbeit, Code, Datenbanken, Hosting und Spieleentwicklung. Suche und Bereiche erleichtern die Auswahl. Anbieter mit zusätzlichem Einrichtungsbedarf sind gekennzeichnet; ihre fehlenden Voraussetzungen werden vor dem Hinzufügen angezeigt. Unter **Engines & 3D-Werkzeuge** stehen zusätzlich sieben lokale Verbindungsvorlagen bereit; siehe [Unity, Unreal und Godot](engines.md).

## Notion verbinden

1. **Notion → Verbindung hinzufügen**. Die Verbindung wird zunächst deaktiviert gespeichert.
2. **Anmelden** öffnet die Anmeldung beim Anbieter im Browser. Dort mit dem eigenen Notion-Konto anmelden und den gewünschten Workspace freigeben. Anvil erhält die Zugangsdaten über den lokalen Rückkanal; kein Token muss kopiert werden.
3. Nach erfolgreicher Anmeldung lädt Anvil die tatsächlich angebotenen Werkzeuge. **Anmeldung lokal gespeichert** und **Katalog geladen** sind unterschiedliche Nachweise: Eine gespeicherte Anmeldung allein bestätigt keinen aktuellen Zugriff.
4. Gewünschte Werkzeuge auswählen. **Auswahl vergrößern** öffnet eine größere Ansicht. **Alle freigeben** wählt den aktuell geladenen Katalog aus; bei einer Suche gelten **Treffer freigeben / Treffer abwählen** nur für die angezeigten Treffer. **Nur ausgewählte** zeigt die bisherigen Freigaben, **Beschreibung** klappt Details auf. Änderungen werden sofort gespeichert; **Fertig** oder Escape schließen die große Ansicht. Zu Beginn ist keines freigegeben; auch später vom Anbieter ergänzte Werkzeuge bleiben ausgeschaltet. Die Auswahl wird im Agentenkatalog und unmittelbar vor einem Werkzeugaufruf durchgesetzt.
5. **In Anvil verwenden** aktiviert die vorhandene Brücke. Danach kann der Agent die ausgewählten Dienstwerkzeuge zusammen mit Anvils Werkzeugen verwenden. Der nächste Auftrag kann beispielsweise eine Suche in Notion verlangen. Die Auswahl selbst führt keinen Auftrag aus.

Der Zugriff richtet sich außerdem nach den bei Notion erteilten Rechten. Gelesene Inhalte können bei einem Agentenauftrag als Kontext an das in Anvil gewählte Modell übermittelt werden. Welche Werkzeuge Notion anbietet, wird vom Dienst geladen und nicht durch einen fest eingebauten Scheinkatalog ersetzt.

## Verbindung prüfen und verwalten

Ein Klick auf den Dienstnamen klappt die gesamte Karte auf oder zu. Name, Anmeldestatus und die Anzahl freigegebener Werkzeuge bleiben im Kopf sichtbar. Laufende Vorgänge und Freigaben bleiben beim Einklappen erhalten.

Erscheint nach dem Konto-Login nur die normale Notion-Seite, fehlt die Rückmeldung an Anvil noch. Während Anvil auf die Freigabe wartet, öffnet **Anmeldeseite erneut öffnen** denselben laufenden Anmeldelink. Dort die Freigabe für Anvil abschließen. Anvil wartet bis zu zehn Minuten und unterscheidet eine fehlende Browser-Rückmeldung von einem bewusst abgebrochenen Vorgang. Nach Ablauf muss eine neue Anmeldung gestartet werden.

Ist die Anmeldung bereits gespeichert, aber der anschließende Katalogabruf fehlgeschlagen, bleibt die Anmeldung erhalten. **Werkzeuge laden** wiederholt dann nur den Katalogabruf.

- **Werkzeuge laden** fragt den aktuellen Katalog erneut ab. Fehlgeschlagene Abfragen und verlorene Verbindungen entwerten den Bereitschaftsstatus. Ein Katalogabruf ist noch kein erfolgreicher Zugriff auf eine konkrete Seite.
- **Werkzeug selbst ausführen** zeigt die freigegebenen Werkzeuge, deren Beschreibung und Eingabeschema. Nach Eingabe der Argumente führt **Jetzt ausführen** einen tatsächlichen Aufruf aus und zeigt die Antwort oder den Fehler. Schreibwerkzeuge können dabei echte Daten beim Anbieter verändern.
- **Aktiv ausschalten** stoppt die Verwendung durch den Agenten; die Anmeldung bleibt für später gespeichert.
- **Abmelden** deaktiviert den Dienst und entfernt seine lokalen Zugangsdaten und Freigaben. Das ist kein allgemeiner Widerruf der App-Freigabe beim Anbieter; diese kann zusätzlich in dessen Kontoeinstellungen entfernt werden.
- **Verbindung entfernen → Endgültig entfernen** entfernt anschließend auch die Verbindung aus Anvil. Andere Verbindungen bleiben erhalten. Schlägt das Löschen der Zugangsdaten fehl, bleibt der deaktivierte Eintrag für einen erneuten Versuch sichtbar.

Anmeldungen können abgebrochen werden. Verspätete Tokenantworten dürfen eine abgebrochene oder entfernte Verbindung nicht wiederherstellen. Ein bereits abgesendeter externer Werkzeugaufruf kann trotz Abbruch beim Anbieter ausgeführt worden sein; Anvil wiederholt solche Aufträge nicht automatisch.

## Weitere Dienste

Für einen weiteren Workspace oder ein anderes Konto kann eine getrennte Verbindung angelegt werden. Jede Verbindung hat eigene Zugangsdaten und Freigaben.

**Eigener Dienst** benötigt eine OAuth-fähige MCP-Adresse, keine normale Website. HTTPS ist erforderlich; unverschlüsseltes HTTP ist nur für lokale Dienste auf diesem Rechner erlaubt. Falls der Anbieter eine Client-ID vorgibt, kann sie angegeben werden. Ansonsten verwendet Anvil die dynamische Registrierung des Anbieters. Dienste ohne diese Registrierung benötigen eine passende vorregistrierte Client-ID.

Bestehende HTTP-, Bearer- und lokale Programmverbindungen bleiben im bisherigen MCP-Bereich verfügbar. Dort angezeigte verwaltete Dienste verweisen für Anmeldung und Werkzeugauswahl auf **Erweiterungen → Dienste**.

Eine Anmeldung bei einem Programm überträgt nicht automatisch dessen gesamten Plugin-Marktplatz nach Anvil. Hier nutzbar sind die vom jeweiligen Dienst über MCP bereitgestellten Funktionen. Eigene Anvil-Plugins, Skill-Pakete und ACP bleiben eigenständige Erweiterungswege.

## Ablage und geprüfter Umfang

Die OAuth-Daten bleiben im Betriebssystem-verschlüsselten `mcp-oauth.enc` im konfigurierten Anvil-Datenordner. Sie werden nicht in Projektdateien, Modellprompts oder den allgemeinen Werkzeugkatalog geschrieben. Ein gespeicherter Refresh-Token zählt als lokal vorhandene Anmeldung; der nächste Dienstzugriff prüft dessen tatsächliche Gültigkeit.

Die Desktop-Abnahme verwendet einen eindeutig benannten lokalen OAuth-Testdienst mit echten HTTP-Anfragen, dynamischer Client-Registrierung, PKCE, Zustandsprüfung und dem tatsächlichen nativen MCP-Client. Nur die Benutzerzustimmung des Testdienstes wird simuliert; die MCP-Brücke und der verschlüsselte Speicher werden nicht ersetzt. Geprüft wurden Werkzeugauswahl und Aufruf, nicht freigegebene Werkzeuge, Neustart ohne erneute Anmeldung, Deaktivieren, Abmelden, Entfernen sowie eine verspätete Tokenantwort nach Abbruch. Nachweis: `artifacts/services/result.json`.

Zusätzliche Integrationstests prüfen entzogene Freigaben gegen alte Aufrufer, fehlgeschlagene Katalogaktualisierung, verspätete Ereignisse einer alten Verbindung und eine während des Entfernens ersetzte Verbindung. Für die automatisierte Abnahme wird ein lokaler Testdienst verwendet. Die separate [Live-Abnahme für Notion und Linear](dienste-live-test.md) hat anschließend erfolgreiche lesende Aufrufe über die verbundenen Konten bestätigt.

Vor der Ergänzung zum Fortsetzen der Browser-Anmeldung bestand der vollständige Testlauf mit **942 erfolgreichen Tests, 5 übersprungenen Tests und 0 Fehlern** (`artifacts/services/tests-final.log`). Für die Ergänzung bestanden erneut Typprüfung, Desktop-Build, die MCP-Tests und 15 gezielte Integrations- und OAuth-Tests (`artifacts/services-login`). Die Desktop-Abnahme prüft zusätzlich das Fortsetzen desselben Anmeldelinks nach fehlender Rückmeldung sowie einen Katalogfehler nach erfolgreicher Anmeldung. `ui-build` wurde aktualisiert. Die MCP-Testsammlung traf beim ersten Lauf auf eine durch das offene Anvil gesperrte Windows-Cookiedatei; nach dem Schließen bestand sie.

## Anbietergrundlagen

Geprüft am 12. September 2026:

- [Notion verbinden](https://developers.notion.com/guides/mcp/get-started-with-mcp): offizieller MCP-Endpunkt und Anmeldung aus anderen Clients.
- [MCP-Client für Notion](https://developers.notion.com/guides/mcp/build-mcp-client): Registrierung, PKCE, OAuth-Discovery, Refresh und sichere Speicherung.
- [Notions aktuelle OAuth-Metadaten](https://mcp.notion.com/.well-known/oauth-authorization-server): öffentlich erreichbare Anmelde-, Registrierungs- und Token-Endpunkte.
- [Linear MCP](https://linear.app/docs/mcp): offizieller Streamable-HTTP-Endpunkt und OAuth-Registrierung.
