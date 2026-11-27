# Anvils Skill-Bibliothek

Lokaler Entwicklungsstand vom 29. Oktober 2026.

Skills sind Arbeitsanleitungen für den Agenten. Sie beschreiben einen sinnvollen Ablauf, passende Werkzeuge und die Prüfungen, die ein Ergebnis bestätigen. Sie funktionieren auch bei ausgeschaltetem persönlichen Gedächtnis. Ein Skill installiert keine Software, meldet dich bei keinem Dienst an und erteilt keine zusätzlichen Werkzeugrechte.

## Auswählen und verwenden

Öffne **Erweiterungen → Skills**. Die Bibliothek enthält 23 vorinstallierte Anleitungen, geordnet nach Entwicklung, Versionsverwaltung, Engines, 3D/CAD und Diensten. Die Gruppen lassen sich auf- und zuklappen. Eigene Projekt-Skills und importierte Anleitungen erscheinen ebenfalls. Herkunft, Projektzuordnung, Version und benötigte Umgebung stehen am jeweiligen Eintrag.

Mit **Skills verwenden** schaltest du die Verwendung insgesamt ein oder aus. Mit **Passende Skills automatisch auswählen** bestimmt Anvil anhand des aktuellen Auftrags passende Anleitungen. Projektdateien unterstützen diese Auswahl; ein installiertes Werkzeug allein führt nicht dazu, dass seine Anleitung bei jedem Auftrag geladen wird.

Die automatische Vorauswahl enthält normalerweise höchstens zwei passende Skills mit Name, Beschreibung und Leseadresse. Sie berücksichtigt den Auftrag und vorhandenen Fachkontext. Ausdrücklich genannte und für das Projekt angeheftete Skills werden zusätzlich berücksichtigt und nicht durch diese automatische Grenze abgeschnitten. Ihre vollständigen Anleitungen lädt der Agent vor der Anwendung über `skill_read`. Weitere Skills findet er über die gemeinsame Werkzeug- und Skill-Suche. Ergänzende Referenzen liest er einzeln bei Bedarf. Dadurch wird der Anfragekontext nicht mit der gesamten Bibliothek gefüllt.

Passende eingebaute Skills sind außerdem mit Anvils vorhandenen Werkzeugen verbunden: Eine Engine-Aufgabe verweist etwa auf Erkennung, Status und Engine-Ausführung; eine FreeCAD-Aufgabe auf die MCP-Katalogsuche und Dienstaufrufe; eine Prüfaufgabe auf Run und die vorhandene Testausführung. Anvil berücksichtigt dafür bis zu acht zusätzliche Werkzeughinweise aus den ausgewählten Skills. Der jeweilige Modus und die freigegebenen Zugriffe bestimmen weiterhin, welche Werkzeuge tatsächlich angeboten werden. Eine Auswahl führt keine Aktion aus und lädt keine fremden Programme.

Bei React-Aufgaben kann die Auswahl das Projektmanifest berücksichtigen, einschließlich Unterprojekten. Eine gültige React-Abhängigkeit in `package.json` unterstützt die Auswahl bei passenden Komponenten- und Rendering-Aufträgen. Ein Wort in einer README, ein Kommentar oder ein kopierter Skill aktiviert diese Erkennung nicht. Ein ausdrücklich genannter React-Auftrag funktioniert auch ohne vorhandenes Manifest.

Du kannst die Auswahl selbst steuern:

- **Für Projekt anheften** berücksichtigt eine Anleitung in diesem Projekt. **Lösen** entfernt die Anheftung. Bis zu drei Anheftungen werden gespeichert. Diese Anleitungen erscheinen auch, wenn die automatische Vorauswahl bereits andere passende Vorschläge hätte.
- Nenne einen Skill ausdrücklich, etwa `$anvil-godot Prüfe die Szene und behebe den Fehler`. Das funktioniert auch bei ausgeschalteter automatischer Auswahl. Der Skill selbst muss eingeschaltet sein.
- **Skill-Auswahl ausprobieren** zeigt passende Anleitungen, den Auswahlgrund und Voraussetzungen. Diese Vorschau ruft kein Modell auf und verändert keine Projektdateien.
- Der Schalter am einzelnen Skill deaktiviert nur diese Anleitung. Die Entscheidung bleibt nach einem Neustart erhalten.

