import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { uniqueMcpName } from "@/lib/mcp";
import { ENGINE_INTEGRATIONS, createEngineIntegration } from "@/lib/engine-integrations";

const field =
  "w-full min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] text-fg";
export function EngineConnections() {
  const busy = useIde(state => state.agentBusy || Boolean(state.pathOperation));
  const [id, setId] = useState("unity-official");
  const [program, setProgram] = useState("");
  const [cwd, setCwd] = useState("");
  const [message, setMessage] = useState("");
  const chosen = ENGINE_INTEGRATIONS.find((item) => item.id === id) || ENGINE_INTEGRATIONS[0];
  return (
    <details className="m-3 rounded-md border border-border p-3 text-[11px]" data-testid="engine-connections">
      <summary className="cursor-pointer font-semibold">Engines, 3D & CAD</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted">
          Verbinde Spiele-Editoren, 3D-Werkzeuge und CAD-Programme mit Anvil. Die Vorlagen
          bereiten die Verbindung vor; Programme und Add-ons benötigen die unten genannte Einrichtung.
        </p>
        <label className="block space-y-1">
          <span>Erweiterung</span>
          <select
            className={field}
            aria-label="Engine-, 3D- oder CAD-Erweiterung auswählen"
            value={chosen.id}
            onChange={(e) => {
              setId(e.target.value);
              setProgram("");
              setCwd("");
              setMessage("");
            }}
          >
            {([['engine', 'Spiele-Engines'], ['3d', '3D & Assets'], ['cad', 'CAD & Konstruktion']] as const).map(([category, title]) => <optgroup key={category} label={title}>{ENGINE_INTEGRATIONS.filter(item => (item.category || 'engine') === category).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}</optgroup>)}
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
          Anleitung des Projekts
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
          disabled={busy}
          className="h-auto min-h-7 w-full whitespace-normal px-2 py-1 text-[11px]"
          onClick={() => {
            try {
              const draft = createEngineIntegration(chosen.id, { program, cwd });
              const st = useIde.getState();
              draft.name = uniqueMcpName(st.mcpServers, draft.name, draft.id);
              st.setMcpServers([...st.mcpServers, draft]);
              setMessage(
                "Die Verbindung wurde unter MCP angelegt und ist noch deaktiviert. Prüfe dort die Einrichtung, ergänze bei Bedarf einen Zugangsschlüssel und aktiviere die Verbindung anschließend.",
              );
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          In MCP vorbereiten
        </Button>
        {chosen.example && <div className="space-y-2 border-t border-border pt-2">
          <p className="font-semibold">Erste Aufgabe</p>
          <p className="text-muted">Nach der Einrichtung: Modell erstellen, Maße und Ansicht prüfen, als neue Datei speichern. Änderungen in Blender oder CAD werden nicht automatisch durch Anvils Projektrücksetzung rückgängig gemacht.</p>
          <Button className="h-auto min-h-7 w-full whitespace-normal px-2 py-1 text-[11px]" disabled={busy} onClick={() => {
            const state = useIde.getState();
            if (!state.agentDraft.includes(chosen.example!)) state.setAgentDraft([state.agentDraft, chosen.example].filter(Boolean).join("\n\n"));
            setMessage("Beispiel zum Chat-Entwurf hinzugefügt. Ergänze dein Speicherziel und sende den Auftrag nach der Einrichtung. Es wurde noch nichts ausgeführt.");
          }}>Beispiel zum Chat hinzufügen</Button>
        </div>}
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
