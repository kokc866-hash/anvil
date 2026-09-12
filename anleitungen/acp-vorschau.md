# Externe Agenten: ACP-Vorschau

Unter **Erweiterungen → API → Externe Agenten · ACP-Vorschau** kann ein bereits installiertes ACP-Programm geprüft werden. Einen absoluten Programmpfad und die vom Anbieter dokumentierten Argumente als JSON-Liste eintragen. Ein Programm mit CLI-Funktion unterstützt nicht automatisch ACP. Es wird nichts heruntergeladen.

**ACP-Verbindung prüfen** startet nur die Protokollinitialisierung. Der Prüfungsordner liegt im Anvil-Datenverzeichnis, enthält keine Projektdateien und wird entfernt, wenn er leer geblieben ist. Das externe Programm läuft mit den Benutzerrechten des Anwenders; der Ordner ist keine Betriebssystem-Sandbox. Nur eigene oder vertrauenswürdige Programme starten. Batchdateien und Shell-Befehlsfolgen werden nicht ausgeführt.

Das Ergebnis zeigt die gemeldeten Fähigkeiten. Es beweist weder eine erfolgreiche Anmeldung noch eine Modellantwort. Abbrechen beendet den zugehörigen Prozessbaum. Nach einem Fehler gibt es keine automatische Wiederholung. Diese Vorschau verändert den vorhandenen Agent- und CLI-Weg nicht.

Der Prototyp enthält zusätzlich einen intern geprüften Text-Sitzungsablauf mit Streaming, Sitzungszuordnung und Abbruch. Client-Datei- und Terminalwerkzeuge sowie Berechtigungsanfragen werden nicht freigegeben. Ein produktiver externer Agent-Modus mit Dateien, Anmeldung und Sitzungsfortsetzung ist damit noch nicht freigegeben. Die Tests verwenden einen eindeutig benannten lokalen Protokollagenten, kein echtes KI-Modell oder Nutzerkonto.

Grundlage: [ACP-Initialisierung](https://agentclientprotocol.com/protocol/v1/initialization), [Sitzungen](https://agentclientprotocol.com/protocol/v1/session-setup), [Aufträge und Abbruch](https://agentclientprotocol.com/protocol/v1/prompt-turn). Stand: 12. September 2026.
