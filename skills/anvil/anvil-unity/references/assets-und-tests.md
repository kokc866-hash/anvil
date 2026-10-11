# Unity-Assets und Testgrenzen

## Kennungen erhalten

Unity speichert die Kennung eines Assets und dessen Importinformationen in der zugehörigen `.meta`-Datei. Verweise in Szenen und Prefabs hängen davon ab. Eine neue Datei mit demselben sichtbaren Namen ist daher kein gleichwertiger Ersatz.

Beim Verschieben außerhalb des Editors Asset und `.meta` gemeinsam behandeln. Prüfe Verweise auf die betroffenen Assets, insbesondere Skriptkomponenten, Materialien und Prefabs. Generierte `Library`-Daten sind keine Vorlage für die Wiederherstellung der Quellassets.

Siehe [Unity-Asset-Metadaten](https://docs.unity.com/en-us/engine/6000.7/manual/assets-and-media/import-assets/asset-metadata). Versionsabhängige Einzelheiten anhand der Projektversion prüfen.

## Beispiel: Komponentenverhalten

Für eine Änderung an einer Komponente zuerst ihren Einsatz in der betroffenen Szene oder im Prefab nachvollziehen. Ein Unit-Test kann die Berechnung absichern. Ob die Komponente tatsächlich an einem Objekt vorhanden ist, ihre Konfiguration stimmt und sie im Spiel den erwarteten Zustand erhält, braucht einen passenden Editor- beziehungsweise PlayMode-Nachweis.

## Testausführung

Anvils erkannter Unity-Standardweg bietet einen PlayMode-Testlauf. Er setzt einen passenden Editor und die erforderlichen Projektpakete voraus. Einen Editorstart nicht als Kompilierung oder Test ausgeben. Für EditMode, spezielle Filter und Ergebnisdateien nur tatsächlich angebotene Werkzeuge oder einen freigegebenen passenden Ablauf verwenden.

Bei einem Testlauf Logs und Testbericht mit Anzahl, Namen und Status der Fälle auswerten. Nicht gelaufene oder übersprungene Tests offen ausweisen. Die [Unity-Anleitung für Kommandozeilentests](https://docs.unity.com/en-us/engine/6000.3/manual/scripting/test-framework-introduction/running-tests/run-tests-from-command-line) beschreibt die getrennten Testoptionen; sie erweitert nicht Anvils Werkzeugfreigabe.
