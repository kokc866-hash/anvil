# Blender mit Anvil und Codex verwenden

Blender bleibt als eigenes Programm geöffnet. Anvil oder Codex senden ihre Werkzeuge über einen lokalen MCP-Prozess an das Blender-Addon. Beide Programme greifen auf die geöffnete Szene zu; Bearbeitungsaufträge deshalb nacheinander geben.

## Blender und Addon einrichten

1. Die Windows-ZIP von der [offiziellen Blender-Downloadseite](https://www.blender.org/download/) in den gewünschten Programmordner entpacken. Für ein portables Benutzerprofil einen Ordner **portable** direkt neben **blender.exe** anlegen. Darin bewahrt Blender Einstellungen und Addons auf. [Blender-Verzeichnisstruktur](https://docs.blender.org/manual/en/latest/advanced/blender_directory_layout.html#portable-installation)
2. Das passende Addon und den MCP-Server aus [MCP for Blender](https://github.com/ahujasid/mcp-for-blender) gemeinsam installieren. Der geprüfte Stand ist **mcp-for-blender 2.1.3** mit Addon **1.8**, Protokoll **13**. Das Addon liegt auch im veröffentlichten Python-Paket unter **blender_mcp/bundled/addon.py**.
3. Das Addon als **blender_mcp.py** unter **portable/scripts/addons** ablegen und in Blender unter **Bearbeiten → Einstellungen → Add-ons** aktivieren. Bei der Installation über `mcp-for-blender install-addon` für ein portables Profil die Prozessvariable **BLENDERMCP_ADDONS_DIR** ausdrücklich auf diesen Addon-Ordner setzen.
4. Im 3D-Fenster mit **N** den Seitenbereich öffnen und **MCP for Blender** wählen. Der lokale Server startet mit dem aktivierten Addon automatisch. Falls er manuell gestoppt wurde, im Bereich wieder starten. Der Standardport ist **9876**; die Verbindung bleibt auf diesem Rechner.

Die Zustimmung zur Telemetrie im Addon ausgeschaltet lassen und im gestarteten MCP-Prozess **DISABLE_TELEMETRY=true** setzen. Cache, temporäre Dateien und das lokale MCP-Profil können im gewählten Programmordner liegen. Diese Prozessvariablen ändern keine systemweiten Windows-Einstellungen.

## Anvil verbinden

Unter **Erweiterungen → Dienste → Engines, 3D & CAD → 3D & Assets** die Blender-Vorlage auswählen und **In MCP vorbereiten** wählen. Eine bereits eingerichtete Blender-Verbindung bearbeiten.

Unter **MCP → Verbindungen → Lokale Programme** folgende Werte setzen:

| Feld | Wert |
|---|---|
| Verbindung | Lokales Programm · stdio |
| Programm | Vollständiger Pfad zum installierten MCP-Programm oder zu seinem Python-Startprogramm |
| Argumente | Passende JSON-Liste; bei uvx beispielsweise `["--python", "3.11", "mcp-for-blender==2.1.3"]` |
| Arbeitsordner | Ein beschreibbarer Ordner für Blender-Projekte |
| Zeitlimit | Beispielsweise `300000` ms für längere Aufrufe |

Das gestartete Programm muss **MCP über stdio** sprechen. **blender.exe** und der interne Socket-Port sind keine MCP-Serveradresse für dieses Feld. Eine separate Python-Umgebung mit vollständig installierten Abhängigkeiten vermeidet Paketdownloads bei jedem Start.

Die Verbindung aktivieren und **Verbindung prüfen** wählen. Der geprüfte Grundumfang liefert **36 Werkzeuge und 4 Ressourcen**. Unter **Werkzeuge** Blender als Verbindung wählen und **get_addon_status** aufrufen. Erwartet werden **up_to_date: true**, übereinstimmende Protokollversionen und die laufende Blender-Version. Danach bestätigt **get_scene_info**, dass auch die Anwendung erreichbar ist. Manche Werkzeuge verlangen **user_prompt**; dort den eigenen Auftrag eingeben.

**Hier arbeiten** wählt Blender als Arbeitsfläche. Im Modus **Brücke** bleiben Anvils Dateiwerkzeuge und weitere aktive Verbindungen verfügbar. Für Änderungen im Chat den Modus **Agent** verwenden.

## Globale Codex-Verbindung

Die globale Registrierung liegt in **~/.codex/config.toml** und gilt projektübergreifend. Für eine vorhandene uvx-Installation lautet der Eintrag beispielsweise:

```toml
[mcp_servers.blender]
command = "D:/Programme/uv/uvx.exe"
args = ["--python", "3.11", "mcp-for-blender==2.1.3"]
startup_timeout_sec = 60
tool_timeout_sec = 300

[mcp_servers.blender.env]
BLENDER_HOST = "127.0.0.1"
BLENDER_PORT = "9876"
DISABLE_TELEMETRY = "true"
```

Die Beispielpfade ersetzen. Für eine bereits installierte separate Python-Umgebung kann stattdessen deren Python-Startprogramm mit der passenden Startdatei verwendet werden. Andere MCP-Einträge und vorhandene Werkzeugfreigaben erhalten. **codex mcp get blender** zeigt den gespeicherten Eintrag; Codex nach der Einrichtung einmal neu starten, damit die Werkzeuge geladen werden. [MCP for Blender: Codex-Anbindung](https://github.com/ahujasid/mcp-for-blender#codex)

## Ein erster Auftrag

> Prüfe die Blender-Verbindung. Erstelle in einer neuen Szene einen Körper mit 120 × 80 × 50 mm und abgerundeten Kanten. Gib ihm ein blaues Material, prüfe die Maße, zeige die Ansicht und speichere eine neue .blend-Datei sowie einen GLB-Export in meinem Zielordner: [Ordner einsetzen].

Für den GLB-Export die aktive Szene und die gewünschten Objekte ausdrücklich wählen. Die Auswahl allein kann bei mehreren Szenen weitere Objekte einschließen. Beim Skripten stabile Blender-API-Kennungen verwenden: Knotennamen können in einer deutschen Oberfläche übersetzt sein. **bpy_api_lookup** und **describe_node_type** helfen bei der tatsächlich installierten Version.

Dateien anschließend erneut öffnen und exportierte Geometrie wieder einlesen. Eine gerenderte Ansicht und passende Maße bestätigen mehr als eine reine Abschlussmeldung des Modells.

## Beim nächsten Start

Blender öffnen und dessen Initialisierung abwarten. Das aktivierte Addon startet die interne Verbindung. Anvil behält den aktivierten Eintrag und lädt den Werkzeugkatalog selbstständig; eine manuelle Prüfung ist nur bei Bedarf nötig. Blender muss für die Bearbeitung geöffnet bleiben.

Asset-Suche und externe 3D-Generierung sind zusätzliche Funktionen mit eigenen Voraussetzungen. Sie werden durch die lokale Grundeinrichtung nicht automatisch angemeldet oder mit Guthaben ausgestattet.

## Geprüfter Stand

Am **4. Oktober 2026** mit **Blender 5.2.2 LTS**, MCP **2.1.3** und Addon-Protokoll **13** geprüft: Anvil-Verbindung, globale Codex-Konfiguration über einen echten MCP-Client, Szenenänderung, Maße und Materialien, .blend-Speicherung, Ansicht und GLB-Export. Ein unabhängiger Blender-Prozess hat die .blend-Datei erneut geöffnet und den GLB-Export wieder eingelesen. Nach einem normalen Blender-Neustart funktionierten der automatische Addon-Start und die erneute Anvil-Verbindung. Dies war ein Verbindungstest mit gezielten Werkzeugaufrufen, kein Dauertest eines Sprachmodells.

Nachweise und Quellen: **artifacts/blender-setup/**.
