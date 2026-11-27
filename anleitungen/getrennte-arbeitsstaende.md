# Getrennte Arbeitsstände und Hintergrundaufträge

Im Git-Bereich können für ein vorhandenes Git-Projekt eigene Arbeitsstände angelegt werden. Jeder besteht aus einem eigenen Projektordner und einem Branch. Das Hauptprojekt bleibt geöffnet, bis ausdrücklich „Öffnen“ gewählt wird. Ein neuer Auftrag arbeitet anschließend im geöffneten Projektordner.

## Einen Aufgabenstand verwenden

1. Den Git-Projektstamm öffnen, im Git-Bereich „Getrennte Arbeitsstände“ aufklappen und einen Namen eingeben. Die erweiterten Funktionen sind zunächst zugeklappt.
2. „Erstellen“ legt den Aufgabenstand auf dem aktuellen **Commit** an. Noch nicht committete oder nur im Editor vorhandene Änderungen werden nicht kopiert. Sie bleiben im Hauptprojekt erhalten. Die Oberfläche weist darauf hin, wenn das Hauptprojekt bereits Änderungen enthält.
3. „Öffnen“ wechselt mit dem bestehenden Projektöffnungsablauf in den eigenen Ordner. Dateien und offene Vorschläge vorher speichern oder abgleichen. Ein laufender Vordergrundauftrag verhindert den Wechsel.
4. Im eigenen Ordner kann ein normaler Auftrag gestartet werden. Hintergrundaufträge anderer, getrennter Projekte dürfen weiterlaufen.
5. „Änderungen“ vergleicht den aktuellen Aufgabenstand mit seiner bei der Erstellung gespeicherten Ausgangsrevision. Dabei sind auch uncommittete, gestagte, neu angelegte und binäre Dateien enthalten. Umbenennungen erscheinen sicherheitshalber als Entfernen und Hinzufügen.
6. „Ins Hauptprojekt rückführen“ übernimmt die geprüften Änderungen als Dateien. Es entsteht kein Commit; der Index des Hauptprojekts bleibt erhalten. Der Aufgabenstand und sein Branch bleiben bestehen.

Die Vorschau benennt Ausgangsstand, Aufgabenstand und bei Konflikten den Stand des Hauptprojekts. Textvorschauen sind begrenzt; die Dateiübernahme prüft den vollständigen Inhalt. Binärdateien werden als solche gekennzeichnet.

## Was bei einer Rückführung geschützt wird

Basisrevision und Basisbranch werden beim Erstellen festgehalten. Eine Zieldatei kann übernommen werden, wenn sie noch dem Ausgangsinhalt entspricht oder den Aufgabeninhalt bereits enthält. Änderungen an anderen Dateien im Hauptprojekt bleiben erhalten, einschließlich vorhandener gestagter Änderungen.

Hat sich eine betroffene Zieldatei anders verändert, erscheint sie in der Konfliktliste. **Bei einem solchen Konflikt wird keine Datei des Rückführungsplans verändert.** Beide Arbeitsstände bleiben erhalten. Es werden weder `reset`, `clean`, ein erzwungener Checkout noch ein automatischer Merge verwendet. Ein erneuter Vergleich muss einen inzwischen veränderten Aufgaben- oder Zielstand berücksichtigen.

Während der bewussten Dateiaktion sind neue Agentenschreibaufträge auf den betroffenen Projektordnern gesperrt. Im geöffneten Editor verhindert die bestehende Dateioperationssperre gleichzeitige Änderungen. Bereits laufende Hintergrundaufträge derselben oder einer überlappenden Projektwurzel blockieren die Dateiaktion.

Vor dem ersten Dateischreibzugriff wird ein Rückführungsprotokoll mit den geprüften Vorher- und Nachherinhalten gespeichert. Scheitert die laufende Übernahme, wird eine bereits geschriebene Datei nur dann zurückgenommen, wenn sie noch dem gerade geschriebenen Inhalt entspricht. Fremde Änderungen werden erhalten und als offene Wiederherstellung benannt. Nach einem Prozessabbruch darf der Aufgabenstand erneut verglichen werden; bereits passende Zieldateien gelten als enthalten. Externe Dienstaktionen werden dabei nicht wiederholt.

Verwaltete Ordner werden anhand der Registrierung, tatsächlichen Ordneridentität, Git-Zuordnung und des erwarteten Branches überprüft. Verschobene, ersetzte oder umgebogene Ordner werden abgewiesen. Es gibt keinen Import beliebiger fremder Worktrees in die Verwaltungsfunktionen. Repository-Hooks und konfigurierte Git-Filterbefehle werden bei diesen Verwaltungsaktionen nicht ausgeführt.

## Begrenzte parallele Hintergrundaufträge

Es dürfen höchstens **zwei** Hintergrundaufträge gleichzeitig laufen. Beide benötigen erreichbare reale Projektordner. Gleiche, verschachtelte oder über reale Pfade zusammenfallende Projektwurzeln dürfen keine parallelen Schreiber haben. Ein Auftrag ohne lokalen Projektordner bleibt als Einzelauftrag möglich.

