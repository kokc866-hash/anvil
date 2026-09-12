# Orientierung in Anvil

Stand: 12. September 2026, lokaler Entwicklungsstand.

Unter **Einstellungen → Orientierung** findest du Aufgaben statt einer Liste technischer Voraussetzungen. Die Karten führen zu KI-Verbindung, lokalen Programmen und Engines, Speicherorten oder der Anordnung der Arbeitsfläche. Darunter stehen der erste Arbeitsablauf und Erklärungen zu Anvils Bereichen.

## Zuschaltbare Hilfe

Unter **Einstellungen → Orientierung → Erklärhilfen und Tour** lässt sich die ausführliche Hilfe einschalten. Bleibe mit der Maus auf einem der wichtigsten Bedienelemente oder wähle es mit Tab aus. Die Erklärung enthält eine Schaltfläche zum passenden Tour-Schritt. Mit **F1** wechselst du vom Bedienelement in die Hilfe, mit **Esc** schließt du sie. Die bisherigen kurzen Beschriftungen bleiben bei ausgeschalteter Erklärhilfe verfügbar.

Die Verzögerung ist auf 0,4, 0,9 oder 1,8 Sekunden einstellbar. Die zeigende Hand der Tour ist separat abschaltbar. Beide Einstellungen bleiben gespeichert und sind Bestandteil der Einstellungssicherung; die Tour startet nur auf deinen Wunsch.

**Tour starten** führt durch Projekt, Chat, Fragen/Agent, Spur, Ausgabe, Erweiterungen und Einstellungen. **Weiter**, **Zurück**, **Überspringen** und **Esc** steuern die Tour. Sie markiert die Bedienelemente und erklärt den Ablauf, ohne Nachrichten zu senden, Dateien zu ändern oder dein Layout umzustellen. Falls ein Bereich ausgeblendet ist, zeigt sie den zugehörigen Einstieg oder einen Hinweis. Während der Tour werden Arbeitsflächen-Tastenkürzel abgefangen.

## Was brauche ich am Anfang?

Öffne deinen Projektordner oder starte das eingebaute Beispiel. Das Beispiel braucht keine KI-Verbindung. Im Einstieg ist die KI-Einrichtung deshalb zunächst zugeklappt; sie öffnet sich, wenn du Chat und KI-Änderungen einrichten möchtest. **Einstieg erneut öffnen** in der Orientierung zeigt diese Hilfe später wieder, ohne Dateien, Einstellungen oder Chat-Entwürfe zurückzusetzen.

Für den Chat wählst du unter **Agent** Anbieter, Anmeldung und Modell. Den zusätzlichen lokalen **Helfer** musst du dafür nicht einrichten. **Companion** startet Programme und Prüfungen auf deinem Rechner; er ist kein KI-Modell. In der Desktop-App wird er bei Bedarf gestartet.

## Fragen oder Agent?

- **Fragen:** erklären und untersuchen. Anvil sendet den Auftrag mit ausschließlich lesenden Projektwerkzeugen. Reparaturwörter wie „Behebe …“ schalten den Modus nicht mehr automatisch um. Auch Kurzbefehle im Chat werden in diesem Modus als Fragen behandelt. Die normalen Schaltflächen der App funktionieren weiterhin.
- **Agent:** kann Dateien bearbeiten und verfügbare Werkzeuge ausführen. Ob Dateiänderungen automatisch übernommen werden, richtet sich weiterhin nach deiner Einstellung.

Der Hinweis unter dem Modusschalter bleibt auch bei einem vorhandenen Gespräch sichtbar. Eine Modusänderung ersetzt keine bereits laufende Aufgabe; für eine neue Aufgabe gilt die beim Senden gewählte Einstellung.

Auch wartende Aufträge und Rückfragen behalten ihren ursprünglichen Modus. Bei einer offenen Rückfrage bleibt die Warteschlange stehen, bis die aktuelle Aufgabe fortgesetzt oder beendet wird. Alte Warteschlangeneinträge ohne gespeicherten Modus werden vorsichtig als Fragen wiederhergestellt.

## Weniger technische Details im Weg

Die Einstellungsbereiche behalten ihre Namen und zeigen zusätzlich ihren Zweck, beispielsweise „Companion – Programme ausführen“ und „Helfer – Zusätzliche lokale KI“.

Adresse, Port, Verbindungsschlüssel und Kopplung stehen unter **Companion → Verbindungsdetails**. Die Prüfung bleibt direkt erreichbar. Bei einem Verbindungsfehler und bei passenden Suchergebnissen werden die Details geöffnet. Die Engine-Einrichtung bleibt separat erreichbar.

Unter **Erweiterungen** heißen die Plugin-Gruppen jetzt unter anderem **Alle Plugins**, **Grundfunktionen**, **Editor**, **Werkzeuge** und **Projekt-Plugins**. **Mitgeliefert** und **Im Projekt** erklären die Herkunft. Für externe Konten wie Notion oder Linear ist weiterhin **Dienste** zuständig; die Plugin-Liste ist kein vollständiger Dienstekatalog.

## Abnahme

Der neue Sendetest zeigte vor der Korrektur, dass eine Reparaturformulierung im Fragen-Modus ohne Lesebeschränkung weitergegeben wurde. Danach bestanden Reparaturformulierungen, Kurzbefehle und die vorhandenen geführten Prüfaufträge mit aktivem Lesemodus und unveränderten Projektdateien.

Die Desktop-Prüfung verwendet ein getrenntes Profil und prüft das funktionierende Beispiel, KI-Einrichtung auf- und zuklappen, Modushinweise, Navigation aus der Orientierung, deutsche und englische Orientierung, Verbindungsdetails bei Suche sowie das erneute Öffnen des Einstiegs mit erhaltenen Dateien und Entwurf. Ein lokales Verbindungsresultat wird für die Prüfung der technischen Detailanzeige simuliert; es werden keine neuen externen Konten verbunden und keine Modellantworten bezahlt.

Zusätzlich bestanden alle sieben Tour-Schritte, Zurück/Überspringen/Esc, Fokusführung mit Tab und Shift+Tab, die interaktive Erklärung mit F1 und Tour-Verknüpfung, die separat abschaltbare Hand, ein 1000 × 720 großes Fenster, die Einstellungssuche und das Wiederherstellen der Hilfe-Einstellungen nach einem Neuladen. Dateien, Chat und Layout blieben während der Tour unverändert. Die Desktop-Abnahme umfasst acht Prüfgruppen; die Modus- und Warteschlangentests prüfen zusätzlich Rückfragen und Wiederherstellung.

Nachweise: `artifacts/clarity/ask-before.log`, `ask-after.log`, `regression.log`, `typecheck.log`, `build.log`, `browser.log` sowie `artifacts/product-experience/result.json`.

Diese Abnahme bestätigt Verhalten und Darstellung. Ob neue Nutzer die Begriffe ohne Hilfe verstehen, muss zusätzlich mit echten Erstnutzern geprüft werden. Spezialbereiche wie die grafische Ablaufsteuerung benötigen weiterhin Vorwissen.