Unter **Anleitung und Voraussetzungen** kannst du den vollständigen Ablauf und seine ergänzenden Referenzen lesen. „Vorhanden“ bedeutet bei Diensten, dass ein Werkzeugkatalog mit Freigaben verfügbar ist. Die konkrete Verbindung muss vor einer Aktion geprüft werden. Ein erkanntes Engine-Projekt bestätigt weder eine installierte Engine noch einen erfolgreichen Test.

**Skill-Anleitungen bei Bedarf laden** steuert den Zugriff auf die vollständigen Texte. Das ist unabhängig vom persönlichen Gedächtnis. Es gibt keine zusätzliche Auswahl oder Bestätigung vor jedem Auftrag. Die Bibliothek lässt sich auch direkt über den entsprechenden Verweis in den Einstellungen öffnen.

## Was die Anzeige beim Chat bedeutet

Unten am Chat öffnet **Skills** die Auswahl des letzten Auftrags und ihren Grund. **Vorausgewählt; Anleitung noch nicht geladen** unterscheidet einen Vorschlag von einer tatsächlich über `skill_read` oder `skill_run` geladenen Anleitung. Die Auswahl gehört zum jeweiligen Chat und bleibt mit dessen Verlauf gespeichert. Von dort öffnest du auch die Bibliothek. Dafür ist keine zusätzliche Auswahl vor dem Absenden erforderlich.

Eine geladene Anleitung ist noch kein Erfolgsnachweis. Ob der Agent sie korrekt umgesetzt hat, zeigen seine tatsächlichen Dateiänderungen, Werkzeugergebnisse und Tests. Die Anleitungen gelten im bisherigen Agentenbetrieb und im zuschaltbaren Hintergrundbetrieb; die jeweils verfügbaren Werkzeuge können sich unterscheiden.

Eine **Modellrückmeldung** beschreibt nur die Einschätzung des Agenten zur Anleitung. Sie ist an Auftrag und Inhaltsversion gebunden, keine gemessene Erfolgsquote. Sie verändert den Anleitungstext nicht und schaltet einen Skill nicht aus. Ein Abbruch oder ein fehlgeschlagenes Programm wird nicht automatisch als Skill-Fehler gewertet.

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
| Einen unterbrochenen Auftrag am tatsächlichen Stand weiterführen | `anvil-auftrag-fortsetzen` |
| Eine Anwendung über den richtigen Einstieg und konkrete Funktionen prüfen | `anvil-anwendung-pruefen` |
| Assets exportieren, im Ziel importieren und dort prüfen | `anvil-assets-uebertragen` |
| Abhängigkeiten und Sicherheitsupdates gezielt pflegen | `anvil-abhaengigkeiten-pflegen` |
| Datenformate und Regeln mit generierten Testfällen prüfen | `anvil-eigenschaftstests` |
| React-Komponenten, Zustand und Rendering gezielt verbessern | `anvil-react` |
| Beschriftungen, Fokus und Bedienabläufe verbessern | `anvil-bedienung-verbessern` |

Diagnose, allgemeine Tests, Änderungsprüfung, Weboberflächen, FreeCAD, Godot, Unity, Dienste und Skill-Entwicklung enthalten zusätzliche Fachreferenzen. Sie vertiefen bestehende Abläufe. Zum Beispiel unterscheidet der Godot-Skill Importprüfung von ausgeführten Verhaltenstests; FreeCAD ergänzt unabhängige Maß- und Geometrieprüfungen. Ein Prüfergebnis darf nur tatsächlich ausgeführte Schritte als erfolgreich nennen.

## Anpassen, exportieren und sichern

Vorinstallierte Anleitungen werden mit Anvil gepflegt. Der Agent kann deren Inhalt nicht überschreiben. **Projektkopie bearbeiten** legt einen eigenen Skill mit seinen Referenzen im aktuellen Projekt an und öffnet dessen `SKILL.md` im Editor. Bestehende Dateien werden nicht überschrieben. Wird eine Datei noch nicht im Projektordner gespeichert, zeigt Anvil das ausdrücklich an.

Auch eine importierte Paket-Anleitung lässt sich als Projektkopie bearbeiten. Das ursprüngliche Paket bleibt erhalten; seine Definition wird durch die eigene Variante nicht verändert. Fehler beim Kopieren oder Speichern stehen direkt am betroffenen Eintrag.

