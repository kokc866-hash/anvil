import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, Cloud, Laptop, Plug, Server } from "lucide-react";
import {
  decodeMcpPick,
  encodeMcpPick,
  mcpCall,
  mcpClose,
  mcpConfigured,
  mcpList,
  mcpListError,
  mcpLogin,
  mcpLogout,
  mcpProbe,
  mcpReadResource,
  mcpSnapshot,
  mcpSubscribe,
  mcpRevision,
  newMcpId,
  schemaHint,
  uniqueMcpName,
  type McpServer,
  type McpTool,
} from "@/lib/mcp";
import { loadSecrets, saveSecrets } from "@/lib/secrets";
import { ANVIL_SURFACE, parseContext, contextLine, surfaceLabel } from "@/lib/surface";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { isMcpService } from "@/lib/mcp-service-policy";
import { disconnectService } from "@/lib/mcp-services";
import {
  GITHUB_READ_PACKAGE,
  createGithubReadPackage,
  mcpPackage,
  assertMcpPackageProbeResult,
} from "@/lib/mcp-packages";

const field =
  "mt-1 h-7 w-full rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-fg";
const connectionGroups = [
  { id: "service", title: "mcpServices", hint: "mcpServicesHint", icon: Cloud },
  { id: "companion", title: "mcpCompanion", hint: "mcpCompanionHint", icon: Plug },
  { id: "stdio", title: "mcpPrograms", hint: "mcpProgramsHint", icon: Laptop },
  { id: "http", title: "mcpAddresses", hint: "mcpAddressesHint", icon: Server },
] as const;
function connectionGroup(server: McpServer, companionUrl: string) {
  if (isMcpService(server)) return "service";
  if (server.transport === "stdio") return "stdio";
  try {
    const companion = new URL(companionUrl);
    companion.pathname = `${companion.pathname.replace(/\/$/, "")}/mcp`;
    if (new URL(server.url).href.replace(/\/$/, "") === companion.href.replace(/\/$/, ""))
      return "companion";
  } catch {
    /* Incomplete addresses remain editable under server addresses. */
  }
  return "http";
}
function seedArguments(tool: McpTool) {
  const values: Record<string, unknown> = {};
  for (const key of tool.inputSchema?.required || []) {
    const prop = tool.inputSchema?.properties?.[key] as Record<string, unknown> | undefined;
    values[key] =
      prop?.default ??
      (Array.isArray(prop?.enum)
        ? prop.enum[0]
        : prop?.type === "boolean"
          ? false
          : prop?.type === "number" || prop?.type === "integer"
            ? 0
            : prop?.type === "array"
              ? []
              : prop?.type === "object"
                ? {}
                : "");
  }
  return JSON.stringify(values, null, 2);
}

