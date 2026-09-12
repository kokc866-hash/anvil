# Unity, Unreal und Godot in Anvil

Stand: 12. September 2026, lokaler Entwicklungsstand.

## Programme und Projekte

Unter **Einstellungen → Companion → Unity, Unreal & Godot einrichten** zuerst **Engine-Pfade prüfen** wählen. Gefundene Editoren erscheinen unter den Feldern. Falls nötig den vollständigen Programmpfad eingeben und **Engine-Pfade speichern** wählen. Leere Felder verwenden die automatische Suche; eine explizite Umgebungsvariable hat Vorrang. Das Speichern startet keinen Editor.

Auf diesem Rechner sind Godot unter `F:\Godot\Godot_v4.7.1-stable_win64.exe` und Unreal unter `I:\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe` hinterlegt. Unter Unity Hub existiert zwar ein Versionsordner, die erwartete Editor-Datei fehlt jedoch. Die Unity CLI ersetzt keinen Unity-Editor; Anvil zeigt deshalb korrekt „Editor nicht gefunden“ an. Unity wurde in dieser Abnahme nicht gestartet.

Die Pfade speichert der Companion im konfigurierten Paketordner unter `toolchains/engine-paths.json`. Hier ist das `I:\AnvilTest\compiler\toolchains\engine-paths.json`. Die Einstellungen gelten auf dem Rechner des Companion.

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

Der zuklappbare Bereich **Engines & 3D-Werkzeuge** enthält sieben Vorlagen:

| Vorlage | Anbindung |
|---|---|
| [Unity MCP – offiziell](https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.5/manual/integration/unity-mcp-get-started.html) | Unity-AI-Paket und lokales Unity-Relay; vollständigen Relay-Pfad angeben. |
| [MCP for Unity – Coplay](https://coplaydev.github.io/unity-mcp/getting-started/install) | Community-Paket im Unity-Projekt und Python/uv. |
| [Godot MCP – Coding-Solo](https://github.com/Coding-Solo/godot-mcp) | Lokaler Node-Server für Godot-Aufrufe und Szenenwerkzeuge. Bei Bedarf `GODOT_PATH` in der Verbindung setzen. |
| [Unreal MCP – chongdashu](https://github.com/chongdashu/unreal-mcp) | Experimentelles C++-Plugin und Python-Server. Den Python-Unterordner des installierten Repositories angeben. |
| [Blender MCP](https://github.com/ahujasid/blender-mcp) | Blender-Addon und lokaler MCP-Server zur Asset-Bearbeitung. |
| [Meshy](https://docs.meshy.ai/en/api/ai) | Offizieller MCP-Server zur 3D-Generierung; eigener API-Schlüssel und Guthaben. |
| [Tripo](https://github.com/VAST-AI-Research/tripo-mcp) | Offizielle Alpha-Anbindung über das Tripo-Blender-Addon. |

Die jeweilige Karte nennt Voraussetzungen, Herkunft und Anleitung. **In MCP vorbereiten** legt ausschließlich eine deaktivierte Verbindung an. **MCP-Verbindungen öffnen** führt zur bestehenden Verwaltung für Zugangsdaten, Aktivierung, Werkzeugkatalog und Entfernen. Beim späteren Aktivieren können Paketprogramme Abhängigkeiten herunterladen. API-Schlüssel gehören in den geschützten Schlüsselspeicher der Verbindung.

Epic Remote Control ist eine HTTP-/WebSocket-Schnittstelle und wird deshalb nicht als fertiger OAuth-MCP-Dienst ausgegeben. Eine lokale Engine-Installation allein stellt ebenfalls noch keinen MCP-Werkzeugkatalog bereit.

## Geprüfter Umfang

Die Tests liefen in neuen, getrennten Projekten unter `I:\Anvil\artifacts\engines`. Bestehende Spielprojekte wurden nicht verändert.

- Godot 4.7.1: Projektimport erfolgreich; Testszene gestartet, erwartete Ausgabe bestätigt und sauber beendet.
- Godot-Fehlerfall: absichtlich ungültiges Skript zuverlässig als Fehler erkannt, obwohl Godot mit Prozesscode 0 beendet wurde. Danach wurde das gültige Testskript wiederhergestellt.
- Unreal Engine 5.8: Testprojekt über den echten Companion geladen und mit `QUIT_EDITOR` sauber beendet, ohne Darstellung (`-nullrhi`). Das bestätigt Projektstart und Prozessablauf, keine interaktive Spielprüfung.
- Automatisiert geprüft: mehrere verschachtelte Projekte, Leerzeichen und Windows-Pfade, geschützte Pfadspeicherung, unbekannte Aktionen, Laufzeitbegrenzung und laufende Editorprozesse. Ein Editorstart oder eine Versionsabfrage kann keine erfolgreiche Projektprüfung vortäuschen. Ein erfolgreicher Wiederholungsversuch kann den zugehörigen Fehler aufheben.
- Desktop-Abnahme: lokale Vorlagen korrekt und deaktiviert anlegen, Pflichtangaben prüfen und zur MCP-Verwaltung wechseln; bestehender Dienstablauf mit Anmeldung, Werkzeugauswahl, Aufruf, Neustart, Abmeldung und Entfernen weiterhin erfolgreich.
- Abschließend in der normalen Anvil-Instanz: aktualisierte Oberfläche gestartet, gespeicherte Godot-/Unreal-Pfade über die neuen Einstellungen geladen und erneut gespeichert. Beide Programme wurden gefunden. 38 gezielte automatisierte Tests, Typprüfung, Build und elf Desktop-Prüfgruppen bestanden.

Nachweise: `artifacts/engines/live-result.json`, `artifacts/engines/tests.log`, `artifacts/engines/evidence-regression.log`, `artifacts/engines/typecheck.log`, `artifacts/engines/build.log` und `artifacts/services/result.json`.

Unity sowie die externen Engine-/Asset-MCP-Server wurden nicht live ausgeführt. Ihre Vorlagen sind anhand der verlinkten Maintainer-Dokumentation vorbereitet. Es wurden keine externen Konten verbunden und keine kostenpflichtigen Generierungen gestartet.
