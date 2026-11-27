# Werkzeuge und Anleitungen nach Bedarf

Anvil stellt dem Modell zu Beginn eines Auftrags grundlegende Dateiwerkzeuge und eine passende Vorauswahl bereit. Der gesamte Werkzeugkatalog und alle Skill-Anleitungen werden nicht mehr vorsorglich mitgesendet. Du formulierst deinen Auftrag wie bisher; zusätzliche Auswahlfenster gibt es nicht.

## Automatische Auswahl

- Die Aufgabe bestimmt passende Werkzeuggruppen, beispielsweise Tests, Versionsverwaltung, Engines oder CAD.
- Bei passenden MCP-Verbindungen kann Anvil bis zu drei bereits zwischengespeicherte Argumentschemata mitgeben. Sehr große Schemata werden als nachladbar gekennzeichnet und nicht mitten im JSON abgeschnitten.
- Bis zu zwei passende Skills werden mit Beschreibung und Leseadresse vorgeschlagen. Der Agent liest eine benötigte Anleitung vor ihrer Anwendung. Angeheftete und ausdrücklich genannte Skills werden weiterhin bevorzugt.
- Suche, To-do, Rückfragen und das Nachlesen gespeicherter Werkzeugausgaben bleiben erreichbar. Im Kompakt- und Textmodus stehen insgesamt höchstens zehn native Werkzeuge gleichzeitig bereit. Weitere Fähigkeiten können im nächsten Schritt geladen werden.

Die Auswahl gilt im bisherigen Agentenbetrieb und im Hintergrundbetrieb. Denkaufwand und eingestellte Kontextlänge bleiben unverändert.

## Gezieltes Nachladen

Bei ausdrücklich angeforderten Tests mit `play` sowie bei Maus- oder Tastaturtests in der HTML-Vorschau bietet Anvil die Vorschauwerkzeuge direkt an. `play` ist ein eigenes Werkzeug und kein Shell-Befehl. Versucht der Agent trotzdem einen Shell-Aufruf, erhält er einen Hinweis auf den passenden Aufruf und das gezielte Nachladen. Dafür ist kein zusätzliches Auswahlfenster nötig.

Ein solcher Prüfauftrag erhält einen To-do-Punkt für die tatsächliche Bedienung und die erwarteten Ergebnisse. Laden der Oberfläche oder eine zugestellte Taste schließen diesen Punkt allein nicht ab. Der Agent muss das erwartete Ergebnis mit einer passenden Vorschauprüfung bestätigen. Vor der Ausführung abgelehnte Befehle verbrauchen kein Ausführungs- oder Reparaturbudget und gelten nicht als fehlgeschlagener Anwendungstest; die Ablehnung bleibt in der Spur sichtbar.

Bei einer Liste einzelner Vorschaufunktionen erhält jede angefragte Funktion einen eigenen Prüfschritt. Ein Klick ohne geprüfte Erwartung bestätigt auch einen allgemeinen Funktionsprüfpunkt nicht. Wird ein Vorschauziel bereits vor der ersten Eingabe abgelehnt, kann der Agent die Adresse korrigieren und weiterarbeiten; fehlgeschlagene Erwartungen oder teilweise ausgeführte Eingabefolgen bleiben als solche erhalten.

„Noch einmal“ übernimmt den vorherigen Testauftrag und dessen Änderungsgrenzen, beginnt aber eine neue Prüfung mit offenen Prüfpunkten. Eine kurze Ergänzung wie „Korrektur: und berichte die Ursachen“ behält das bisherige Ziel. Eine ausdrückliche neue Aufgabe erhält ihren eigenen Auftrag.

Wiederholt der Agent mehrfach dieselbe Werkzeugfolge mit unveränderten Ergebnissen, erhält er zunächst einen Hinweis, die Prüfmethode zu wechseln. Wiederholt er die Folge weiterhin, hält Anvil den Auftrag mit dem tatsächlichen Grund an. Langsames Modelldenken wird dadurch nicht nach einer festen Minutenzahl abgebrochen. Unterschiedliche beobachtete Zustände und tatsächliche Dateiänderungen gelten als Fortschritt.

Der Agent kann über `select_tools` nach einer benötigten Fähigkeit suchen. Die Bereiche `tools`, `mcp` und `skills` grenzen die Suche ein; `all` durchsucht passende Bereiche gemeinsam. Native Werkzeugnamen können auch direkt angefordert werden. Die Suche ist lesend und löst keine Dienstaktion aus.

MCP-Treffer enthalten Serverkennung, Werkzeugname und das vollständige verfügbare Argumentschema. Der eigentliche Aufruf erfolgt anschließend über `mcp_call`. Die Schema- und Freigabeprüfung bleibt bestehen. Große Ergebnisse werden außerhalb des Modellkontexts gespeichert und über ihren Ausgabe-Verweis gelesen; eine bereits ausgeführte Aktion muss dafür nicht wiederholt werden.

Skill-Treffer enthalten Metadaten und die Leseadresse. Erst `skill_read` liefert die Anleitung; Referenzen werden einzeln angefordert. Der vorhandene **Skills**-Status am Chat unterscheidet Vorauswahl und tatsächlich geladene Anleitung.

Trefferlisten sind begrenzt und können seitenweise gelesen werden. Bei geänderter Suche oder geändertem Katalog wird ein alter Seitencursor ausdrücklich zurückgewiesen. Mit `refresh: true` kann der Agent gezielt den abgefragten MCP-Katalog aktualisieren. Frühere erfolgreiche Katalogantworten können für spätere Modellanfragen zusammengefasst werden; der gespeicherte Chatverlauf, ausgeführte Aktionen und geladene Anleitungen bleiben erhalten.

## Plugins und Freigaben

Unterstützte importierte Plugin-Fähigkeiten verwenden dieselben Wege: importierte Skills werden in der Skill-Suche gefunden, freigegebene MCP-Werkzeuge in der MCP-Suche. Das macht nicht unterstützte Plugin-Hooks oder fremde Bedienoberflächen nicht automatisch ausführbar. Native Anvil-Plugins behalten ihre bestehende Bedienung.

Deaktivierte Skills, ausgeschaltete Verbindungen und entzogene Paketfreigaben werden dadurch nicht umgangen. **Fragen**, aktive Arbeitsfläche, **Brücke**, Projektbindung und **Stoppen** gelten weiterhin. Finden oder Laden eines Werkzeugs ist keine zusätzliche Ausführungsfreigabe und bestätigt keinen erfolgreichen Auftrag.

## Was sich beim Kontext ändert

Kleine Aufgaben sparen vor allem unnötige Werkzeugdefinitionen. Größere Aufgaben laden passende Definitionen und Anleitungen schrittweise. Dafür kann eine zusätzliche Suchanfrage nötig werden. Wie viel insgesamt gespart wird, hängt von Aufgabe, Katalog, Verlauf und Modell ab. Dateiinhalte, Bilder oder bereits benötigte Anleitungen können weiterhin viel Kontext beanspruchen. Tokenzahlen aus einer Zeichenschätzung sind keine vom Modell gemessenen Werte.

Entwicklerprüfungen: `scripts/context-discovery.test.mjs` prüft reale Plugin-Importe und einen festen Katalogvergleich. `scripts/context-discovery-worker.test.mjs` prüft Standard-, Kompakt- und Textmodus gegen lokale Modell- und MCP-Gegenstellen. Die Modellantworten dieser reproduzierbaren Prüfungen sind vorgegeben; sie belegen keine Inferenzqualität eines echten Modells.
