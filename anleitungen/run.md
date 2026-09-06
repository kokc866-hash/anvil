# Programme mit Run starten

Run verwendet die aktive ausführbare Datei. Bei geöffneten Dokumenten oder Headern sucht Anvil einen Programmeinstieg im Projekt, bevorzugt im selben Unterordner. `.anvil/`, `ref/`, Markdown, JSON und Header sind keine Programme.

## Native Ausgabe

In der Desktop-Anwendung liegen native Run-Dateien neben `Anvil.exe` im Ordner `runs`. Ein Lauf enthält:

| Ort | Inhalt |
| --- | --- |
| `runs/<Programm-ID>/<Lauf-ID>/src` | Quelldatei-Snapshot dieses Laufs |
| `runs/<Programm-ID>/<Lauf-ID>/out` | Programme, Objekte bzw. übersetzte Dateien |
| `runs/<Programm-ID>/<Lauf-ID>/tmp` | Zwischendateien dieses Laufs |
| `runs/<Programm-ID>/<Lauf-ID>/run.log` | Zusammengefasste Ausgabe und Fehler |
| `runs/<Programm-ID>/<Lauf-ID>/run.json` | Status, Befehle, Exitcodes und Ausgabeordner |
| `runs/cache` | Wiederverwendbare Compiler-Caches |

Die Ausgabe-Konsole nennt den absoluten Ausgabeordner. Jeder Lauf hat eine eigene ID; vorhandene Builds werden nicht überschrieben. Der Windows-Installer erhält `runs` auch beim Aktualisieren oder Deinstallieren. Nicht mehr benötigte Laufordner lassen sich nach dem Beenden des Programms löschen. Bei einem separat gestarteten Companion liegt `runs` standardmäßig im Anvil-Verzeichnis oberhalb von `companion`; `ANVIL_INSTALL_DIR` setzt bei Bedarf den Installationspfad explizit.

Direkt gestartete Programme verwenden einen gekoppelten Projektordner als Arbeitsverzeichnis. Projektwerkzeuge wie Cargo arbeiten im Snapshot. Der Compiler arbeitet mit dem aktuellen Snapshot. Fehler beim Zugriff auf den Projekt- oder Installationsordner werden angezeigt. Das Programmverzeichnis muss beschreibbar sein.

C/C++: Anvil kompiliert den gewählten Einstieg und die Hilfsdateien. Weitere Quelldateien mit eigener `main`-Funktion werden ausgelassen. Eine C-Hilfsdatei wird als C übersetzt, auch wenn der Einstieg C++ ist. Eigene CMake-/Make-Buildregeln werden durch den einfachen Datei-Runner nicht automatisch interpretiert.

## Terminal und Fehler

Python-Programme mit `curses` oder `input()` sowie erkannte native Konsolenprogramme starten unter Windows in einem eigenen Terminal. Tastatureingaben und die Programmansicht gehören zu diesem Fenster. Anvil behält stderr und das abschließende Prozessergebnis. Für grafische Fenster gilt dieselbe Statusüberwachung.

Standard-Python für Windows enthält `curses` nicht. Falls die Meldung `No module named '_curses'` erscheint, mit dem in der Run-Ausgabe genannten Python installieren:

```powershell
& "Pfad\zu\python.exe" -m pip install windows-curses
```

Der Paketfehler und ein fehlendes interaktives Terminal sind verschiedene Ursachen. Grundlage: [Python curses HOWTO](https://docs.python.org/3/howto/curses.html), [windows-curses](https://github.com/zephyrproject-rtos/windows-curses).

Bei einem Fehlschlag den vollständigen Compile-/Run-Block einschließlich stderr und Exitcode verwenden. `see_run` liefert denselben aktuellen Status. Ein geöffnetes Fenster bedeutet „läuft“; erst das Prozessende liefert das endgültige Ergebnis.

## MCP-Werkzeuge

Native Werkzeuge wie `read_file`, `write_file` und `run_file` benötigen keine MCP-Aktivierung. Auf der Anvil-Fläche stehen konfigurierte und aktivierte MCP-Server über `mcp_list` und `mcp_call` zur Verfügung. `mcp_list` liefert Server-IDs, Werkzeugkataloge und Verbindungsfehler. Bei einer exklusiv gewählten MCP-Fläche bleibt der Zugriff auf diese Fläche beschränkt.
