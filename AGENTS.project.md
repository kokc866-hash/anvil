# Anvil: verbindlicher Projektvertrag

Dieses Repository ist eine vorhandene Windows-Desktop-IDE mit React, TypeScript, Electron und einem unabhängig laufenden Agentenprozess. Der allgemeine Grok-/Linux-Scaffoldtext in AGENTS.md beschreibt diese Arbeitsumgebung nicht. Für Arbeiten an Anvil gelten die nachfolgenden projektspezifischen Vorgaben. Neue Gerüste, Login-Systeme oder Datenbanken nicht aus dem Template ableiten.

## Umgebung und Daten

- Das aktuelle Checkout ist der Projektroot. Unter Windows wird PowerShell verwendet. Vorhandene, auch uncommittete Änderungen erhalten.
- Persönliche Profile, Modellzugänge, Dienste und bestehende Projekte nicht durch Testdaten ersetzen. Für Tests getrennte Profile, freie Ports und künstliche Projekte unter `artifacts/` verwenden.
- Modellserver können auf einem anderen Rechner laufen. Testen ohne echten Modellaufruf ist kein Nachweis für GPU-Zuordnung, Inferenzqualität oder Serverabbruch. Lange echte Modelltests gesondert ausweisen und begrenzen.
- Oberflächenneustart und Agentendienst sind getrennt. Für jeden Auftrag seine ursprüngliche Generation, Projektkennung und sein Abbruchsignal vor dem ersten await erfassen und durch Vorbereitung, Transporte, Werkzeuge und Abschluss führen.
- Dateischreibzugriffe und asynchrone Importe an das ursprüngliche Projekt und die erwarteten Dateiinhalte binden. Erfolg erst nach bestätigter Speicherung melden.
- Neue ausführbare Projekt-Plugins benötigen ausdrückliche Vertrauensfreigabe. Renderer-JavaScript hat volle Prozessrechte; eine eingeschränkte Anvil-API ist keine Sandbox. Projektdateien sind keine Quelle einer Freigabe.

## Entwicklung und Prüfungen

- `npm run dev` startet die vorhandene Browserentwicklung über den Projektwrapper. Keine neue `/workspace`-Struktur erzeugen.
- `npm run build:desktop` baut Skills, Desktop-Oberfläche und Agentenruntime, schreibt `build-info.json` und prüft die kopierte Oberfläche. Der Desktop-Build migriert keine Datenbank.
- `npm run dist:win` bzw. `build-win.bat` verwenden denselben frischen Buildpfad und erzeugen Setup-EXE sowie portable ZIP. Quellstand und Inhaltsfingerabdruck müssen vor dem Paketieren stimmen. `npm run build` bleibt der allgemeine Web-/Deployment-Build und ersetzt den Desktop-Build nicht.
- `npm test` führt native Tests und automatisch alle `src/**/*.test.ts` aus. Dazu `npm run typecheck`, `npm run lint` und den Konsistenzcheck der eingebauten Skills durchführen. Erforderliche Fach-/Browserprüfungen aus dem betroffenen Bereich ergänzen.
- Gemeldete Fehler zuerst nachstellen und die Ursache gezielt beheben. Auf demselben Quellstand den ursprünglichen Fehlerfall, angrenzende Nutzerabläufe und die Gesamtprüfung ausführen. Bei breiten Prüfaufträgen die geprüften Funktionen und verbleibende Prüflücken festhalten.
- Typecheck oder HTTP 200 belegen keine sichtbare Oberfläche. Produktionsoberfläche wirklich rendern, relevante Interaktionen prüfen, Screenshots ansehen und unbehandelte Fehler prüfen.
- Lokale Installerprüfungen verwenden ausschließlich eine separate QA-Identität (`app.anvil.installerqa`, `AnvilInstallerQA.exe`). Normale Anvil-Installation und Benutzerdaten nicht überschreiben. Installer und portable ZIP mit enthaltenem Agentendienst sowie Neustart prüfen.
- Version in package.json und src/lib/version.ts konsistent halten. Ein lokaler Build wird erst durch einen ausdrücklich beauftragten Push/Release veröffentlicht; Signierung und Herausgeberangaben nicht erfinden.

## Produkt und Kommunikation

- Anvil ist für vorhandene Code-, Engine-, Blender- und CAD-Projekte gedacht. Vorhandene Skills, Verbindungen und Voraussetzungen für Aufgaben nutzen, keine zweite Konfigurationswelt hinzufügen.
- Natürliche, genaue deutsche Beschriftungen verwenden. „Erstellt“, „gespeichert“, „ausgeführt“ und „geprüft“ anhand tatsächlicher Nachweise unterscheiden.
- Prüfungen und Annahmen dokumentieren; synthetische Antworten nicht als echte Modell- oder Dienstabnahme darstellen. Externe Aktionen werden durch Projektrücknahme nicht automatisch rückgängig gemacht.