Eigene Skills lassen sich mit **Bearbeiten** direkt am Eintrag ändern. Beschreibung und Anleitung werden dort mit **Skill speichern** übernommen; **Abbrechen** verwirft die noch nicht gespeicherten Eingaben. **Entfernen** entfernt einen eigenen Skill. Die Aktion arbeitet am zugehörigen Projektstand und zeigt einen Fehler direkt an, wenn die Speicherung oder Entfernung nicht bestätigt werden konnte.

Bei einer importierten Paket-Anleitung entfernt **Paket entfernen** das zugehörige Paket, einschließlich weiterer enthaltenen Skills. Der Hinweis am Eintrag erklärt diesen Umfang vor dem Klick. Um nur eine Anleitung nicht zu verwenden, genügt deren Aktivierungsschalter. Es gibt kein zusätzliches Bestätigungsfenster.

**Als ZIP exportieren** enthält die vollständige Anleitung und ihre ergänzenden Dateien. Die eingebauten Anvil-Skills nennen im Paket ihre Anvil-Abhängigkeit und Version. Ein gültiges Skill-Format allein garantiert nicht, dass ein anderer Agent dieselben Werkzeuge anbietet.

Die angepassten Fachanleitungen führen ihre Quellen und festgehaltenen Quellstände in `references/quellen.md` und `references/quellen.json` auf. Zugehörige Lizenztexte und Hinweise werden als Paketressourcen mit exportiert und nur bei Bedarf gelesen. Die eigenschaftsbasierte Testanleitung und entsprechend gekennzeichnete Fachreferenzen behalten ihre eigene CC-BY-SA-Lizenz; diese Kennzeichnung bezieht sich auf die jeweiligen Inhalte.

Die Kompatibilitätsprüfung unterscheidet Anleitung, Ressourcen, Werkzeuge und ungeprüftes Verhalten. Gewöhnliche Programmfunktionen wie `is_sorted()` oder `assert_eq()` gelten nicht allein wegen ihrer Schreibweise als Anvil-Werkzeuge. Ein Verzeichnislink wie `assets/` ist gültig, wenn zugehörige Dateien im Paket vorhanden sind. Fehlende Ressourcen, unsichere Pfade und ausdrücklich behauptete, unbekannte Anvil-Werkzeuge bleiben Fehler.

**Skill importieren** öffnet den bestehenden Aufgabenpaket-Bereich mit **Skill-Ordner importieren**. Dort importierst du einen Ordner mit `SKILL.md` und benötigten Referenzen; einen ZIP-Export vorher entpacken. **Installierte Skills verwalten** führt zur Bibliothek zurück. Vorhandene und importierte Skills bleiben beim Einspielen der Anvil-Bibliothek erhalten. Paketfreigaben und Projektzuordnung gelten weiterhin.

Eine im Projekt gefundene Skill-Datei bleibt diesem Projekt zugeordnet. Eine Angabe wie `scope: user` in der Datei macht sie nicht von selbst zu einer Anleitung für alle Projekte. Wird die Projektdatei geändert, ungültig oder entfernt, wird ihre Verfügbarkeit im vollständigen aktuellen Dateistand entsprechend abgeglichen. Bewusst gespeicherte Nutzer-Skills sind davon getrennt.

## Was die Skill-Prüfung belegt

Die Prüfung in den aufgeklappten Details unterscheidet das Format, die Referenzen und bekannte Werkzeugnamen. Fehlt ein aktueller Ressourcenindex, bleibt eine verlinkte Datei als ungeprüft erkennbar. Dienstwerkzeuge müssen anhand ihres tatsächlichen Katalogs und Zugriffs geprüft werden. Ein erfolgreicher statischer Check bestätigt keine zuverlässige Ausführung durch ein Modell.

Für die Pflege der Bibliothek liegen unter `fixtures/skills/evaluations.json` jeweils ein passender Auftrag, ein begrenzender Fall und eine fehlende Voraussetzung pro Skill. Sie beschreiben erwartetes Verhalten und dienen späteren Vergleichsläufen mit und ohne Skill. Die vorhandenen Softwaretests prüfen unter anderem Paketdaten, Auswahl und tatsächliche Laufzeiteinstiege. Das Vorhandensein eines Testfalls ist noch kein ausgeführter Modellvergleich.

Die Einstellungssicherung unter **Daten → Exportieren** enthält auch die Skill-Schalter und Projekt-Anheftungen. **Gespeicherte Erinnerungen löschen** entfernt persönliche und projektbezogene Erinnerungen, nicht die Skill-Bibliothek. Der Gedächtnisbereich verweist mit **Skills verwalten →** auf die zentrale Verwaltung.
