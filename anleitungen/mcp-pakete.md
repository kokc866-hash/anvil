# MCP-Aufgabenpakete

Im MCP-Bereich unter **Aufgabenpakete** gibt es die Vorlage **GitHub · Projektquelle lesen**. Sie ist ein begrenztes Lesepaket, kein allgemeiner Plugin-Marktplatz.

1. **Lesepaket hinzufügen** speichert eine deaktivierte Verbindung. Vorhandene eigene MCP-Verbindungen bleiben bestehen; es wird nichts heruntergeladen oder ausgeführt.
2. Einen GitHub-Token für dieses Paket eintragen. Er bleibt im vorhandenen Schlüsselspeicher. Der Token muss die gewünschten Repository-Inhalte lesen dürfen; GitHub-Organisationsrichtlinien können den Zugang zusätzlich begrenzen. Ein bereits für andere Anbindungen gespeicherter Token wird nicht automatisch übernommen.
3. Paket aktivieren. **Öffentliche README lesen** lädt zuerst den Katalog und führt anschließend `get_file_contents` für `github/github-mcp-server/README.md` aus. Ein geladener Katalog ist noch kein erfolgreicher Dateizugriff. Serverfehler, leere Ergebnisse und Abbruch ergeben keinen Erfolg. Der Test prüft keine privaten Repositories und sendet keine Anfrage an ein KI-Modell.
4. Für eigene Quellen stehen **get_file_contents**, **list_branches** und **list_commits** bereit. Die Felder und Pflichtangaben zeigt Anvil wie bei bestehenden MCP-Verbindungen an.
5. **Entfernen** beendet die Verbindung und leert nur den eigenen Pakettoken. Eigene MCP-Verbindungen und deren Zugangsdaten bleiben erhalten. Das Paket wird beim Neustart nicht wieder hinzugefügt. Der Token selbst wird dadurch nicht bei GitHub widerrufen.

## Umfang und Rechte

Anfragen gehen an den offiziellen GitHub-Endpunkt `https://api.githubcopilot.com/mcp/x/repos/readonly`. Werden Ergebnisse später vom Agenten genutzt, können gelesene Inhalte als Kontext an dessen gewählten Modellanbieter gelangen. Es wird keine zusätzliche lokale Laufzeit benötigt.

Die Vorlagenversion **v1** bezeichnet die in Anvil enthaltene Konfiguration. Sie ist **keine festgesetzte GitHub-Serverversion**: GitHub betreibt und aktualisiert den Dienst selbst. Anvil beschränkt das Paket zusätzlich auf die drei genannten Toolnamen. Neue Tools und Ressourcen werden weder angeboten noch durch direkte Aufrufe freigeschaltet. Eine geänderte Adresse, ein anderer Transport oder eine unbekannte Vorlagenversion wird abgewiesen, bevor Anvil dafür eine Anfrage sendet. Bestehende v1-Rechte dürfen bei einer späteren Vorlagenänderung nicht erweitert werden; dafür ist eine neue Version mit bewusstem Hinzufügen erforderlich.

Ein erfolgreicher Test wird nur während der aktuellen Ansicht für dieselbe Konfiguration gezeigt. Änderungen an der Verbindung oder an den Zugangsdaten verwerfen ihn; Deaktivierung und Entfernen machen die Verbindung unbenutzbar.

## Nachweis und Grenze

Die fokussierten Pakettests prüfen deaktiviertes Hinzufügen, die feste Rechteauswahl, veränderte Ziele, unveränderte eigene MCP-Verbindungen sowie Fehler und leere Leseergebnisse. Der Integrationstest durchläuft Anvils vorhandenen MCP-Client mit einer kontrollierten Transportantwort: Katalog laden, neue Tools aussortieren, README lesen, Schreibaufrufe blockieren, entfernen. Damit ist die lokale Durchleitung geprüft. Ein persönlicher GitHub-Token wurde nicht verwendet; der Zugriff auf GitHubs Live-Dienst und auf private Repositories ist damit nicht als getestet behauptet.

Die gebaute Electron-Oberfläche wurde zusätzlich mit einem getrennten Profil und kontrolliertem MCP-Transport bedient: Paket hinzufügen, Token eintragen, aktivieren, Leseprobe, Tokenwechsel, Fehlerantwort und Entfernen. Nach einem tatsächlichen Neustart blieb das Paket entfernt; die vorhandenen Verbindungen blieben erhalten. Es gab keine Browserfehler. Nachweis: `artifacts/mcp-packages/result.json` und `read-package.png`.

Quellen, geprüft am 12. September 2026: [GitHubs Remote-Server-Dokumentation](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md) beschreibt den gehosteten Endpunkt und die `/readonly`-Varianten. [GitHubs MCP-Server](https://github.com/github/github-mcp-server) dokumentiert PAT-Anmeldung und die verwendeten Repository-Werkzeuge.
