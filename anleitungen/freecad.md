# FreeCAD mit Anvil einrichten

Mit dieser Verbindung kann Anvils Agent Dokumente in FreeCAD erstellen, Bauteile ändern, Ansichten abrufen und Dateien exportieren. FreeCAD bleibt dabei die Anwendung für das CAD-Modell. Anvil übernimmt die Unterhaltung und die Werkzeugaufrufe.

Diese Anleitung beschreibt eine lokale Windows-Einrichtung. Die Pfade sind Beispiele und müssen zur eigenen Installation passen. Geprüfter Stand vom 1. Oktober 2026: FreeCAD 1.1.4 sowie FreeCAD-MCP-Addon und Server 0.1.25, mit 17 Werkzeugen.

## 1. Voraussetzungen installieren

- [FreeCAD](https://www.freecad.org/downloads.php).
- [Python 3.12 oder neuer](https://www.python.org/downloads/windows/) für den externen MCP-Server. FreeCADs eingebautes Python ersetzt diese Laufzeit nicht.
- `uvx` aus [uv](https://docs.astral.sh/uv/getting-started/installation/), das den MCP-Server mit seinen Abhängigkeiten startet. Falls `uvx` schon für OpenSCAD eingerichtet wurde, kann dieselbe Installation verwendet werden.

FreeCAD und Anvil müssen für diesen Ablauf auf demselben Rechner laufen. Ein Modellserver darf weiterhin im Netzwerk stehen; seine Adresse und seine Einstellungen werden durch die CAD-Einrichtung nicht verändert.

### Optional: uvx im Anvil-Ordner ablegen

Die folgenden PowerShell-Befehle legen eine separate Python-Umgebung im gewählten Anvil-Ordner an und installieren dort uv. Python 3.12 mit dem Windows-Python-Launcher muss dafür bereits vorhanden sein. Einen bereits eingerichteten Ordner nicht erneut anlegen.

```powershell
$anvilFolder = 'D:\Anvil' # Durch den eigenen Anvil-Ordner ersetzen.
$cadRuntime = Join-Path $anvilFolder 'data\packages\mcp\runtime'
py -3.12 -m venv $cadRuntime
& (Join-Path $cadRuntime 'Scripts\python.exe') -m pip install --no-cache-dir uv
& (Join-Path $cadRuntime 'Scripts\uvx.exe') --version
```

Das Programm für die MCP-Verbindung liegt anschließend unter `D:/Anvil/data/packages/mcp/runtime/Scripts/uvx.exe`. Ist der Python-Launcher nicht installiert, beim ersten Befehl stattdessen den vollständigen Pfad zu einer vorhandenen Python-3.12-Programmdatei verwenden. Das Serverpaket nicht in FreeCADs eigene Python-Umgebung installieren.

## 2. Das FreeCAD-Addon installieren

1. Die [Quellcode-ZIP von FreeCAD MCP 0.1.25](https://github.com/neka-nat/freecad-mcp/archive/refs/tags/v0.1.25.zip) herunterladen und entpacken. Die gesamte entpackte Quelle ist noch kein installiertes Addon.
2. Daraus den Ordner `addon/FreeCADMCP` in das `Mod`-Verzeichnis der verwendeten FreeCAD-Installation kopieren. Bei einer beschreibbaren Installation kann das beispielsweise `D:/Programme/FreeCAD 1.1/Mod` sein. Dort muss unmittelbar `FreeCADMCP/InitGui.py` liegen, ohne einen zusätzlichen gleichnamigen Unterordner.
3. FreeCAD vollständig schließen und wieder öffnen.
4. Oben in der Auswahl der Arbeitsumgebung **MCP Addon** wählen. Die englischen Bezeichnungen stammen vom Zusatzmodul und bleiben auch in einer deutschen FreeCAD-Oberfläche erhalten.
5. Im Menü **FreeCAD MCP → Start RPC Server** den Server starten. Anschließend **Auto-Start Server** einschalten, damit dieser Schritt beim nächsten FreeCAD-Start automatisch erfolgt.

Ist das Installationsverzeichnis geschützt, kann der Benutzer-Addon-Ordner verwendet werden. Bei FreeCAD 1.1 unter Windows ist das normalerweise `%APPDATA%/FreeCAD/v1-1/Mod`; andere Versionen können andere Ordner verwenden. Die [Installationsanleitung des Addons](https://github.com/neka-nat/freecad-mcp/blob/v0.1.25/docs/installation.md) beschreibt, wie sich der tatsächlich verwendete Ordner ermitteln lässt.

Für die lokale Einrichtung **Remote Connections** ausgeschaltet lassen. Der Addon-Server ist dann nur auf diesem Rechner unter `127.0.0.1:9875` erreichbar. Diese Adresse ist die interne Verbindung zu FreeCAD und wird **nicht** als MCP-HTTP-Adresse in Anvil eingetragen.

FreeCAD verwaltet seine kleinen Addon-Einstellungen im eigenen Benutzerprofil. Das Kopieren des Addons in den Installationsordner verlagert dieses Profil nicht. Anvils Paketcache und temporäre Serverdateien lassen sich dagegen wie unten beschrieben im Anvil-Ordner ablegen.

## 3. Die Verbindung in Anvil anlegen

Unter **Erweiterungen → Dienste → Engines, 3D & CAD → CAD & Konstruktion** die Vorlage **FreeCAD – parametrische Konstruktion** wählen und **In MCP vorbereiten** anklicken. Anschließend **MCP-Verbindungen öffnen** wählen. Die neue Verbindung ist zunächst deaktiviert. Gibt es bereits eine FreeCAD-Verbindung, diese bearbeiten, statt eine zweite anzulegen.

In der Verbindung folgende Felder ausfüllen:

| Feld | Eingabe |
|---|---|
| Name | `FreeCAD – parametrische Konstruktion` |
| Verbindung | **Lokales Programm · stdio** |
| Programm | `uvx`, falls erreichbar; sonst der vollständige Pfad zu `uvx.exe` |
| Argumente | Die JSON-Liste aus dem nächsten Abschnitt |
| Arbeitsordner | Kann leer bleiben |
| Zeitlimit in ms | `600000` für längere CAD-Aufrufe, entsprechend zehn Minuten |

Bei einer vorhandenen uvx-Installation genügt für die Bedienung des geöffneten FreeCAD-Fensters diese Argumentliste:

```json
["--python", "3.12", "freecad-mcp@0.1.25", "--host", "127.0.0.1"]
```

Für eine ausdrücklich gewählte Python-Laufzeit und die zusätzliche Ausführung ohne FreeCAD-Fenster können die Argumente so aussehen:

```json
[
  "--python",
  "D:/Anvil/data/packages/mcp/runtime/Scripts/python.exe",
  "freecad-mcp@0.1.25",
  "--host",
  "127.0.0.1",
  "--freecadcmd",
  "\"D:/Programme/FreeCAD 1.1/bin/freecadcmd.exe\""
]
```

Die Beispielpfade durch die eigenen Pfade ersetzen. In JSON entweder `/` oder doppelte Backslashes `\\` verwenden. Die inneren Anführungszeichen bei `--freecadcmd` sind erforderlich, wenn der FreeCAD-Pfad Leerzeichen enthält. Das Feld **Programm** bleibt `uvx.exe`; `freecad.exe` ist kein MCP-Server.

### Paketcache und temporäre Dateien

Im Umgebungsfeld der MCP-Verbindung kann dieses JSON-Objekt hinterlegt werden:

```json
{
  "UV_CACHE_DIR": "D:/Anvil/data/packages/mcp/cache",
  "TMP": "D:/Anvil/data/packages/mcp/freecad/temp",
  "TEMP": "D:/Anvil/data/packages/mcp/freecad/temp"
}
```

Die Pfade anpassen und die Ordner anlegen. Anvil bewahrt diese Umgebungswerte im Schlüsselspeicher der Verbindung auf. Sie gelten für den gestarteten Server und ändern keine systemweiten Umgebungsvariablen. Die Serverabhängigkeiten liegen damit im angegebenen Paketcache. Der Anbieter verwendet für kurzlebige Skripte der Ausführung ohne Fenster zusätzlich den Benutzer-Cache; diese Skripte werden nach dem Aufruf entfernt.

## 4. Aktivieren und prüfen

FreeCAD-Dokumente (`.FCStd`, ältere `.FCStd1`-Sicherungen und `.FCBak`) enthalten Binärdaten. Anvil liest sie ohne Textumwandlung ein; sie bleiben auch beim erneuten Laden und Fortsetzen bytegenau erhalten. Falls Anvil einen tatsächlichen Unterschied zwischen Editor und Datenträger meldet, offene Textänderungen zuerst prüfen und den Projektstand neu laden. Die native FreeCAD-Datei dafür nicht im Texteditor speichern. Ein fehlgeschlagener Start bleibt im Agentenbereich sichtbar, bis ein Start gelingt oder die Meldung ausgeblendet wird.

1. FreeCAD geöffnet lassen und kontrollieren, dass sein Addon-Server gestartet ist.
2. In Anvil die FreeCAD-Verbindung aktivieren und **Verbindung prüfen** wählen. Beim ersten Start lädt uvx das Paket und seine Abhängigkeiten herunter. Mit Version 0.1.25 sollte der Katalog **17 Werkzeuge · 0 Ressourcen** zeigen. Null Ressourcen ist bei diesem Server kein Fehler.
3. Nach `get_rpc_status` suchen, das Werkzeug wählen, die Argumente `{}` verwenden und **Aufrufen** anklicken.
4. In der Ausgabe müssen `success: true`, `rpc_server: "running"`, `gui_dispatch.state: "healthy"` und `version_check: "ok"` stehen. Damit sind nicht nur der Werkzeugkatalog, sondern auch FreeCAD und der Versionsabgleich geprüft.
5. Bei dieser Verbindung **Hier arbeiten** wählen. **Brücke** erlaubt dem Agenten zusätzlich Anvil-Dateien und weitere aktive MCP-Verbindungen. **Nur aktive Arbeitsfläche** beschränkt ihn auf FreeCAD. Für das Erstellen und Ändern von Bauteilen im Chat den Modus **Agent** verwenden.

## 5. Ein erstes Bauteil erstellen

Einen beschreibbaren Zielordner wählen und im Auftrag ausdrücklich nennen. Beispielsweise:

> Verwende die FreeCAD-MCP-Verbindung und prüfe zuerst ihren Status. Erstelle in einem neuen Dokument eine parametrische Montageplatte mit 80 × 50 × 3 mm. Ergänze vier durchgehende Bohrungen mit 3,2 mm Durchmesser, jeweils 10 mm von den angrenzenden Kanten entfernt. Prüfe die tatsächlichen Maße, die Bohrungen und die Gültigkeit des Volumenkörpers. Zeige eine Ansicht. Speichere eine neue FCStd-Datei und exportiere STEP in meinen Zielordner: [vollständigen Ordnerpfad einsetzen]. Bestehende Dokumente und Dateien nicht überschreiben.

Das Bauteil muss im FreeCAD-Fenster sichtbar sein. Eine Abschlussmeldung des Modells allein bestätigt noch kein korrektes Ergebnis. Für die Prüfung Maße und Geometrie aus FreeCAD abfragen, die gespeicherte FCStd-Datei erneut öffnen und den STEP-Export wieder einlesen. FCStd erhält das native Dokument mit seinen Parametern; STEP dient dem Austausch der Geometrie.

## 6. Beim nächsten Start

FreeCAD öffnen und seine Initialisierung abwarten. Mit **Auto-Start Server** startet die interne Brücke automatisch. Danach Anvil öffnen; die aktivierte Verbindung und ihre Einstellungen bleiben gespeichert. Der Katalog muss nicht bei jedem Neustart manuell geladen werden. **Verbindung prüfen** ist für eine zusätzliche Prüfung oder nach einer Änderung verfügbar.

Für Arbeiten im FreeCAD-Fenster muss FreeCAD geöffnet bleiben. Das Werkzeug `execute_code_headless` startet dagegen einen separaten Prozess und bearbeitet nicht automatisch das offene Dokument. `execute_code_async` startet einen Auftrag im geöffneten FreeCAD; dessen Abschluss wird mit `get_async_status` geprüft. Ein größeres Anvil-Zeitlimit verlängert nicht automatisch das eigene Ausführungsbudget des Addons.

## Wenn etwas nicht funktioniert

### Nach einem abgebrochenen Hintergrundauftrag

Im Agentenbereich **Fortsetzen** wählen. In den Auftragsdetails heißt derselbe Weg **Stand prüfen und fortsetzen**. Du musst kein Formular ausfüllen und den Ausgang eines unterbrochenen FreeCAD-Aufrufs nicht erraten. Der Agent liest zuerst den aktuellen Projekt- oder Dienststand und arbeitet von dort an offenen Punkten weiter.

Aktionen ohne bestätigte Rückmeldung bleiben als unbekannt gespeichert. Das betroffene Werkzeug bleibt gesperrt; auch veränderte Argumente lösen keine Wiederholung aus. Der Agent darf die Sperre nicht über ein anderes Werkzeug umgehen. Kann er deshalb nicht weiterarbeiten, muss er konkret erklären, was fehlt. Die Wiederaufnahme ist keine bestandene CAD-Prüfung.

**Frühere Aktion selbst klären (optional)** ist nur für den Fall gedacht, dass du den Ausgang bereits selbst geprüft hast und das betroffene Werkzeug wieder freigeben möchtest. Dort den bekannten Ausgang wählen und die tatsächliche Beobachtung im Programm oder Dienstprotokoll beschreiben. Wenn du es nicht weißt, die Angaben leer lassen und normal fortsetzen. Diese Klärung führt selbst keine CAD-Aktion aus und bleibt nach einem Neustart erhalten.

Unter **Kriterien und Nachweise** zeigt Anvil Sollwert, Messwert und konkrete Nachweisfehler. `1` als Zahl und `"1"` als Text sind unterschiedliche Werte. Bereits festgelegte Kriterien werden bei einer Wiederaufnahme nicht still umgeschrieben. Wurde ein Kriterium falsch vereinbart, braucht es einen neuen Prüfauftrag mit korrekt festgelegten Kriterien.

Messberichte müssen als echte Dateien im geöffneten Projekt vorliegen. Anvil vergleicht ihre SHA-256-Prüfsummen mit den gespeicherten Bytes; Platzhalter oder lediglich die Bezeichnung „verification“ reichen nicht. Die Dateiprüfung bestätigt die Zuordnung des Berichts. Maße, Geometrie, Wiederöffnen und Exporte müssen weiterhin tatsächlich geprüft werden. Historische PASS-Zeilen eines älteren CAD-Stands belegen den endgültigen Stand nicht.

| Anzeige oder Problem | Was zu prüfen ist |
|---|---|
| `uvx` oder das Programm wird nicht gefunden | Den vollständigen Pfad zu `uvx.exe` im Feld **Programm** eintragen. Bei Python-Fehlern auch den Python-Pfad beziehungsweise Python 3.12 prüfen. |
| **MCP Addon** fehlt | Ordnerstruktur mit `Mod/FreeCADMCP/InitGui.py` prüfen und FreeCAD vollständig neu starten. Importfehler stehen unter **Ansicht → Bedienfelder → Berichtansicht**. |
| Katalog geladen, CAD-Aufruf scheitert | FreeCAD geöffnet lassen, **Start RPC Server** prüfen und `get_rpc_status` aufrufen. Der Katalog allein bestätigt keine erreichbare CAD-Anwendung. |
| Port `9875` bereits belegt | Prüfen, ob eine zweite FreeCAD-Instanz den Addon-Server gestartet hat. Für diese Einrichtung eine Instanz mit laufender Brücke verwenden. |
| `version_check` meldet eine Abweichung | Addon und Paketargument auf denselben Stand bringen und FreeCAD neu starten. Hier ist das auf beiden Seiten 0.1.25. |
| Ausführung ohne Fenster startet nicht | Pfad zu `bin/freecadcmd.exe` und die inneren Anführungszeichen in dessen Argument prüfen. |
| `Failed to …`, `Error: …` oder ein Zeitlimit | Auch bei `isError: false` die Textausgabe ernst nehmen. Mit Status und Geometrie prüfen, was bereits ausgeführt wurde, bevor eine schreibende Aktion wiederholt wird. |
| Ein Dokument wird nach dem Wiederöffnen nicht gefunden | Mit `list_documents` den aktuellen Namen ermitteln; FreeCAD kann ihn aus dem Dateinamen ableiten. |

Eine laufende CAD-Änderung wird durch Anvils **Stoppen** nicht zwangsläufig rückgängig gemacht. Einheiten, Speicherziel und Wiederherstellung daher vor größeren Änderungen festlegen. Anvils Projektrücksetzung stellt fremde CAD-Dokumente nicht automatisch wieder her.

FEM-Berechnungen brauchen eingerichtete Solver und eine vollständige Berechnungsaufgabe; die optionale Bauteilbibliothek braucht eigene Inhalte. Diese Funktionen werden durch die Grundverbindung nicht automatisch eingerichtet.

Weitere Details: [MCP in Anvil](mcp.md), [Engines, 3D und CAD](engines.md), [FreeCAD-MCP-Dokumentation](https://github.com/neka-nat/freecad-mcp/tree/v0.1.25/docs).
