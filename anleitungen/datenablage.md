# Lokale Desktop-Daten

Anvil speichert sein Desktop-Profil im Unterordner `data` des Anvil-Verzeichnisses.
Beim Start aus dem Quellcode liegt `data` im Anvil-Projektordner; bei einer
gepackten Windows-Version liegt der Ordner neben `Anvil.exe`.

Dort liegen auch Chromium-Sitzungen, IndexedDB, lokaler Speicher, Caches,
verschlüsselte Schlüssel und Absturzprotokolle. Der Ordner muss beschreibbar sein.
Anvil weicht bei einem Schreibfehler nicht still auf AppData aus.

Bereits ausdrücklich konfigurierte Orte in `data/anvil-paths.json` bleiben gültig.
Ohne eigene Vorgaben liegen Helfermodelle und Pakete ebenfalls unter `data`.
`ANVIL_USER_DATA` kann einen anderen absoluten Profilpfad festlegen. Testläufe
können weiterhin `ANVIL_QA_USER_DATA` zur Isolation verwenden.

## Vorhandenes Profil übernehmen

Anvil vor einer Übernahme vollständig schließen. Den bisherigen gesamten Ordner
`%APPDATA%\Anvil` in den neuen `data`-Ordner kopieren, einschließlich versteckter
Dateien und Sitzungsordner. Ein bereits vorhandenes Zielprofil nicht überschreiben
oder mit dem alten Profil zusammenführen. Die Kopie prüfen und Einträge in
`anvil-paths.json`, die noch in den alten Ordner zeigen, auf das neue Ziel anpassen.
Erst nach einer vollständigen Prüfung die alte Ablage entfernen.

Der Datenordner ist von Git und der Dateiüberwachung des Entwicklungsservers
ausgenommen. Der Entwicklungsserver liefert seine Dateien nicht über HTTP aus.

## Projektsicherungspunkte

In Release 1.3.28 liegen Projektsicherungspunkte unter `data/project-checkpoints` beziehungsweise im entsprechend konfigurierten Anvil-Profil. Sie enthalten auch ungeöffnete Projektdateien und Binärinhalte, getrennt von den Projektordnern. Identische Inhalte werden über ihren SHA-256-Wert gemeinsam abgelegt. Beginn, Ende und ein möglicher Wiederherstellungsplan bleiben getrennt erhalten.

Der Speicher wächst mit neuen und geänderten Inhalten; alte Sicherungsinhalte werden derzeit nicht automatisch bereinigt. Anvils eigener Datenordner wird von diesen Sicherungspunkten ausgeschlossen, auch wenn er innerhalb des geöffneten Quellcodeprojekts liegt. Ein Projektsicherungspunkt ersetzt keine gesonderte Sicherung des Anvil-Profils und keine externe Datensicherung. Bedienung und Ausschlüsse stehen im [Editor-Handbuch](editor.md#projekt-und-assets-vor-einer-agentenrunde-sichern).
