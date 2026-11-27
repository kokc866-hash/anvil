# Notion: Spezifikation, Umsetzung und Fortschritt verbinden

## Tatsächliche Verbindung und Auftrag

Mit mcp_list die eingerichtete Notion-Verbindung und die aktuell freigegebenen Such-, Lese- und gegebenenfalls Schreibwerkzeuge bestimmen. Nur bestätigte Namen und inputSchema verwenden. Upstream-Namen wie Notion:search oder notion-create-pages sind keine Anvil-Werkzeugnamen und dürfen nicht ungeprüft aufgerufen werden. Aktionen laufen über mcp_call mit dem bestätigten Server und Schema; lange vorhandene Ergebnisse bei Bedarf über mcp_read_output weiterlesen.

Login, erreichbarer Katalog und Zugriff auf eine konkrete Seite sind unterschiedliche Nachweise. Den vorhandenen Anvil-Login benutzen. Fehlenden Zugriff benennen; keine Codex-App-ID, fremde OAuth-Datei, zusätzliche Plugin-Installation oder neue Anmeldung aus dieser Anleitung übernehmen.

Der Auftrag bestimmt die erlaubten Wirkungen. Eine Spezifikation lesen und daraus lokal Code erstellen ist noch kein Auftrag, Notion-Seiten, Aufgaben oder Status zu verändern. Eine beauftragte Planung mit Aufgabenanlage darf dagegen im konkreten Ziel umgesetzt werden, ohne eine neue Bestätigungsfolge einzuführen. Nachrichten an andere Personen brauchen den dafür erteilten Auftrag.

## Spezifikation verstehen

Das gewünschte Dokument gezielt suchen und vollständig genug lesen. Anvil verwendet tatsächliche Notion-Seiten-/Datenbankkennungen aus Antworten, keine erfundenen IDs oder Suchtreffer eines anderen Dienstes. Bei mehreren Treffern zunächst vorhandenen Kontext, Titel, Elternseite und Inhalt zur Zuordnung nutzen; nur eine entscheidende verbleibende Mehrdeutigkeit klären.

Beobachtbare Anforderungen, Grenzen, betroffene Daten und vorhandene Vorgaben aus dem Dokument extrahieren. Offene Angaben als solche festhalten. Eine überschaubare lokale Planliste reicht für eine kleine Änderung; keine zusätzliche Dokumentlandschaft allein wegen eines Templates erzeugen.

## Beauftragte Aufgaben erstellen

Vor Schreibaktionen das tatsächliche Ziel und Datenbankschema lesen. Titel, Statusoptionen, Pflichtfelder, Beziehungen und Parent aus diesem Schema ableiten. Fremde Vorlagefelder, frei erfundene Statuswerte und bestimmte data_source_id-Parameter nicht pauschal voraussetzen. Mit den realen Antworten weiterarbeiten und nur unterstützte Felder senden.

Aufgaben in beobachtbare Arbeitsergebnisse zerlegen. Spezifikation, Plan und Aufgaben verlinken, soweit dies verlangt und mit den vorhandenen Feldern möglich ist. Bereits vorhandene Aufgaben weiterverwenden, statt bei jedem Fortsetzen einen zweiten Satz anzulegen. Lokale set_plan-Schritte und Notion-Aufgaben sind unterschiedliche Zustände; deren Kennungen und Erfolgsmeldungen nicht verwechseln.

## Fortschritt aus Nachweisen ableiten

Einen Schritt erst als erledigt kennzeichnen, wenn seine konkrete Umsetzung und passende Prüfung belegt sind. Ein erfolgreicher Notion-Schreibaufruf bestätigt nur die Änderung in Notion, keine funktionierende Anwendung. Ein bestandener Teiltest bestätigt nicht alle Anforderungen. Blockierte oder ungeprüfte Arbeit entsprechend benennen und eine Modellbehauptung nicht als Testnachweis übertragen.

Bei Status- oder Inhaltsänderungen aktuellen Inhalt lesen und unabhängige Nutzeränderungen erhalten. Nach Timeout oder unterbrochener Antwort zuerst den tatsächlichen Zielzustand lesen: Eine Aktion kann bereits ausgeführt worden sein. Keine Aufgaben oder Kommentare blind erneut erstellen. Ungeklärte externe Wirkungen offen berichten; daraus kein zusätzliches Anvil-Abnahmefenster machen.

Zum Abschluss bestätigte Objektlinks oder IDs, erledigte Arbeit und noch offene Prüfungen nennen. Eine lokal gespeicherte Anmeldung, ein geladener Werkzeugkatalog oder ein erzeugtes Template genügt nicht als Erfolg.
