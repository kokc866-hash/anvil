# Projektregeln und Plugin-Kompatibilität

Projektregeln ergänzen den Auftrag um Vorgaben für die betroffenen Dateien. Regeln aus einem anderen Projektteil werden nicht vorsorglich mitgeladen. Die Auswahl nutzt den aktuellen Projektstand und die tatsächlich angegebenen Zielpfade; sie liest nichts außerhalb des geöffneten Projekts.

## Welche Regeln gelten

- `AGENTS.md` und `AGENTS.project.md` gelten für ihren Ordner und dessen Unterordner. Eine eindeutige Schreibvariante wie `Agents.md` wird erkannt.
- `.anvil/rules.md` und das ältere `.anvil/rules` gelten für den zugehörigen Projektordner und dessen Unterordner.
- `.cursorrules` und `CLAUDE.md` werden an der Projektwurzel weiterhin berücksichtigt.
- `.cursor/rules/*.mdc` sowie darunter abgelegte MDC-Dateien erhalten ihren Geltungsbereich vom Ordner oberhalb von `.cursor`.

Allgemeine Regeln stehen vor Regeln tieferer Ordner. Innerhalb eines Ordners folgen auf ältere Wurzelregeln die Cursor-Regeln, `AGENTS.md`, `AGENTS.project.md`, `.anvil/rules` und `.anvil/rules.md`. Regeln derselben Art werden nach Pfad sortiert. Die zusätzlich eingegebenen Nutzerregeln stehen zuletzt. Engere Vorgaben gelten nur innerhalb ihres ausgewiesenen Bereichs; die Reihenfolge erweitert keine Ausführungsrechte.

Bei mehreren Zielpfaden wird die Vereinigung ihrer zuständigen Regeln geladen. Gemeinsame Vorfahren erscheinen einmal. Ein ausdrücklich gewählter Ordner lädt seine Vorfahren, aber keine Regeln aus untergeordneten Teilprojekten. Ohne Zielpfade werden ausschließlich globale Wurzelregeln geladen.

Jede geladene Quelle nennt ihren Pfad, den Geltungsbereich und den Auswahlgrund. Die interne Auskunft `ruleContext(files, paths)` trennt angewendete Quellen mit Anleitungstext von verfügbaren Metadaten ohne Anleitungstext. Sie enthält außerdem die geprüften Zielpfade, Kürzungshinweise und Warnungen. `ruleFilesPresent(files, paths)` nennt die tatsächlich ausgewählten Dateien. Bestehende Aufrufe von `workspaceRules(files, extra)` bleiben gültig; Zielpfade können als drittes Argument übergeben werden.

Beim Öffnen lokaler Projekte lesen sowohl der Browser-Ordnerzugriff als auch der Companion gezielt `.cursor/rules` mit MDC-Dateien und die Wurzeldatei `.cursorrules` ein. Andere Cursor-Dateien wie MCP-Konfigurationen, Hooks oder sonstige versteckte Verzeichnisse werden dadurch nicht allgemein geöffnet. Die vorhandene Ausnahme für vollständig aufbewahrte Plugin-Pakete bleibt davon getrennt.

## Cursor-Metadaten

```md
---
description: TypeScript-Vorgaben für die Oberfläche
globs: "src/**/*.{ts,tsx}, !**/*.test.ts"
alwaysApply: false
---
Die vereinbarten Komponenten und vorhandenen Gestaltungstokens verwenden.
```

`alwaysApply: true` lädt den Regeltext für den zugehörigen Bereich. An der Projektwurzel gilt eine solche Regel auch ohne ausgewählte Datei. Ohne `alwaysApply: true` wird der Text nur für passende `globs` oder beim ausdrücklich gewählten Pfad der Regeldatei geladen. Eine reine Beschreibung lädt noch keine Anleitung. Verfügbare Beschreibungen sind separat begrenzte Metadaten; sie werden nicht pauschal an den Regelprompt angehängt.

`globs` akzeptiert einen Text mit Kommas oder eine YAML-Liste. Unterstützt sind `*`, `?`, `**` als vollständiges Pfadsegment, einfache Alternativen wie `*.{ts,tsx}` und Ausschlüsse mit `!`. Muster ohne `/` prüfen den Dateinamen innerhalb des Bereichs; Muster mit `/` beginnen am Bereichsordner. Ein Ausschluss trifft nur die betreffende Datei. Reguläre Ausdrücke, Zeichenklassen, verschachtelte Alternativen, absolute Pfade und Traversierungsmuster werden abgewiesen. Die Auswertung führt keine Projektprogramme oder regulären Ausdrücke aus dem Projekt aus.

