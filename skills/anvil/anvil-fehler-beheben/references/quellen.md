# Herkunft und Anpassung für Anvil

Diese deutschsprachige Anleitung ist eine gezielte Anvil-Anpassung. Übernommen wurden fachliche Verfahren, keine fremden Installer, Hooks, Modellserver, Anmeldungen oder ausführbaren Host-Komponenten. Projektvorgaben, Nutzerauftrag und tatsächlich freigegebene Werkzeuge bleiben maßgeblich. Die Auswahl ist statisch geprüft; ein erfolgreicher Lauf des Upstream-Pakets in Anvil wird damit nicht behauptet.

- [mattpocock/skills: skills/engineering/diagnosing-bugs/SKILL.md](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/diagnosing-bugs/SKILL.md) — Commit 59db609eb1e18aaf59b63284d0e52255aff0c63c; Lizenz MIT.
- [obra/superpowers: skills/systematic-debugging/SKILL.md](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/systematic-debugging/SKILL.md) — Commit 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b; Lizenz MIT.
- [obra/superpowers: skills/verification-before-completion/SKILL.md](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/verification-before-completion/SKILL.md) — Commit 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b; Lizenz MIT.
- [affaan-m/ECC: skills/agent-introspection-debugging/SKILL.md](https://github.com/affaan-m/ECC/blob/25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b/skills/agent-introspection-debugging/SKILL.md) — Commit 25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b; Lizenz MIT.

Änderungen: eigenständige deutsche Formulierung, Anvil-Werkzeugnamen, gezieltes Nachladen, vorhandene Projektgrenzen und ehrliche Ergebnisberichte. Fremde Pflichtfreigaben, Subagenten-/CLI-Annahmen und automatische Installationen wurden nicht übernommen.

- Lizenzhinweis mattpocock/skills: [lizenz-matt.txt](lizenz-matt.txt).
- Lizenzhinweis obra/superpowers: [lizenz-super.txt](lizenz-super.txt).
- Lizenzhinweis affaan-m/ECC: [lizenz-ecc.txt](lizenz-ecc.txt).

## Lesende Kontext- und Modelldiagnose

- [ECC Context Budget](https://github.com/affaan-m/ECC/blob/25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b/skills/context-budget/SKILL.md) — Commit 25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b, MIT; Lizenzhinweis bereits in lizenz-ecc.txt.
- [Hugging Face Local Models](https://github.com/huggingface/skills/blob/fabc634a893f62ad5c2039830397efa35fa62715/skills/huggingface-local-models/SKILL.md) — Commit fabc634a893f62ad5c2039830397efa35fa62715, Apache-2.0; vollständiger Hinweis in [lizenz-hf.txt](lizenz-hf.txt).

Anpassung: Messquelle und Schätzung unterscheiden, vorhandenen Netzwerkzugang erhalten und Modell-/Quantisierungsbezeichnungen genau lesen. Aus der HF-Quelle wurden keine Installations-, Download-, Konvertierungs- oder Serverstartabläufe übernommen. Keine native Codex-/Claude-Kontextanzeige als Anvil-Werkzeug vorausgesetzt.
