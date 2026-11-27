# Installation, Updates und Freigabe

Stand: 4. Oktober 2026, Quellstand 1.3.35. Öffentliche Pakete findest du unter [aktuelle Veröffentlichung](https://github.com/kokc866-hash/anvil/releases/latest); diese Anleitung behauptet keine Veröffentlichung des heutigen Arbeitsstands. Auf Wunsch des Eigentümers werden Setup-EXE und portable ZIP bisher unsigniert bereitgestellt. `product-release.json` enthält noch keine Herausgeber-, Support-, Lizenz- oder Signaturangaben; die Prüfung für eine signierte Freigabe lehnt diesen Zustand weiterhin ab. Das blockiert nicht den ausdrücklich freigegebenen unsignierten Veröffentlichungsweg.

Die Release-Prüfungen für 1.3.26 liefen erfolgreich auf einem frischen GitHub-Windows-Runner, einschließlich Installer- und ZIP-Abnahme. Beide veröffentlichten Downloads wurden geprüft. Ein solcher Runner ist keine unveränderte Endnutzer-Windows-Installation: Der App-Start wird ohne externes Node.js im Anwendungspfad geprüft, der Baujob selbst besitzt Entwicklungswerkzeuge. Eine echte Migration von einem älteren Nutzer-Release bleibt ein zusätzlicher Nachweis.

## Verhalten für Nutzer

- Setup und Deinstallation beenden Anvil nicht. Wenn Anvil läuft, müssen Nutzer ihre Arbeit in Anvil speichern und die Anwendung selbst schließen. Der Dialog erlaubt Wiederholen oder Abbrechen. Stille Installationen brechen mit Fehlercode 2 ab.
- „Setup herunterladen“ prüft den Download und zeigt die Datei im Ordner. Es startet keinen Installer im Hintergrund. Erst Arbeit speichern, Anvil schließen und das Setup öffnen.
- Ein konfigurierter Herausgeber wird gegen die gültige, mit Zeitstempel versehene Windows-Signatur geprüft. Ohne Konfiguration wird ausdrücklich keine bestätigte Herausgeber-Signatur behauptet. Eine SHA-256-Prüfsumme allein bestätigt die Dateiübertragung, nicht den Herausgeber.
- ZIP-Ausgaben werden nur in einen leeren Zielordner entpackt. Bestehende Projekte oder die laufende Anwendung werden nicht überschrieben.
- Daten neben der Anwendung und eigene Run-Ausgaben bleiben bei der Deinstallation erhalten. Das Setup entfernt keine fremden temporären Arbeitsordner.

## Reproduzierbare Paketabnahme

`scripts/verify-installer.ps1` startet tatsächlich die installierte Anwendung. Es kontrolliert die Oberfläche, die Datenablage neben der Anwendung, einen Speichervorgang, den Schutz ungespeicherter Änderungen bei Update und Deinstallation, Abbrechen beim Schließen, einen vollständigen Neustart, eine erneute Installation und die anschließende Deinstallation. Der gestarteten Anwendung steht kein externes Node.js im PATH zur Verfügung. Die Hintergrundprüfung verwendet ausschließlich einen künstlichen Modelladapter im lokalen Testprozess; sie sendet keine Anfragen an persönliche Modellserver oder Cloudanbieter. Dabei werden die tatsächlich gepackten Agenten-, Shell-, Formatierungs-, Debugger-, Vorschau-, Skill- und Gedächtnispfade ausgeführt.

Auf Entwicklerrechnern ist ausschließlich ein separat gebautes Paket mit `appId: app.anvil.installerqa`, Produktname und ausführbarer Datei `AnvilInstallerQA` erlaubt. Der Paketierer prüft die kopierten Programmdateien und schreibt die tatsächlich aufgelöste Identität in `package-identity.json`, auch bei umgeleiteter Terminalausgabe. Vor der Installation werden diese Angaben und die Bindung an den frischen Build kontrolliert; fehlende Nachweise oder eine normale Anvil-Identität brechen die Prüfung ab. Der Nachweis enthält keine Signier- oder Veröffentlichungszugangsdaten. Die Tests verwenden einen neu angelegten Unterordner in `artifacts/installer-acceptance`; Screenshots und `result.json` bleiben dort zur Prüfung erhalten. Die normale Anvil-Installation und vorhandene Projekte werden nicht für die Prüfung verwendet.

Der gemeinsame Paketbau erzeugt Oberfläche, Hintergrundprozess, geprüften Fingerabdruck, Setup-EXE und portable ZIP frisch. Für eine lokale Abnahme mit eigener App-Identität:

```powershell
npm run dist:win -- --config.appId=app.anvil.installerqa --config.productName=AnvilInstallerQA --config.win.executableName=AnvilInstallerQA --config.nsis.shortcutName=AnvilInstallerQA --config.nsis.createDesktopShortcut=false --config.nsis.createStartMenuShortcut=false --config.directories.output=artifacts/installer-package
./scripts/verify-installer.ps1 -Directory artifacts/installer-package -Executable AnvilInstallerQA.exe
node scripts/verify-portable.mjs (Resolve-Path 'artifacts/installer-package/AnvilInstallerQA-1.3.35-win.zip').Path AnvilInstallerQA.exe
```

Eine erneute Installation derselben Version prüft den Installer-Updateweg und den Datenerhalt. Sie ersetzt keine Migration von einer tatsächlich älteren veröffentlichten Version. Dafür muss ein entsprechendes älteres, isoliertes Prüfpaket zusätzlich bereitliegen.

## Öffentliche Windows-Freigabe

Ein neuer passender Versions-Tag (zum Beispiel `v1.3.26`) veröffentlicht nach bestandenen Prüfungen Setup-EXE und portable ZIP. Bereits veröffentlichte Tags und Pakete werden nicht für spätere Änderungen wiederverwendet. Ein normaler Push auf `main` veröffentlicht nichts. Alternativ kann der Workflow manuell mit `publish: true` gestartet werden. Ohne `signed: true` sind die Pakete unsigniert; das steht ausdrücklich in den Release-Hinweisen.

Für eine spätere **signierte** Veröffentlichung:

1. Tatsächlichen Herausgeber, nutzbare Support-Adresse, festgelegte Nutzungsbedingungen und den Zertifikatsnamen in `product-release.json` eintragen.
2. Das Windows-Code-Signing-Zertifikat als `WINDOWS_CSC_LINK` und sein Passwort als `WINDOWS_CSC_KEY_PASSWORD` in den geschützten Repository-Secrets hinterlegen. Keine Schlüssel ins Repository schreiben.
3. `node scripts/verify-release-readiness.mjs` prüft die Angaben. Der Windows-Bau mit `forceCodeSigning` verlangt eine echte Signatur; `scripts/verify-signatures.ps1` kontrolliert danach Setup und Anvil.exe einschließlich Herausgeber und Zeitstempel.
4. Den Release-Workflow ausdrücklich mit `publish: true` und `signed: true` starten. Prüfungen, Signaturprüfung und Paketabnahme müssen vor der Veröffentlichung erfolgreich sein.

Es werden keine Identitäten oder Lizenzangaben erfunden; Zertifikate werden separat eingerichtet.

## Lokales Ergebnis vom 4. Oktober 2026

Die frischen QA-Pakete für den lokalen Quellstand **1.3.35** liegen unter `artifacts/audit-2026-10-04/implementation/packages`: `AnvilInstallerQA Setup 1.3.35.exe` und `AnvilInstallerQA-1.3.35-win.zip`. Beide enthalten Electron **44.5.1** und den aktuellen Agentendienst. Der Paketierer prüfte die kopierten Dateien vor der Auslieferung; die Installer- und ZIP-Prüfung verglichen die enthaltenen SHA-256-Werte erneut mit dem frischen Build. Die lokale QA-Identität wurde vor der Installation anhand des tatsächlichen Paketiernachweises bestätigt.

Die [Installer-Abnahme](../artifacts/installer-acceptance/install-eLLYEv/result.json) und die [portable Abnahme](../artifacts/portable-acceptance/zip-fhWsue/result.json) stehen beide auf `ok: true`, ohne Rendererfehler. Beide starteten ohne externes Node im Anwendungspfad. Tatsächlich geprüft wurden Hintergrundauftrag, Shell mit gebündeltem Node, erwarteter negativer Exitcode, Dateien umbenennen/zurücknehmen, Formatierung, Canvas mit ES-Modulen, konfigurierte Steuerung, Bildaufnahme, Debugger-Wiederverbindung, Gedächtnis, dauerhafte Skills, native Go-Formatierung und Go-Trace-Auswertung. Der Modelladapter verwendete ausschließlich künstliche lokale Testantworten.

Beim Setup bestanden zusätzlich echter Speichervorgang, Abbrechen beim Schließen, verweigertes Update und verweigerte Deinstallation bei offener Arbeit, vollständiger Neustart, erneute Installation mit Datenerhalt sowie anschließende Deinstallation mit erhaltenen Nutzerdaten und Run-Ausgaben. Bei der portablen Version blieben die Einstellungen nach einem vollständigen Neustart erhalten. Beide Screenshots wurden visuell geprüft.

Setup und Anwendung sind laut tatsächlicher Windows-Signaturprüfung **nicht signiert**. Diese QA-Pakete sind keine neue öffentliche Veröffentlichung und ersetzen nicht die normale Anvil-Installation. Weitere Ergebnisse und Grenzen stehen im [Umsetzungsbericht](../artifacts/audit-2026-10-04/umsetzung.md); ein echter mehrstündiger Qwen-Auftrag ist damit nicht abgenommen.

## Historisches lokales Ergebnis vom 12. September 2026

Das isolierte Setup `artifacts/installer-package/AnvilInstallerQA Setup 1.3.24.exe` wurde tatsächlich installiert und vollständig abgenommen. Ergebnis: `artifacts/installer-acceptance/install-NPYrMa/result.json`, `ok: true`, keine Rendererfehler.

Bestätigt sind Start und Speicherung ohne externes Node im Anwendungspfad, eigener Datenordner neben der EXE, Schutz offener ungespeicherter Arbeit bei Update und Deinstallation, Abbrechen beim Schließen, Dateispeicherung, vollständiger Neustart, erneute Installation mit Datenerhalt sowie Deinstallation. Nach der Deinstallation bleiben die Nutzerdaten und Run-Ausgaben erhalten; alle überprüften Programmdateien einschließlich `dxcompiler.dll`, `dxil.dll` und `resources.pak` sind entfernt. Der direkt ausgeführte Test-Uninstaller ist wegen des NSIS-Testarguments `_?=` von der Selbstentfernungsprüfung ausgenommen.

Der Test behält wie die normale Anwendung dieselbe lokale Adresse über Neustarts. Ein anfänglicher Testlauf änderte diese Adresse und öffnete damit einen anderen Browser-Speicher; der Harness wurde korrigiert und vollständig wiederholt. Das Paket ist nach tatsächlicher Windows-Prüfung **nicht signiert**. Es ist ein lokales QA-Paket mit eigener App-Identität und kein veröffentlichtes Nutzer-Setup.

Auch `artifacts/installer-package/AnvilInstallerQA-1.3.24-win.zip` wurde tatsächlich in einen eigenen Ordner entpackt und gestartet: `artifacts/portable-acceptance/zip-MhD2R7/result.json`, `ok: true`, keine Rendererfehler. Bestätigt sind die sichtbare Oberfläche ohne externes Node im Anwendungspfad, Daten neben der portablen EXE und ein vollständiger Neustart mit erhaltenen Einstellungen. Beide finalen Paket-Screenshots wurden visuell geprüft. Der Hauptprozess im fertigen Paket stimmt per SHA-256 mit dem aktuellen Quellstand überein. Der ZIP-Test stellt keine zusätzliche Prüfung der Run-Funktion dar.

Die portable Abnahme lässt sich mit `node scripts/verify-portable.mjs <absoluter-ZIP-Pfad> AnvilInstallerQA.exe` wiederholen und ist auch im Windows-Release-Workflow vor einer Veröffentlichung eingetragen.

Die Prozessprüfung beruht auf dem [NSIS-nsProcess-Vertrag](https://nsis.sourceforge.io/NsProcess_plugin). Der Anvil-Hook ersetzt den regulären Prozessbeendigungsweg der lokal installierten electron-builder-NSIS-Vorlagen; siehe auch die [offizielle NSIS-Anpassung](https://www.electron.build/v26/docs/nsis/).