function ServerFields({
  server: s,
  busy,
  patch,
  perform,
}: {
  server: McpServer;
  busy: boolean;
  patch: (value: Partial<McpServer>) => void;
  perform: (label: string, fn: (signal: AbortSignal) => Promise<unknown>) => void;
}) {
  const [args, setArgs] = useState(JSON.stringify(s.args || []));
  const [keys, setKeys] = useState(loadSecrets().keys);
  const notice = useIde((st) => st.setNotice);
  function key(name: string, value: string) {
    const next = {
      ...loadSecrets().keys,
      [name]: value,
      ...(name === `mcp:${s.id}` ? { [`mcp-target:${s.id}`]: s.url.trim() } : {}),
    };
    saveSecrets({ keys: next });
    setKeys(next);
    void mcpClose(s);
    if (mcpPackage(s)) patch({});
  }
  useEffect(() => {
    setArgs(JSON.stringify(s.args || []));
  }, [s.args]);
  if (isMcpService(s))
    return (
      <p className="mt-2 break-words text-[11px] text-muted">
        Anmeldung und Werkzeugauswahl unter Erweiterungen → Dienste verwalten.{" "}
        {s.allowedTools?.length || 0} Werkzeuge freigegeben. {s.url}
      </p>
    );
  if (mcpPackage(s))
    return (
      <fieldset disabled={busy} className="mt-2 text-[11px] text-muted">
        <p>
          Vorlage v1 · Anbieter: GitHub. Der gehostete Server wird von GitHub aktualisiert; seine
          Version ist nicht festgesetzt.
        </p>
        <p className="mt-1">
          Freigegeben: Dateien, Zweige und Commitlisten lesen. Neue Werkzeuge und Ressourcen bleiben
          gesperrt. Anfragen gehen an GitHub; gelesene Inhalte können als Kontext an das gewählte
          Modell gelangen.
        </p>
        <p className="mt-1">
          Voraussetzung: Internet und ein GitHub-Token mit Lesezugriff auf die gewünschten
          Repository-Inhalte. Kein zusätzliches Programm. Organisationsrichtlinien können den
          Zugriff begrenzen.
        </p>
        <input
          type="password"
          aria-label="GitHub-Lesepaket Token"
          autoComplete="off"
          className={field}
          value={keys[`mcp:${s.id}`] || ""}
          placeholder="GitHub-Token für dieses Lesepaket"
          onChange={(e) => key(`mcp:${s.id}`, e.target.value)}
        />
        <a
          href={GITHUB_READ_PACKAGE.source}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block underline"
        >
          Anbieter und Einrichtung
        </a>
        <p className="mt-1 break-all text-[10px]">{GITHUB_READ_PACKAGE.url}</p>
      </fieldset>
    );
  return (
    <fieldset disabled={busy}>
      <select
        aria-label="MCP-Transport"
        className={field}
        value={s.transport || "http"}
        onChange={(e) => patch({ transport: e.target.value as "http" | "stdio" })}
      >
        <option value="http">Serveradresse · HTTP</option>
        <option value="stdio">Lokales Programm · stdio</option>
      </select>
      {s.transport === "stdio" ? (
        <>
          <input
            aria-label="MCP-Programm"
            className={field}
            value={s.command || ""}
            placeholder="Programm, z. B. npx oder vollständiger Pfad"
            onChange={(e) => patch({ command: e.target.value })}
          />
          <input
            aria-label="MCP-Programmargumente"
            className={field}
            value={args}
            placeholder={'["-y", "@anbieter/mcp-server"]'}
            onChange={(e) => setArgs(e.target.value)}
            onBlur={() => {
              try {
                const values = JSON.parse(args);
                if (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
                  throw new Error();
                patch({ args: values });
              } catch {
                notice(
                  "Programmargumente als JSON-Liste von Texten eingeben. Letzte gültige Argumente bleiben gespeichert.",
                );
              }
            }}
          />
          <input
            aria-label="MCP-Arbeitsordner"
            className={field}
            value={s.cwd || ""}
            placeholder="Arbeitsordner des MCP-Programms (optional)"
            onChange={(e) => patch({ cwd: e.target.value })}
          />
          <input
            aria-label="MCP-Umgebungsvariablen"
            type="password"
            autoComplete="off"
            className={field}
            value={keys[`mcp-env:${s.id}`] || ""}
            placeholder={'Umgebung als JSON, z. B. {"TOKEN":"…"}'}
            onChange={(e) => key(`mcp-env:${s.id}`, e.target.value)}
          />
          <p className="mt-1 text-[10px] text-muted">
            Programm und Argumente werden getrennt gestartet. Umgebungswerte bleiben im
            Schlüsselspeicher.
          </p>
        </>
      ) : (
        <>
          <input
            aria-label="MCP-URL"
            className={field}
            value={s.url}
            placeholder="https://…/mcp"
            onChange={(e) => patch({ url: e.target.value })}
          />
          <select
            aria-label="MCP-Anmeldung"
            className={field}
            value={s.auth || "bearer"}
            onChange={(e) => patch({ auth: e.target.value as "bearer" | "oauth" })}
          >
            <option value="bearer">Ohne Anmeldung / Bearer</option>
            <option value="oauth">OAuth · im Browser anmelden</option>
          </select>
          {s.auth === "oauth" ? (
            <>
              <input
                aria-label="OAuth-Client-ID"
                className={field}
                value={s.oauthClientId || ""}
                placeholder="Client-ID (optional, sonst Registrierung am Server)"
                onChange={(e) => patch({ oauthClientId: e.target.value })}
              />
              <div className="mt-1 flex gap-2">
                <Button
                  variant="quiet"
                  className="h-7 px-2 text-[11px]"
                  disabled={!mcpConfigured(s)}
                  onClick={() =>
                    perform("Anmeldung", async (signal) => {
                      const result = await mcpLogin(s, signal);
                      await mcpProbe(s, useIde.getState().mcpServers, signal);
                      notice("MCP-Anmeldung abgeschlossen.");
                      return result;
                    })
                  }
                >
                  Anmelden
                </Button>
                <Button
                  variant="quiet"
                  className="h-7 px-2 text-[11px]"
                  disabled={!s.url.trim()}
                  onClick={() =>
                    perform("Abmelden", async () => {
                      await mcpLogout(s);
                      notice("MCP-Anmeldung entfernt.");
                    })
                  }
                >
                  Abmelden
                </Button>
              </div>
            </>
          ) : (
            <input
              type="password"
              aria-label="MCP-Bearer"
              autoComplete="off"
              className={field}
              value={keys[`mcp:${s.id}`] ?? ""}
              placeholder="Bearer (optional)"
              onChange={(e) => key(`mcp:${s.id}`, e.target.value)}
            />
          )}
        </>
      )}
      <input
        type="number"
        aria-label="MCP-Zeitlimit in Millisekunden"
        min={8000}
        max={600000}
        step={1000}
        className={field}
        value={s.timeoutMs || ""}
        placeholder="Zeitlimit in ms · Standard 120000"
        onChange={(e) =>
          patch({ timeoutMs: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })
        }
      />
      <textarea
        aria-label="MCP-Kontext"
        value={contextLine(s.context)}
        placeholder="Kontext: key=value (nur passende Schema-Felder)"
        rows={2}
        className={cn(field, "h-auto resize-y py-1")}
        onChange={(e) => patch({ context: parseContext(e.target.value) })}
      />
    </fieldset>
  );
}

export function McpPane() {
  const t = useT();
  const companionUrl = useIde((s) => s.companionUrl);
  const servers = useIde((s) => s.mcpServers),
    setServers = useIde((s) => s.setMcpServers);
  const active = useIde((s) => s.activeSurfaceId),
    setActive = useIde((s) => s.setActiveSurface);
  const mode = useIde((s) => s.surfaceMode),
    setMode = useIde((s) => s.setSurfaceMode);
  const views = useIde((s) => s.mcpView),
    log = useIde((s) => s.mcpLog),
    stream = useIde((s) => s.mcpStream);
  const notice = useIde((s) => s.setNotice);
  useSyncExternalStore(mcpSubscribe, mcpRevision, () => 0);
  const { tools, resources, ready } = mcpSnapshot(servers);
  const [busy, setBusy] = useState("");
  const job = useRef<AbortController | null>(null);
  const [pick, setPick] = useState(""),
    [argsText, setArgsText] = useState("{}");
  const [resourceUri, setResourceUri] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"connections" | "tools" | "history">("connections");
  const [connectionQuery, setConnectionQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [toolServer, setToolServer] = useState("");
  const [inspectedServer, setInspectedServer] = useState("");
  const [packageProbe, setPackageProbe] = useState<{
    id: string;
    config: string;
    at: number;
  } | null>(null);
  const current =
    servers.find((s) => s.id === inspectedServer && s.enabled) ||
    servers.find((s) => s.id === active && s.enabled) ||
    servers.find(mcpConfigured);
  const connectionMatches = servers.filter((s) =>
    `${s.name} ${s.command || ""} ${s.url} ${t(connectionGroups.find((g) => g.id === connectionGroup(s, companionUrl))!.title)}`
      .toLocaleLowerCase()
      .includes(connectionQuery.trim().toLocaleLowerCase()),
  );
  const shownTools = tools.filter(
    (tool) =>
      (!toolServer || (tool.serverId || tool.server) === toolServer) &&
      `${tool.server} ${tool.name} ${tool.description}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const picked = decodeMcpPick(pick);
  const pickedTool = tools.find(
    (tool) => (tool.serverId || tool.server) === picked.server && tool.name === picked.name,
  );
  const view = current ? views[current.id] : undefined;

  function perform(label: string, fn: (signal: AbortSignal) => Promise<unknown>) {
    if (job.current) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(label);
    void fn(controller.signal)
      .catch((error) => {
        if (job.current === controller)
          notice(
            controller.signal.aborted
              ? "MCP abgebrochen."
              : error instanceof Error
                ? error.message
                : String(error),
          );
      })
      .finally(() => {
        if (job.current === controller) {
          job.current = null;
          setBusy("");
        }
      });
  }
  function show(id: string, raw: unknown) {
    const rec =
      raw && typeof raw === "object"
        ? (raw as {
            text?: string;
            image?: string;
            images?: string[];
            isError?: boolean;
            structuredContent?: unknown;
          })
        : null;
    const text =
      [
        rec?.text,
        rec?.structuredContent == null ? "" : JSON.stringify(rec.structuredContent, null, 2),
      ]
        .filter(Boolean)
        .join("\n\n") || (typeof raw === "string" ? raw : JSON.stringify(raw, null, 2));
    useIde
      .getState()
      .setMcpView(id, { text, image: rec?.image, images: rec?.images, at: Date.now() });
    if (rec?.isError) notice("MCP-Werkzeug meldet einen Fehler. Ausgabe beachten.");
  }
  function read(uri: string) {
    if (current)
      perform("Ressource", async (signal) => {
        const raw = await mcpReadResource(servers, current.id, uri, signal);
        signal.throwIfAborted();
        show(current.id, raw);
      });
  }
  useEffect(() => {
    if (useIde.getState().mcpServers.some(mcpConfigured))
      perform("Katalog", (signal) => mcpList(useIde.getState().mcpServers, signal));
    return () => {
      const controller = job.current;
      job.current = null;
      controller?.abort();
    };
    // Only the mounted pane owns its manual requests; store/catalog changes are subscribed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (pick && !pickedTool) {
      setPick("");
      setArgsText("{}");
    }
  }, [pick, pickedTool]);
  useEffect(() => {
    setResourceUri("");
  }, [current?.id]);
  useEffect(() => {
    if (toolServer && !servers.some((server) => server.id === toolServer && server.enabled)) {
      setToolServer("");
      setInspectedServer("");
    }
  }, [servers, toolServer]);
  useEffect(() => {
    setPackageProbe(null);
  }, [servers]);
  useEffect(() => {
    const invalidate = () => setPackageProbe(null);
    window.addEventListener("anvil-secrets-changed", invalidate);
    window.addEventListener("anvil-secret-status", invalidate);
    return () => {
      window.removeEventListener("anvil-secrets-changed", invalidate);
      window.removeEventListener("anvil-secret-status", invalidate);
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg">{t("mcp")}</p>
        <p className="text-[11px] text-muted">{t("mcpHint")}</p>
        <p className="mt-1 text-[10px] text-muted">
          {t("mcpOverview", {
            total: servers.length,
            active: servers.filter((s) => s.enabled).length,
            tools: tools.length,
          })}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            disabled={Boolean(busy)}
            onClick={() =>
              perform("Katalog", async (signal) => {
                const rows = await mcpList(servers, signal);
                notice(
                  rows.length
                    ? t("mcpOk")
                    : "Katalog geladen. Serverstatus und Ressourcen beachten.",
                );
              })
            }
          >
            {busy || t("mcpPing")}
          </Button>
          {busy ? (
            <Button
              variant="quiet"
              className="h-7 px-2 text-[11px] text-danger"
              onClick={() => job.current?.abort()}
            >
              Stoppen
            </Button>
          ) : null}
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            disabled={Boolean(busy)}
            onClick={() => {
              const id = newMcpId();
              setServers([
                ...servers,
                { id, name: uniqueMcpName(servers, "MCP", id), url: "", enabled: true },
              ]);
              setTab("connections");
              setConnectionQuery("");
              setExpanded((value) => ({ ...value, [id]: true }));
            }}
          >
            {t("mcpAdd")}
          </Button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1" role="tablist" aria-label={t("mcpSections")}>
          {(["connections", "tools", "history"] as const).map((value, index, tabs) => (
            <button
              key={value}
              id={`mcp-tab-${value}`}
              type="button"
              role="tab"
              aria-selected={tab === value}
              aria-controls={`mcp-panel-${value}`}
              tabIndex={tab === value ? 0 : -1}
              className={cn(
                "min-w-0 rounded-md px-1 py-2 text-[11px]",
                tab === value ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(tabs[next]);
                document.getElementById(`mcp-tab-${tabs[next]}`)?.focus();
              }}
            >
              {t(
                value === "connections"
                  ? "mcpConnections"
                  : value === "tools"
                    ? "mcpTools"
                    : "mcpLog",
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          id="mcp-panel-connections"
          role="tabpanel"
          aria-labelledby="mcp-tab-connections"
          hidden={tab !== "connections"}
        >
          <div className="border-b border-border px-3 py-2">
            <input
              type="search"
              aria-label={t("mcpSearchConnections")}
              className={field}
              placeholder={t("mcpSearchConnections")}
              value={connectionQuery}
              onChange={(event) => setConnectionQuery(event.target.value)}
            />
            <Button
              variant="quiet"
              className="mt-2 h-auto min-h-7 whitespace-normal px-2 py-1 text-[11px]"
              onClick={() => useIde.getState().setSidebar("ext")}
            >
              {t("mcpManageServices")}
            </Button>
            <p className="mt-1 text-[10px] text-muted">{t("mcpManageServicesHint")}</p>
          </div>
          <details className="border-b border-border px-3 py-2 text-[11px]">
            <summary className="cursor-pointer font-medium text-fg">{t("mcpAgentAccess")}</summary>
            <p className="mt-2 text-muted">{t("surfaceBridgeHint")}</p>
            <div className="mt-2 flex flex-wrap rounded-[10px] bg-bg p-0.5">
              {(["exclusive", "bridge"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "min-h-7 flex-1 rounded-[8px] px-2 py-1 text-[11px]",
                    mode === value ? "bg-hover text-fg" : "text-muted",
                  )}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {t(value === "exclusive" ? "surfaceExclusive" : "surfaceBridge")}
                </button>
              ))}
            </div>
            <p className="mt-2 text-muted">
              {t("surface")}: {surfaceLabel(active, servers)}
            </p>
          </details>
          <details className="border-b border-border px-3 py-2 text-[11px] text-muted">
            <summary className="cursor-pointer text-xs text-fg">
              {t("mcpConnectionTemplates")}
            </summary>
            <p className="mt-2 font-medium text-fg">{GITHUB_READ_PACKAGE.name}</p>
            <p className="mt-1">
              Eine externe Projektquelle untersuchen: Dateien, Zweige und Commitlisten lesen.
              Vorlage v1, GitHub-Token erforderlich. Hinzufügen speichert die Verbindung
              deaktiviert. Kein Download und kein automatischer Aufruf.
            </p>
            <Button
              variant="quiet"
              className="mt-2 h-7 px-2 text-[11px]"
              disabled={Boolean(busy) || servers.some((s) => s.id === GITHUB_READ_PACKAGE.id)}
              onClick={() => {
                const currentServers = useIde.getState().mcpServers;
                if (currentServers.some((s) => s.id === GITHUB_READ_PACKAGE.id)) return;
                const server = createGithubReadPackage();
                server.name = uniqueMcpName(currentServers, server.name, server.id);
                setServers([...currentServers, server]);
                setExpanded((value) => ({ ...value, [server.id]: true }));
                notice(
                  "Das Lesepaket wurde hinzugefügt. Trage deinen Token ein, aktiviere die Verbindung und starte anschließend die Leseprobe.",
                );
              }}
            >
              {servers.some((s) => s.id === GITHUB_READ_PACKAGE.id)
                ? "Lesepaket hinzugefügt"
                : "Lesepaket hinzufügen"}
            </Button>
          </details>
          {!connectionMatches.length ? (
            <p className="px-3 py-4 text-[11px] text-muted">
              {t(servers.length ? "mcpNoConnectionMatch" : "mcpNoConnections")}
            </p>
          ) : null}
          {connectionGroups.map((group) => {
            const rows = connectionMatches.filter(
              (server) => connectionGroup(server, companionUrl) === group.id,
            );
            if (!rows.length) return null;
            const Icon = group.icon;
            return (
              <section
                key={group.id}
                className="border-b border-border"
                aria-label={t(group.title)}
              >
                <div className="px-3 pt-3 pb-2">
                  <h2 className="flex items-center gap-2 text-xs font-semibold text-fg">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {t(group.title)}
                    <span className="ml-auto text-[10px] font-normal text-muted" aria-hidden="true">
                      {rows.length}
                    </span>
                  </h2>
                  <p className="mt-1 text-[10px] text-muted">{t(group.hint)}</p>
                </div>
                {rows.map((s) => (
                  <details
                    key={s.id}
                    open={Boolean(expanded[s.id])}
                    className={cn(
                      "group mx-2 mb-2 min-w-0 rounded-md border border-border px-2 py-2",
                      active === s.id && "bg-bg",
                    )}
                  >
                    <summary
                      className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden"
                      onClick={(event) => {
                        event.preventDefault();
                        setExpanded((value) => ({ ...value, [s.id]: !value[s.id] }));
                      }}
                    >
                      <ChevronDown
                        className="mt-0.5 size-3.5 shrink-0 -rotate-90 transition-transform group-open:rotate-0"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="block break-words text-xs font-medium text-fg">
                          {s.name}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted">
                          <span className="rounded border border-border px-1">
                            {mcpPackage(s) ? t("mcpTemplate") : t(group.title)}
                          </span>
                          <span>{t(s.enabled ? "mcpEnabled" : "mcpDisabled")}</span>
                          {active === s.id ? (
                            <span className="text-accent">{t("surface")}</span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "mt-1 block break-words text-[10px]",
                            mcpListError(s.id) ? "text-danger" : "text-muted",
                          )}
                        >
                          {!s.enabled
                            ? ""
                            : mcpListError(s.id)
                              ? t("mcpConnectionError")
                              : ready.has(s.id)
                                ? t("mcpCatalogLoaded", {
                                    tools: tools.filter((tool) => tool.serverId === s.id).length,
                                    resources: resources.filter((r) => r.serverId === s.id).length,
                                  })
                                : t("mcpCatalogPending")}
                        </span>
                      </div>
                    </summary>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted">
                        <input
                          type="checkbox"
                          aria-label={`${s.name} aktiviert`}
                          checked={s.enabled}
                          disabled={Boolean(busy)}
                          onChange={(e) =>
                            setServers(
                              servers.map((x) =>
                                x.id === s.id ? { ...x, enabled: e.target.checked } : x,
                              ),
                            )
                          }
                        />
                        {t("mcpEnabled")}
                      </label>
                      <input
                        aria-label="MCP-Servername"
                        className="h-7 min-w-0 flex-1 basis-36 rounded-md border border-border bg-bg px-2 text-xs text-fg"
                        value={s.name}
                        onChange={(e) =>
                          setServers(
                            servers.map((x) =>
                              x.id === s.id ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                        onBlur={(e) =>
                          setServers(
                            servers.map((x) =>
                              x.id === s.id
                                ? { ...x, name: uniqueMcpName(servers, e.target.value, s.id) }
                                : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        disabled={!s.enabled}
                        className={cn(
                          "h-7 shrink-0 rounded-sm px-2 text-[10px]",
                          active === s.id ? "bg-hover text-fg" : "text-muted",
                        )}
                        onClick={() => {
                          setActive(active === s.id ? ANVIL_SURFACE : s.id);
                          setInspectedServer(s.id);
                        }}
                      >
                        {t(active === s.id ? "surfaceHere" : "surfaceUse")}
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-muted hover:text-fg"
                        disabled={Boolean(busy) || !mcpConfigured(s)}
                        onClick={() => perform("Katalog", (signal) => mcpProbe(s, servers, signal))}
                      >
                        {t("mcpPingOne")}
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-danger"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (isMcpService(s)) {
                            perform("Dienst entfernen", () => disconnectService(s.id, true));
                            return;
                          }
                          void mcpClose(s);
                          if (mcpPackage(s))
                            saveSecrets({
                              keys: {
                                [`mcp:${s.id}`]: "",
                                [`mcp-target:${s.id}`]: "",
                                [`mcp-env:${s.id}`]: "",
                              },
                            });
                          setServers(useIde.getState().mcpServers.filter((x) => x.id !== s.id));
                        }}
                      >
                        {t("remove")}
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] font-medium text-muted">
                      {t("mcpConnectionSettings")}
                    </p>
                    <ServerFields
                      server={s}
                      busy={Boolean(busy)}
                      patch={(value) =>
                        setServers(servers.map((x) => (x.id === s.id ? { ...x, ...value } : x)))
                      }
                      perform={perform}
                    />
                    {mcpPackage(s) ? (
                      <div className="mt-2 text-[11px] text-muted">
                        <p>
                          Die Leseprobe ruft nur die öffentliche README von github/github-mcp-server
                          ab. Sie bestätigt keinen Zugriff auf private Projekte.
                        </p>
                        <Button
                          variant="quiet"
                          className="mt-1 h-7 px-2 text-[11px]"
                          disabled={Boolean(busy) || !s.enabled}
                          onClick={() =>
                            perform("Leseprobe", async (signal) => {
                              setPackageProbe(null);
                              if (!loadSecrets().keys[`mcp:${s.id}`]?.trim())
                                throw new Error(
                                  "Zuerst einen GitHub-Token für dieses Lesepaket eintragen.",
                                );
                              await mcpProbe(s, servers, signal);
                              const raw = await mcpCall(
                                servers,
                                s.id,
                                "get_file_contents",
                                { ...GITHUB_READ_PACKAGE.probe },
                                undefined,
                                { signal },
                              );
                              signal.throwIfAborted();
                              show(s.id, raw);
                              assertMcpPackageProbeResult(raw);
                              setPackageProbe({
                                id: s.id,
                                config: JSON.stringify(s),
                                at: Date.now(),
                              });
                              notice("Leseprobe erfolgreich: Der Dateiabruf hat Inhalt geliefert.");
                            })
                          }
                        >
                          Öffentliche README lesen
                        </Button>
                        {packageProbe?.id === s.id &&
                        packageProbe.config === JSON.stringify(s) &&
                        ready.has(s.id) ? (
                          <p role="status" className="mt-1 text-fg">
                            Leseprobe erfolgreich · {new Date(packageProbe.at).toLocaleTimeString()}{" "}
                            · öffentliche README
                          </p>
                        ) : (
                          <p className="mt-1">
                            Lesezugriff noch nicht mit dieser Konfiguration bestätigt.
                          </p>
                        )}
                      </div>
                    ) : null}
                    {mcpListError(s.id) ? (
                      <p className="mt-1 break-words text-[10px] text-danger">
                        {mcpListError(s.id)}
                      </p>
                    ) : null}
                  </details>
                ))}
              </section>
            );
          })}
        </div>
        <div
          id="mcp-panel-tools"
          role="tabpanel"
          aria-labelledby="mcp-tab-tools"
          hidden={tab !== "tools"}
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-[11px] text-muted">{t("mcpToolsHint")}</p>
            <label className="mt-2 block text-[10px] text-muted">
              {t("mcpToolsFrom")}
              <select
                aria-label={t("mcpToolsFrom")}
                className={field}
                value={toolServer}
                onChange={(event) => {
                  setToolServer(event.target.value);
                  setPick("");
                  setArgsText("{}");
                  setInspectedServer(event.target.value);
                }}
              >
                <option value="">{t("mcpAllConnections")}</option>
                {servers
                  .filter((s) => s.enabled)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {current ? (
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] tracking-wide text-subtle uppercase">
                {t("mcpResult")} · {surfaceLabel(current.id, servers)}
              </p>
              {(view?.images || (view?.image ? [view.image] : [])).map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`MCP-Ergebnis ${i + 1}`}
                  className="mt-1 max-h-48 w-auto rounded-sm border border-border"
                />
              ))}
              {view?.text ? (
                <pre className="mt-1 max-h-60 overflow-auto font-mono text-[10px] whitespace-pre-wrap text-muted">
                  {view.text}
                </pre>
              ) : (
                <p className="mt-1 text-[11px] text-muted">{t("mcpResultEmpty")}</p>
              )}
              <p className="mt-2 text-[10px] tracking-wide text-subtle uppercase">
                {t("surfaceRes")}
              </p>
              {resources
                .filter((r) => r.serverId === current.id)
                .map((r) => (
                  <button
                    key={r.uri}
                    type="button"
                    disabled={Boolean(busy)}
                    className="block w-full truncate py-0.5 text-left font-mono text-[10px] text-muted hover:text-fg"
                    onClick={() => (r.uriTemplate ? setResourceUri(r.uriTemplate) : read(r.uri))}
                  >
                    {r.name} {r.uriTemplate ? "· Vorlage" : ""}
                  </button>
                ))}
              <input
                aria-label="MCP-Ressourcen-URI"
                className={field}
                value={resourceUri}
                placeholder="Ressourcen-URI, Vorlagenwerte einsetzen"
                onChange={(e) => setResourceUri(e.target.value)}
              />
              <Button
                variant="quiet"
                className="mt-1 h-7 px-2 text-[11px]"
                disabled={Boolean(busy) || !resourceUri.trim() || /[{}]/.test(resourceUri)}
                onClick={() => read(resourceUri)}
              >
                Ressource lesen
              </Button>
            </div>
          ) : null}
          <div className="px-3 py-2">
            <p className="text-[10px] tracking-wide text-subtle uppercase">
              {t("mcpTools")} · {shownTools.length}
            </p>
            <input
              aria-label="MCP-Werkzeuge suchen"
              className={field}
              value={query}
              placeholder="Werkzeug oder Server suchen"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {!shownTools.length ? (
            <p className="px-3 py-2 text-xs text-muted">
              {tools.length
                ? t("mcpNoToolMatch")
                : servers.some(mcpConfigured)
                  ? t("mcpPing")
                  : t("mcpNone")}
            </p>
          ) : (
            shownTools.map((tool) => {
              const id = encodeMcpPick(tool.serverId || tool.server, tool.name);
              return (
                <button
                  key={id}
                  type="button"
                  disabled={Boolean(busy)}
                  className={cn(
                    "block w-full px-3 py-1 text-left hover:bg-hover",
                    pick === id && "bg-hover",
                  )}
                  onClick={() => {
                    setPick(id);
                    setInspectedServer(tool.serverId || tool.server);
                    setArgsText(seedArguments(tool));
                  }}
                >
                  <span className="break-words font-mono text-xs text-fg">
                    {tool.server} · {tool.name}
                  </span>
                  <span className="block break-words text-[10px] text-muted">
                    {tool.description}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-subtle">
                    {schemaHint(tool.inputSchema)}
                  </span>
                </button>
              );
            })
          )}
          {pickedTool ? (
            <div className="px-3 py-2">
              <p className="text-xs text-fg">
                {pickedTool.server} · {pickedTool.name}
              </p>
              <details className="mt-1 text-[10px] text-muted">
                <summary>Schema der Eingaben</summary>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(pickedTool.inputSchema, null, 2)}
                </pre>
              </details>
              <textarea
                aria-label="MCP-Toolargumente"
                rows={5}
                disabled={Boolean(busy)}
                className={cn(field, "h-auto resize-y py-1")}
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
              />
              <Button
                variant="quiet"
                className="mt-1 h-7 px-2 text-[11px]"
                disabled={Boolean(busy)}
                onClick={() =>
                  perform("Werkzeug", async (signal) => {
                    const args: unknown = JSON.parse(argsText),
                      started = Date.now();
                    const sid = pickedTool.serverId || pickedTool.server;
                    const workspace = useIde.getState();
                    const out = await mcpCall(servers, sid, pickedTool.name, args, undefined, {
                      cwd: workspace.workspaceCwd || undefined,
                      signal,
                      workspaceCurrent: workspace.workspaceNative ? () => useIde.getState().workspaceEpoch === workspace.workspaceEpoch : undefined,
                    });
                    signal.throwIfAborted();
                    show(sid, out);
                    const rec = out as { isError?: boolean; text?: string };
                    useIde.getState().pushMcpLog({
                      at: started,
                      server: sid,
                      name: pickedTool.name,
                      ok: !rec?.isError,
                      detail: String(rec?.text || "Ergebnis empfangen").slice(0, 400),
                    });
                  })
                }
              >
                {t("mcpCall")}
              </Button>
            </div>
          ) : null}
        </div>
        <div
          id="mcp-panel-history"
          role="tabpanel"
          aria-labelledby="mcp-tab-history"
          hidden={tab !== "history"}
        >
          <div className="border-t border-border px-3 py-2">
            <label className="flex items-center gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => useIde.getState().setMcpStream(e.target.checked)}
              />
              {t("mcpStream")}
            </label>
            <div className="mt-2 flex justify-between text-[10px] text-subtle">
              <span>{t("mcpLog")}</span>
              <button type="button" onClick={() => useIde.getState().clearMcpLog()}>
                {t("clear")}
              </button>
            </div>
            {log.map((e, i) => (
              <p
                key={i}
                className={cn(
                  "mt-1 break-words font-mono text-[10px]",
                  e.ok ? "text-muted" : "text-danger",
                )}
              >
                {surfaceLabel(e.server, servers)} · {e.name} · {e.detail}
              </p>
            ))}
            {!log.length ? (
              <p className="mt-2 text-[11px] text-muted">{t("mcpNoHistory")}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
