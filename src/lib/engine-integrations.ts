import type { McpServer } from "./mcp";

export type EngineIntegration = {
  id: string;
  name: string;
  description: string;
  source: string;
  maintainer: string;
  requirements: string[];
  command: string;
  args: string[];
  programRequired?: boolean;
  cwdRequired?: boolean;
};

// Maintainer documentation checked 2026-09-12. These are setup templates,
// not installed tools or evidence that an editor connection has been tested.
export const ENGINE_INTEGRATIONS: EngineIntegration[] = [
  {
    id: "unity-official",
    name: "Unity MCP – offiziell",
    description:
      "Unity-Projekte, Szenen, GameObjects und Konsolenausgaben über Unitys eigene Editor-Brücke bearbeiten.",
    source:
      "https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.5/manual/integration/unity-mcp-get-started.html",
    maintainer: "Unity Technologies",
    requirements: [
      "Unity 6 oder neuer mit dem Paket com.unity.ai.assistant; die Unity-MCP-Brücke muss im geöffneten Projekt laufen.",
      "Den vollständigen Pfad des installierten Unity-Relays wählen. Unter Windows liegt es normalerweise unter %USERPROFILE%\\.unity\\relay\\relay_win.exe.",
      "Die erste Verbindung in Unity unter Projekteinstellungen → AI → Unity MCP bestätigen.",
      "Die Vorlage installiert weder Unity noch das AI-Paket. Die Unity-MCP-Nutzung selbst verbraucht laut Unity keine AI-Credits.",
    ],
    command: "",
    args: ["--mcp"],
    programRequired: true,
  },
  {
    id: "unity-coplay",
    name: "MCP for Unity – Coplay",
    description:
      "Szenen, C#-Skripte, Assets und Tests im Unity-Editor über die Community-Brücke steuern.",
    source: "https://coplaydev.github.io/unity-mcp/getting-started/install",
    maintainer: "Coplay / Aura · Community, nicht Unity Technologies",
    requirements: [
      "Unity 2021.3 LTS oder neuer, Python 3.10 oder neuer und uv mit erreichbar installiertem uvx.",
      "Das passende MCP-for-Unity-Paket im Unity-Projekt installieren und dessen Verbindung für stdio einrichten; das Projekt muss geöffnet sein.",
      "Beim ersten Start kann uvx den MCP-Server und seine Abhängigkeiten herunterladen. Das Vorbereiten dieser Vorlage startet nichts.",
    ],
    command: "uvx",
    args: [
      "--from",
      "mcpforunityserver",
      "mcp-for-unity",
      "--transport",
      "stdio",
    ],
  },
  {
    id: "godot-coding-solo",
    name: "Godot MCP – Coding-Solo",
    description:
      "Godot-Projekte untersuchen, Szenen und Nodes bearbeiten, Projekte starten und Debugausgaben lesen.",
    source: "https://github.com/Coding-Solo/godot-mcp",
    maintainer: "Coding-Solo · Community, nicht das Godot-Projekt",
    requirements: [
      "Godot muss installiert sein; zusätzlich Node.js 18 oder neuer mit npm und npx.",
      "Bei fehlender automatischer Erkennung GODOT_PATH als Umgebungsvariable der MCP-Verbindung auf die Godot-Programmdatei setzen.",
      "UID-Werkzeuge benötigen Godot 4.4 oder neuer. Diese Brücke verwendet Godots Programmaufrufe und Hilfsskripte; sie ist keine vollständige Live-Editorsteuerung.",
      "Beim ersten Start kann npx das Paket herunterladen. Das Vorbereiten startet oder installiert nichts.",
    ],
    command: "npx",
    args: ["-y", "@coding-solo/godot-mcp"],
  },
  {
    id: "unreal-chongdashu",
    name: "Unreal MCP – chongdashu",
    description:
      "Actors, Blueprints und den Unreal-Editor über ein lokales C++-Plugin und einen Python-MCP-Server bedienen.",
    source: "https://github.com/chongdashu/unreal-mcp",
    maintainer: "chongdashu · Community, nicht Epic Games",
    requirements: [
      "Experimentelles Projekt für Unreal Engine 5.5 oder neuer; Python 3.12 oder neuer und uv erforderlich.",
      "Das UnrealMCP-Plugin aus dem Repository im eigenen Projekt installieren, mit der passenden C++-Werkzeugkette kompilieren und im Editor aktivieren.",
      "Als Arbeitsordner den Python-Unterordner des heruntergeladenen unreal-mcp-Repositories wählen. Dort muss unreal_mcp_server.py liegen.",
      "Der Plugin-Port 55557 ist eine interne TCP-Verbindung, keine MCP-HTTP-Adresse. Der Editor mit dem vorbereiteten Projekt muss geöffnet sein.",
    ],
    command: "uv",
    args: ["run", "unreal_mcp_server.py"],
    cwdRequired: true,
  },
  {
    id: "blender-mcp",
    name: "Blender MCP",
    description:
      "3D-Modelle, Materialien und Szenen in Blender vorbereiten und für Unity, Unreal oder Godot exportieren.",
    source: "https://github.com/ahujasid/blender-mcp",
    maintainer: "Siddharth Ahuja · Community, nicht die Blender Foundation",
    requirements: [
      "Blender 3 oder neuer, Python 3.10 oder neuer und uv mit uvx.",
      "Das zugehörige Blender-Addon installieren, aktivieren und im Blender-Seitenbereich den MCP-Server starten.",
      "Die Brücke kann Python in Blender ausführen. Änderungen am Modell erst am gewünschten Projekt vornehmen; nur eine MCP-Serverinstanz gleichzeitig betreiben.",
      "Mit DISABLE_TELEMETRY=true in den Umgebungsvariablen lässt sich die dokumentierte Telemetrie ausschalten. Die Vorlage setzt keine Umgebungsvariablen automatisch.",
      "Optionale Asset-Dienste benötigen eigene Zugänge und können Kosten verursachen. API-Schlüssel ausschließlich im Schlüsselspeicher der MCP-Verbindung hinterlegen.",
    ],
    command: "uvx",
    args: ["blender-mcp"],
  },
  {
    id: "meshy-mcp",
    name: "Meshy – 3D-Assets",
    description:
      "3D-Assets aus Text oder Bildern erzeugen, überarbeiten und herunterladen; für den Engine-Import anschließend prüfen.",
    source: "https://docs.meshy.ai/en/api/ai",
    maintainer: "Meshy · offizieller MCP-Server",
    requirements: [
      "Node.js 18 oder neuer mit npm und npx; Meshy-Konto mit API-Zugang und verfügbarem Guthaben.",
      "MESHY_API_KEY ausschließlich als geschützte Umgebungsvariable im Schlüsselspeicher der MCP-Verbindung hinterlegen, niemals in Programmargumenten oder Projektdateien.",
      "Generierung und weitere kostenpflichtige Vorgänge verbrauchen Meshy-API-Credits. Eine normale Browser-Anmeldung ersetzt den API-Schlüssel hier nicht.",
      "Beim ersten Start kann npx den offiziellen MCP-Server herunterladen. Diese Vorlage lädt nichts herunter und erzeugt keine Assets.",
    ],
    command: "npx",
    args: ["-y", "@meshy-ai/meshy-mcp-server"],
  },
  {
    id: "tripo-mcp",
    name: "Tripo – Blender-Assets",
    description:
      "3D-Assets über Tripo erzeugen und in Blender importieren, um sie für das Engine-Projekt aufzubereiten.",
    source: "https://github.com/VAST-AI-Research/tripo-mcp",
    maintainer: "VAST / Tripo · offizieller MCP-Server",
    requirements: [
      "Alpha-Version; unterstützt laut Maintainer derzeit die Tripo-Blender-Addon-Integration.",
      "Python 3.10 oder neuer, uv mit uvx, Blender und das offizielle Tripo-AI-Blender-Addon installieren und dessen MCP-Verbindung starten.",
      "Tripo-Zugang im vorgesehenen Anbieter-Addon einrichten. Generierung nutzt dessen externe API und kann Tripo-Credits verbrauchen.",
      "Keine Zugangsdaten in Programmargumente oder Projektdateien schreiben; für MCP-Umgebungsvariablen ausschließlich den Schlüsselspeicher verwenden.",
    ],
    command: "uvx",
    args: ["tripo-mcp"],
  },
];

function absoluteSetupPath(value: string | undefined, label: string) {
  const path = value?.trim() || "";
  if (
    !path ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/i.test(path)
  ) {
    throw new Error(`${label}: Bitte einen vollständigen absoluten Pfad angeben.`);
  }
  return path;
}

/** Creates an inactive configuration only; never installs or starts a server. */
export function createEngineIntegration(
  id: string,
  options: { program?: string; cwd?: string } = {},
): McpServer {
  const integration = ENGINE_INTEGRATIONS.find((entry) => entry.id === id);
  if (!integration) throw new Error("Unbekannte Engine-Erweiterung.");
  const command = integration.programRequired
    ? absoluteSetupPath(options.program, "Programm")
    : integration.command;
  const cwd = integration.cwdRequired
    ? absoluteSetupPath(options.cwd, "Arbeitsordner")
    : undefined;
  return {
    id: `mcp:${crypto.randomUUID()}`,
    name: integration.name,
    url: "",
    enabled: false,
    transport: "stdio",
    command,
    args: [...integration.args],
    ...(cwd ? { cwd } : {}),
  };
}
