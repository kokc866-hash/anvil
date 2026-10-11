# Updates für Sprachwerkzeuge

Unter **Einstellungen → Companion → Updates für Sprachwerkzeuge** prüft Anvil die Versionen seiner Compiler, Laufzeitumgebungen und Sprachserver.

## Automatische Prüfung

**Automatisch täglich prüfen** ist standardmäßig eingeschaltet. Anvil prüft nach dem Start und während es geöffnet bleibt, ob eine neue Prüfung fällig ist. Erfolgreiche Prüfungen werden höchstens einmal innerhalb von 24 Stunden durchgeführt. Nach einem fehlgeschlagenen oder unterbrochenen Abruf wird frühestens nach einer Stunde erneut geprüft. Es gibt keinen zusätzlichen dauerhaft laufenden Dienst.

Die Ergebnisse und der Schalter werden im gewählten **Pakete-Ordner** als `language-updates.json` gespeichert. Ein Neustart verwirft sie nicht. Bei einem Wechsel des Pakete-Ordners gelten die dort gespeicherten Einstellungen und Ergebnisse.

Mit **Jetzt auf Updates prüfen** kannst du jederzeit eine Prüfung starten, auch wenn die Automatik ausgeschaltet ist. Gleichzeitige Prüfungen verwenden denselben laufenden Vorgang.

## Ergebnisse lesen

**Versionen und Ergebnisse** lässt sich auf- und zuklappen. Jeder Eintrag zeigt die installierte Version, die verfügbare Version und den Installationsort. Eine von Anvil heruntergeladene Reserve wird getrennt von einem systemweit installierten Werkzeug geprüft.

- **Update verfügbar:** Eine neuere Version innerhalb der verglichenen Versionsreihe wurde gefunden.
- **Neue Versionsreihe verfügbar:** Der Anbieter hat eine neuere Reihe veröffentlicht. Vor einem Wechsel solltest du prüfen, ob dein Projekt damit funktioniert.
- **Aktuell:** Die installierte Version entspricht der beim Anbieter gefundenen stabilen Version.
- **Installierte Version ist neuer:** Deine Version liegt über der verglichenen Anbieter-Version, etwa wenn du eine neuere Node.js-Reihe statt der aktuellen LTS-Reihe verwendest.
- **Nicht installiert:** Anvil hat für dieses Werkzeug keine Installation gefunden. Die Anbieter-Version allein bedeutet nicht, dass es bereits verfügbar ist.
- **Vergleich nicht möglich:** Anvil kann die installierte Version nicht eindeutig bestimmen oder die Versionsformate passen nicht zusammen.
- **Vergleichsversion eines anderen Anbieters:** Für Java konnte Microsoft nicht als Anbieter der Installation bestätigt werden. Die angezeigte Microsoft-Version gilt dann als Referenz und wird nicht als Update für diese Installation gezählt.
- **Prüfung fehlgeschlagen:** Der Anbieter war nicht erreichbar oder lieferte keine passenden Versionsdaten. Das gilt nicht als erfolgreiche Prüfung. Eine vorher bekannte Version bleibt mit dem Datum ihrer letzten erfolgreichen Prüfung sichtbar.

Ein über `rustup` verwalteter **rust-analyzer** gehört zur Rust-Installation. Er wird nicht mit einem eigenständigen GitHub-Paket verglichen. Für eine eigenständige Installation werden die datierten stabilen Releases verglichen.

## Welche Werkzeuge werden geprüft?

Die Prüfung umfasst Go, Rust, OpenJDK, Zig für C/C++, PHP, Ruby, Python, Node.js und das .NET SDK sowie Pyright, TypeScript, TypeScript Language Server, HTML/CSS/JSON, YAML, gopls, clangd und eigenständig installierten rust-analyzer.

Für **Node.js** wird die aktuelle LTS-Version verglichen. Bei **Java, PHP und .NET** bleibt Anvil innerhalb der installierten Versionsreihe. Ist noch nichts installiert, verwendet die Prüfung die bisher in Anvil angebotenen Reihen OpenJDK 21, PHP 8.3 und .NET 8.0. Für Java dient die Downloadseite von Microsoft OpenJDK als Quelle.

Die Quellen sind die offiziellen Downloadseiten und Release-Metadaten der Anbieter, die npm-Registry und für einige Sprachserver die Releases ihrer offiziellen GitHub-Projekte. **Beim Anbieter öffnen** führt zur jeweiligen Quelle. Anvil überträgt dabei keine Projektdateien, Modell-Einstellungen oder Zugangsdaten.

## Installation und Grenzen

Die Prüfung lädt Versionsinformationen und installiert keine Aktualisierungen. Ein gefundenes Update verändert weder einen laufenden Agentenauftrag noch die Modellverbindung. Installiere eine Aktualisierung erst zu einem passenden Zeitpunkt und prüfe danach dein Projekt.

Anvils eigene Programm-Updates bleiben unter **Einstellungen → Daten**. Abhängigkeiten eines Projekts, Python-Pakete, Engine-Versionen und Plugins gehören nicht zu dieser Prüfung. Der verwendete Companion muss diese Funktion unterstützen; mit einer älteren Companion-Version nennt Anvil den fehlgeschlagenen Abruf.
