---
name: anvil-react
description: "Bestehende React-Komponenten, Zustandsabonnements und Rendering-Verhalten anhand messbarer Ursachen verbessern. Für tatsächliche React-Projekte; erhält Framework, öffentliche Schnittstellen und vorhandenes Verhalten."
compatibility: "Für Anvils Agentenbetrieb. Verwendet vorhandene Projekt- und Werkzeugzugriffe; diese Anleitung erteilt keine zusätzlichen Rechte und installiert keine Programme."
license: MIT
metadata:
  version: "1.0.0"
  adaptation: "Anvil-spezifische Arbeitsanleitung; keine unverändert importierte Laufzeit"
  provenance: "references/quellen.json"
---

# React gezielt verbessern

Prüfe mit `read_file` und `grep` das tatsächliche Projektmanifest, Komponenten und Zustandsverwaltung. Eine TSX-Datei oder das Wort React in einer Dokumentation allein belegt keine verwendete Laufzeit. Für ein anderes Framework den passenden Projektweg beibehalten.

Bei Performanceproblemen zuerst die betroffene Nutzeraktion und eine nachvollziehbare Ausgangsmessung bestimmen. Vorhandenen Profiler oder reproduzierbare Zeit-/Renderbeobachtungen verwenden, sofern verfügbar. Ohne Messung eine strukturelle Vermutung als solche berichten; nicht pauschal schnelleren Ablauf behaupten.

Abonnements möglichst auf die benötigten Zustandsausschnitte begrenzen. Ableitbare Werte nicht durch zusätzliche Effect-/State-Ketten duplizieren. Effects mit externem System, Listenern oder laufenden Aufgaben brauchen passende Lebensdauer und Aufräumwege. Vor einer Memoisierung prüfen, ob teure Arbeit oder instabile Eingaben tatsächlich die Ursache sind.

Komponenten anhand von Verhalten und Verantwortung zusammensetzen. Bestehende Schnittstellen und sinnvolle lokale Zustände erhalten. Große unabhängige Module nur über den vorhandenen Stack nachladen. Eine Vercel-Empfehlung ist kein Grund, Next.js, einen neuen Router oder einen anderen State-Store einzuführen.

Die kleinste begründete Änderung umsetzen und dieselbe Nutzeraktion erneut prüfen. Typprüfung oder Build bestätigt keine Fokus-, Tastatur- oder Laufzeitfunktion. Referenzen zu Messung, Datenfluss und Komposition stehen in [references/rendering-und-komposition.md](references/rendering-und-komposition.md); Herkunft in [references/quellen.md](references/quellen.md).
