---
name: anvil-bedienung-verbessern
description: "Beschriftungen, Fehlermeldungen, Fokus, Tooltips und responsive Bedienabläufe bestehender Oberflächen prüfen oder gezielt verbessern. Erhält den beauftragten Stil und unterscheidet tatsächliche Interaktion von bloßen Darstellungsannahmen."
compatibility: "Für Anvils Agentenbetrieb. Verwendet vorhandene Projekt- und Werkzeugzugriffe; diese Anleitung erteilt keine zusätzlichen Rechte und installiert keine Programme."
license: Apache-2.0
metadata:
  version: "1.0.0"
  adaptation: "Anvil-spezifische Arbeitsanleitung; keine unverändert importierte Laufzeit"
  provenance: "references/quellen.json"
---

# Bedienung und Texte verbessern

Kläre aus dem Auftrag, welche Oberfläche, Nutzeraktion und konkrete Schwierigkeit gemeint sind. Eine reine Bewertung bleibt lesend. Eine beauftragte Verbesserung erhält vorhandene Gestaltung, Funktionen und Produktangaben außerhalb dieses Umfangs; sie ist kein pauschaler Neuentwurf.

Lies betroffene Komponenten, Zustände und vorhandene Gestaltungsvorgaben. Prüfe den tatsächlich gerenderten Ablauf mit den vorhandenen Anvil-Werkzeugen. `run_file`, `open_preview`, `see_run` und `play` besitzen unterschiedliche Möglichkeiten. `play` bietet die im Schema beschriebenen Tastatur-, Maus-, Texteingabe- und Erwartungsprüfungen innerhalb der HTML-Vorschau. Nutze echte Selektoren und prüfe eine beobachtbare Wirkung; daraus entsteht kein Zugriff auf andere Fenster. Weitere Browserwerkzeuge nur über einen tatsächlich eingerichteten MCP-Katalog verwenden.

Beschriftungen sollen Aktion und Folge verständlich nennen. Fehlermeldungen erklären, was passiert ist und welcher konkrete nächste Schritt möglich ist. Keine persönlichen Pfade oder fremden Systemdaten als allgemeine Produkttexte übernehmen. Ein Tooltip ergänzt ein erkennbares Bedienelement, ersetzt aber keine notwendige Beschriftung und verdeckt dessen Ziel nicht.

Prüfe Fokusreihenfolge, Tastaturzugriff, lange Texte, schmale Ansichten sowie leere, ladende und fehlgeschlagene Zustände. Benötigte Rückmeldung nahe an der Handlung zeigen. Keine neue Bestätigungsfolge für normale Arbeitsabläufe und keine zusätzlichen Abnahmefenster einführen.

Änderungen auf die betroffene Stelle begrenzen und den gleichen Ablauf erneut bedienen, soweit die Werkzeuge dies ermöglichen. Sichtbare Darstellung, tatsächliche Interaktion und statische Einschätzung getrennt berichten. Konkrete Prüffälle stehen in [references/texte-fokus-und-zustaende.md](references/texte-fokus-und-zustaende.md); Quellen und Anpassungen in [references/quellen.md](references/quellen.md).
