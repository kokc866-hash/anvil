import { useRef, useState, useEffect } from "react";
import { useIde } from "@/store/ide";

type Result = {
  ok: boolean;
  error?: string;
  value?: {
    agentInfo?: { name?: string; version?: string };
    agentCapabilities?: unknown;
    authMethods?: unknown;
    scope: string;
  };
};
type Api = {
  acpProbe: (request: { id: string; command: string; args: string[] }) => Promise<Result>;
  acpCancel: () => Promise<unknown>;
};
function api(): Api | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as { anvilNative?: Api }).anvilNative;
}
export function AcpPreview() {
  const [command, setCommand] = useState(""),
    [args, setArgs] = useState("[]"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<Result | null>(null);
  const alive = useRef(true),
    running = useRef(false);
  const blocked = useIde((s) => s.agentBusy || Boolean(s.pathOperation));
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (running.current) void api()?.acpCancel();
    };
  }, []);
  async function probe() {
    const native = api();
    if (!native?.acpProbe || busy || blocked) return;
    setResult(null);
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== "string"))
        throw Error("Argumente als Liste von Texten eintragen.");
      setBusy(true);
      running.current = true;
      const next = await native.acpProbe({ id: crypto.randomUUID(), command, args: parsed });
      if (alive.current) setResult(next);
    } catch (error) {
      if (alive.current)
        setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="my-2 rounded border border-border p-2 text-xs">
      <summary className="cursor-pointer font-medium">Externe Agenten · ACP-Vorschau</summary>
      <p className="my-2 text-muted">
        Prüft die Protokollverbindung eines bereits installierten, vertrauenswürdigen Agenten.
        Startet dessen Programm in einem leeren Prüfungsordner; sendet keinen Modellauftrag und
        keine Projektdateien. Dies ist noch kein zusätzlicher Agent-Modus. Das externe Programm
        läuft mit deinen Benutzerrechten.
      </p>
      <label className="block">
        Programmpfad
        <input
          aria-label="ACP-Programmpfad"
          value={command}
          disabled={busy}
          onChange={(e) => {
            setCommand(e.target.value);
            setResult(null);
          }}
          className="my-1 w-full rounded border border-border bg-bg p-2"
          placeholder="Absoluter Pfad zur EXE"
        />
      </label>
      <label className="block">
        Argumente (JSON-Liste)
        <input
          aria-label="ACP-Argumente"
          value={args}
          disabled={busy}
          onChange={(e) => {
            setArgs(e.target.value);
            setResult(null);
          }}
          className="my-1 w-full rounded border border-border bg-bg p-2"
        />
      </label>
      <button
        type="button"
        disabled={busy || blocked || !command.trim() || !api()?.acpProbe}
        onClick={() => void probe()}
        className="rounded border border-border px-2 py-1 disabled:opacity-50"
      >
        ACP-Verbindung prüfen
      </button>
      {busy ? (
        <button
          type="button"
          onClick={() => void api()?.acpCancel()}
          className="ml-2 rounded border border-border px-2 py-1"
        >
          Abbrechen
        </button>
      ) : null}
      {result ? (
        <div role="status" className="mt-2 whitespace-pre-wrap break-words text-muted">
          {result.ok
            ? `ACP-Initialisierung erfolgreich: ${result.value?.agentInfo?.name || "Agent"}\nEine Anmeldung und Modellantwort sind damit noch nicht geprüft.\nGemeldete Fähigkeiten:\n${JSON.stringify(result.value?.agentCapabilities ?? {}, null, 2)}`
            : result.error}
        </div>
      ) : null}
    </details>
  );
}
