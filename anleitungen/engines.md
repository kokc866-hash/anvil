# Unity, Unreal und Godot in Anvil

Die beschriebenen Funktionen entsprechen dem lokalen Quellstand 1.3.35 vom 4. Oktober 2026. Die unten genannten älteren Engine-Pfade und Praxistests dokumentieren die Prüfung vom 12. September 2026; sie gelten nicht pauschal für alle Engine-Versionen. Neue Prüfungen von Godot, Unreal, Blender und CAD mit ihren jeweiligen Grenzen stehen unter [Optimierungen und Abnahme](optimierungen-2026-10.md).

## Programme und Projekte

Unter **Einstellungen → Companion → Unity, Unreal & Godot einrichten** zuerst **Engine-Pfade prüfen** wählen. Gefundene Editoren erscheinen unter den Feldern. Falls nötig den vollständigen Programmpfad eingeben und **Engine-Pfade speichern** wählen. Leere Felder verwenden die automatische Suche; eine explizite Umgebungsvariable hat Vorrang. Das Speichern startet keinen Editor.

Für jede gewünschte Engine muss ein passender Editor auf dem Rechner des Companion installiert sein. Den Pfad zur ausführbaren Editor-Datei auswählen. Ein Versionsordner allein reicht nicht aus; auch die Unity CLI ersetzt keinen Unity-Editor. Fehlt die ausführbare Datei, meldet Anvil „Editor nicht gefunden“.

Die Pfade speichert der Companion im konfigurierten Paketordner unter `toolchains/engine-paths.json`. Die Einstellungen gelten auf dem Rechner des Companion und richten sich nach dessen Installation.

Den Projektordner in Anvil öffnen und beispielsweise beauftragen: „Erkenne das Godot-Projekt, prüfe den Import und zeige mir die Fehler.“ Bei mehreren Projekten kann der Agent Engine und Projektunterordner gezielt wählen. Vor dem Start speichert Anvil die Änderungen auf die Festplatte. Ein bloß im Arbeitsspeicher angelegtes Projekt braucht zuerst einen Projektordner.

Anvil unterscheidet zwischen Editorstart, laufendem Projekt und abgeschlossener Prüfung. Godots Importprüfung bestätigt den Import und erkannte Skriptfehler, keine vollständige Spielprüfung. Nicht unterstützte Aktionen werden abgelehnt und nicht stillschweigend durch einen Spielstart ersetzt.

## Dienste für die Spieleentwicklung

Unter **Erweiterungen → Dienste** sind ergänzt:

| Angebot | Nutzen und Voraussetzung |
|---|---|
| [AI Game Developer](https://github.com/IvanMurzak/Unity-MCP) | Cloud-Brücke für Unity, Unreal und Godot. Passendes Engine-Plugin, geöffnetes Projekt und Anmeldung im Plugin erforderlich. Community-Projekt, kein gemeinsamer offizieller Dienst der Engine-Hersteller. |
| [Context7](https://context7.com/docs/resources/all-clients) | Dokumentation und Codebeispiele; Versionsangaben bei der Suche verwenden. Steuert keinen Editor. |
| [ElevenLabs](https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp) | Stimmen und Audio. Die Anmeldung benötigt zusätzlich eine passende registrierte Client-ID oder Client-Metadaten; deshalb noch kein unmittelbarer Ein-Klick-Zugang. |

Die öffentlichen Anmelde-Metadaten wurden geprüft. Das ist kein Test mit einem Benutzerkonto. Der gesamte Katalog umfasst jetzt 50 Angebote, davon 35 für den bestehenden Anmeldeweg vorbereitet und 15 mit zusätzlichem Einrichtungsbedarf.

## Lokale Engine- und Asset-Erweiterungen

Der zuklappbare Bereich **Engines, 3D & CAD** enthält neun Vorlagen:

| Vorlage | Anbindung |
|---|---|
| [Unity MCP – offiziell](https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.5/manual/integration/unity-mcp-get-started.html) | Unity-AI-Paket und lokales Unity-Relay; vollständigen Relay-Pfad angeben. |
| [MCP for Unity – Coplay](https://coplaydev.github.io/unity-mcp/getting-started/install) | Community-Paket im Unity-Projekt und Python/uv. |
| [Godot MCP – Coding-Solo](https://github.com/Coding-Solo/godot-mcp) | Lokaler Node-Server für Godot-Aufrufe und Szenenwerkzeuge. Bei Bedarf `GODOT_PATH` in der Verbindung setzen. |
| [Unreal MCP – chongdashu](https://github.com/chongdashu/unreal-mcp) | Experimentelles C++-Plugin und Python-Server. Den Python-Unterordner des installierten Repositories angeben. |
| [MCP for Blender](https://github.com/ahujasid/mcp-for-blender) | Blender-Addon und lokaler MCP-Server; neue Vorlagen verwenden `uvx mcp-for-blender`. |
| [FreeCAD MCP](https://github.com/neka-nat/freecad-mcp) | FreeCAD-Addon, gestarteter RPC-Server und `uvx freecad-mcp`. |
| [OpenSCAD MCP](https://github.com/RobertCoop/openscad-mcp) | Lokale OpenSCAD-Installation und `uvx openscad-mcp`. |
| [Meshy](https://docs.meshy.ai/en/api/ai) | Offizieller MCP-Server zur 3D-Generierung; eigener API-Schlüssel und Guthaben. |
| [Tripo](https://github.com/VAST-AI-Research/tripo-mcp) | Offizielle Alpha-Anbindung über das Tripo-Blender-Addon. |

Die jeweilige Karte nennt Voraussetzungen, Herkunft und Anleitung. **In MCP vorbereiten** legt ausschließlich eine deaktivierte Verbindung an. **MCP-Verbindungen öffnen** führt zur bestehenden Verwaltung für Zugangsdaten, Aktivierung, Werkzeugkatalog und Entfernen. Beim späteren Aktivieren können Paketprogramme Abhängigkeiten herunterladen. API-Schlüssel gehören in den geschützten Schlüsselspeicher der Verbindung.

Epic Remote Control ist eine HTTP-/WebSocket-Schnittstelle und wird deshalb nicht als fertiger OAuth-MCP-Dienst ausgegeben. Eine lokale Engine-Installation allein stellt ebenfalls noch keinen MCP-Werkzeugkatalog bereit.

## Blender und CAD

Die drei Vorlagen wurden am 30. September 2026 anhand der verlinkten Maintainer-Dokumentation aktualisiert. Sie stehen unter **Erweiterungen → Dienste → Engines, 3D & CAD**; die Auswahl ist in Spiele-Engines, 3D & Assets und CAD & Konstruktion gegliedert.

**Blender:** Die [Einrichtung Schritt für Schritt](blender.md) beschreibt das portable Profil, den automatischen Addon-Start, die Anvil-Verbindung und die globale Codex-Anbindung. Die bestehende interne Vorlagenkennung bleibt erhalten, der neue Startbefehl lautet `uvx mcp-for-blender`. Bereits gespeicherte Verbindungen werden nicht überschrieben. Bei einer bestehenden Einrichtung Paketargument und Addon gemeinsam anhand der Projektanleitung aktualisieren. Die neue Vorlage installiert kein Addon. Telemetrie lässt sich laut Maintainer mit `DISABLE_TELEMETRY=true` vollständig abschalten; die entsprechende Variable kann im MCP-Schlüsselspeicher hinterlegt werden. Zusätzliche Codex-Ansichten sind keine zugesicherte Anvil-Funktion. Blender 5.2.2 LTS mit MCP 2.1.3 wurde am 4. Oktober 2026 einschließlich Szenenänderung, Speicherung, Ansicht, GLB-Export und Neustart praktisch geprüft; Nachweise stehen unter `artifacts/blender-setup/`.

**FreeCAD:** Die [Einrichtung Schritt für Schritt](freecad.md) beschreibt Installation, Start, Anvil-Verbindung und ein erstes Bauteil. Das Addon-Verzeichnis hängt von Installation und Version ab. Den vom Projekt bereitgestellten Ordner `addon/FreeCADMCP` im passenden `Mod`-Verzeichnis installieren, FreeCAD neu starten und unter **MCP Addon → Start RPC Server** aktivieren. Der externe MCP-Server benötigt Python 3.12 oder neuer, unabhängig von FreeCADs eigener Python-Version. Anvil startet die Verbindung als lokalen Prozess; der interne RPC-Port ist keine MCP-HTTP-Adresse. [Installationsanleitung](https://github.com/neka-nat/freecad-mcp/blob/main/docs/installation.md).

Für eine dauerhaft eingerichtete Verbindung **FreeCAD MCP → Auto-Start Server** aktivieren. FreeCAD muss geöffnet sein; der Addon-Server startet dann beim nächsten Programmstart automatisch. Addon und externen Server auf denselben Versionsstand bringen. `get_rpc_status` bestätigt Verbindung, Ausführungszustand und Versionsabgleich; ein geladener Werkzeugkatalog allein bestätigt noch keine erreichbare CAD-Anwendung.

Bei Programmen außerhalb des Suchpfads im MCP-Feld **Programm** den vollständigen Pfad zu `uvx.exe` verwenden. Beispielsweise lassen sich die geprüfte Version und die separate Prozessausführung mit den Argumenten `["--python", "<Python-Pfad>", "freecad-mcp@0.1.25", "--host", "127.0.0.1", "--freecadcmd", "\"<FreeCAD-Ordner>/bin/freecadcmd.exe\""]` festlegen. Unter Windows Pfade mit `/` schreiben; die inneren Anführungszeichen halten einen Programmpfad mit Leerzeichen zusammen. `UV_CACHE_DIR` sowie `TMP` und `TEMP` können für diese Verbindung auf den gewählten Anvil-Paketordner zeigen. Der Server verwaltet seine kurzlebigen Headless-Skripte zusätzlich im Benutzer-Cache; sie werden nach dem Aufruf entfernt. Das ändert keine systemweiten Suchpfade. Für längere CAD-Aufrufe ein passendes MCP-Zeitlimit einstellen; für aufwendige Geometrie `execute_code_async` mit `get_async_status` oder `execute_code_headless` verwenden.

CAD-Fehler können vom Anbieter auch als Text mit `isError: false` zurückgegeben werden. Deshalb die vollständige Ausgabe und die tatsächliche Geometrie prüfen. Nach `reload_document` kann FreeCAD den Dokumentnamen aus dem Dateinamen ableiten; `list_documents` liefert die aktuell geöffneten Namen. Exporte erneut einlesen und Maße sowie Gültigkeit prüfen. FEM und die optionale Bauteilbibliothek benötigen ihre jeweiligen Programme beziehungsweise Inhalte; die MCP-Verbindung installiert sie nicht automatisch.

**OpenSCAD:** Die Vorlage verwendet RobertCoops `openscad-mcp`, nicht das ähnlich benannte `openscad-mcp-server`. OpenSCAD muss separat installiert sein. Falls es nicht automatisch gefunden wird, `OPENSCAD_PATH` in der MCP-Verbindung auf die Programmdatei setzen. Das Feld **Programm** der Verbindung bleibt `uvx`. Prüfergebnisse müssen auch Fehlermeldungen und Geometrie berücksichtigen, da ein erfolgreicher OpenSCAD-Prozess allein kein fehlerfreies Modell belegt.

OpenSCAD und der MCP-Server sind getrennte Programme. Das Aktivieren der Verbindung installiert die Voraussetzungen nicht. `uvx` muss erreichbar sein; alternativ im Feld **Programm** den vollständigen Pfad zu `uvx.exe` hinterlegen. Über Programmargumente wie `["--python", "<vollständiger Python-Pfad>", "openscad-mcp@0.6.1"]` lässt sich eine vorhandene Python-Laufzeit und die geprüfte Serverversion festlegen. In den Umgebungsvariablen der Verbindung können `UV_CACHE_DIR` und `MCP_TEMP_DIR` auf einen Ordner innerhalb des gewählten Anvil-Paketverzeichnisses zeigen. So bleiben Paketcache und temporäre CAD-Dateien dort. Diese Angaben ändern keine systemweiten Pfade.

Bei einem fehlgeschlagenen Start zeigt Anvil den Programmnamen und die Ursache an. Fehlende Programme oder Abhängigkeiten werden nicht als Benutzerabbruch ausgegeben. **Verbindung prüfen** lädt den Katalog; anschließend bestätigt das Werkzeug `check_openscad`, ob das CAD-Programm tatsächlich gefunden wird. Für einen vollständigen Funktionstest außerdem `validate`, `measure`, `render` und `export_model` an einem getrennten Testmodell verwenden.

Nach der Einrichtung in MCP aktivieren und den Werkzeugkatalog prüfen. **Beispiel zum Chat hinzufügen** ergänzt den Entwurf um eine passende Aufgabe, ohne ihn zu senden oder bestehenden Text zu ersetzen. Die CAD-Beispiele verwenden eine Platte mit vorgegebenen Maßen und verlangen eine Geometrieprüfung sowie Speicherung als neue Datei. Das Speicherziel wird im Auftrag festgelegt. Maßhaltigkeit, Export und Rückkehr zum gesicherten Dokument müssen in der tatsächlichen Anwendung geprüft werden. Anvils Projektrücksetzung setzt fremde Blender-/CAD-Dokumente nicht automatisch zurück.

Der Einrichtungsweg und die gespeicherten Konfigurationen werden isoliert getestet. Das ist kein Nachweis eines vollständigen Modellierungsauftrags in Blender, FreeCAD oder OpenSCAD. Onshape ist in dieser Ergänzung nicht enthalten.

Am 1. Oktober 2026 wurde OpenSCAD zusätzlich live geprüft: `openscad-mcp` 0.6.1 mit OpenSCAD 2021.01, MCP-Verhandlung, 12 Werkzeuge, Installationsprüfung, Syntaxprüfung, Maß- und Geometrieprüfung, PNG-Ansicht und STL-Export einer künstlichen Montageplatte. Gemessene Maße: 80 × 50 × 3 mm, geschlossenes Volumen ohne offene oder nicht mannigfaltige Kanten. Der Werkzeugkatalog und `check_openscad` wurden auch in Anvils MCP-Oberfläche aufgerufen. Nachweise liegen lokal unter `artifacts/openscad/result.json` und den zugehörigen Testdateien.

Am selben Tag wurde FreeCAD 1.1.4 mit Addon und MCP-Server 0.1.25 live geprüft: 17 Werkzeuge, Versionsabgleich, parametrische Montageplatte (80 × 50 × 3 mm), vier durchgehende Bohrungen mit 3,2 mm Durchmesser, Änderung der Breite auf 90 mm und Rückkehr auf 80 mm, FCStd-Speicherung und Wiederöffnen, STEP-Export mit erneutem Einlesen sowie eine PNG-Ansicht. Das Volumen wurde unabhängig aus Plattenmaßen und Bohrungen berechnet und mit der CAD-Geometrie verglichen. Auch die separate FreeCADCmd-Ausführung und ein kleiner Hintergrundjob mit Statusabfrage wurden geprüft. Nachweise liegen unter `artifacts/freecad/latest.json`, im zugehörigen Testordner und unter `artifacts/freecad/execution-test.json`. Das bestätigt diese Einrichtungs- und Werkzeugabläufe; ein vollständiger Modellauftrag mit Qwen, FEM-Berechnungen und Blender sind damit nicht abgenommen.

Prüfung der Einrichtung: `npm run test:cad:browser`, nach frischem Build zusätzlich `npm run test:cad:browser -- --production`. Beide prüfen die aktuellen Startargumente, deaktivierte neue Verbindungen, Erhalt einer vorhandenen Blender-Konfiguration, Chat-Entwürfe, Neuladen und schmale Ansichten. Die gezielten Modultests sind in `npm run test:engines` enthalten.

## Geprüfter Umfang

Der Test vom 12. September 2026 verwendete Godot 4.7.1 und Unreal Engine 5.8. Für Unity war in dieser Testumgebung kein ausführbarer Editor verfügbar.

Die Tests liefen in getrennten Testprojekten.

- Godot 4.7.1: Projektimport erfolgreich; Testszene gestartet, erwartete Ausgabe bestätigt und sauber beendet.
- Godot-Fehlerfall: absichtlich ungültiges Skript zuverlässig als Fehler erkannt, obwohl Godot mit Prozesscode 0 beendet wurde. Danach wurde das gültige Testskript wiederhergestellt.
- Unreal Engine 5.8: Testprojekt über den echten Companion geladen und mit `QUIT_EDITOR` sauber beendet, ohne Darstellung (`-nullrhi`). Das bestätigt Projektstart und Prozessablauf, keine interaktive Spielprüfung.
- Automatisiert geprüft: mehrere verschachtelte Projekte, Leerzeichen und Windows-Pfade, geschützte Pfadspeicherung, unbekannte Aktionen, Laufzeitbegrenzung und laufende Editorprozesse. Ein Editorstart oder eine Versionsabfrage kann keine erfolgreiche Projektprüfung vortäuschen. Ein erfolgreicher Wiederholungsversuch kann den zugehörigen Fehler aufheben.
- Desktop-Abnahme: lokale Vorlagen korrekt und deaktiviert anlegen, Pflichtangaben prüfen und zur MCP-Verwaltung wechseln; bestehender Dienstablauf mit Anmeldung, Werkzeugauswahl, Aufruf, Neustart, Abmeldung und Entfernen weiterhin erfolgreich.
- Abschließend in der normalen Anvil-Instanz: aktualisierte Oberfläche gestartet, gespeicherte Godot-/Unreal-Pfade über die neuen Einstellungen geladen und erneut gespeichert. Beide Programme wurden gefunden. 38 gezielte automatisierte Tests, Typprüfung, Build und elf Desktop-Prüfgruppen bestanden.

Nachweise: `artifacts/engines/live-result.json`, `artifacts/engines/tests.log`, `artifacts/engines/evidence-regression.log`, `artifacts/engines/typecheck.log`, `artifacts/engines/build.log` und `artifacts/services/result.json`.

Unity sowie die weiteren externen Engine-/Asset-MCP-Server wurden nicht live ausgeführt. Für Blender, FreeCAD und OpenSCAD gelten die separat datierten Praxistests weiter oben. Die übrigen Vorlagen sind anhand der verlinkten Maintainer-Dokumentation vorbereitet. Es wurden keine externen Konten verbunden und keine kostenpflichtigen Generierungen gestartet.
