# Installation, Updates und Freigabe

Anvil kann ohne Signatur gebaut und getestet werden. Auf Wunsch des Eigentümers wird auch Release 1.3.25 ausdrücklich unsigniert veröffentlicht. `product-release.json` enthält noch keine Herausgeber-, Support-, Lizenz- oder Signaturangaben; die Prüfung für eine signierte Freigabe lehnt diesen Zustand weiterhin ab.

## Verhalten für Nutzer

- Setup und Deinstallation beenden Anvil nicht. Wenn Anvil läuft, müssen Nutzer ihre Arbeit in Anvil speichern und die Anwendung selbst schließen. Der Dialog erlaubt Wiederholen oder Abbrechen. Stille Installationen brechen mit Fehlercode 2 ab.
- „Setup herunterladen“ prüft den Download und zeigt die Datei im Ordner. Es startet keinen Installer im Hintergrund. Erst Arbeit speichern, Anvil schließen und das Setup öffnen.
- Ein konfigurierter Herausgeber wird gegen die gültige, mit Zeitstempel versehene Windows-Signatur geprüft. Ohne Konfiguration wird ausdrücklich keine bestätigte Herausgeber-Signatur behauptet. Eine SHA-256-Prüfsumme allein bestätigt die Dateiübertragung, nicht den Herausgeber.
- ZIP-Ausgaben werden nur in einen leeren Zielordner entpackt. Bestehende Projekte oder die laufende Anwendung werden nicht überschrieben.
- Daten neben der Anwendung und eigene Run-Ausgaben bleiben bei der Deinstallation erhalten. Das Setup entfernt keine fremden temporären Arbeitsordner.

## Reproduzierbare Paketabnahme

`scripts/verify-installer.ps1` startet tatsächlich die installierte Anwendung. Es kontrolliert die Oberfläche, die Datenablage neben der Anwendung, einen Speichervorgang, den Schutz ungespeicherter Änderungen bei Update und Deinstallation, Abbrechen beim Schließen, einen vollständigen Neustart, eine erneute Installation und die anschließende Deinstallation. Der gestarteten Anwendung steht kein externes Node.js im PATH zur Verfügung. Es werden keine Modellanfragen gestellt.

Auf Entwicklerrechnern ist ausschließlich ein separat gebautes Paket mit `appId: app.anvil.installerqa`, Produktname und ausführbarer Datei `AnvilInstallerQA` erlaubt. Seine effektive Baukonfiguration wird vor der Installation kontrolliert. Die Tests verwenden einen neu angelegten Unterordner in `artifacts/installer-acceptance`; Screenshots und `result.json` bleiben dort zur Prüfung erhalten. Die normale Anvil-Installation und vorhandene Projekte werden nicht für die Prüfung verwendet.

Nach einem aktuellen Build und `node scripts/pack-ui.mjs`:

```powershell
node node_modules/electron-builder/cli.js --win nsis --publish never --config.appId=app.anvil.installerqa --config.productName=AnvilInstallerQA --config.win.executableName=AnvilInstallerQA --config.nsis.shortcutName=AnvilInstallerQA --config.nsis.createDesktopShortcut=false --config.nsis.createStartMenuShortcut=false --config.directories.output=artifacts/installer-package
./scripts/verify-installer.ps1 -Directory artifacts/installer-package -Executable AnvilInstallerQA.exe
```

Eine erneute Installation derselben Version prüft den Installer-Updateweg und den Datenerhalt. Sie ersetzt keine Migration von einer tatsächlich älteren veröffentlichten Version. Dafür muss ein entsprechendes älteres, isoliertes Prüfpaket zusätzlich bereitliegen.

## Öffentliche Windows-Freigabe

Ein passender Versions-Tag (zum Beispiel `v1.3.25`) veröffentlicht nach bestandenen Prüfungen Setup-EXE und portable ZIP. Ein normaler Push auf `main` veröffentlicht nichts. Alternativ kann der Workflow manuell mit `publish: true` gestartet werden. Ohne `signed: true` sind die Pakete unsigniert; das steht ausdrücklich in den Release-Hinweisen.

