import { useEffect, useState } from "react";
import { mcpCall, mcpList, mcpReadResource, mcpResourcesCached, mcpToolsCached, newMcpId, type McpResource, type McpTool } from "@/lib/mcp";
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
  const setNotice = useIde((s) => s.setNotice);
  const [tools, setTools] = useState<McpTool[]>(() => mcpToolsCached());
  const [resources, setResources] = useState<McpResource[]>(() => mcpResourcesCached());
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");

  const live = servers.filter((s) => s.enabled);
  const current = servers.find((s) => s.id === active && s.enabled) ?? live[0] ?? null;
  const view = current ? views[current.id] : undefined;
  const slog = current ? log.filter((e) => e.server === current.id || e.server === current.name) : log;

  function refresh() {
    setBusy(true);
    void mcpList(useIde.getState().mcpServers)
      .then((list) => {
        setTools(list);
        setResources(mcpResourcesCached());
        const n = list.filter((x) => x.name !== "(fehler)").length;
        setNotice(n ? t("mcpOk") : t("mcpNone"));
      })
      .catch((e) => setNotice(e instanceof Error ? e.message : t("mcpNone")))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    if (!tools.length && live.length) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg">{t("mcp")}</p>
        <p className="text-[11px] text-muted">{t("mcpHint")}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Button variant="quiet" className="h-7 px-2 text-[11px]" disabled={busy} onClick={refresh}>
            {busy ? t("running") : t("mcpPing")}
          </Button>
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            onClick={() => setMcpServers([...servers, { id: newMcpId(), name: "MCP", url: "", enabled: true }])}
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
          const err = tools.find((t) => t.server === (s.name || s.id) && t.name === "(fehler)");
          return (
            <div key={s.id} className={cn("border-b border-border px-3 py-2", on && "bg-bg")}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => setMcpServers(servers.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)))}
                />
                <input
                  value={s.name}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg"
                  onChange={(e) => setMcpServers(servers.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                />
                <button
                  type="button"
                  className={cn("h-7 shrink-0 rounded-sm px-2 text-[10px]", on ? "bg-hover text-fg" : "text-muted hover:text-fg")}
                  onClick={() => setActive(on ? ANVIL_SURFACE : s.id)}
                >
                  {on ? t("surfaceHere") : t("surfaceUse")}
                </button>
                <button type="button" className="text-[10px] text-danger" onClick={() => setMcpServers(servers.filter((x) => x.id !== s.id))}>
                  {t("remove")}
                </button>
              </div>
              <input
                value={s.url}
                placeholder="https://…/mcp"
                className="mt-1 h-7 w-full rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-fg"
                onChange={(e) => setMcpServers(servers.map((x) => (x.id === s.id ? { ...x, url: e.target.value } : x)))}
              />
              <input
                type="password"
                placeholder="Bearer (optional)"
                defaultValue={loadSecrets().keys[`mcp:${s.id}`] ?? ""}
                className="mt-1 h-7 w-full rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-fg"
                onBlur={(e) => {
                  const cur = loadSecrets();
                  saveSecrets({ keys: { ...cur.keys, [`mcp:${s.id}`]: e.target.value } });
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
              {err ? <p className="mt-1 text-[10px] text-danger">{err.description}</p> : null}
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
            {resources.filter((r) => r.server === (current.name || current.id)).length ? (
              <div className="mt-2">
                <p className="text-[10px] tracking-wide text-subtle uppercase">{t("surfaceRes")}</p>
                {resources
                  .filter((r) => r.server === (current.name || current.id))
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
            const id = `${tool.server}.${tool.name}`;
            const bad = tool.name === "(fehler)";
            return (
              <button
                key={`${id}:${i}`}
                type="button"
                className="block w-full px-3 py-1 text-left hover:bg-hover"
                onClick={() => setPick(id)}
              >
                <span className={`font-mono text-xs ${bad ? "text-danger" : "text-fg"}`}>{id}</span>
                {tool.description ? <span className="block truncate text-[10px] text-muted">{tool.description}</span> : null}
              </button>
            );
          })
        )}
        {pick && !pick.endsWith(".(fehler)") ? (
          <div className="px-3 py-2">
            <Button
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                const [server, ...rest] = pick.split(".");
                const name = rest.join(".");
                setBusy(true);
                void mcpCall(useIde.getState().mcpServers, server ?? "", name, {})
                  .then((r) => {
                    const rec = r && typeof r === "object" ? (r as { text?: string; image?: string; isError?: boolean }) : null;
                    const text = rec?.text || (typeof r === "string" ? r : JSON.stringify(r, null, 2).slice(0, 4000));
                    const sid = servers.find((x) => x.name === server || x.id === server)?.id ?? server ?? "";
                    useIde.getState().pushMcpLog({
                      at: Date.now(),
                      server: sid,
                      name,
                      ok: !rec?.isError,
                      detail: String(text).slice(0, 400),
                      image: rec?.image,
                    });
                    if (sid) useIde.getState().setMcpView(sid, { text: String(text).slice(0, 2000), image: rec?.image, at: Date.now() });
                  })
                  .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {t("mcpCall")} {pick}
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
