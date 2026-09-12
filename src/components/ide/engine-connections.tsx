import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { uniqueMcpName } from "@/lib/mcp";
import { ENGINE_INTEGRATIONS, createEngineIntegration } from "@/lib/engine-integrations";

const field =
  "w-full min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] text-fg";
export function EngineConnections() {
  const [id, setId] = useState("unity-official");
  const [program, setProgram] = useState("");
  const [cwd, setCwd] = useState("");
  const [message, setMessage] = useState("");
  const chosen = ENGINE_INTEGRATIONS.find((item) => item.id === id) || ENGINE_INTEGRATIONS[0];
  return (
    <details className="m-3 rounded-md border border-border p-3 text-[11px]">
      <summary className="cursor-pointer font-semibold">Engines & 3D-Werkzeuge</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted">
          Lokale Editor-Erweiterungen und Asset-Werkzeuge ergänzen die Cloud-Dienste. Sie benötigen
          die unten genannte Einrichtung.
        </p>
        <label className="block space-y-1">
          <span>Erweiterung</span>
          <select
            className={field}
            aria-label="Engine-Erweiterung auswählen"
            value={chosen.id}
            onChange={(e) => {
              setId(e.target.value);
              setProgram("");
              setCwd("");
              setMessage("");
            }}
          >
            {ENGINE_INTEGRATIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <p>{chosen.description}</p>
        <p className="text-muted">{chosen.maintainer}</p>
        <ul className="list-disc space-y-1 pl-4 text-muted">
          {chosen.requirements.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <a className="inline-block underline" href={chosen.source} target="_blank" rel="noreferrer">
          Einrichtung beim Anbieter
        </a>
        {chosen.programRequired && (
          <label className="block space-y-1">
            <span>Vollständiger Programmpfad</span>
            <input
              className={field}
              aria-label="Engine-Erweiterung: Programm"
              value={program}
              onChange={(e) => setProgram(e.target.value)}
              placeholder="Pfad zum installierten Verbindungsprogramm"
            />
          </label>
        )}
        {chosen.cwdRequired && (
          <label className="block space-y-1">
            <span>Ordner des Verbindungsprogramms</span>
            <input
              className={field}
              aria-label="Engine-Erweiterung: Arbeitsordner"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="Ordner mit unreal_mcp_server.py"
            />
          </label>
        )}
        <Button
          className="h-auto min-h-7 w-full whitespace-normal px-2 py-1 text-[11px]"
          onClick={() => {
            try {
              const draft = createEngineIntegration(chosen.id, { program, cwd });
              const st = useIde.getState();
              draft.name = uniqueMcpName(st.mcpServers, draft.name, draft.id);
              st.setMcpServers([...st.mcpServers, draft]);
              setMessage(
                "Deaktiviert unter MCP vorbereitet. Dort Einrichtung prüfen, bei Bedarf Zugangsschlüssel eintragen und erst dann aktivieren.",
              );
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          In MCP vorbereiten
        </Button>
        <p className="text-muted">
          Vorbereiten installiert und startet nichts. Beim späteren Aktivieren können Pakete geladen
          und Programme gestartet werden. Schlüssel gehören ausschließlich in den Schlüsselspeicher
          unter MCP.
        </p>
        {message && <p role="status">{message}</p>}
        <Button
          variant="quiet"
          className="h-7 text-[11px]"
          onClick={() => useIde.getState().setSidebar("mcp")}
        >
          MCP-Verbindungen öffnen
        </Button>
      </div>
    </details>
  );
}
