# Rendering, Datenfluss und Komponenten prüfen

## Erst den Engpass bestimmen

Eine konkrete Folge wie Tippen bei langem Verlauf, Filtern großer Listen oder Öffnen eines Editors wiederholbar messen. Derselbe Datenstand und dieselbe Umgebung müssen vor und nach der Änderung gelten. Bei fehlendem Profiler nur beobachtbare Größen nennen; aus wenigen langsam wirkenden Frames keine genaue Ursache erfinden.

Prüfe breite Store-Abonnements und unnötig häufig erzeugte Objekte. Komponenten nur für Werte abonnieren, die sie beim Rendern brauchen. Bei häufigen transienten Werten kann ein Ref passen, wenn die Anzeige davon nicht unmittelbar abhängt. Keine Sichtbarkeit oder Zustandssicherheit zugunsten vermeintlicher Geschwindigkeit opfern.

## Effects und Ressourcen

Aus Props oder bestehendem Zustand berechenbare Werte direkt ableiten. Eine zusätzliche Effect-/State-Kette erzeugt Zwischenzustände und weitere Aktualisierungen. Benutzeraktionen gehören nach Möglichkeit in ihre Handler. Für tatsächliche externe Synchronisation Abhängigkeiten, Cleanup und Abbruch prüfen. Projekt- oder Auftragswechsel darf eine verspätete Antwort nicht in den neuen Zustand schreiben.

Ein Timer, Event-Listener, Observer oder Stream muss eine klare Lebensdauer haben. Lang wachsende Listen und Caches auf wiederholten Mount/Unmount und begrenzte Speicherung prüfen. Eine gestartete Hintergrundaufgabe nicht durch den bloßen Komponentenabbau stillschweigend als beendet behandeln.

## Zusammensetzung und Nachladen

Öffentliche Komponentenverträge klein halten. Fachliche Zustände nicht durch viele konkurrierende boolesche Props unklar machen; vorhandene Kompositionsmuster nutzen. Dateien nicht allein für ein theoretisches Muster neu aufbauen.

Große unabhängige Editoren oder Diagramme über die bereits unterstützten React-/Bundler-Wege nachladen. Next-spezifische Server-, Cache- oder Dynamic-Import-APIs nur in einem tatsächlichen passenden Next-Projekt verwenden. SSR, Desktop-Renderer und Browser haben unterschiedliche Voraussetzungen.

## Ergebnis

Gleiche Interaktion und Daten vor/nach der Änderung vergleichen, relevante Verhaltenstests wiederholen und Tastatur/Fokus kontrollieren. Messwerte, Verfahren und Grenzen nennen. Keine höhere Geschwindigkeit oder geringeren Speicherverbrauch aus einer bloßen Codeänderung ableiten.
