# Agent und Chat

Interner Entwicklungsstand nach 1.3.19. Die folgenden Ergänzungen sind noch nicht als Installer veröffentlicht.

- Die laufende Anfrage zeigt ihren Status rechts neben der Zeit an der Agentenblase. Die frühere feste Statusleiste entfällt. Lange Angaben bleiben per Tooltip vollständig lesbar, auch am Fensterrand. Escape, Scrollen oder eine Größenänderung schließen den Tooltip.
- „Neuer Chat“ beendet den laufenden Agentenauftrag und leert auch dessen Warteschlange, ausstehende Übergabe, Entwurf und ausgewählte Rückfrage. Der Befehl verhält sich über die Schaltfläche, das Kontextmenü und die Befehlspalette gleich.
- Kurz gepufferte Text- und Denkausgaben bleiben ihrer ursprünglichen Nachricht und ihrem Projekt zugeordnet. Sie wandern beim Chatwechsel oder Löschen einer Nachricht nicht in eine andere Antwort.
- Zwei unmittelbar übergebene Aufträge starten nacheinander. Wartende Aufträge ersetzen keine bereits laufende Anfrage.
- Ein verspäteter Abschluss von „Stop“ greift nicht in einen danach gestarteten Auftrag ein. Wird die aktive Antwort gelöscht, endet auch die dazugehörige Anfrage.

Die gezielten Chat-Regressionen verwenden simulierte Anbieterantworten. Sie prüfen die Reihenfolge, Chatwechsel, Stream-Zuordnung, Stop/Neustart und die Statusanzeige; dafür sind keine echten Modellanfragen erforderlich.