Für eine spätere **signierte** Veröffentlichung:

1. Tatsächlichen Herausgeber, nutzbare Support-Adresse, festgelegte Nutzungsbedingungen und den Zertifikatsnamen in `product-release.json` eintragen.
2. Das Windows-Code-Signing-Zertifikat als `WINDOWS_CSC_LINK` und sein Passwort als `WINDOWS_CSC_KEY_PASSWORD` in den geschützten Repository-Secrets hinterlegen. Keine Schlüssel ins Repository schreiben.
3. `node scripts/verify-release-readiness.mjs` prüft die Angaben. Der Windows-Bau mit `forceCodeSigning` verlangt eine echte Signatur; `scripts/verify-signatures.ps1` kontrolliert danach Setup und Anvil.exe einschließlich Herausgeber und Zeitstempel.
4. Den Release-Workflow ausdrücklich mit `publish: true` und `signed: true` starten. Prüfungen, Signaturprüfung und Paketabnahme müssen vor der Veröffentlichung erfolgreich sein.

Es werden keine Identitäten oder Lizenzangaben erfunden; Zertifikate werden separat eingerichtet.

## Lokales Ergebnis vom 12. September 2026

Das isolierte Setup `artifacts/installer-package/AnvilInstallerQA Setup 1.3.24.exe` wurde tatsächlich installiert und vollständig abgenommen. Ergebnis: `artifacts/installer-acceptance/install-NPYrMa/result.json`, `ok: true`, keine Rendererfehler.

Bestätigt sind Start und Speicherung ohne externes Node im Anwendungspfad, eigener Datenordner neben der EXE, Schutz offener ungespeicherter Arbeit bei Update und Deinstallation, Abbrechen beim Schließen, Dateispeicherung, vollständiger Neustart, erneute Installation mit Datenerhalt sowie Deinstallation. Nach der Deinstallation bleiben die Nutzerdaten und Run-Ausgaben erhalten; alle überprüften Programmdateien einschließlich `dxcompiler.dll`, `dxil.dll` und `resources.pak` sind entfernt. Der direkt ausgeführte Test-Uninstaller ist wegen des NSIS-Testarguments `_?=` von der Selbstentfernungsprüfung ausgenommen.

Der Test behält wie die normale Anwendung dieselbe lokale Adresse über Neustarts. Ein anfänglicher Testlauf änderte diese Adresse und öffnete damit einen anderen Browser-Speicher; der Harness wurde korrigiert und vollständig wiederholt. Das Paket ist nach tatsächlicher Windows-Prüfung **nicht signiert**. Es ist ein lokales QA-Paket mit eigener App-Identität und kein veröffentlichtes Nutzer-Setup.

Auch `artifacts/installer-package/AnvilInstallerQA-1.3.24-win.zip` wurde tatsächlich in einen eigenen Ordner entpackt und gestartet: `artifacts/portable-acceptance/zip-MhD2R7/result.json`, `ok: true`, keine Rendererfehler. Bestätigt sind die sichtbare Oberfläche ohne externes Node im Anwendungspfad, Daten neben der portablen EXE und ein vollständiger Neustart mit erhaltenen Einstellungen. Beide finalen Paket-Screenshots wurden visuell geprüft. Der Hauptprozess im fertigen Paket stimmt per SHA-256 mit dem aktuellen Quellstand überein. Der ZIP-Test stellt keine zusätzliche Prüfung der Run-Funktion dar.

Die portable Abnahme lässt sich mit `node scripts/verify-portable.mjs <absoluter-ZIP-Pfad> AnvilInstallerQA.exe` wiederholen und ist auch im Windows-Release-Workflow vor einer Veröffentlichung eingetragen.

Die Prozessprüfung beruht auf dem [NSIS-nsProcess-Vertrag](https://nsis.sourceforge.io/NsProcess_plugin). Der Anvil-Hook ersetzt den regulären Prozessbeendigungsweg der lokal installierten electron-builder-NSIS-Vorlagen; siehe auch die [offizielle NSIS-Anpassung](https://www.electron.build/v26/docs/nsis/).
