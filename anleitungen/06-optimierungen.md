# Optimierungen im Entwicklungsstand

Stand: 6. September 2026, auf Basis von Anvil 1.3.13. Diese Änderungen gehören zum Quellcode nach diesem Release; ein bestehender Installer enthält sie erst mit einer später gebauten Version.

## Umgesetzte Änderungen

| Bereich | Änderung | Wirkung |
| --- | --- | --- |
| Dateien speichern | Eine Warteschlange ordnet Schreiben, Löschen und Ordneranlage. Jede Aufgabe hält ihren Zielordner und Companion-Endpunkt fest. | Eine ältere Schreiboperation entfernt keine neuere Änderung aus der Warteschlange. Ein Ordnerwechsel lenkt ausstehende Schreibvorgänge nicht um. |
| Browser-Sicherung | Änderungen werden gebündelt und pro Datei bzw. Nachricht gespeichert. Ein ausdrücklicher Leerzustand und Löschoperationen werden in IndexedDB mitgespeichert. | Unveränderte Dateien werden bei Chat-Ausgaben nicht erneut serialisiert. Gelöschte Inhalte werden nicht aus einer alten Sicherung zurückgeholt. |
| Modellanfragen | Optionale Absichts- und Dateihinweise werden während der Eingabe vorbereitet. Beim Senden sind sofort Heuristiken verfügbar. MCP-Kataloge werden zwischengespeichert und mit höchstens vier gleichzeitigen Serverabfragen geladen. | Die normale Modellanfrage wartet nicht auf den optionalen Helfer, den Companion-Start oder sämtliche MCP-Server. Eine ausdrücklich gewählte MCP-Oberfläche lädt bei Bedarf nur ihren eigenen Katalog vorab. |
| Companion | Datei-, Git-, Engine- und lokale MCP-Aufrufe halten den benötigten Dienst für ihre Laufzeit aktiv. Gleichzeitige Starts werden zusammengefasst. | Der Dienst ist für Werkzeuge verfügbar, ohne jede Unterhaltung beim Start aufzuhalten. Ein Aufruf gibt nur seinen eigenen Nutzungsanspruch frei. |
| Chat-Darstellung | Einzelne Nachrichten sind memoisiert. Ab 60 Nachrichten werden entfernte Inhalte außerhalb des sichtbaren Bereichs durch Platzhalter ersetzt. Dateilisten werden anhand des Dateibestands zwischengespeichert. | Unveränderte Nachrichten müssen bei neuen Textstücken nicht erneut formatiert werden. Umfangreiche Unterhaltungen erzeugen weniger aktive DOM-Inhalte. |
| Chatarchiv | IndexedDB speichert die vorhandenen Nachrichten einschließlich Inhalt, Denkausgabe, Schritten und Bildern. Die bisherige Kürzung auf eine begrenzte Zahl kurzer Nachrichten gilt nur noch für die kleine Wiederherstellungskopie in localStorage. | Lange vorhandene Antworten werden beim normalen Speichern nicht durch diese Archivkürzung abgeschnitten. Das Kontextbudget für Modellanfragen bleibt separat begrenzt. |
| Schlüssel | Desktop nutzt eine verschlüsselte Datei, atomaren Dateiaustausch und geordnete Änderungen. Bekannte Modellschlüssel können über interne Verweise an die native HTTP-Leitung übergeben werden. | Zugangsdaten liegen nach erfolgreicher Migration nicht mehr als Klartext in Anvils localStorage-Eintrag. Die native Leitung setzt bekannte Schlüssel erst für die Anfrage an den Anbieter in HTTP-Header ein. |
| Status | Modellliste, CLI-Status und Phasen einer laufenden Anfrage sind getrennt benannt. | Eine geladene Modellliste wird nicht als erfolgreiche Textgenerierung dargestellt. |
| Wartbarkeit | Chatablauf, Nachrichten, Verlauf, Kontextanzeige, Menüs, Einstellungsbereiche, Store-Typen und Persistenzprojektion liegen in eigenen Modulen. Einstellungsbereiche werden bei Bedarf geladen. | Änderungen betreffen kleinere, klar abgegrenzte Dateien. Bestehende öffentliche Store-Typen bleiben über `store/ide` importierbar. |

