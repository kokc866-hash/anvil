import { INFRA_SERVICE_PROVIDERS } from "./service-providers-infra";
import { GAME_SERVICE_PROVIDERS } from "./service-providers-game";

export type ServiceProvider = {
  id: string;
  name: string;
  url: string;
  category: string;
  description: string;
  source: string;
  note?: string;
  setupRequired?: string;
};

// Official endpoints researched 2026-09-12. Availability is not an account test.
export const SERVICE_PROVIDERS: ServiceProvider[] = [
  {
    id: "notion",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    category: "Aufgaben & Wissen",
    description: "Seiten und Datenbanken in deinem Notion-Workspace verwenden.",
    source: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
  },
  {
    id: "linear",
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    category: "Aufgaben & Wissen",
    description: "Aufgaben und Projekte in deinem Linear-Workspace verwenden.",
    source: "https://linear.app/docs/mcp",
  },
  {
    id: "atlassian",
    name: "Atlassian Rovo",
    url: "https://mcp.atlassian.com/v2/mcp?tools=all",
    category: "Aufgaben & Wissen",
    description: "Jira, Confluence und weitere Atlassian-Arbeitsbereiche verbinden.",
    source: "https://atlassian.github.io/atlassian-mcp-server/",
    note: "Die Organisation kann den Zugriff auf ihre Atlassian-Produkte beschränken.",
  },
  {
    id: "todoist",
    name: "Todoist",
    url: "https://ai.todoist.net/mcp",
    category: "Aufgaben & Wissen",
    description: "Aufgaben, Termine und Projekte organisieren.",
    source: "https://developer.todoist.com/api/v1/",
  },
  {
    id: "clickup",
    name: "ClickUp",
    url: "https://mcp.clickup.com/mcp",
    category: "Aufgaben & Wissen",
    description: "Aufgaben, Listen, Dokumente und Zeiterfassung verbinden.",
    source: "https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server",
    note: "Beta. Verfügbare Aufrufe hängen vom ClickUp-Tarif ab.",
  },
  {
    id: "airtable",
    name: "Airtable",
    url: "https://mcp.airtable.com/mcp",
    category: "Datenbanken",
    description: "Bases durchsuchen, Datensätze bearbeiten und Informationen auswerten.",
    source: "https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server",
    note: "In verwalteten Organisationen muss Anvil gegebenenfalls freigegeben werden.",
  },
  {
    id: "canva",
    name: "Canva",
    url: "https://mcp.canva.com/mcp",
    category: "Design & Websites",
    description: "Designs suchen, erstellen und für die weitere Arbeit exportieren.",
    source: "https://www.canva.dev/docs/mcp/",
  },
  {
    id: "miro",
    name: "Miro",
    url: "https://mcp.miro.com/",
    category: "Design & Websites",
    description: "Boards, Planung und visuelle Zusammenarbeit mit Anvil verbinden.",
    source: "https://developers.miro.com/docs/miro-mcp-server-frequently-asked-questions",
    note: "Bei der Anmeldung ein Team wählen. Dessen Administration muss MCP gegebenenfalls aktivieren.",
  },
  {
    id: "webflow",
    name: "Webflow",
    url: "https://mcp.webflow.com/mcp",
    category: "Design & Websites",
    description: "Websites und CMS-Inhalte in Webflow verwalten.",
    source: "https://developers.webflow.com/mcp/reference/getting-started",
    note: "Für Arbeit direkt im Designer muss zusätzlich die Webflow MCP Bridge App im Designer geöffnet sein.",
  },
  {
    id: "intercom",
    name: "Intercom (USA)",
    url: "https://mcp.intercom.com/mcp",
    category: "Kommunikation & Kunden",
    description: "Supportgespräche, Kontakte und Hilfeartikel nutzen.",
    source: "https://developers.intercom.com/docs/guides/mcp",
    note: "Für Workspaces in der US-Datenregion. Für europäische Konten Intercom (EU) wählen.",
  },
  {
    id: "intercom-eu",
    name: "Intercom (EU)",
    url: "https://mcp.eu.intercom.com/mcp",
    category: "Kommunikation & Kunden",
    description: "Supportgespräche, Kontakte und Hilfeartikel aus europäischen Workspaces nutzen.",
    source: "https://developers.intercom.com/docs/guides/mcp",
    note: "Für Workspaces in der EU-Datenregion. Australische Workspaces werden noch nicht unterstützt.",
  },
  {
    id: "figma",
    name: "Figma",
    url: "https://mcp.figma.com/mcp",
    category: "Design & Websites",
    description: "Entwürfe und Designkontext für die Umsetzung in Anvil nutzen.",
    source: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/",
    setupRequired:
      "Figma muss Anvil zuerst als unterstützten MCP-Client freischalten. Die Aufnahme erfolgt über den Anbieter.",
  },
  {
    id: "asana",
    name: "Asana",
    url: "https://mcp.asana.com/v2/mcp",
    category: "Aufgaben & Wissen",
    description: "Aufgaben, Projekte und Teamarbeit verbinden.",
    source: "https://developers.asana.com/docs/connecting-mcp-clients-to-asanas-v2-server",
    setupRequired:
      "Asana benötigt eine eigene registrierte OAuth-App mit Client-ID und Secret. Diese zusätzliche Anmeldelogik fehlt in Anvil noch.",
  },
  {
    id: "monday",
    name: "monday.com",
    url: "https://mcp.monday.com/mcp",
    category: "Aufgaben & Wissen",
    description: "Boards, Aufgaben und Arbeitsabläufe verbinden.",
    source: "https://developer.monday.com/api-reference/docs/mcp-dynamic-client-registration",
    setupRequired:
      "monday.com muss die Anvil-Integration vor ihrer öffentlichen Bereitstellung prüfen und freigeben. Danach kann die automatische Anmeldung genutzt werden.",
  },
  {
    id: "slack",
    name: "Slack",
    url: "https://mcp.slack.com/mcp",
    category: "Kommunikation & Kunden",
    description: "Nachrichten, Kanäle und Teamwissen einbinden.",
    source: "https://docs.slack.dev/ai/slack-mcp-server",
    setupRequired:
      "Slack verlangt eine eigene zugelassene oder interne App mit Client-ID und Secret. Dafür braucht Anvil zusätzliche Anmeldelogik.",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    url: "https://mcp.hubspot.com/",
    category: "Kommunikation & Kunden",
    description: "Kontakte, Unternehmen, Deals und Kundenarbeit verbinden.",
    source:
      "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server",
    setupRequired:
      "Eine eigene HubSpot MCP Auth App und die Verarbeitung ihres Client-Secrets müssen zuerst eingerichtet werden.",
  },
  {
    id: "box",
    name: "Box",
    url: "https://mcp.box.com/",
    category: "Dateien & Office",
    description: "Dateien und Dokumente im Box-Arbeitsbereich verwenden.",
    source: "https://developer.box.com/guides/box-mcp/setup",
    setupRequired:
      "Eine Administration muss eine Box-MCP-Integration anlegen. Client-ID und Secret benötigen zusätzliche Unterstützung in Anvil.",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    url: "https://mcp.dropbox.com/mcp",
    category: "Dateien & Office",
    description: "Dateien suchen, lesen und verwalten.",
    source: "https://help.dropbox.com/integrations/connect-dropbox-mcp-server",
    setupRequired:
      "Für Anvil als eigenen Client ist eine Dropbox-App mit App-Key, Secret und Rücksprungadresse erforderlich. Die zusätzliche Anmeldung ist noch einzubauen.",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    url: "https://drivemcp.googleapis.com/mcp/v1",
    category: "Dateien & Office",
    description: "Dateien und Dokumente in Google Drive verwenden.",
    source: "https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en",
    setupRequired:
      "Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil.",
  },
  {
    id: "gmail",
    name: "Gmail",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    category: "Kommunikation & Kunden",
    description: "E-Mails und Postfacharbeit verbinden.",
    source: "https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en",
    setupRequired:
      "Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil.",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    category: "Dateien & Office",
    description: "Kalender und Termine einbinden.",
    source: "https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en",
    setupRequired:
      "Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil.",
  },
  {
    id: "google-chat",
    name: "Google Chat",
    url: "https://chatmcp.googleapis.com/mcp/v1",
    category: "Kommunikation & Kunden",
    description: "Unterhaltungen und Teamkommunikation verbinden.",
    source: "https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en",
    setupRequired:
      "Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil.",
  },
  {
    id: "google-contacts",
    name: "Google Kontakte",
    url: "https://people.googleapis.com/mcp/v1",
    category: "Kommunikation & Kunden",
    description: "Kontaktinformationen für die tägliche Arbeit verwenden.",
    source: "https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli?hl=en",
    setupRequired:
      "Google verlangt Zugang zur Workspace-MCP-Vorschau sowie ein Cloud-Projekt mit eigener OAuth-App. Diese Anmeldung benötigt zusätzliche Unterstützung in Anvil.",
  },
  ...INFRA_SERVICE_PROVIDERS,
  ...GAME_SERVICE_PROVIDERS,
];
