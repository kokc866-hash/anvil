# Marketplace und Plugin-Import

Stand: 30. September 2026. Dieses Dokument trennt Produktziel, jetzt umgesetzten Import und weitere Ausbauschritte. Es erklärt keine fremden Plugins pauschal für mit Anvil kompatibel.

## Produktziel

Ein gemeinsamer Marketplace verbindet Finden, Verstehen, Einrichten, Verwenden und Entfernen. Nutzer suchen nach einer Aufgabe oder einem Anbieter. Ein Angebot zeigt seinen Nutzen, Beispiele, Herkunft, Version, Lizenzangabe, Modell- und Laufzeitvoraussetzungen, externe Dienste und Kostenhinweise. Der Agent kann passende installierte Fähigkeiten für einen Auftrag verwenden. Eine fehlende Anmeldung wird im selben Ablauf erklärt.

Ein Paket darf Skills, Dienstverbindungen und weitere Komponenten bündeln. Das Paketformat ist vom ausführenden Modell getrennt: Ein lokales Modell kann passende Skills und Werkzeuge verwenden, sofern seine Fähigkeiten und Anvils Laufzeit ausreichen. Das ist keine Zusicherung gleicher Ergebnisqualität mit jedem Modell.

## Gemeinsamer Import

Unter **Erweiterungen → Marktplatz → Agenten-Plugins** gibt es **Plugin-Ordner prüfen** und **Plugin-ZIP prüfen**. Ein ZIP-Download aus einem Git-Repository kann mehrere Pakete enthalten; dann wird zuerst ein Paket gewählt. Der Import lädt selbst kein Repository, keine Abhängigkeiten und keine Zugangsdaten aus anderen Programmen.

| Format | Manifest | Auswertung |
| --- | --- | --- |
| Agent Plugins 1.0.0 | `plugin.json` | Festes Verzeichnis `skills/`, feste `mcp.json`, bekannte Schema-Version erforderlich |
| Codex | `.codex-plugin/plugin.json` | Standardpfade plus ausdrücklich angegebene Skill- und MCP-Pfade |
| Cursor | `.cursor-plugin/plugin.json` | Ausdrücklich angegebene Pfade ersetzen die jeweilige Standardsuche |

Wenn ein offenes `plugin.json` und zusätzliche Host-Manifeste im selben Paket liegen, ist das offene Manifest maßgeblich. Host-Ergänzungen werden als nicht aktiviert angezeigt. Anvil behauptet damit keine vollständige Konformität zu allen Ausführungsfunktionen dieser Formate.

Die Vorschau zeigt pro Bestandteil **importierbar** oder **noch nicht unterstützt**, jeweils mit Begründung. Lizenzangaben werden aus dem Manifest angezeigt, nicht als geprüfte Nutzungserlaubnis bewertet. Ohne verwertbaren Skill oder vorbereitbare Dienstverbindung lässt sich das Paket nicht installieren.

### Nutzbare Bestandteile

- Gültige `SKILL.md`-Anleitungen einschließlich ihrer Referenzen und Ressourcen. Der vollständige Paketbaum bleibt erhalten, damit relative Verweise nicht durch das Verteilen einzelner Dateien zerstört werden.
- Einfache entfernte MCP-Konfigurationen mit HTTPS-Adresse und unterstützter Transport-/Anmeldeangabe. Die Verbindung wird erst mit **Dienste einrichten** separat angelegt, deaktiviert und ohne übernommene Anmeldedaten. Vorhandene gleichartige Verbindungen werden wiederverwendet.
- Nach **Skills aktivieren** werden nur die im Manifest ausgewählten gültigen Skills im aktuellen Projekt angeboten. Eine importierte `scope: user`- oder `kind: plugin`-Angabe macht daraus weder eine globale Anleitung noch automatisch ausführbaren Erweiterungscode.
- **Im Chat verwenden** ergänzt den bestehenden Entwurf um die Paketverweise. Es sendet keinen Auftrag und überschreibt den Entwurf nicht.

### Ausdrückliche Grenzen

- Cursor-Regeln, Agentenvorlagen, Befehle, Hooks, Codex-App-Anbindungen und Host-Erweiterungen werden gespeichert und angezeigt, aber nicht automatisch in Anvil ausgeführt oder als aktive Funktionen angeboten.
- Lokale MCP-Prozesse, SSE, eigene Header, Konfigurationsvariablen und komplexere Anmeldung benötigen eine gesonderte Einrichtung. Solche Optionen werden niemals stillschweigend entfernt, um einen scheinbar funktionierenden Dienst zu erzeugen.
- Remote-Adressen mit Abfrageparametern benötigen derzeit ebenfalls gesonderte Einrichtung. Das kann auch harmlose Anbieterparameter betreffen.
- Formatprüfung bedeutet weder Live-Test beim Anbieter noch Sicherheitsprüfung aller enthaltenen Programme. Skripte bleiben Paketressourcen; ihre spätere Nutzung ist ein eigener Werkzeugaufruf im Auftrag.
- Klassische VS-Code-Erweiterungen bleiben ein eigener Bereich. Deren bestehender Import übernimmt die von Anvil unterstützten Beiträge, nicht die gesamte VS-Code-Laufzeit.

