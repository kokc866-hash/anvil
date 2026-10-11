import type { McpServer } from "./mcp";
import { hasAsciiControl } from "../../electron/text-controls.mjs";

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
  category?: "3d" | "cad";
  example?: string;
};

// Engine documentation checked 2026-09-12; Blender/CAD refreshed 2026-09-30.
// These are setup templates,
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
    name: "Blender – MCP for Blender",
    category: "3d",
    description:
      "3D-Modelle, Materialien und Szenen in Blender vorbereiten und für Unity, Unreal oder Godot exportieren.",
    source: "https://github.com/ahujasid/mcp-for-blender",
    maintainer: "Siddharth Ahuja · Community, nicht die Blender Foundation",
    requirements: [
      "Blender 3 oder neuer, Python 3.10 oder neuer und uv mit uvx.",
      "Das aktuelle Addon aus demselben Projekt installieren und in Blender unter Add-ons → Interface: MCP for Blender aktivieren. Im Seitenbereich den MCP-Server starten und Blender geöffnet lassen.",
      "Die Brücke kann Python in Blender ausführen. Änderungen am Modell erst am gewünschten Projekt vornehmen; nur eine MCP-Serverinstanz gleichzeitig betreiben.",
      "Mit DISABLE_TELEMETRY=true in den Umgebungsvariablen lässt sich die dokumentierte Telemetrie ausschalten. Die Vorlage setzt keine Umgebungsvariablen automatisch.",
      "Optionale Asset-Dienste benötigen eigene Zugänge und können Kosten verursachen. API-Schlüssel ausschließlich im Schlüsselspeicher der MCP-Verbindung hinterlegen.",
      "Die Vorlage verwendet den aktuellen Paketnamen mcp-for-blender. Vorhandene Verbindungen und Add-ons werden nicht automatisch geändert. Codex-spezifische eingebettete Ansichten werden nicht übernommen.",
    ],
    command: "uvx",
    args: ["mcp-for-blender"],
    example: "Verwende die eingerichtete Blender-MCP-Verbindung. Prüfe zuerst, ob Blender erreichbar ist. Erstelle in einer neuen Szene einen einfachen Tisch, prüfe Abmessungen und Materialien und zeige eine Ansicht. Speichere eine neue .blend-Datei und exportiere eine GLB-Datei in meinen gewählten Projektordner. Bestehende Dateien nicht überschreiben. Berichte nur tatsächlich ausgeführte Prüfungen. Fehlt die Verbindung oder ein Speicherziel, erkläre zuerst, was benötigt wird.",
  },
  {
    id: "freecad-mcp",
    name: "FreeCAD – parametrische Konstruktion",
    category: "cad",
    description: "Technische Bauteile in FreeCAD erstellen, Eigenschaften ändern und das Dokument sowie seine Ansicht prüfen.",
    source: "https://github.com/neka-nat/freecad-mcp",
    maintainer: "neka-nat · Community, nicht das FreeCAD-Projekt",
    requirements: [
      "FreeCAD, uv mit uvx und Python 3.12 oder neuer für den MCP-Server. FreeCAD verwendet seine eigene Python-Laufzeit; dort das Serverpaket nicht installieren.",
      "Den Ordner addon/FreeCADMCP aus dem Repository in das Mod-Verzeichnis der verwendeten FreeCAD-Installation kopieren. FreeCAD neu starten, die Arbeitsumgebung MCP Addon wählen und Start RPC Server anklicken.",
      "FreeCAD mit dem vorbereiteten Addon geöffnet lassen. Der interne RPC-Port 9875 ist keine MCP-HTTP-Adresse; die Verbindung wird hier als lokaler Prozess angelegt.",
      "Addon und Server müssen zueinander passen. Die Werkzeuge können Python ausführen und Dokumente verändern. Vor Änderungen das gewünschte Dokument prüfen und eine eigene Sicherung speichern.",
      "Beim ersten Aktivieren kann uvx das Paket freecad-mcp und dessen Abhängigkeiten herunterladen. FEM benötigt zusätzliche Solver und wird durch diese Vorlage nicht eingerichtet.",
    ],
    command: "uvx",
    args: ["freecad-mcp"],
    example: "Verwende die eingerichtete FreeCAD-MCP-Verbindung und prüfe zuerst ihren Status. Konstruiere in einem neuen Dokument eine parametrische Montageplatte: 80 × 50 × 3 mm, vier durchgehende Bohrungen mit 3,2 mm Durchmesser, jeweils 10 mm von den beiden angrenzenden Kanten entfernt. Prüfe nach der Neuberechnung die tatsächlichen Maße, Bohrungen und Gültigkeit des Volumenkörpers und zeige eine Ansicht. Speichere eine neue FCStd-Datei und exportiere STEP in meinen gewählten Projektordner. Bestehende Dokumente und Dateien nicht überschreiben. Einheiten und Prüfergebnisse nennen; fehlende Verbindung oder Speicherziele zuerst klären.",
  },
  {
    id: "openscad-mcp",
    name: "OpenSCAD – Konstruktion mit Code",
    category: "cad",
    description: "Parametrische Bauteile aus OpenSCAD-Code erstellen, Geometrie prüfen, Ansichten rendern und Modelle exportieren.",
    source: "https://github.com/RobertCoop/openscad-mcp",
    maintainer: "RobertCoop · Community, nicht das OpenSCAD-Projekt",
    requirements: [
      "OpenSCAD 2021.01 oder neuer, Python 3.10 oder neuer und uv mit uvx installieren. Ein geöffnetes OpenSCAD-Fenster ist für die Kommandozeilen-Werkzeuge nicht erforderlich.",
      "Wenn OpenSCAD nicht gefunden wird, OPENSCAD_PATH unter MCP als Umgebungsvariable auf die installierte Programmdatei setzen. Das Verbindungsprogramm bleibt uvx, nicht openscad.exe.",
      "Die Vorlage startet das Paket openscad-mcp von RobertCoop. Das ähnlich benannte Paket openscad-mcp-server gehört zu einer anderen Anbindung.",
      "Modelldateien und Exportziele im gewünschten Projekt festlegen. Nach dem Rendern auch Fehlermeldungen und Geometrie prüfen: OpenSCAD kann trotz eines Modellfehlers den Prozess erfolgreich beenden.",
      "Beim ersten Aktivieren kann uvx Server und Abhängigkeiten herunterladen. Ansichten und Exporte benötigen eine funktionsfähige lokale OpenSCAD-Installation.",
    ],
    command: "uvx",
    args: ["openscad-mcp"],
    example: "Verwende die eingerichtete OpenSCAD-MCP-Verbindung. Erstelle eine neue parametrische .scad-Datei für eine Montageplatte: 80 × 50 × 3 mm, vier durchgehende Bohrungen mit 3,2 mm Durchmesser, jeweils 10 mm von den angrenzenden Kanten entfernt. Verwende Millimeter und benannte Parameter. Prüfe Syntax, Fehlermeldungen und gemessene Geometrie, rendere eine Ansicht und exportiere STL in meinen gewählten Projektordner. Bestehende Dateien nicht überschreiben. Melde nur belegte Prüfergebnisse; ein erfolgreicher Prozess allein bestätigt noch kein korrektes Modell. Fehlt die Verbindung oder ein Speicherziel, kläre das zuerst.",
  },
  {
    id: "meshy-mcp",
    category: "3d",
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
    category: "3d",
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
    hasAsciiControl(path, true) ||
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
