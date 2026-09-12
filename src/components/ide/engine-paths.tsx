import { useState } from "react";
import { Button } from "@/components/ui/button";
import { companionEnginePaths, type EnginePaths } from "@/lib/companion";
import { withCompanion } from "@/lib/companion-life";

export function EnginePathsSetup({ base }: { base: string }) {
  const [configured, setConfigured] = useState<EnginePaths>({ godot: "", unity: "", unreal: "" });
  const [bins, setBins] = useState<Record<string, string | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function request(save: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const result = await withCompanion(
        () => companionEnginePaths(base, save ? configured : undefined),
        base,
      );
      setConfigured(result.configured);
      setBins(result.bins);
      setLoaded(true);
      setMessage(
        save
          ? "Engine-Pfade gespeichert. Es wurde kein Editor gestartet."
          : "Programme geprüft. Ein gefundenes Programm bestätigt noch keinen erfolgreichen Projekttest.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="my-3 rounded-md border border-border p-3 text-xs">
      <summary className="cursor-pointer font-medium">Unity, Unreal & Godot einrichten</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted">
          Hier den installierten Editor wählen, wenn Anvil ihn nicht automatisch findet. Der Pfad
          gilt auf dem Rechner des Companion. Ein leeres Feld verwendet die automatische Suche.
        </p>
        {(
          [
            ["godot", "Godot"],
            ["unity", "Unity"],
            ["unreal", "Unreal Engine"],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className="block space-y-1">
            <span>{label}</span>
            <input
              className="w-full min-w-0 rounded border border-border bg-bg px-2 py-1 text-fg"
              aria-label={`${label}: Editorpfad`}
              disabled={!loaded || busy}
              value={configured[id] || ""}
              onChange={(e) => setConfigured({ ...configured, [id]: e.target.value })}
              placeholder="Vollständiger Pfad zur Editor-Datei"
            />
            {loaded && (
              <span className="block break-all text-muted">
                {bins[id === "unreal" ? "UnrealEditor" : id] || "Editor nicht gefunden"}
              </span>
            )}
          </label>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button className="h-7 text-xs" disabled={busy} onClick={() => void request(false)}>
            Engine-Pfade prüfen
          </Button>
          <Button
            className="h-7 text-xs"
            disabled={!loaded || busy}
            onClick={() => void request(true)}
          >
            Engine-Pfade speichern
          </Button>
        </div>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
