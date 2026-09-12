import type { ServiceProvider } from "./service-providers";

export const GAME_SERVICE_PROVIDERS: ServiceProvider[] = [
  {
    id: "ai-game-developer",
    name: "AI Game Developer · Unity, Unreal & Godot",
    url: "https://ai-game.dev/mcp",
    category: "Spiele & 3D",
    description: "Engine-Projekte über das verbundene Editor-Plugin bearbeiten und prüfen.",
    source: "https://github.com/IvanMurzak/Unity-MCP",
    note: "Community-Anbieter. Das passende Unity-, Unreal- oder Godot-Plugin muss installiert, am Cloud-Hub angemeldet und im geöffneten Projekt verbunden sein. Godot benötigt die .NET-Ausgabe ab 4.3 und .NET 8; Unreal ab 5.5 ein C++-fähiges Projekt. Die Cloud-Verbindung kann Projektinhalte übertragen. Eine Anmeldung allein verbindet noch keinen Editor.",
  },
  {
    id: "context7",
    name: "Context7",
    url: "https://mcp.context7.com/mcp/oauth",
    category: "Code & Qualität",
    description:
      "Dokumentation und Beispiele zu Engines, Bibliotheken und verwendeten Paketen nachschlagen.",
    source: "https://context7.com/docs/resources/all-clients",
    note: "Die passende Bibliothek und Version wählen. Dokumentationszugriff steuert keinen Engine-Editor.",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    url: "https://api.us.elevenlabs.io/v1/mcp",
    category: "Spiele & 3D",
    description: "Sprachausgabe für Figuren und Dialoge erzeugen und Sprachagenten verwalten.",
    source: "https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp",
    setupRequired:
      "ElevenLabs benötigt eine registrierte Client-ID oder veröffentlichte Anvil-Client-Metadaten. Die automatische Registrierung unseres bisherigen Anmeldewegs wird nicht angeboten. Spracherzeugung benötigt außerdem Kontoguthaben.",
  },
];
