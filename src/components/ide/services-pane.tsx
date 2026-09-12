import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ServiceToolPicker } from "./service-tool-picker";
import { EngineConnections } from "./engine-connections";
import { useIde } from "@/store/ide";
import { ANVIL_SURFACE } from "@/lib/surface";
import {
  hasMcpNative,
  mcpAuthStatus,
  mcpCall,
  mcpIsError,
  mcpListError,
  mcpLogin,
  mcpProbe,
  mcpReopenLogin,
  mcpRevision,
  mcpServiceCatalog,
  mcpSubscribe,
  type McpServer,
  type McpTool,
} from "@/lib/mcp";
import {
  SERVICE_PROVIDERS,
  createService,
  disconnectService,
  updateService,
} from "@/lib/mcp-services";

const field =
  "w-full min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] text-fg";
const action = "h-auto min-h-7 max-w-full whitespace-normal px-2 py-1 text-[11px]";
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function argumentsFor(tool: McpTool) {
  const values: Record<string, unknown> = {};
  for (const name of tool.inputSchema?.required || []) {
    const property = tool.inputSchema?.properties?.[name] as Record<string, unknown> | undefined;
    values[name] =
      property?.default ??
      (Array.isArray(property?.enum)
        ? property.enum[0]
        : property?.type === "boolean"
          ? false
          : property?.type === "integer" || property?.type === "number"
            ? 0
            : property?.type === "array"
              ? []
              : property?.type === "object"
                ? {}
                : "");
  }
  return JSON.stringify(values, null, 2);
}

