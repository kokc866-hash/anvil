import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

const field =
  "mt-1 h-7 w-full rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-fg";
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
  }
  useEffect(() => {
    setArgs(JSON.stringify(s.args || []));
  }, [s.args]);
  return (
    <fieldset disabled={busy}>
      <select
        aria-label="MCP-Transport"
        className={field}
        value={s.transport || "http"}
        onChange={(e) => patch({ transport: e.target.value as "http" | "stdio" })}
      >
        <option value="http">HTTP / SSE</option>
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
  const current = servers.find((s) => s.id === active && s.enabled) || servers.find(mcpConfigured);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg">{t("mcp")}</p>
        <p className="text-[11px] text-muted">{t("mcpHint")}</p>
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
              Stop
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
            }}
          >
            {t("mcpAdd")}
          </Button>
        </div>
        <div className="mt-2 flex rounded-[10px] bg-bg p-0.5">
          {(["exclusive", "bridge"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={cn(
                "h-7 flex-1 rounded-[8px] px-2 text-[11px]",
                mode === value ? "bg-hover text-fg" : "text-muted",
              )}
              onClick={() => setMode(value)}
            >
              {t(value === "exclusive" ? "surfaceExclusive" : "surfaceBridge")}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {servers.map((s) => (
          <div
            key={s.id}
            className={cn("border-b border-border px-3 py-2", active === s.id && "bg-bg")}
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`${s.name} aktiviert`}
                checked={s.enabled}
                onChange={(e) =>
                  setServers(
                    servers.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)),
                  )
                }
              />
              <input
                aria-label="MCP-Servername"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg"
                value={s.name}
                onChange={(e) =>
                  setServers(
                    servers.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)),
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
                onClick={() => setActive(active === s.id ? ANVIL_SURFACE : s.id)}
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
                onClick={() => setServers(servers.filter((x) => x.id !== s.id))}
              >
                {t("remove")}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-muted">
              {!s.enabled
                ? "Deaktiviert"
                : ready.has(s.id)
                  ? `Katalog geladen · ${tools.filter((tool) => tool.serverId === s.id).length} Tools · ${resources.filter((r) => r.serverId === s.id).length} Ressourcen`
                  : "Katalog noch nicht verfügbar"}
            </p>
            <ServerFields
              server={s}
              busy={Boolean(busy)}
              patch={(value) =>
                setServers(servers.map((x) => (x.id === s.id ? { ...x, ...value } : x)))
              }
              perform={perform}
            />
            {mcpListError(s.id) ? (
              <p className="mt-1 break-words text-[10px] text-danger">{mcpListError(s.id)}</p>
            ) : null}
          </div>
        ))}
        {current ? (
          <div className="border-b border-border px-3 py-2">
            <p className="text-[10px] tracking-wide text-subtle uppercase">
              {t("surfaceView")} · {surfaceLabel(current.id, servers)}
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
              <p className="mt-1 text-[11px] text-muted">{t("surfaceViewEmpty")}</p>
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
            {t("mcpTools")} · {tools.length}
          </p>
          <input
            aria-label="MCP-Tools suchen"
            className={field}
            value={query}
            placeholder="Tool oder Server suchen"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!tools.length ? (
          <p className="px-3 py-2 text-xs text-muted">
            {servers.some(mcpConfigured) ? t("mcpPing") : t("mcpNone")}
          </p>
        ) : (
          tools
            .filter((tool) =>
              `${tool.server} ${tool.name} ${tool.description}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((tool) => {
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
                    setArgsText(seedArguments(tool));
                  }}
                >
                  <span className="font-mono text-xs text-fg">
                    {tool.server} · {tool.name}
                  </span>
                  <span className="block truncate text-[10px] text-muted">{tool.description}</span>
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
              <summary>Argumentschema</summary>
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
                perform("Tool", async (signal) => {
                  const args: unknown = JSON.parse(argsText),
                    started = Date.now();
                  const sid = pickedTool.serverId || pickedTool.server;
                  const out = await mcpCall(servers, sid, pickedTool.name, args, undefined, {
                    cwd: useIde.getState().workspaceCwd || undefined,
                    signal,
                  });
                  signal.throwIfAborted();
                  show(sid, out);
                  const rec = out as { isError?: boolean; text?: string };
                  useIde
                    .getState()
                    .pushMcpLog({
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
          {log
            .filter((e) => !current || e.server === current.id || e.server === current.name)
            .map((e, i) => (
              <p
                key={i}
                className={cn(
                  "mt-1 break-words font-mono text-[10px]",
                  e.ok ? "text-muted" : "text-danger",
                )}
              >
                {e.name} · {e.detail}
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}
