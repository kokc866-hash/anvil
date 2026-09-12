# Anvil

**Deine KI-Werkbank für eigene Projekte.** Dateien bearbeiten, mit einem gewählten Modell weiterentwickeln und das Ergebnis direkt ausführen.

Anvil verbindet Editor, KI-Agent, Änderungsverlauf und Run in einer Windows-Anwendung. Du kannst vorhandene Projekte öffnen oder eine kleine Anwendung neu erstellen. Modelle laufen je nach Verbindung auf deinem Rechner, im lokalen Netz oder bei einem Anbieter.

## Anvil benutzen

Die Downloadadresse des Projekts ist [GitHub Releases](https://github.com/kokc866-hash/anvil/releases). Verwende das Windows-Setup oder entpacke das ZIP in einen beschreibbaren Ordner und starte `Anvil.exe`. Für diese fertigen Pakete ist keine separate Node.js-Installation vorgesehen.

1. **Projekt öffnen:** Wähle in der Ersteinrichtung einen Ordner. Später findest du die Ordnerwahl im Dateibereich unter **Mehr → Desktop-Ordner**.
2. **KI wählen:** Öffne **Einstellungen → Agent**. Wähle einen vorhandenen Modellserver, einen unterstützten CLI-Zugang oder einen API-Anbieter. Die jeweiligen Zugänge und Laufzeiten werden separat benötigt.
3. **Eine Aufgabe geben:** Zum Beispiel: „Erkläre zuerst den Aufbau dieses Projekts und seinen Startweg.“ Für Änderungen verwende den Modus **Agent**; **Fragen** dient zum Erklären.
4. **Ergebnis prüfen:** Lies die Änderungen, führe die Anwendung über **Run** aus und probiere die veränderte Funktion selbst aus. Eine offene Prüfung ist kein bestandener Test.
5. **Speichern:** `Strg+S` speichert die aktive Datei, `Strg+Alt+S` alle geänderten Dateien. Nach dem Neustart kannst du am Projekt weiterarbeiten.

Zum Kennenlernen wähle in der Ersteinrichtung **Beispiel ohne KI starten**. Anvil öffnet ein eigenständiges HTML-Beispiel mit einem bedienbaren Zähler. Vorhandene Dateien bleiben erhalten. Unter dem Chat führen **Geführte Aufgaben** durch Projekt verstehen, Änderung umsetzen, Fehler beheben und Änderung prüfen. Die Auswahl bereitet einen bearbeitbaren Auftrag vor; gesendet wird erst durch dich.

## Verbindungen und Daten

- **Modellserver:** Der gewählte Server verarbeitet die Modellanfragen. Ein Server im LAN läuft nicht unbedingt auf diesem Rechner.
- **CLI-Zugang:** Anvil verwendet die vorhandene Anmeldung der unterstützten CLI. Im aktuellen Anvil-Adapter werden Bilder nicht an die CLI übertragen; Ergebnisbilder können trotzdem in Anvil angezeigt werden.
- **API-Zugang:** Verwendet deinen Anbieter und dessen Abrechnung. Bildunterstützung und Thinking hängen von Modell und Anvil-Adapter ab.
- **Projektdateien:** Bleiben im gewählten Projektordner. Das Anvil-Profil liegt standardmäßig in `data` neben Anvil; ausdrücklich konfigurierte Speicherorte können abweichen. Externe CLIs und Werkzeuge haben gegebenenfalls eigene Datenordner.

## Aktueller Stand

Der lokale Entwicklungsstand wurde mit einem echten Aufgabenplaner über Ollama und Codex CLI erprobt. Einstieg ohne KI, geführte Aufgaben, Hilfe, Bildschutz, Neustart, Speichern und Rundenrücknahme wurden zusätzlich in der gebauten Desktop-Oberfläche geprüft. Das ist keine vollständige Abnahme jedes Modells und jedes veröffentlichten Pakets.

**Runde zurücknehmen:** Die Vorschau zeigt betroffene Dateien. Bestätigte Rücknahmen werden sofort gespeichert: neue Dateien entfernen, geänderte Inhalte zurücksetzen und gelöschte geladene Dateien wiederherstellen. Spätere eigene oder externe Änderungen werden geschützt. Alte Runden ohne verlässlich gespeicherten Endstand sind nur lesbar. Nicht eingelesene Binärdateien und externe Aktionen sind nicht Teil der Rücknahme; nicht leere Ordner werden erhalten. CLI-Ergebnisbilder ersetzen keine visuelle Prüfung durch das Modell.

Unter **Einstellungen → Orientierung** kannst du interaktive Erklärhilfen einschalten und die geführte Tour starten. Unter **Einstellungen → Hilfe** kannst du einen Fehlerbericht vorbereiten, vollständig ansehen und kopieren. Es wird nichts automatisch versendet. Release 1.3.25 wird auf Wunsch des Eigentümers unsigniert bereitgestellt; Herausgeberangaben, Supportkontakt, Lizenz und Signierung sind noch offen.

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
- [Thinking und Modellgrenzen](anleitungen/thinking.md)
- [Praxistest und nachgeprüfte Reparaturen](anleitungen/praxistest-tageswerk.md)
- [Arbeiten bis zur Produktreife](anleitungen/produktreife.md)
- [Neue Abläufe, Hilfe und bekannte Grenzen](anleitungen/produktabschluss.md)
- [Installation und Paketabnahme](anleitungen/installation-abnahme.md)