function ServiceConnection({ server }: { server: McpServer }) {
  useSyncExternalStore(mcpSubscribe, mcpRevision, mcpRevision);
  const mode = useIde((s) => s.surfaceMode);
  const active = useIde((s) => s.activeSurfaceId);
  const [storedLogin, setStoredLogin] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState("");
  const [busy, setBusy] = useState("");
  const [loginProgress, setLoginProgress] = useState("");
  const [reopeningLogin, setReopeningLogin] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [toolName, setToolName] = useState("");
  const [argumentsText, setArgumentsText] = useState("{}");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const loginConfirmed = useRef(false);
  const mounted = useRef(true);
  const catalog = mcpServiceCatalog(server);
  const selected = new Set(server.allowedTools || []);
  const availableSelected = catalog.tools.filter((tool) => selected.has(tool.name));
  const chosenTool = availableSelected.find((tool) => tool.name === toolName);
  const catalogError = mcpListError(server.id);

  function current() {
    const latest = useIde.getState().mcpServers.find((item) => item.id === server.id);
    if (!latest) throw new Error("Diese Verbindung wurde entfernt.");
    return latest;
  }
  async function refreshLocalStatus(signal: AbortSignal) {
    try {
      const status = await mcpAuthStatus(current(), signal);
      if (!signal.aborted && mounted.current) {
        setStoredLogin(status.authenticated);
        setStatusError("");
      }
    } catch (failure) {
      if (!signal.aborted && mounted.current) {
        setStoredLogin(null);
        setStatusError(errorText(failure));
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const status = new AbortController();
    setStoredLogin(null);
    setError("");
    setMessage("");
    setResult("");
    setLoginProgress("");
    void refreshLocalStatus(status.signal);
    return () => {
      mounted.current = false;
      status.abort();
      controller.current?.abort();
    };
  }, [server.id, server.url, server.oauthClientId]);
  useEffect(() => {
    setResult("");
    setMessage("");
  }, [server.enabled, JSON.stringify(server.allowedTools), server.allowResources]);
  useEffect(() => {
    if (toolName && !availableSelected.some((tool) => tool.name === toolName)) {
      setToolName("");
      setArgumentsText("{}");
      setResult("");
    }
  }, [toolName, availableSelected.map((tool) => tool.name).join("\n")]);

  async function perform(label: string, operation: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const running = new AbortController();
    controller.current = running;
    loginConfirmed.current = false;
    setBusy(label);
    setLoginProgress("");
    setError("");
    setMessage("");
    setResult("");
    try {
      await operation(running.signal);
      running.signal.throwIfAborted();
    } catch (failure) {
      if (mounted.current)
        setError(
          label === "Anmeldung" && loginConfirmed.current
            ? `Anmeldung gespeichert; Werkzeugkatalog konnte nicht geladen werden. ${
                running.signal.aborted ? "Der Katalogabruf wurde abgebrochen." : errorText(failure)
              } Du kannst „Werkzeuge laden“ erneut versuchen.`
            : running.signal.aborted
              ? label === "Werkzeugaufruf"
                ? "Vorgang abgebrochen. Ein bereits gesendeter Werkzeugaufruf kann beim Dienst trotzdem ausgeführt worden sein."
                : `${label} abgebrochen.`
              : errorText(failure),
        );
    } finally {
      if (controller.current === running) controller.current = null;
      if (mounted.current) {
        setBusy("");
        setLoginProgress("");
        setReopeningLogin(false);
      }
    }
  }
  async function reopenLogin() {
    const running = controller.current;
    if (!running || running.signal.aborted || reopeningLogin || loginConfirmed.current) return;
    setReopeningLogin(true);
    setError("");
    try {
      await mcpReopenLogin(current(), running.signal);
    } catch (failure) {
      if (mounted.current && controller.current === running && !running.signal.aborted)
        setError(errorText(failure));
    } finally {
      if (mounted.current && controller.current === running) setReopeningLogin(false);
    }
  }
  function patch(value: Partial<McpServer>) {
    setResult("");
    setError("");
    setMessage("");
    try {
      updateService(server.id, value);
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  function choose(tool: McpTool) {
    setToolName(tool.name);
    setArgumentsText(argumentsFor(tool));
    setResult("");
    setError("");
  }
  const canConnect = hasMcpNative() && !busy;
  return (
    <section
      aria-label={`Dienst: ${server.name}`}
      className="min-w-0 space-y-3 border-b border-border p-3 text-[11px]"
    >
      <details open className="group/service">
        <summary
          aria-label={`${server.name}: Dienst auf- oder zuklappen`}
          className="flex cursor-pointer list-none items-start gap-2 rounded py-1 text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 transition-transform group-open/service:rotate-90"
          >
            ▸
          </span>
          <span className="min-w-0">
            <span className="block break-words text-xs font-semibold">{server.name}</span>
            <span className="mt-1 block text-[10px] text-muted">
              {busy
                ? `${busy} läuft…`
                : !server.enabled
                  ? "Deaktiviert"
                  : storedLogin
                    ? "Angemeldet"
                    : storedLogin === null
                      ? "Anmeldung wird geprüft…"
                      : "Nicht angemeldet"}
              {catalog.ready
                ? ` · ${availableSelected.length} von ${catalog.tools.length} Werkzeugen freigegeben`
                : ""}
              {error || statusError || catalogError ? " · Hinweis – Details öffnen" : ""}
            </span>
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="mt-1 break-all text-[10px] text-muted">{server.url}</p>
            </div>
            <label className="flex shrink-0 items-center gap-1.5 text-muted">
              <input
                type="checkbox"
                aria-label={`${server.name} aktiv`}
                checked={server.enabled}
                disabled={Boolean(busy)}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              Aktiv
            </label>
          </div>
          <div className="space-y-1 text-muted" aria-live="polite">
            <p>
              {storedLogin === null
                ? "Gespeicherte Anmeldung: noch nicht ermittelt."
                : storedLogin
                  ? "Anmeldung lokal gespeichert."
                  : "Keine Anmeldung gespeichert."}
            </p>
            <p>
              {!server.enabled
                ? "Deaktiviert: Der Agent kann diesen Dienst nicht verwenden."
                : catalog.ready
                  ? `Katalog geladen: ${catalog.tools.length} Werkzeuge angeboten.`
                  : "Werkzeugkatalog noch nicht erfolgreich geladen."}
            </p>
            <p className="text-[10px]">
              Der gespeicherte Login bestätigt keinen aktuellen Zugriff. „Werkzeuge laden“ prüft den
              Dienst.
            </p>
          </div>
          {statusError && (
            <p className="break-words text-danger" role="status">
              Anmeldestatus: {statusError}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button
              className={action}
              disabled={!canConnect}
              onClick={() => {
                patch({ enabled: true });
                setStoredLogin(null);
                void perform("Anmeldung", async (signal) => {
                  try {
                    const login = await mcpLogin(current(), signal, (progress) => {
                      if (!signal.aborted && mounted.current) setLoginProgress(progress);
                    });
                    if (!(login as { authenticated?: boolean } | undefined)?.authenticated)
                      throw new Error(
                        "Der Dienst hat die Anmeldung nicht bestätigt. Bitte erneut anmelden.",
                      );
                    loginConfirmed.current = true;
                    if (!signal.aborted && mounted.current) {
                      setStoredLogin(true);
                      setLoginProgress("Anmeldung gespeichert. Werkzeugkatalog wird geladen…");
                    }
                    await mcpProbe(current(), useIde.getState().mcpServers, signal);
                    if (!signal.aborted && mounted.current)
                      setMessage(
                        "Anmeldung und Katalogabruf erfolgreich. Wähle jetzt die Werkzeuge aus.",
                      );
                  } finally {
                    await refreshLocalStatus(signal);
                  }
                });
              }}
            >
              {storedLogin ? "Erneut anmelden" : "Anmelden"}
            </Button>
            <Button
              className={action}
              disabled={!canConnect || !server.enabled}
              onClick={() =>
                void perform("Werkzeuge laden", async (signal) => {
                  try {
                    await mcpProbe(current(), useIde.getState().mcpServers, signal);
                    if (!signal.aborted && mounted.current)
                      setMessage("Werkzeugkatalog erfolgreich geladen.");
                  } finally {
                    await refreshLocalStatus(signal);
                  }
                })
              }
            >
              Werkzeuge laden
            </Button>
            <Button
              className={action}
              variant="quiet"
              disabled={!canConnect}
              onClick={() =>
                void perform("Abmelden", async () => {
                  await disconnectService(server.id);
                  if (mounted.current) {
                    setStoredLogin(false);
                    setMessage("Abgemeldet. Lokale Zugangsdaten und Werkzeugfreigaben entfernt.");
                  }
                })
              }
            >
              Abmelden
            </Button>
            <Button
              className={action}
              variant="danger"
              disabled={Boolean(busy)}
              onClick={() => setConfirmRemove(true)}
            >
              Verbindung entfernen
            </Button>
          </div>
          {confirmRemove && (
            <div className="space-y-2 rounded-md border border-border bg-bg p-2">
              <p>
                „{server.name}“ aus Anvil entfernen? Die gespeicherte Anmeldung und alle
                Werkzeugfreigaben dieser Verbindung werden gelöscht.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  className={action}
                  variant="danger"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void perform("Entfernen", async () => {
                      await disconnectService(server.id, true);
                    })
                  }
                >
                  Endgültig entfernen
                </Button>
                <Button
                  className={action}
                  variant="quiet"
                  disabled={Boolean(busy)}
                  onClick={() => setConfirmRemove(false)}
                >
                  Behalten
                </Button>
              </div>
            </div>
          )}
          {busy && (
            <div className="flex flex-wrap items-center gap-2" role="status">
              <span className="break-words">{loginProgress || `${busy} läuft…`}</span>
              {busy === "Anmeldung" && !loginConfirmed.current && (
                <>
                  <p className="w-full text-muted">
                    Schließe die Freigabe beim Anbieter ab und kehre anschließend zu Anvil zurück.
                    {server.service === "notion"
                      ? " Landest du nur auf deiner normalen Notion-Seite, öffne die Anmeldeseite hier erneut. "
                      : " Landest du nur auf der normalen Startseite des Dienstes, öffne die Anmeldeseite hier erneut. "}
                    Der laufende Anmeldevorgang bleibt erhalten.
                  </p>
                  <Button
                    className={action}
                    variant="quiet"
                    disabled={reopeningLogin}
                    onClick={() => void reopenLogin()}
                  >
                    {reopeningLogin ? "Anmeldeseite wird geöffnet…" : "Anmeldeseite erneut öffnen"}
                  </Button>
                </>
              )}
              {busy !== "Abmelden" && busy !== "Entfernen" && (
                <Button
                  className={action}
                  variant="quiet"
                  onClick={() => controller.current?.abort()}
                >
                  Abbrechen
                </Button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="whitespace-pre-wrap break-words text-danger">
              {error}
            </p>
          )}
          {!error && catalogError && server.enabled && (
            <p role="alert" className="break-words text-danger">
              Katalog: {catalogError}
            </p>
          )}
          {message && (
            <p role="status" className="break-words text-muted">
              {message}
            </p>
          )}
          <div className="space-y-2">
            <div>
              <h4 className="font-medium text-fg">Werkzeuge für Anvil auswählen</h4>
              <p className="mt-1 text-muted">
                {selected.size} freigegeben. Neue Werkzeuge bleiben ausgeschaltet. Je nach Auswahl
                kann der Dienst Daten lesen oder ändern.
              </p>
            </div>
            {catalog.tools.length > 0 ? (
              <ServiceToolPicker
                name={server.name}
                tools={catalog.tools}
                selected={selected}
                disabled={Boolean(busy) || !server.enabled || !catalog.ready}
                onChange={(names, enabled) => {
                  const next = new Set(current().allowedTools || []);
                  for (const name of names) {
                    if (enabled) next.add(name);
                    else next.delete(name);
                  }
                  patch({ allowedTools: [...next] });
                }}
              />
            ) : (
              <p className="text-muted">
                {catalog.ready
                  ? "Dieser Dienst bietet keine Werkzeuge an."
                  : "Nach dem Anmelden oder Laden erscheint hier die Auswahl."}
              </p>
            )}
            {selected.size > 0 && (
              <Button
                className={action}
                variant="quiet"
                disabled={Boolean(busy)}
                onClick={() => patch({ allowedTools: [] })}
              >
                Alle Werkzeugfreigaben entfernen
              </Button>
            )}
            {catalog.resources.length > 0 && (
              <label className="flex items-start gap-2 text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(server.allowResources)}
                  disabled={Boolean(busy) || !server.enabled}
                  onChange={(e) => patch({ allowResources: e.target.checked })}
                />
                <span>Auch angebotene Ressourcen lesen lassen ({catalog.resources.length}).</span>
              </label>
            )}
            <Button
              className={`${action} w-full`}
              disabled={
                Boolean(busy) || !server.enabled || !catalog.ready || availableSelected.length === 0
              }
              onClick={() => {
                const state = useIde.getState();
                state.setSurfaceMode("bridge");
                state.setActiveSurface(ANVIL_SURFACE);
                setMessage(
                  "Brücke aktiv. Der Agent kann die freigegebenen Werkzeuge zusammen mit Anvils Werkzeugen verwenden.",
                );
              }}
            >
              In Anvil verwenden
            </Button>
            <p className="text-[10px] text-muted">
              {mode === "bridge" && active === ANVIL_SURFACE
                ? "Anvils Brücke ist aktiv. Welche Aktion ausgeführt wird, entscheidet dein Auftrag an den Agenten."
                : "Aktiviert Anvils Brücke für die freigegebenen Dienste. Die Auswahl allein führt keine Aktion aus."}
            </p>
          </div>
          {availableSelected.length > 0 && (
            <details className="rounded-md border border-border p-2">
              <summary className="cursor-pointer font-medium">Werkzeug selbst ausführen</summary>
              <div className="mt-2 space-y-2">
                <p className="text-muted">
                  Dieser Aufruf arbeitet mit deinen echten Daten beim Dienst. Prüfe
                  Werkzeugbeschreibung und Eingaben vor dem Ausführen.
                </p>
                <select
                  className={field}
                  aria-label={`${server.name}: Werkzeug ausführen`}
                  value={toolName}
                  disabled={Boolean(busy)}
                  onChange={(e) => {
                    const tool = availableSelected.find((item) => item.name === e.target.value);
                    if (tool) choose(tool);
                    else setToolName("");
                  }}
                >
                  <option value="">Werkzeug wählen</option>
                  {availableSelected.map((tool) => (
                    <option key={tool.name} value={tool.name}>
                      {tool.name}
                    </option>
                  ))}
                </select>
                {chosenTool && (
                  <>
                    <p className="whitespace-pre-wrap break-words text-muted">
                      {chosenTool.description}
                    </p>
                    <details>
                      <summary className="cursor-pointer text-muted">
                        Erwartete Eingaben anzeigen
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                        {JSON.stringify(chosenTool.inputSchema || { type: "object" }, null, 2)}
                      </pre>
                    </details>
                    <textarea
                      className={`${field} min-h-24 font-mono`}
                      aria-label={`${server.name}: Werkzeugargumente als JSON`}
                      value={argumentsText}
                      disabled={Boolean(busy)}
                      onChange={(e) => {
                        setArgumentsText(e.target.value);
                        setResult("");
                        setError("");
                      }}
                    />
                    <Button
                      className={action}
                      disabled={Boolean(busy) || !server.enabled || !catalog.ready}
                      onClick={() =>
                        void perform("Werkzeugaufruf", async (signal) => {
                          const args = JSON.parse(argumentsText);
                          if (!args || typeof args !== "object" || Array.isArray(args))
                            throw new Error("Eingaben müssen ein JSON-Objekt sein.");
                          const value = await mcpCall(
                            useIde.getState().mcpServers,
                            server.id,
                            chosenTool.name,
                            args,
                            undefined,
                            { signal },
                          );
                          signal.throwIfAborted();
                          if (!mounted.current) return;
                          const text =
                            typeof value === "string"
                              ? value
                              : (JSON.stringify(value, null, 2) ?? "Keine Ausgabe.");
                          setResult(
                            text.length > 30000
                              ? `${text.slice(0, 30000)}\n… Anzeige gekürzt.`
                              : text,
                          );
                          if (mcpIsError(value))
                            throw new Error(
                              "Der Dienst meldet einen Werkzeugfehler. Die Antwort steht unten.",
                            );
                          setMessage("Werkzeugaufruf abgeschlossen. Antwort des Dienstes:");
                        })
                      }
                    >
                      Jetzt ausführen
                    </Button>
                  </>
                )}
                {result && (
                  <pre
                    aria-label={`${server.name}: Werkzeugantwort`}
                    className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-2 text-[10px]"
                  >
                    {result}
                  </pre>
                )}
              </div>
            </details>
          )}
        </div>
      </details>
    </section>
  );
}

export function ServicesPane() {
  const servers = useIde((state) => state.mcpServers);
  const [provider, setProvider] = useState<string>("notion");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState("");
  const chosen = SERVICE_PROVIDERS.find((item) => item.id === provider);
  const query = search.trim().toLocaleLowerCase("de");
  const matches = SERVICE_PROVIDERS.filter((item) =>
    `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase("de").includes(query),
  );
  const categories = [...new Set(matches.map((item) => item.category))];
  const services = servers.filter((server) => server.service);
  return (
    <div className="min-w-0 pb-6 text-[11px]">
      <div className="space-y-3 border-b border-border p-3">
        <div>
          <h2 className="text-xs font-semibold text-fg">Dienste verbinden</h2>
          <p className="mt-1 text-muted">
            Anmelden, angebotene Werkzeuge auswählen und über Anvils Brücke verwenden. Die Dienste
            stellen ihre Erweiterungen über MCP bereit.
          </p>
        </div>
        {!hasMcpNative() && (
          <p className="rounded-md border border-border p-2 text-muted">
            Anmelden benötigt die Anvil-Desktop-App. Verbindungen kannst du hier bereits
            vorbereiten.
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-muted">Dienst suchen</span>
          <input
            className={field}
            type="search"
            aria-label="Dienste durchsuchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name oder Aufgabe, z. B. Design, Dateien, Fehler"
          />
        </label>
        <p className="text-[10px] text-muted" role="status">
          {matches.length} von {SERVICE_PROVIDERS.length} Angeboten
          {query && matches.length === 0
            ? " · Kein Treffer. Suche ändern oder eigenen Dienst ergänzen."
            : ""}
        </p>
        <label className="block space-y-1">
          <span className="text-muted">Dienst</span>
          <select
            className={field}
            aria-label="Dienst auswählen"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setError("");
            }}
          >
            {chosen && !matches.includes(chosen) && (
              <optgroup label="Aktuelle Auswahl (außerhalb der Suche)">
                <option value={chosen.id}>{chosen.name}</option>
              </optgroup>
            )}
            {categories.map((category) => (
              <optgroup key={category} label={category}>
                {matches
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.setupRequired ? " · Einrichtung nötig" : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
            <option value="custom">Eigener Dienst</option>
          </select>
        </label>
        {chosen && (
          <div className="space-y-1 text-muted">
            <p>{chosen.description}</p>
            {chosen.note && <p>{chosen.note}</p>}
            {chosen.setupRequired && (
              <p className="rounded-md border border-border p-2 text-fg">
                <strong>Zusätzliche Einrichtung nötig: </strong>
                {chosen.setupRequired}
              </p>
            )}
            {chosen.source && (
              <a
                href={chosen.source}
                target="_blank"
                rel="noreferrer"
                className="inline-block underline"
              >
                Einrichtung beim Anbieter
              </a>
            )}
          </div>
        )}
        {provider === "custom" && (
          <>
            <label className="block space-y-1">
              <span className="text-muted">Name</span>
              <input
                className={field}
                aria-label="Eigener Dienst: Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name des Dienstes"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted">MCP-Adresse</span>
              <input
                className={field}
                aria-label="Eigener Dienst: MCP-Adresse"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://dienst.example/mcp"
              />
            </label>
            <p className="text-[10px] text-muted">
              Ein MCP-Endpunkt mit OAuth-Anmeldung, keine normale Website. HTTPS oder ein lokaler
              Dienst auf diesem Rechner.
            </p>
          </>
        )}
        <details>
          <summary className="cursor-pointer text-muted">Optionale Client-ID</summary>
          <input
            className={`${field} mt-2`}
            aria-label="Dienst: OAuth-Client-ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Nur falls der Dienst eine Client-ID vorgibt"
          />
          <p className="mt-1 text-[10px] text-muted">
            Ohne Vorgabe versucht Anvil die Registrierung beim Anbieter. Ein Dienst muss diese
            unterstützen.
          </p>
        </details>
        <Button
          className={`${action} w-full`}
          disabled={Boolean(chosen?.setupRequired)}
          onClick={() => {
            try {
              const service = createService(provider, name, url, clientId);
              const state = useIde.getState();
              state.setMcpServers([...state.mcpServers, service]);
              setError("");
              setName("");
              setUrl("");
              setClientId("");
            } catch (failure) {
              setError(errorText(failure));
            }
          }}
        >
          Verbindung hinzufügen
        </Button>
        <p className="text-[10px] text-muted">
          Wird deaktiviert gespeichert. Erst „Anmelden“ öffnet die Anmeldung beim Dienst.
        </p>
        {error && (
          <p role="alert" className="break-words text-danger">
            {error}
          </p>
        )}
      </div>
      <EngineConnections />
      {services.length ? (
        services.map((server) => <ServiceConnection key={server.id} server={server} />)
      ) : (
        <p className="p-3 text-muted">Noch kein Dienst verbunden. Wähle oben einen Anbieter aus.</p>
      )}
    </div>
  );
}