## Lebenszyklus und Daten

Neue Pakete beginnen mit deaktivierten Skills. Aktivierung und Deaktivierung sind separat möglich. Die Auswahl und Ressourcen bleiben nach einem Neustart erhalten. Änderungen an der Komponentenliste erfordern erneute Prüfung durch Export, Entfernung und erneuten Import; vorhandene Pakete werden nicht überschrieben.

**Entfernen** löscht die Paketdateien und die zugehörige Registrierung, einschließlich eigener Änderungen innerhalb des Pakets. Andere Projektdateien bleiben erhalten. Separat eingerichtete Dienste werden weiter unter **Dienste** oder **MCP** verwaltet und nicht automatisch abgemeldet oder gelöscht; sie können auch anderen Aufgaben dienen. Das wird vor dem Entfernen erklärt. **Paket exportieren** sichert den aktuellen Paketinhalt als ZIP ohne Anvils Aktivierungszustand.

Speicherorte innerhalb des Projekts:

- `.anvil/skills/package-<kennung>/`: Originaldateien mit unveränderter relativer Anordnung.
- `.anvil/plugin-imports/<kennung>.json`: Herkunftsangabe, Format, erkannte Komponenten und Aktivierungszustand.

Eine Kennung enthält Format und kollisionsfrei kodierten Paketnamen. Ein gleichnamiges Paket desselben Formats kann nicht unbemerkt aus anderer Quelle darüber installiert werden. Die lokale Kennung ist keine bestätigte Herausgeberidentität.

Importgrenzen: höchstens 1.000 Dateien und 32 MiB pro Quelle, höchstens 300 Dateien und 16 MiB gespeicherte Inhalte pro gewähltem Paket. Binärdaten werden verlustfrei kodiert und zählen in dieser Darstellung gegen das Paketlimit. ZIPs mit beschädigten Einträgen, unzulässigen Pfaden, Verknüpfungen oder Überschreitung der Entpackgrenzen werden zurückgewiesen. Häufige Zugangsdaten-Dateien und erkannte eingebettete Zugangsdaten werden nicht übernommen; dies ist kein vollständiger Geheimnisscanner.

## Nächste Ausbaupunkte des Marketplace

1. Kuratierter Katalog aus freigegebenen Originalquellen mit Herkunft, Versionsbindung und konkreten Abnahmeaufgaben.
2. Aufgabenbezogene Suche über Dienste, Skills und Pakete hinweg, einschließlich klarer Einrichtungs- und Verbindungszustände.
3. Geprüfte Arbeitsabläufe für Webanwendungen, Godot und Notion; danach Unity, Unreal und weitere Anbieter auf derselben Grundlage.
4. Versionswechsel mit Vergleich von Inhalten, neuen Berechtigungen und Wiederherstellung. Der aktuelle Import ersetzt keine vorhandene Version.
5. Weitere Host-Komponenten nur mit einer passenden Anvil-Ausführung und Verhaltenstests. Ein importierter Hook ist ohne solche Umsetzung keine funktionierende Automatisierung.

## Prüfungen

- `npm run test:plugins`
- `npm run test:plugins:browser`
- Nach frischem Build: `npm run test:plugins:browser -- --production`

Die Browserprüfungen verwenden ein eigenes Testprofil und künstliche Pakete für alle drei Formate. Sie sperren Modell- und Anbieteranfragen und prüfen Import, Aktivierung, Deaktivierung, Dienstvorbereitung, erneutes Laden, Entfernung und schmale Ansichten. Ein bestandener Test ist kein Live-Nachweis für beliebige Marketplace-Angebote.

Zusätzlich wurde das vorhandene Codex-Paket **codex-engineering-guardrails 1.1.1** im isolierten Browserprofil des Produktionsbuilds importiert, aktiviert und entfernt. Das bestätigt dessen Import und Verwaltung; die enthaltenen Arbeitsanweisungen wurden dabei nicht als Agentenauftrag ausgeführt. Tests der Dateiablage prüfen binäre Ressourcen, versteckte Manifeste und die Entfernung ohne Verlust fremder Dateien. Während Paketänderungen nehmen Vordergrund- und Hintergrundbetrieb keine neuen Aufträge an; Entwürfe bleiben erhalten.

## Formatquellen

Am 30. September 2026 abgeglichen: [Agent Plugins 1.0.0](https://agent-plugins.org/specification), [Codex-Paketdokumentation](https://developers.openai.com/plugins/build/plugins), [Cursor-Plugin-Referenz](https://cursor.com/docs/reference/plugins). Die lokalen Parser verwenden bekannte Regeln und laden beim Import keine entfernten Schemas.
