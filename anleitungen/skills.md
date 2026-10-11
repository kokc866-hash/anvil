# Anvils Skill-Bibliothek

Lokaler Entwicklungsstand vom 4. Oktober 2026.

Skills sind Arbeitsanleitungen für den Agenten. Sie beschreiben einen sinnvollen Ablauf, passende Werkzeuge und die Prüfungen, die ein Ergebnis bestätigen. Sie funktionieren auch bei ausgeschaltetem persönlichen Gedächtnis. Ein Skill installiert keine Software, meldet dich bei keinem Dienst an und erteilt keine zusätzlichen Werkzeugrechte.

## Auswählen und verwenden

Öffne **Erweiterungen → Skills**. Die Bibliothek enthält 16 vorinstallierte Anleitungen, geordnet nach Entwicklung, Versionsverwaltung, Engines, 3D/CAD und Diensten. Die Gruppen lassen sich auf- und zuklappen. Eigene Projekt-Skills und importierte Anleitungen erscheinen ebenfalls.

Mit **Skills verwenden** schaltest du die Verwendung insgesamt ein oder aus. Mit **Passende Skills automatisch auswählen** bestimmt Anvil anhand des aktuellen Auftrags passende Anleitungen. Projektdateien unterstützen diese Auswahl; ein installiertes Werkzeug allein führt nicht dazu, dass seine Anleitung bei jedem Auftrag geladen wird.

Pro Auftrag werden höchstens zwei passende Anleitungen direkt mitgesendet. Weitere Skills und ergänzende Referenzen kann der Agent bei Bedarf gezielt lesen. Dadurch wird der Anfragekontext nicht mit der gesamten Bibliothek gefüllt.

Du kannst die Auswahl selbst steuern:

- **Für Projekt anheften** bevorzugt eine Anleitung in diesem Projekt. **Lösen** entfernt die Anheftung. Bis zu drei Anheftungen werden gespeichert; höchstens zwei Anleitungen werden direkt geladen.
- Nenne einen Skill ausdrücklich, etwa `$anvil-godot Prüfe die Szene und behebe den Fehler`. Das funktioniert auch bei ausgeschalteter automatischer Auswahl. Der Skill selbst muss eingeschaltet sein.
- **Skill-Auswahl ausprobieren** zeigt passende Anleitungen, den Auswahlgrund und Voraussetzungen. Diese Vorschau ruft kein Modell auf und verändert keine Projektdateien.
- Der Schalter am einzelnen Skill deaktiviert nur diese Anleitung. Die Entscheidung bleibt nach einem Neustart erhalten.

Unter **Anleitung und Voraussetzungen** kannst du den vollständigen Ablauf und seine ergänzenden Referenzen lesen. „Vorhanden“ bedeutet bei Diensten, dass ein Werkzeugkatalog mit Freigaben verfügbar ist. Die konkrete Verbindung muss vor einer Aktion geprüft werden. Ein erkanntes Engine-Projekt bestätigt weder eine installierte Engine noch einen erfolgreichen Test.

## Was die Anzeige beim Chat bedeutet

Unten am Chat öffnet **Skills** die Auswahl des letzten Auftrags: welche Anleitungen mitgesendet oder später über `skill_read` beziehungsweise `skill_run` geladen wurden und warum. Die Auswahl gehört zum jeweiligen Chat und bleibt mit dessen Verlauf gespeichert. Von dort öffnest du auch die Bibliothek.

Eine geladene Anleitung ist noch kein Erfolgsnachweis. Ob der Agent sie korrekt umgesetzt hat, zeigen seine tatsächlichen Dateiänderungen, Werkzeugergebnisse und Tests. Die Anleitungen gelten im bisherigen Agentenbetrieb und im zuschaltbaren Hintergrundbetrieb; die jeweils verfügbaren Werkzeuge können sich unterscheiden.

## Die vorinstallierten Anleitungen

| Aufgabe | Skill |
| --- | --- |
| Projektaufbau und Startweg verstehen | `anvil-projekt-verstehen` |
| Eine gezielte Änderung über mehrere Dateien umsetzen | `anvil-code-aendern` |
| Fehler nachvollziehen, beheben und erneut prüfen | `anvil-fehler-beheben` |
| Änderungen und Nebenwirkungen prüfen | `anvil-aenderungen-pruefen` |
| Geeignete Tests erstellen und ausführen | `anvil-tests` |
| Eine Weboberfläche einschließlich Bedienung prüfen | `anvil-web` |
| Git-Änderungen beurteilen und gezielt sichern | `anvil-git` |
| Mit verfügbaren GitHub-Werkzeugen arbeiten | `anvil-github` |
| Godot-Projekte und Szenen bearbeiten | `anvil-godot` |
| Unity-Projekte bearbeiten und validieren | `anvil-unity` |
| Unreal-Projekte bearbeiten und validieren | `anvil-unreal` |
| In Blender modellieren und Ergebnisse prüfen | `anvil-blender` |
| Parametrische OpenSCAD-Modelle erstellen und exportieren | `anvil-openscad` |
| FreeCAD-Bauteile erstellen, exportieren und erneut öffnen | `anvil-freecad` |
| Angemeldete Dienste mit freigegebenen Werkzeugen verwenden | `anvil-dienste` |
| Eigene vollständige Skills erstellen und prüfen | `anvil-skill-erstellen` |

## Anpassen, exportieren und sichern

Vorinstallierte Anleitungen werden mit Anvil gepflegt. Der Agent kann deren Inhalt nicht überschreiben. **Projektkopie bearbeiten** legt einen eigenen Skill mit seinen Referenzen im aktuellen Projekt an und öffnet dessen `SKILL.md` im Editor. Bestehende Dateien werden nicht überschrieben. Wird eine Datei noch nicht im Projektordner gespeichert, zeigt Anvil das ausdrücklich an.

**Als ZIP exportieren** enthält die vollständige Anleitung und ihre ergänzenden Dateien. Für einen Ordnerimport entpackst du das ZIP und verwendest **Erweiterungen → Aufgabenpakete → Skill-Ordner importieren**. Vorhandene und importierte Skills bleiben beim Einspielen der Anvil-Bibliothek erhalten. Paketfreigaben und Projektzuordnung gelten weiterhin.

Die Einstellungssicherung unter **Daten → Exportieren** enthält auch die Skill-Schalter und Projekt-Anheftungen. **Gespeicherte Erinnerungen löschen** entfernt persönliche und projektbezogene Erinnerungen, nicht die Skill-Bibliothek. Einen eigenen Skill oder ein importiertes Paket entfernst du separat im zuständigen Bereich.
