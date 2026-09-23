# Programme ausführen

**Ausführen** startet die aktive ausführbare Datei. Bei geöffneten Dokumenten oder Headerdateien sucht Anvil eine passende Startdatei im Projekt, bevorzugt im selben Unterordner. Dateien unter `.anvil/` und `ref/` sowie Markdown-, JSON- und Headerdateien werden nicht als Programme gestartet.

## HTML und Canvas

HTML, JavaScript und TypeScript werden in der geöffneten Vorschau oder im Ausgabefenster ausgeführt. Jede Ausführung startet das Dokument neu und wartet, bis es bereit ist. Der Agent steuert dieselbe Ausgabe; Startfehler werden als Fehler gemeldet. **Stoppen** beendet auch selbst geschriebene JavaScript-Schleifen. Mehr zu API, Projektdateien und Bildaufnahmen findest du in der [Canvas-Anleitung](canvas.md).

## Native Ausgabe

In der Desktop-Anwendung werden die Dateien lokal ausgeführter Programme neben `Anvil.exe` im Ordner `runs` abgelegt. Jede Ausführung erhält einen eigenen Ordner mit folgenden Inhalten:

| Ort | Inhalt |
| --- | --- |
| `runs/<Programm-ID>/<Lauf-ID>/src` | Quelldatei-Snapshot dieses Laufs |
| `runs/<Programm-ID>/<Lauf-ID>/out` | Programme, Objekte bzw. übersetzte Dateien |
| `runs/<Programm-ID>/<Lauf-ID>/tmp` | Zwischendateien dieses Laufs |
| `runs/<Programm-ID>/<Lauf-ID>/run.log` | Zusammengefasste Ausgabe und Fehler |
| `runs/<Programm-ID>/<Lauf-ID>/run.json` | Status, Befehle, Exitcodes und Ausgabeordner |
| `runs/cache` | Wiederverwendbare Compiler-Caches |

Die Konsole zeigt den vollständigen Pfad des Ausgabeordners. Jede Ausführung hat eine eigene ID; vorhandene Builds werden nicht überschrieben. Der Windows-Installer erhält `runs` auch beim Aktualisieren oder Deinstallieren. Nicht mehr benötigte Ausführungsordner lassen sich nach dem Beenden des Programms löschen. Bei einem separat gestarteten Companion liegt `runs` standardmäßig im Anvil-Verzeichnis oberhalb von `companion`; mit `ANVIL_INSTALL_DIR` lässt sich bei Bedarf ein anderer Installationspfad festlegen.

Direkt gestartete Programme verwenden den verbundenen Projektordner als Arbeitsverzeichnis. Projektwerkzeuge wie Cargo und der Compiler arbeiten mit einer Kopie des aktuellen Projektstands. Fehler beim Zugriff auf den Projekt- oder Installationsordner werden angezeigt. Das Programmverzeichnis muss beschreibbar sein.

C/C++: Anvil kompiliert die gewählte Startdatei und die zugehörigen Hilfsdateien. Weitere Quelldateien mit eigener `main`-Funktion werden ausgelassen. Eine C-Hilfsdatei wird als C übersetzt, auch wenn die Startdatei in C++ geschrieben ist. Eigene CMake- oder Make-Regeln werden bei der einfachen Dateiausführung nicht automatisch ausgewertet.

## Terminal und Fehler

Python-Programme mit `curses` oder `input()` sowie erkannte native Konsolenprogramme starten unter Windows in einem eigenen Terminal. Tastatureingaben und die Programmansicht gehören zu diesem Fenster. Anvil behält stderr und das abschließende Prozessergebnis. Für grafische Fenster gilt dieselbe Statusüberwachung.

Standard-Python für Windows enthält `curses` nicht. Falls die Meldung `No module named '_curses'` erscheint, mit dem in der Programmausgabe genannten Python installieren:

```powershell
& "Pfad\zu\python.exe" -m pip install windows-curses
```

Der Paketfehler und ein fehlendes interaktives Terminal sind verschiedene Ursachen. Grundlage: [Python curses HOWTO](https://docs.python.org/3/howto/curses.html), [windows-curses](https://github.com/zephyrproject-rtos/windows-curses).

Verwende bei einem Fehler die vollständige Compiler- und Programmausgabe einschließlich Fehlerausgabe (`stderr`) und Exitcode. `see_run` liefert denselben aktuellen Status. Ein geöffnetes Fenster bedeutet „läuft“; erst nach dem Prozessende steht das endgültige Ergebnis fest.

## MCP-Werkzeuge

Integrierte Werkzeuge wie `read_file`, `write_file` und `run_file` benötigen keine MCP-Aktivierung. Auf der Anvil-Arbeitsfläche stehen konfigurierte und aktivierte MCP-Server über `mcp_list` und `mcp_call` zur Verfügung. `mcp_list` liefert Server-IDs, Werkzeugkataloge und Verbindungsfehler. Ist eine MCP-Arbeitsfläche exklusiv ausgewählt, bleibt der Zugriff auf diese Arbeitsfläche beschränkt.
