# Sorceress als Werkzeugdienst

Sorceress erstellt Bilder, Sprites, 3D-Modelle, Animationen, Musik und Sprache. Anvil verbindet die offizielle REST-API über einen eingebauten Adapter mit seiner vorhandenen Werkzeugbrücke. Es ist keine zusätzliche Installation nötig. Sorceress wird unter **Erweiterungen → Dienste** eingerichtet; das Agentenmodell bleibt unter **Einstellungen → Agent** wählbar.

## Einrichten

1. **Sorceress → Verbindung hinzufügen** wählen.
2. Einen vorhandenen Schlüssel auf der [Sorceress-API-Seite](https://sorceress.games/account/api-keys) verwenden oder dort selbst anlegen. Den Schlüssel nur in Anvils Passwortfeld **API-Schlüssel** eintragen, nicht in den Chat oder eine Projektdatei.
3. **Schlüssel speichern und prüfen** anklicken. Anvil speichert ihn mit dem Betriebssystem verschlüsselt im konfigurierten Datenordner und prüft ihn mit dem kostenlosen `ping`. Danach lädt Anvil den Katalog für dieses Konto. Ein gespeicherter Schlüssel allein belegt noch keinen gültigen Zugriff.
4. Nur die benötigten Werkzeuge freigeben. Für Bilder beispielsweise `image_generate`, `sorceress_tool_info` und `sorceress_job_get`. Neu angebotene Werkzeuge bleiben ausgeschaltet. Der Katalog kann auch Veröffentlichungs- und Löschwerkzeuge enthalten; diese nur bewusst freigeben.
5. **In Anvil verwenden** aktiviert die vorhandene Brücke für den nächsten Auftrag. Der Agent findet die freigegebenen Werkzeuge über `mcp_list` und verwendet sie über `mcp_call`. Die gleiche Verbindung steht im Hintergrundbetrieb zur Verfügung.

Nach einem Neustart wird der Katalog einer aktiven Verbindung mit gespeichertem Schlüssel automatisch geladen. Freigaben bleiben erhalten. **Abmelden** entfernt den lokalen Dienstschlüssel und seine Freigaben; **Verbindung entfernen** entfernt zusätzlich den Eintrag. Andere Modellschlüssel werden dabei nicht gelöscht. Einen Schlüssel bei Sorceress selbst widerrufen, wenn er dort ebenfalls ungültig werden soll.

## Längere Generierungen und Kosten

Vor einer Generierung `sorceress_tool_info` mit dem gewünschten Werkzeugnamen lesen: Die Antwort enthält die aktuellen Anbieterangaben zu Modellen, Parametern und Credit-Preisen. Ein Katalogwert von `creditCost: 0` bedeutet bei `selfBilled: true` keine kostenlose Generierung; die Kosten hängen dann von den Optionen ab.

Viele Aufrufe liefern zunächst eine `jobId`. Das bedeutet **Auftrag gestartet**, noch kein fertiges Asset. `sorceress_job_get` fragt mit dieser Kennung einmalig den Status und später die Ergebnis-URLs ab. Bei `queued` oder `processing` bleibt der Auftrag offen. Den Erzeugungsaufruf nicht nochmals senden, um den Status abzufragen: Das könnte einen weiteren kostenpflichtigen Auftrag starten. Anvil folgt keiner vom Dienst gelieferten beliebigen Poll-Adresse, sondern fragt ausschließlich die feste Sorceress-API ab.

Ein Abbruch in Anvil beendet die lokale Anfrage. Die geprüfte API dokumentiert keinen serverseitigen Abbruch laufender Medienaufträge; ein bereits gestarteter Auftrag kann weiterlaufen und bei Erfolg Credits verbrauchen. Die Kennung für eine spätere Statusabfrage aufbewahren. Verbindungsfehler lösen keine automatische Wiederholung einer Generierung aus.

## Typische Fehler

- **401:** Schlüssel ungültig, nicht vorhanden oder widerrufen.
- **402:** Nicht genug Guthaben.
- **403:** Schlüssel erlaubt das Werkzeug nicht.
- **404:** Werkzeug oder Auftragskennung nicht gefunden.
- **409:** Werkzeug derzeit nicht verfügbar.
- **HTML statt API-Antwort:** Eine Website oder unerwartete Serverantwort wurde empfangen. Die Schlüsselverwaltung unter `/account/api-keys` ist kein Chatmodell-Endpunkt. Die feste Werkzeugadresse lautet `https://sorceress.games/api/v1`.

Quelle: offizielle [Sorceress-Dokumentation, Quickstart und Reference](https://sorceress.games/account/api-keys), geprüft am 11. Oktober 2026. Die Adaptertests verwenden künstliche Antworten. Ein geladener öffentlicher Katalog ersetzt keinen Kontotest und keine tatsächliche Mediengenerierung.