Jeder Auftrag erhält einen eigenen Host, eine eigene Runtime sowie eigene Verbindungs-, Engine- und Wissensinstanzen. Projekt, ursprüngliche Anfragedaten und Modellziel werden vor der asynchronen Vorbereitung gebunden. Das Fortsetzen eines vorhandenen Auftrags verlangt dasselbe Projekt und Modellziel. Für ein anderes Ziel wird ein neuer Auftrag gestartet.

Die Auftragsauswahl zeigt die gespeicherten Aufträge. Ein anderer ausgewählter Auftrag kopiert seine Dateien nicht in das geöffnete Projekt. Gespeicherte Aufträge und die Auswahl werden nach einem Programmneustart wiederhergestellt. Noch aktive Aufträge erhalten den bestehenden Status „unterbrochen“ und laufen nicht automatisch erneut an. Ein vorhandenes älteres `agent-jobs/latest.json` bleibt unter seinem bisherigen Pfad als Legacy-Auftrag erreichbar.

Gemeinsame externe MCP-, CLI-, Engine- und Debug-Ressourcen verwenden eine gemeinsame Besitzsperre. Ein anderer Auftrag bekommt vor dem Aufruf eine klare Belegt-Meldung. Die Sperre löst keine Warteschlange und keinen automatischen Wiederholungsversuch aus. Eine laufende Engine- oder Debug-Sitzung behält ihren Besitz über den Startaufruf hinaus. Ein angeforderter Abbruch beweist allein noch kein Ende der tatsächlichen Operation.

Bleibt nach dem Auftragsende eine von Anvil gestartete Engine geöffnet, bietet die Auftragszeile **Sitzung beenden** an. Dieser bewusste Befehl beendet nur die zu diesem Auftrag gehörenden Ressourcen; der Ergebnisbericht bleibt erhalten. Anvil schließt keine Engine automatisch, um einen Folgeauftrag zu erzwingen. Du kannst auch das zugehörige Engine-Fenster selbst schließen. Erst der tatsächliche Abschluss gibt die Ressource frei.

## Erhalten und aufräumen

„Leeren Stand entfernen“ arbeitet ausschließlich auf einem eigenen registrierten Aufgabenstand, der gegenüber der Ausgangsrevision unverändert ist und keine eigenen Commits, ungetrackten oder ignorierten Dateien enthält. Der aktuell geöffnete Ordner wird nicht entfernt. Der Branch bleibt erhalten. Ein Aufgabenstand mit Änderungen wird auch nach einer erfolgreichen Rückführung erhalten.

Ein abgebrochener Erstellungsvorgang kann einen unvollständigen registrierten Aufgabenstand hinterlassen. Er wird als solcher angezeigt und nicht durch ein erzwungenes Aufräumen beseitigt. Die Git-Zuordnung und gegebenenfalls vorhandene Dateien bleiben zur Untersuchung erhalten.

Die Registry und Rückführungsprotokolle liegen unter `worktrees` im vorhandenen Anvil-Paket-/Companion-Speicher. Die Oberfläche benötigt dafür keine neue Konfiguration. Auftragsstände liegen im bestehenden Anvil-Datenprofil unter `agent-jobs`.

## Grenzen

- Erstellung und Rückführung sind auf höchstens 4000 Dateien und begrenzte Dateimengen bis 64 MiB ausgelegt.
- Git-Submodule und gespeicherte symbolische Verknüpfungen werden derzeit abgewiesen. Auch Verknüpfungen in betroffenen Zielpfaden werden nicht beschrieben.
- Änderungen am ausführbaren Git-Dateimodus werden unter Windows als Konflikt angezeigt, da sie ohne Änderung des geschützten Hauptprojekt-Index nicht zuverlässig übertragbar sind.
- Der Checkout wird aus Git-Blobinhalten erstellt. LFS-Downloads und Clean-/Smudge-Filter werden dabei nicht gestartet. Nicht versionierte Engine-Caches, lokale Abhängigkeiten und ignorierte Assets werden nicht aus dem Hauptprojekt kopiert.
- Ein Worktree trennt Dateistände. Er ist keine Betriebssystem-Sandbox. Explizit gestartete Programme und externe Dienste haben ihre eigenen Wirkungsbereiche.
- Eine Rückführung belegt gespeicherte Dateien und Konfliktprüfungen. Sie ersetzt weder Projekt-, Engine-, CAD- noch Modellabnahme. Git-Dateirücknahme macht externe Aktionen nicht rückgängig.

Die automatischen Prüfungen verwenden ausschließlich künstliche Git-Repositories und getrennte Datenprofile unter `artifacts/cursor-adoption-2026-10-19/worktrees`. Sie rufen keine persönlichen Projekte oder echten Modelle auf.
