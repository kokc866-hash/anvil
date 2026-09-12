# Dienstkatalog und Anmeldestatus

Stand: 12. September 2026. Lokaler Entwicklungsstand.

50 Angebote: 35 für den vorhandenen Anmeldeweg vorbereitet, 15 mit zusätzlicher Einrichtung. Die Cloudflare-Produkte zählen als getrennte Angebote; die Anzahl bezeichnet nicht ausschließlich unabhängige Unternehmen.

## Nachweis und Grenzen

Notion und Linear wurden mit den verbundenen Konten lesend in Anvil getestet; siehe [Live-Test](dienste-live-test.md). Bei den übrigen Angeboten wurden offizielle Anbieterunterlagen und, soweit erreichbar, öffentliche OAuth-Metadaten geprüft. Das bestätigt die dokumentierte Anmeldung, keinen erfolgreichen Kontozugriff oder sämtliche Werkzeuge. Es wurden weder neue Konten verbunden noch externe Daten verändert.

Suche nach Name, Aufgabe oder Bereich grenzt die Auswahl ein. Eine bereits getroffene Auswahl bleibt beim Suchen erhalten und wird bei Bedarf separat gekennzeichnet. Anbieter mit fehlender Freischaltung oder zusätzlicher Anmeldelogik zeigen die konkrete Voraussetzung; Hinzufügen ist dann gesperrt. Ein direkter programmatischer Hinzufügeversuch wird ebenfalls abgewiesen.

Alle hinzugefügten Dienste beginnen deaktiviert und ohne Werkzeugfreigaben. Anmeldung, Auswahl, Einklappen, Abmelden und Entfernen nutzen weiterhin dieselbe Brücke. Die vorhandenen Verbindungen werden nicht umgeschrieben.

## Vorbereitete Angebote