Ungültige Metadaten machen eine Regel niemals automatisch global. Betroffene Quellen werden mit einem Hinweis ausgelassen.

## Grenzen und Schutz

Pro Regel werden höchstens 6.000 Zeichen geladen; der formatierte Dateiregelkontext umfasst höchstens 24.000 Zeichen. Zusätzliche Nutzerregeln haben ein eigenes Limit von 6.000 Zeichen. Die Auswahl begrenzt sich auf 32 angewendete Quellen, 512 Regelkandidaten und 64 Zielpfade. Es werden höchstens zwölf verfügbare Regelbeschreibungen mit jeweils 200 Zeichen und zwölf unterschiedliche Warnungen zurückgegeben. Ein Metadatenkopf darf 4.096 Zeichen enthalten. Es gelten höchstens 16 Glob-Muster mit je 256 Zeichen und insgesamt 64 aufgelöste Muster; Alternativen sind auf 32 Erweiterungen begrenzt. Kürzungen und ausgelassene Quellen sind an der Auskunft erkennbar.

Relative Pfade dürfen keine Traversierung, leeren Segmente, Geräte- oder Datenstromnamen und keine unter Windows mehrdeutigen Bestandteile enthalten. Eindeutige Pfade werden ohne Beachtung der Groß-/Kleinschreibung zugeordnet. Bei widersprüchlichen Schreibweisen oder Datei-/Ordnerkollisionen werden betroffene Regeln ausgelassen. Geheimnis-, Git- und Abhängigkeitsverzeichnisse sowie importierte Plugin-Verzeichnisse unter `.anvil/skills` und Importregister unter `.anvil/plugin-imports` sind als Regelquellen ausgeschlossen. Erkannte Zugangsdatenmuster und private Schlüssel werden im ausgegebenen Text entfernt. Diese Musterprüfung ist keine allgemeine Erkennung beliebiger Geheimnisse.

Die Auswahl arbeitet auf den vom Aufruf übergebenen Dateien. Sie kann keine nicht geladenen Dateien finden und keine physischen Symlinks oder Dateisystemgrenzen außerhalb dieses Abbilds prüfen. Autorisierung und sichere Dateizugriffe bleiben Aufgabe der vorhandenen Ausführungs- und Speichergrenzen.

## Bestandteile importierter Plugins

Der Marktplatz zeigt die Kompatibilität pro Bestandteil und die aktuelle Einrichtung getrennt an:

| Anzeige | Bedeutung |
| --- | --- |
| Nutzbar | Ein gültiger Skill kann verwendet werden; vor dem Import ist er noch nicht aktiviert. Bei einem importierten Paket muss er in der aktuellen Skill-Auswahl verfügbar sein. Ein Dienst gilt hier erst mit einer passenden, bereiten Verbindung und verfügbaren freigegebenen Werkzeugen oder Ressourcen als nutzbar. |
| Einrichtung nötig | Etwa ein deaktivierter Skill, eine noch nicht eingerichtete Dienstverbindung, fehlende Anmeldung oder Freigabe. Lokale MCP-Befehle, Variablen und beigefügte Skripte benötigen eine gesonderte Einrichtung bzw. einen passenden Ausführungsauftrag. |
| Nicht unterstützt | Beispielsweise host-spezifische Regeln, Agentenprofile, Befehlseinstiege, Hooks und App-Verknüpfungen. Dateien bleiben erhalten, ihre Hostfunktion wird nicht aktiviert. Ungültige oder widersprüchliche Paketdefinitionen fallen ebenfalls darunter. |

Ein gemischtes Paket wird als teilweise nutzbar ausgewiesen. Die Details nennen für jeden Bestandteil Pfad und konkreten Grund. Die Anzeige prüft aktuelle Paketdateien erneut; gespeicherte Statusangaben allein reichen nicht aus. Ältere Importregister ohne das zusätzliche Statusfeld bleiben lesbar.

Importierte Skills starten deaktiviert. Deaktivieren, Entfernen und erneuter Import werden aus dem aktuellen Stand abgeleitet; ein erneuter Import übernimmt keine frühere Aktivierung. Separat eingerichtete Dienstverbindungen bleiben eigenständige Verbindungen und erben weder Paketaktivierung noch Paketentfernung.

Import, Formatunterstützung und Skill-Aktivierung führen keine Hooks oder Skripte aus, aktivieren keine Apps und erteilen kein Vertrauen. Plugin-Regeln innerhalb des Pakets gelangen auch bei aktiviertem Skill nicht automatisch in die Projektregeln. Vorhandene Skill- und Dienstverwaltung bleiben die einzigen Einrichtungswege.
