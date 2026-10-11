# Optimierungen und Abnahme vom 4. Oktober 2026

Diese Anleitung beschreibt den lokalen Quellstand 1.3.35. Die Änderungen sind keine neue GitHub-Veröffentlichung. Die ausführlichen Nachweise und Prüfgrenzen stehen im [Umsetzungsbericht](../artifacts/audit-2026-10-04/umsetzung.md).

## Aufträge und Abbruch

Der eigentliche Auftrag bleibt getrennt von Projektregeln, ausgewähltem Text und Anhängen erhalten. Bei Platzmangel kürzt Anvil Zusatzinformationen; reicht das Budget schon für den Auftrag nicht aus, meldet es das. Der Auftrag wird nicht unbemerkt entfernt. Bilder bleiben abhängig von der gewählten Verbindung und der tatsächlichen Modellfähigkeit.

Ein Auftrag behält seine ursprüngliche Verbindung, sein Projekt und sein Abbruchsignal. Wird er gestoppt und direkt ein neuer Auftrag begonnen, dürfen vorbereitete Antworten, Werkzeugaufrufe und Abschlussprüfungen des alten Auftrags den neuen nicht übernehmen. Das gilt auch für verspätete Shell-, Git- und Debugger-Vorbereitung. Ein abgebrochener HTTP-Aufruf allein ist weiterhin kein Nachweis, dass jeder externe Modellserver die Berechnung beendet hat.

## Wiederherstellung und Sicherungspunkte

Anvil wählt beim Neustart eine zusammengehörige Speichergeneration. Eine neuere Notfallsicherung hat Vorrang, wenn ihre Inhalte vollständig verfügbar sind. Bei unvollständigen Notfallinhalten erhält Anvil die vollständige ältere Generation und bewahrt die abgelehnten neuen Metadaten separat. Dateien, Chat und Entwürfe werden nicht aus unterschiedlichen Projekten oder Generationen zusammengesetzt.

Sicherungspunkt-Inhalte liegen jetzt getrennt von den Einstellungen im lokalen Archiv. Gleiche Inhalte werden nur einmal gespeichert. Bis zu 40 Sicherungspunkte werden aufbewahrt; das Budget für ihre verschiedenen Inhalte beträgt 96 Millionen Zeichen. Die Migration aus dem früheren Archivformat erfolgt beim Laden. Fehlt der Inhalt eines Sicherungspunkts, lässt Anvil seine Rücknahme nicht zu, statt fehlende Daten als leere Dateien zu behandeln.

Scheitert eine Sicherung oder Wiederherstellung, bleibt der Hinweis sichtbar, bis du ihn schließt oder eine Sicherung erfolgreich ist. Sichere bei einem solchen Hinweis wichtige Änderungen zusätzlich. Eine Projektrücknahme nimmt externe Dienstaktionen oder unabhängig geänderte CAD-/Engine-Dokumente nicht automatisch zurück.

## Projekt-Plugins und Import

Neue ausführbare Projekt-Plugins beginnen ausgeschaltet. Vor der Aktivierung zeigt Anvil eine ausdrückliche Vertrauensabfrage. Die Freigabe gilt für das konkrete Projekt, den Dateiinhalt und die Berechtigungen. Ein geänderter Inhalt, auch bei gleicher Länge, oder ein nachträgliches `@trust` erfordert eine neue Freigabe. Eine Projektdatei kann diese Zustimmung nicht erteilen.

Projekt-JavaScript läuft ohne Sandbox im Renderer und besitzt dessen Rechte. Die eingeschränkte Anvil-API allein macht es nicht zu sicher isoliertem Code. Aktiviere deshalb nur Code, dem du vertraust. Bei Browserordnern ohne stabile Projektkennung gilt die Freigabe nur für die Sitzung.

Lokale Archive benötigen keine nachträglich aus dem Internet geladene Archivbibliothek mehr. ZIP-/VSIX-Importe prüfen Ursprungsprojekt, Dateikonflikte und Speicherung. Ein Projektwechsel während des Downloads bricht die Übernahme ab. Grenzen: 64 MiB Archiv, 128 MiB entpackter Inhalt, 32 MiB je Datei, 5.000 Dateien und 30 Sekunden Verarbeitung; Abbruch und Fehler werden angezeigt.

## Editor und Hintergrundbetrieb

Die Symbolsuche verwendet eine pro Dateiinhalt wiederverwendete Liste und korrekte Zeilenpositionen. Die Projektsuche filtert ausgeschlossene Dateien vor dem Transfer zum Suchworker. Der TypeScript-Compiler wird erst für passende Quelldateien oder eine ausdrücklich angeforderte Compilerfunktion geladen.

Bei Text- und Statusänderungen eines Hintergrundauftrags werden unveränderte Dateientwürfe wiederverwendet. Erstverbindung, Wiederverbindung und neue Aufträge liefern vollständige Stände. Das spart Übertragung und Kopierarbeit, ohne Änderungen, Rücknahmen oder Wiederaufnahme auszulassen. Der Hintergrundbetrieb bleibt wie vereinbart zunächst zuschaltbar.

## Geführte Aufgaben

Links über den Einstellungen öffnet **Geführte Aufgaben** sechs Einstiege: Projekt verstehen, Änderung umsetzen, Fehler beheben, Änderung prüfen, Szene bearbeiten und Bauteil erstellen. Die Aufgaben zeigen passende vorhandene Skills und fehlende Voraussetzungen. Die Links öffnen Anvils bestehende Projekt-, Verbindungs- oder Skill-Bereiche.

Eine Auswahl bereitet einen bearbeitbaren Entwurf vor und wählt Fragen oder Agent. Dein konkreter Auftrag bleibt darin enthalten. Es wird nichts automatisch gesendet, installiert oder freigegeben.

## Bauen und prüfen

`npm run build:desktop` baut Oberfläche, Skills und Hintergrundruntime frisch. `npm run dist:win` und `build-win.bat` verwenden denselben Pfad für Setup-EXE und portable ZIP. Der Bau legt einen Fingerabdruck von Quellen und ausgelieferten Dateien bei. Ein veralteter oder veränderter Inhalt wird vor dem Packen und bei der Paketabnahme abgewiesen.

`npm test` umfasst native Tests und alle TypeScript-Testdateien. Typecheck, Lint und Skill-Konsistenz gehören zu den Prüfungen. Die [Installationsanleitung](installation-abnahme.md) erklärt die getrennte lokale QA-Identität, echte Installation und portable Abnahme.

Die Laufzeit ist Electron 44.5.1. Gepatchte kompatible Bibliotheken wurden installiert; die aktuelle Abhängigkeitsprüfung meldet keine bekannten betroffenen Pakete. Diese Meldung ersetzt keine Prüfung der tatsächlichen Programmpfade.

Echte Godot-/Unreal-Szenen und CAD-/Blender-Dateien wurden getrennt von Modelltests geprüft. Ein vollständiger mehrstündiger Qwen-Test, Unity und ein echter durchgängiger CAD-MCP-Agentenauftrag sind zusätzliche Abnahmen. Unreals Fachtest bestand; die Profil-Isolation seines automatisch gestarteten Crash-Helfers ist nicht vollständig abgenommen. Details und ausgeführte Softwareversionen stehen im Umsetzungsbericht.