| Angebot | Bereich | Nutzen / Voraussetzung |
|---|---|---|
| [Notion](https://developers.notion.com/guides/mcp/get-started-with-mcp) | Aufgaben & Wissen | Seiten und Datenbanken in deinem Notion-Workspace verwenden.  |
| [Linear](https://linear.app/docs/mcp) | Aufgaben & Wissen | Aufgaben und Projekte in deinem Linear-Workspace verwenden.  |
| [Atlassian Rovo](https://atlassian.github.io/atlassian-mcp-server/) | Aufgaben & Wissen | Jira, Confluence und weitere Atlassian-Arbeitsbereiche verbinden. Die Organisation kann den Zugriff auf ihre Atlassian-Produkte beschränken. |
| [Todoist](https://developer.todoist.com/api/v1/) | Aufgaben & Wissen | Aufgaben, Termine und Projekte organisieren.  |
| [ClickUp](https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server) | Aufgaben & Wissen | Aufgaben, Listen, Dokumente und Zeiterfassung verbinden. Beta. Verfügbare Aufrufe hängen vom ClickUp-Tarif ab. |
| [Airtable](https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server) | Datenbanken | Bases durchsuchen, Datensätze bearbeiten und Informationen auswerten. In verwalteten Organisationen muss Anvil gegebenenfalls freigegeben werden. |
| [Canva](https://www.canva.dev/docs/mcp/) | Design & Websites | Designs suchen, erstellen und für die weitere Arbeit exportieren.  |
| [Miro](https://developers.miro.com/docs/miro-mcp-server-frequently-asked-questions) | Design & Websites | Boards, Planung und visuelle Zusammenarbeit mit Anvil verbinden. Bei der Anmeldung ein Team wählen. Dessen Administration muss MCP gegebenenfalls aktivieren. |
| [Webflow](https://developers.webflow.com/mcp/reference/getting-started) | Design & Websites | Websites und CMS-Inhalte in Webflow verwalten. Für Arbeit direkt im Designer muss zusätzlich die Webflow MCP Bridge App im Designer geöffnet sein. |
| [Intercom (USA)](https://developers.intercom.com/docs/guides/mcp) | Kommunikation & Kunden | Supportgespräche, Kontakte und Hilfeartikel nutzen. Für Workspaces in der US-Datenregion. Für europäische Konten Intercom (EU) wählen. |
| [Intercom (EU)](https://developers.intercom.com/docs/guides/mcp) | Kommunikation & Kunden | Supportgespräche, Kontakte und Hilfeartikel aus europäischen Workspaces nutzen. Für Workspaces in der EU-Datenregion. Australische Workspaces werden noch nicht unterstützt. |
| [GitLab](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) | Code & Qualität | Projekte, Issues und Merge Requests mit GitLab verbinden. Beta. Der MCP-Zugriff muss in der obersten GitLab-Gruppe freigegeben sein. Eigene GitLab-Instanzen lassen sich über ihre Dienstadresse ergänzen. |
| [Sentry](https://github.com/getsentry/sentry-mcp) | Code & Qualität | Fehler, Stacktraces, Releases und Leistungsprobleme untersuchen. Organisation, Projekte und verfügbare Fähigkeiten werden bei Sentry freigegeben. |
| [PostHog](https://posthog.com/docs/model-context-protocol) | Code & Qualität | Produktanalysen, Fehler, Feature Flags und Experimente auswerten. Die Anmeldung wählt die passende Datenregion. KI-Funktionen können eine Freigabe für KI-Datenverarbeitung erfordern und Kosten verursachen. |
| [Supabase](https://supabase.com/docs/guides/ai-tools/mcp) | Datenbanken | Datenbanken, Tabellen, Abfragen und Entwicklungsprojekte verwalten. Für einzelne Projekte oder reinen Lesezugriff kann eine entsprechend eingeschränkte Dienstadresse verwendet werden. |
| [Neon](https://neon.com/docs/ai/neon-mcp-server) | Datenbanken | Postgres-Projekte, Datenbankzweige und SQL-Abfragen nutzen. Mit dem Neon-Konto anmelden und die benötigten Berechtigungen freigeben. |
| [Vercel](https://vercel.com/docs/agent-resources/vercel-mcp) | Hosting & Cloud | Projekte, Deployments, Build-Protokolle und Webanalysen bearbeiten. Zugriff auf die gewünschten Vercel-Projekte im Browser freigeben. |
| [Netlify](https://docs.netlify.com/build/build-with-ai/agent-setup-guides/agent-setup-overview/) | Hosting & Cloud | Webprojekte, Veröffentlichungen und Netlify-Ressourcen verwalten.  |
| [Cloudflare](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | Cloudflare-Dienste wie DNS, Workers, R2 und Zero Trust verwalten. Die Werkzeuge search und execute bündeln viele Funktionen. Den Zugriff deshalb auch bei Cloudflare auf die benötigten Rechte beschränken. |
| [Cloudflare Workers Bindings](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | Workers mit Speicher, KI und Rechendiensten verbinden.  |
| [Cloudflare Workers Builds](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | Builds von Workers prüfen und verwalten.  |
| [Cloudflare Observability](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Code & Qualität | Anwendungsprotokolle und Analysen zur Fehlersuche nutzen.  |
| [Cloudflare Radar](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | Internettrends, Netzwerkverkehr und URL-Scans untersuchen.  |
| [Cloudflare Containers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | Abgeschirmte Entwicklungsumgebungen in der Cloud starten.  |
| [Cloudflare Browser Run](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | Webseiten abrufen, in Markdown umwandeln und Bildschirmfotos erstellen.  |
| [Cloudflare Logpush](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Code & Qualität | Den Zustand von Logpush-Aufträgen überprüfen.  |
| [Cloudflare AI Gateway](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Code & Qualität | KI-Anfragen und Antworten in Gateway-Protokollen untersuchen.  |
| [Cloudflare AI Search](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Datenbanken | Dokumente aus vorhandenen AI-Search-Sammlungen durchsuchen.  |
| [Cloudflare Audit Logs](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Code & Qualität | Änderungsprotokolle abfragen und Prüfberichte erstellen.  |
| [Cloudflare DNS Analytics](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | DNS-Leistung und Konfigurationsprobleme untersuchen.  |
| [Cloudflare Digital Experience](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | Erreichbarkeit und Nutzung wichtiger Anwendungen überwachen.  |
| [Cloudflare One CASB](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Code & Qualität | Sicherheitsprobleme in angebundenen Cloud-Anwendungen erkennen.  |
| [Cloudflare GraphQL Analytics](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Hosting & Cloud | Cloudflare-Analysedaten gezielt abfragen.  |
| [AI Game Developer · Unity, Unreal & Godot](https://github.com/IvanMurzak/Unity-MCP) | Spiele & 3D | Engine-Projekte über das verbundene Editor-Plugin bearbeiten und prüfen. Community-Anbieter. Das passende Unity-, Unreal- oder Godot-Plugin muss installiert, am Cloud-Hub angemeldet und im geöffneten Projekt verbunden sein. Godot benötigt die .NET-Ausgabe ab 4.3 und .NET 8; Unreal ab 5.5 ein C++-fähiges Projekt. Die Cloud-Verbindung kann Projektinhalte übertragen. Eine Anmeldung allein verbindet noch keinen Editor. |
| [Context7](https://context7.com/docs/resources/all-clients) | Code & Qualität | Dokumentation und Beispiele zu Engines, Bibliotheken und verwendeten Paketen nachschlagen. Die passende Bibliothek und Version wählen. Dokumentationszugriff steuert keinen Engine-Editor. |

## Zusätzliche Einrichtung erforderlich

| Angebot | Was noch fehlt |
|---|---|
| [Figma](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) | Figma muss Anvil zuerst als unterstützten MCP-Client freischalten. Die Aufnahme erfolgt über den Anbieter. |
| [Asana](https://developers.asana.com/docs/connecting-mcp-clients-to-asanas-v2-server) | Asana benötigt eine eigene registrierte OAuth-App mit Client-ID und Secret. Diese zusätzliche Anmeldelogik fehlt in Anvil noch. |
| [monday.com](https://developer.monday.com/api-reference/docs/mcp-dynamic-client-registration) | monday.com muss die Anvil-Integration vor ihrer öffentlichen Bereitstellung prüfen und freigeben. Danach kann die automatische Anmeldung genutzt werden. |
| [Slack](https://docs.slack.dev/ai/slack-mcp-server) | Slack verlangt eine eigene zugelassene oder interne App mit Client-ID und Secret. Dafür braucht Anvil zusätzliche Anmeldelogik. |
| [HubSpot](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server) | Eine eigene HubSpot MCP Auth App und die Verarbeitung ihres Client-Secrets müssen zuerst eingerichtet werden. |
| [Box](https://developer.box.com/guides/box-mcp/setup) | Eine Administration muss eine Box-MCP-Integration anlegen. Client-ID und Secret benötigen zusätzliche Unterstützung in Anvil. |
| [Dropbox](https://help.dropbox.com/integrations/connect-dropbox-mcp-server) | Für Anvil als eigenen Client ist eine Dropbox-App mit App-Key, Secret und Rücksprungadresse erforderlich. Die zusätzliche Anmeldung ist noch einzubauen. |
| [Google Drive](https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en) | Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil. |
| [Gmail](https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en) | Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil. |
| [Google Calendar](https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en) | Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil. |
| [Google Chat](https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en) | Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil. |
| [Google Kontakte](https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en) | Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil. |
| [GitHub](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md) | GitHub verlangt eine eigene registrierte Anvil-App mit zusätzlicher Anmeldelogik oder einen persönlichen Zugriffstoken. Die automatische Client-Registrierung wird nicht unterstützt. |
| [Render](https://render.com/docs/mcp-server) | Render bietet Browser-Anmeldung für registrierte Clients, aber keine automatische Client-Registrierung. Für Anvil wird eine eigene freigegebene Client-ID oder eine Verbindung mit API-Schlüssel benötigt. |
| [ElevenLabs](https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp) | ElevenLabs benötigt eine registrierte Client-ID oder veröffentlichte Anvil-Client-Metadaten. Die automatische Registrierung unseres bisherigen Anmeldewegs wird nicht angeboten. Spracherzeugung benötigt außerdem Kontoguthaben. |

## Entscheidungen

- Atlassian nutzt den [offiziellen Gateway-Modus](https://atlassian.github.io/atlassian-mcp-server/#mcp-gateways) mit `?tools=all`, damit die Werkzeuge einzeln freigegeben werden können.
- Cloudflare bietet zusätzlich zum universellen Zugang einzelne Produktserver. Im universellen Zugang bündeln search/execute viele Funktionen; Anbieterrechte bleiben deshalb entscheidend.
- Canva unterstützt dynamische Registrierung noch als Übergangsverfahren. Seine Umstellung auf Client-ID-Metadaten muss bei späteren Anbieteränderungen erneut geprüft werden.
- GitLab, Supabase und Miro werden anhand des dokumentierten öffentlichen Client-Verfahrens eingeordnet. Eine alleinige Auswertung der angebotenen Secret-Methoden in Discovery wäre zu restriktiv.
- Anbieter mit eigener OAuth-App, Client-Secret oder Freischaltung sind kein funktionierender Ein-Klick-Zugang. Die dafür fehlenden Schritte stehen oben ausdrücklich offen.
- Weitere Token- und lokale MCP-Dienste lassen sich im vorhandenen MCP-Bereich anbinden. Sie werden nicht als Browser-Anmeldung dargestellt.

## Lokale Abnahme

Typprüfung und Desktop-Build bestanden. Der Dienst-Integrationstest prüft alle Katalogeinträge auf eindeutige Identität, normalisierte HTTPS-Adressen, Quellenlinks, deaktivierte Anlage und die Sperre bei fehlender Einrichtung. Die Desktop-Abnahme prüft Suche, Gruppen, leere Treffer, stabile Auswahl, Einrichtungssperre und weiterhin den vollständigen lokalen OAuth-/Werkzeugablauf einschließlich Neustart und Entfernung.

Nachweise: `artifacts/services-catalog/tests.log`, `artifacts/services-catalog/browser.log`, `artifacts/services/result.json`, `artifacts/services/dienste-katalog.png`. Das lokale `ui-build` enthält den neuen Katalog. Keine Veröffentlichung oder Signierung.
