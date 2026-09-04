import { useEffect, useState } from "react";
import {
  decodeMcpPick,
  encodeMcpPick,
  mcpCall,
  mcpClose,
  mcpList,
  mcpListError,
  mcpProbe,
  mcpReadResource,
  mcpResourcesCached,
  mcpToolsCached,
  newMcpId,
  schemaHint,
  uniqueMcpName,
  type McpResource,
  type McpTool,
} from "@/lib/mcp";
import { loadSecrets, saveSecrets } from "@/lib/secrets";
import { ANVIL_SURFACE, parseContext, contextLine, surfaceLabel } from "@/lib/surface";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export function McpPane() {
  const t = useT();
  const servers = useIde((s) => s.mcpServers);
  const setMcpServers = useIde((s) => s.setMcpServers);
  const active = useIde((s) => s.activeSurfaceId);
  const setActive = useIde((s) => s.setActiveSurface);
  const mode = useIde((s) => s.surfaceMode);
  const setMode = useIde((s) => s.setSurfaceMode);
  const setContext = useIde((s) => s.setMcpContext);
  const log = useIde((s) => s.mcpLog);
  const views = useIde((s) => s.mcpView);
  const workspaceCwd = useIde((s) => s.workspaceCwd);
  const setNotice = useIde((s) => s.setNotice);
  const [tools, setTools] = useState<McpTool[]>(() => mcpToolsCached());
  const [resources, setResources] = useState<McpResource[]>(() => mcpResourcesCached());
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [keys, setKeys] = useState<Record<string, string>>(() => loadSecrets().keys);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const live = servers.filter((s) => s.enabled);
  const current = servers.find((s) => s.id === active && s.enabled) ?? live[0] ?? null;
  const view = current ? views[current.id] : undefined;
  const slog = current ? log.filter((e) => e.server === current.id || e.server === current.name) : log;
  const picked = pick ? decodeMcpPick(pick) : null;
  const pickedTool = picked
    ? tools.find((x) => (x.serverId === picked.server || x.server === picked.server) && x.name === picked.name)
    : undefined;

  function snapErrors() {
    const next: Record<string, string> = {};
    for (const s of useIde.getState().mcpServers) {
      const e = mcpListError(s.id);
      if (e) next[s.id] = e;
    }
    setErrs(next);
  }

  function refresh() {
    setBusy(true);
    void mcpList(useIde.getState().mcpServers)
      .then((rows) => {
        setTools(rows);
        setResources(mcpResourcesCached());
        snapErrors();
        const n = rows.length;
        setNotice(n ? t("mcpOk") : t("mcpNone"));
      })
      .catch((e) => setNotice(e instanceof Error ? e.message : t("mcpNone")))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    if (!tools.length && live.length) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveKey(id: string, value: string) {
    const cur = loadSecrets();
    const next = { ...cur.keys, [`mcp:${id}`]: value };
    saveSecrets({ keys: next });
    setKeys(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg">{t("mcp")}</p>
        <p className="text-[11px] text-muted">{t("mcpHint")}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Button variant="quiet" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => refresh()}>
            {busy ? t("running") : t("mcpPing")}
          </Button>
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              const id = newMcpId();
              setMcpServers([...servers, { id, name: uniqueMcpName(servers, "MCP", id), url: "", enabled: true }]);
            }}
          >
            {t("mcpAdd")}
          </Button>
        </div>
        <div className="mt-2 flex rounded-[10px] bg-bg p-0.5">
          <button
            type="button"
            className={cn("h-7 flex-1 rounded-[8px] px-2 text-[11px]", mode === "exclusive" ? "bg-hover text-fg" : "text-muted")}
            onClick={() => setMode("exclusive")}
          >
            {t("surfaceExclusive")}
          </button>
          <button
            type="button"
            className={cn("h-7 flex-1 rounded-[8px] px-2 text-[11px]", mode === "bridge" ? "bg-hover text-fg" : "text-muted")}
            onClick={() => setMode("bridge")}
          >
            {t("surfaceBridge")}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {servers.map((s) => {
          const on = active === s.id;
          const err = errs[s.id];
          return (
            <div key={s.id} className={cn("border-b border-border px-3 py-2", on && "bg-bg")}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    if (!enabled) void mcpClose(s);
                    setMcpServers(servers.map((x) => (x.id === s.id ? { ...x, enabled } : x)));
                  }}
                />
                <input
                  value={s.name}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg"
                  onChange={(e) => setMcpServers(servers.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                  onBlur={(e) =>
                    setMcpServers(
                      servers.map((x) => (x.id === s.id ? { ...x, name: uniqueMcpName(servers, e.target.value, s.id) } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  className={cn("h-7 shrink-0 rounded-sm px-2 text-[10px]", on ? "bg-hover text-fg" : "text-muted hover:text-fg")}
                  onClick={() => setActive(on ? ANVIL_SURFACE : s.id)}
                >
                  {on ? t("surfaceHere") : t("surfaceUse")}
                </button>
                <button
                  type="button"
                  className="text-[10px] text-muted hover:text-fg"
                  disabled={busy || !s.url.trim()}
                  onClick={() => {
                    setBusy(true);
                    void mcpProbe(s, servers)
                      .then((rows) => {
                        setTools(rows);
                        setResources(mcpResourcesCached());
                        snapErrors();
                      })
                      .catch((e) => {
                        snapErrors();
                        setNotice(e instanceof Error ? e.message : t("mcpNone"));
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  {t("mcpPingOne")}
                </button>
                <button
                  type="button"
                  className="text-[10px] text-danger"
                  onClick={() => {
                    void mcpClose(s);
                    setMcpServers(servers.filter((x) => x.id !== s.id));
                  }}
                >
                  {t("remove")}
                </button>
              </div>
              <input
                value={s.url}
                placeholder="https://…/mcp"
                className="mt-1 h-7 w-full rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-fg"
                onChange={(e) => {
                  void mcpClose(s);
                  setMcpServers(servers.map((x) => (x.id === s.id ? { ...x, url: e.target.value } : x)));
                }}
              />
              <input
                type="password"
                placeholder="Bearer (optional)"
                value={keys[`mcp:${s.id}`] ?? ""}
                className="mt-1 h-7 w-full rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-fg"
                onChange={(e) => saveKey(s.id, e.target.value)}
              />
              <input
                type="number"
                min={8000}
                step={1000}
                placeholder={t("mcpTimeout")}
                value={s.timeoutMs || ""}
                className="mt-1 h-7 w-full rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-fg"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setMcpServers(servers.map((x) => (x.id === s.id ? { ...x, timeoutMs: n > 0 ? n : undefined } : x)));
                }}
              />
              {s.enabled ? (
                <textarea
                  value={contextLine(s.context)}
                  placeholder={t("surfaceCtxPh")}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg"
                  onChange={(e) => setContext(s.id, parseContext(e.target.value))}
                />
              ) : null}
              {err ? <p className="mt-1 text-[10px] text-danger">{err}</p> : null}
            </div>
          );
        })}
        {current ? (
          <div className="px-3 py-2">
            <p className="text-[10px] tracking-wide text-subtle uppercase">
              {t("surfaceView")} · {surfaceLabel(current.id, servers)}
            </p>
            {view?.image ? (
              <img src={view.image} alt="" className="mt-1 max-h-40 w-auto rounded-sm border border-border" />
            ) : null}
            {view?.text ? (
              <pre className="mt-1 max-h-28 overflow-auto font-mono text-[10px] text-muted whitespace-pre-wrap">{view.text}</pre>
            ) : (
              <p className="mt-1 text-[11px] text-muted">{t("surfaceViewEmpty")}</p>
            )}
            {resources.filter((r) => r.server === (current.name || current.id) || r.server === current.id).length ? (
              <div className="mt-2">
                <p className="text-[10px] tracking-wide text-subtle uppercase">{t("surfaceRes")}</p>
                {resources
                  .filter((r) => r.server === (current.name || current.id) || r.server === current.id)
                  .slice(0, 16)
                  .map((r) => (
                    <button
                      key={r.uri}
                      type="button"
                      className="block w-full truncate py-0.5 text-left font-mono text-[10px] text-muted hover:text-fg"
                      onClick={() => {
                        setBusy(true);
                        void mcpReadResource(useIde.getState().mcpServers, current.id, r.uri)
                          .then((out) => {
                            const rec = out && typeof out === "object" ? (out as { text?: string; image?: string }) : null;
                            const text = rec?.text || (typeof out === "string" ? out : JSON.stringify(out).slice(0, 2000));
                            useIde.getState().setMcpView(current.id, { text, image: rec?.image, at: Date.now() });
                          })
                          .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      {r.name || r.uri}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="px-3 pt-2 text-[10px] tracking-wide text-subtle uppercase">{t("mcpTools")}</p>
        {tools.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">{live.length ? t("mcpPing") : t("mcpNone")}</p>
        ) : (
          tools.map((tool, i) => {
            const sid = tool.serverId || tool.server;
            const id = encodeMcpPick(sid, tool.name);
            return (
              <button
                key={`${id}:${i}`}
                type="button"
                className="block w-full px-3 py-1 text-left hover:bg-hover"
                onClick={() => {
                  setPick(id);
                  const hint = schemaHint(tool.inputSchema);
                  if (hint && argsText === "{}") {
                    const req = new Set(tool.inputSchema?.required ?? []);
                    const seed: Record<string, string> = {};
                    for (const k of Object.keys(tool.inputSchema?.properties ?? {})) {
                      if (req.has(k)) seed[k] = "";
                    }
                    if (Object.keys(seed).length) setArgsText(JSON.stringify(seed, null, 2));
                  }
                }}
              >
                <span className="font-mono text-xs text-fg">{tool.server}.{tool.name}</span>
                {tool.description ? <span className="block truncate text-[10px] text-muted">{tool.description}</span> : null}
                {schemaHint(tool.inputSchema) ? (
                  <span className="block truncate font-mono text-[10px] text-subtle">{schemaHint(tool.inputSchema)}</span>
                ) : null}
              </button>
            );
          })
        )}
        {pick && picked?.name ? (
          <div className="px-3 py-2">
            {schemaHint(pickedTool?.inputSchema) ? (
              <p className="mb-1 font-mono text-[10px] text-subtle">{t("mcpArgs")}: {schemaHint(pickedTool?.inputSchema)}</p>
            ) : null}
            <textarea
              value={argsText}
              rows={4}
              className="mb-1 w-full resize-y rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg"
              onChange={(e) => setArgsText(e.target.value)}
            />
            <Button
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                let parsed: unknown = {};
                try {
                  parsed = argsText.trim() ? JSON.parse(argsText) : {};
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : t("mcpArgsBad"));
                  return;
                }
                setBusy(true);
                void mcpCall(useIde.getState().mcpServers, picked.server, picked.name, parsed, undefined, {
                  cwd: workspaceCwd || undefined,
                })
                  .then((r) => {
                    const rec = r && typeof r === "object" ? (r as { text?: string; image?: string; isError?: boolean }) : null;
                    const text = rec?.text || (typeof r === "string" ? r : JSON.stringify(r, null, 2).slice(0, 4000));
                    const sid = servers.find((x) => x.id === picked.server || x.name === picked.server)?.id ?? picked.server;
                    useIde.getState().pushMcpLog({
                      at: Date.now(),
                      server: sid,
                      name: picked.name,
                      ok: !rec?.isError,
                      detail: String(text).slice(0, 400),
                      image: rec?.image,
                    });
                    if (sid) useIde.getState().setMcpView(sid, { text: String(text).slice(0, 2000), image: rec?.image, at: Date.now() });
                    if (rec?.isError) setNotice(String(text).slice(0, 180));
                  })
                  .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {t("mcpCall")} {picked.name}
            </Button>
          </div>
        ) : null}
        {slog.length ? (
          <div className="border-t border-border px-3 py-2">
            <p className="text-[10px] tracking-wide text-subtle uppercase">{t("surfaceLog")}</p>
            {slog.slice(0, 16).map((e, i) => (
              <p key={`${e.at}:${i}`} className={cn("mt-0.5 truncate font-mono text-[10px]", e.ok ? "text-muted" : "text-danger")}>
                {e.name} · {e.detail}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
