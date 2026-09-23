# Anvil

**Deine KI-Werkbank für eigene Projekte.** Dateien bearbeiten, mit einem gewählten Modell weiterentwickeln und das Ergebnis direkt ausführen.

Anvil verbindet Editor, KI-Agent, Änderungsverlauf und Programmausführung in einer Windows-Anwendung. Du kannst vorhandene Projekte öffnen oder eine kleine Anwendung neu erstellen. Modelle laufen je nach Verbindung auf deinem Rechner, im lokalen Netz oder bei einem Anbieter.

## Anvil benutzen

Windows-Release: [Anvil 1.3.29](https://github.com/kokc866-hash/anvil/releases/tag/v1.3.29). Verwende das Windows-Setup oder entpacke das ZIP vollständig in einen beschreibbaren Ordner und starte `Anvil.exe`. Diese Pakete enthalten die Oberfläche und ihre Laufzeit; eine separate Node.js-Installation ist nicht nötig.

1. **Projekt öffnen:** Wähle in der Ersteinrichtung einen Ordner. Später findest du die Ordnerwahl im Dateibereich unter **Mehr → Lokalen Ordner öffnen**.
2. **KI wählen:** Öffne **Einstellungen → Agent**. Wähle einen vorhandenen Modellserver, einen unterstützten CLI-Zugang oder einen API-Anbieter. Die jeweiligen Zugänge und Laufzeiten werden separat benötigt.
3. **Eine Aufgabe geben:** Zum Beispiel: „Erkläre zuerst den Aufbau dieses Projekts und seinen Startweg.“ Für Änderungen verwende den Modus **Agent**; **Fragen** dient zum Erklären.
4. **Ergebnis prüfen:** Lies die Änderungen, starte die Anwendung über **Ausführen** und probiere die veränderte Funktion selbst aus. Eine noch ausstehende Prüfung gilt nicht als bestandener Test.
5. **Speichern:** `Strg+S` speichert die aktive Datei, `Strg+Alt+S` alle geänderten Dateien. Nach dem Neustart kannst du am Projekt weiterarbeiten.

Zum Kennenlernen wähle in der Ersteinrichtung **Beispiel ohne KI starten**. Anvil öffnet ein eigenständiges HTML-Beispiel mit einem bedienbaren Zähler. Vorhandene Dateien bleiben erhalten. Links über den Einstellungen öffnet das Checklisten-Symbol **Geführte Aufgaben**: Projekt verstehen, Änderung umsetzen, Fehler beheben und Änderung prüfen. Die Auswahl bereitet einen bearbeitbaren Auftrag vor; gesendet wird erst durch dich.

## Verbindungen und Daten

- **Modellserver:** Der gewählte Server verarbeitet die Modellanfragen. Ein Server im LAN läuft nicht unbedingt auf diesem Rechner.
- **CLI-Zugang:** Anvil verwendet die vorhandene Anmeldung von Codex, Claude Code oder GitHub Copilot. Release 1.3.29 unterstützt Bildübertragung und eintreffende Teilantworten; das gewählte Modell muss Bilder verstehen. [Möglichkeiten und Grenzen](anleitungen/05-verbindungen.md).
- **API-Zugang:** Verwendet deinen Anbieter und dessen Abrechnung. Ob Bilder unterstützt werden und der Denkaufwand einstellbar ist, hängt vom Modell und der Anvil-Anbindung ab.
- **Projektdateien:** Bleiben im gewählten Projektordner. Das Anvil-Profil liegt standardmäßig in `data` neben Anvil; ausdrücklich konfigurierte Speicherorte können abweichen. Externe CLIs und Werkzeuge haben gegebenenfalls eigene Datenordner.

## Aktueller Stand

Der Praxistest vom 12. September erprobte einen echten Aufgabenplaner über Ollama und Codex CLI. Einstieg ohne KI, geführte Aufgaben, Hilfe, der damalige Bildschutz, Neustart, Speichern und Rundenrücknahme wurden zusätzlich in der gebauten Desktop-Oberfläche geprüft. Diese Nachweise gehören zum damaligen Stand und ersetzen keine gesonderte Abnahme späterer Änderungen oder jedes verfügbaren Modells.

**Runde zurücknehmen:** Die Vorschau zeigt betroffene Dateien. Bestätigte Rücknahmen werden sofort gespeichert und schützen spätere eigene oder externe Änderungen. Alte Runden ohne verlässlich gespeicherten Endstand sind nur lesbar.

**Neu in Release 1.3.29:** Lokale Desktop-Projekte mit der Standard-Companion-Verbindung erhalten vor bearbeitenden Agentenaufträgen Projektsicherungspunkte einschließlich Bildern, Binärdateien und ungeöffneten Dateien. Die Rücknahme zeigt Assets, Konflikte, ausgeschlossene Pfade und externe Werkzeugaktionen gemeinsam an. Externe Aktionen und laufende Datenbanktransaktionen werden nicht rückgängig gemacht; Browser-/Remote-Projekte behalten den bisherigen Umfang. Bedienung, Speicherbedarf und Grenzen stehen im [Editor-Handbuch](anleitungen/editor.md#projekt-und-assets-vor-einer-agentenrunde-sichern).

Unter **Erweiterungen → Dienste** meldest du dich bei unterstützten Anbietern an und wählst ihre Werkzeuge. Aktive, bereits angemeldete Dienste laden ihren Katalog nach dem Neustart automatisch. Deine Freigaben bleiben erhalten; neue Werkzeuge bleiben ausgeschaltet. Ein Katalogabruf führt keine Werkzeuge aus. Der Eigentümer hat die funktionierenden Erweiterungen und ihre Erkennung durch den Agenten bestätigt. Details: [Dienste](anleitungen/dienste.md).

Unter **Einstellungen → Orientierung** kannst du interaktive Erklärhilfen einschalten und die geführte Tour starten. Unter **Einstellungen → Hilfe** kannst du einen Fehlerbericht vorbereiten, vollständig ansehen und kopieren. Es wird nichts automatisch versendet. Release 1.3.29 ist auf Wunsch des Eigentümers weiterhin unsigniert; Herausgeberangaben, Supportkontakt, Lizenz und Signierung sind für später offen.

## Am Quellcode arbeiten

Dieser Weg ist für die Entwicklung gedacht:

1. Node.js LTS installieren, falls es fehlt.
2. Einmal `install.bat` ausführen.
3. Zum Testen `start.bat` oder `Anvil.vbs` öffnen.

Nach Änderungen am Anvil-Quellcode die Entwicklungs-App bei Bedarf vollständig schließen und neu starten. Einstellungen nicht neu einrichten, nur weil eine laufende Entwicklungsansicht während einer Aktualisierung vorübergehend Standardwerte zeigt.

## Weiterführendes

- [Kurzanleitung](anleitungen/01-kurz.md)
- [Alle Anleitungen](anleitungen/README.md)
- [Datenablage](anleitungen/datenablage.md)
- [Denkaufwand und Modellgrenzen](anleitungen/thinking.md)
- [Zuschaltbarer Hintergrundbetrieb (neuer Testmodus)](anleitungen/hintergrundbetrieb.md)
- [Praxistest und nachgeprüfte Reparaturen](anleitungen/praxistest-tageswerk.md)
- [Arbeiten bis zur Produktreife](anleitungen/produktreife.md)
- [Neue Abläufe, Hilfe und bekannte Grenzen](anleitungen/produktabschluss.md)
- [Installation und Paketabnahme](anleitungen/installation-abnahme.md)