## Speicherung und Migration

Die vorhandene IndexedDB-Datenbank wird auf Version 3 erweitert; bisherige Dateiablagen werden eingelesen. Dateiänderungen, Chatnachrichten und ihre Reihenfolge werden je Sicherung in einer Transaktion geschrieben. Eine leere Dateiliste oder ein leerer Chat ist ein gespeicherter Zustand. Die primäre Ablage kann auch dann geladen werden, wenn die kleine localStorage-Kopie fehlt oder beschädigt ist.

Automatische Sicherungen werden nach kurzer Eingabepause zusammengefasst; bei fortlaufenden Änderungen wird spätestens nach drei Sekunden ein weiterer Schreibvorgang eingereiht. **Speichern** wartet zusätzlich auf bereits eingereihte Schreibvorgänge, Browser-Sicherung und ausstehende Schlüsseländerungen. Währenddessen entstandene neue Dateiinhalte bleiben als ungespeichert markiert. Schreibfehler werden angezeigt. Ein plötzlicher Prozessabbruch kann weiterhin Änderungen verlieren, deren Sicherung noch nicht abgeschlossen war.

Bereits von früheren Versionen abgeschnittene Texte lassen sich nicht rekonstruieren. Das neue Archiv bewahrt die Nachrichten, die der Anwendung vorliegen; bestehende Grenzen für eingelesene Projektdateien und die Verarbeitung von Modellantworten werden dadurch nicht aufgehoben. Der Verlauf bleibt im Arbeitsspeicher verfügbar; die Virtualisierung reduziert die Darstellung, nicht die gespeicherte Datenmenge. Sehr lange Sitzungen können daher weiterhin viel Arbeitsspeicher oder Browser-Speicherplatz beanspruchen.

## Schlüsselablage

`electron/secrets.mjs` verwendet [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). Windows nutzt dabei DPAPI. Unter Linux akzeptiert Anvil den ungeschützten Fallback `basic_text` nicht als dauerhafte sichere Ablage. Die verschlüsselte Datei liegt als `secrets.enc` im Anvil-Benutzerverzeichnis; Schreibvorgänge ersetzen sie erst nach vollständig geschriebenem temporärem Inhalt.

Die bisherige Ablage wird erst entfernt, wenn die native Seite die dauerhafte Speicherung bestätigt hat. Solange das nicht gelingt, bleibt eine vorhandene Browser-Kopie zur Wiederherstellung erhalten. Eine vorhandene, gesperrte oder nicht entschlüsselbare native Datei wird nicht überschrieben. Neue Schlüssel ohne verfügbare Betriebssystem-Verschlüsselung gelten nur für die laufende Sitzung.

Diese Änderung schützt die Ablage auf dem Datenträger. Schlüssel bleiben für bestehende Integrationen teilweise im Arbeitsspeicher des Renderers verfügbar; die Anwendung bietet damit keine vollständige Abschottung gegenüber kompromittiertem Renderer-Code. Bekannte, bereits übernommene Modellschlüssel werden über zufällige interne Verweise im nativen HTTP-Transport aufgelöst. Noch nicht übernommene Schlüssel und Browserbetrieb behalten den kompatiblen Transportweg.

**Abo bleibt eine CLI-Verbindung.** Die installierte Anbieter-CLI verwaltet ihre Anmeldung selbst. Die Migration liest keine CLI-Anmeldedateien und ersetzt Abos nicht durch API-Zugangsdaten.

## Technische Einordnung

Die Integration wurde mit `npm run typecheck -- --pretty false` statisch kompiliert. Es wurden für diese Änderung keine Testläufe, Browserläufe, Modellanfragen oder Benchmarks durchgeführt. Windows-Verschlüsselung, tatsächliche LAN-Antworten und Laufzeitgewinne sind damit nicht praktisch nachgewiesen. Ein neuer Installer oder ein Release wird durch diese Dokumentation nicht erzeugt.
