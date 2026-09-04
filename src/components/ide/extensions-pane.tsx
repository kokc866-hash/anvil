import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Puzzle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PLUGIN_API_DOC,
  PLUGIN_TEMPLATE,
  listCommands,
  listPlugins,
  pluginSnapshot,
  subscribePlugins,
} from "@/lib/plugins";
import { importVsix, listVsPacks, vsPackFilePaths } from "@/lib/plugins/vscode";
import { vsPackPluginId } from "@/lib/plugins/util";
import { downloadVsix, FEATURED, searchMarket, type MarketItem } from "@/lib/market";
import { cn } from "@/lib/cn";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";

const TAB_IDS = ["all", "core", "edit", "web", "tools", "workspace", "market", "api"] as const;

export function ExtensionsPane() {
  const t = useT();
  const disabled = useIde((s) => s.pluginDisabled);
  const files = useIde((s) => s.files);
  const togglePlugin = useIde((s) => s.togglePlugin);
  const writeFile = useIde((s) => s.writeFile);
  const deleteFile = useIde((s) => s.deleteFile);
  const openFile = useIde((s) => s.openFile);
  const setSidebar = useIde((s) => s.setSidebar);
  useSyncExternalStore(subscribePlugins, pluginSnapshot, pluginSnapshot);
  const plugins = listPlugins();
  const commands = listCommands();
  const packs = listVsPacks();
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<(typeof TAB_IDS)[number]>("all");
  const [market, setMarket] = useState<MarketItem[]>(FEATURED);
  const [marketMsg, setMarketMsg] = useState("");
  const q = filter.toLowerCase();
  const abortRef = useRef<AbortController | null>(null);

  const shown = useMemo(() => {
    return plugins.filter((p) => {
      if (tab !== "all" && tab !== "api" && tab !== "market" && (p.category ?? "core") !== tab) return false;
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    });
  }, [plugins, q, tab]);

  useEffect(() => {
    if (tab !== "market") return;
    const handle = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setMarketMsg(t("extSearching"));
      void searchMarket(filter || "snippets", ac.signal)
        .then((rows) => {
          if (ac.signal.aborted) return;
          setMarket(rows.length ? rows : FEATURED);
          setMarketMsg(rows.length ? t("extHits", { n: rows.length }) : t("extNoHits"));
        })
        .catch((e) => {
          if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
          setMarketMsg(e instanceof Error ? e.message : t("extSearchFail"));
        });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [filter, tab, t]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function installItem(item: MarketItem) {
    if (!item.vsix) return;
    setMarketMsg(t("extLoadingName", { name: item.name }));
    try {
      const buf = await downloadVsix(item.vsix);
      const slug = item.id.replace(/[^\w.\-]+/g, "-");
      const got = await importVsix(buf, `plugins/${slug}`);
      for (const [p, c] of Object.entries(got.files)) writeFile(p, c);
      useIde.getState().setNotice(`${item.name}: ${Object.keys(got.files).length} ${t("extFiles")}`);
      setMarketMsg(t("extInstalled", { name: item.name }));
    } catch (err) {
      setMarketMsg(err instanceof Error ? err.message : t("extDownloadFail"));
    }
  }

  function uninstallPack(path: string) {
    const st = useIde.getState();
    const gone = vsPackFilePaths(st.files, path);
    for (const p of gone) deleteFile(p);
    st.setNotice(t("extRemoved", { n: gone.length }));
  }

  const tabs: { id: (typeof TAB_IDS)[number]; label: string }[] = [
    { id: "all", label: t("extAll") },
    { id: "core", label: t("extCore") },
    { id: "edit", label: t("extEdit") },
    { id: "web", label: t("extWeb") },
    { id: "tools", label: t("extTools") },
    { id: "workspace", label: t("extWorkspace") },
    { id: "market", label: t("extMarket") },
    { id: "api", label: t("extApi") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 flex-1 px-1 text-xs font-medium tracking-wide text-muted uppercase">
          {t("extensions")}
        </span>
        <Button variant="quiet" className="h-8 w-8 p-0" aria-label={t("close")} onClick={() => setSidebar(null)}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="border-b border-border px-2 py-2">
        <input
          value={filter}
          placeholder={t("search")}
          className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-subtle"
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={cn(
                "h-7 rounded-md px-2 text-[11px]",
                tab === tb.id ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {tab === "api" ? (
          <pre className="whitespace-pre-wrap px-1 font-mono text-[11px] leading-5 text-muted">{PLUGIN_API_DOC}</pre>
        ) : tab === "market" ? (
          <div>
            <p className="mb-2 px-1 text-[11px] text-muted">{t("extMarketHint")}</p>
            {marketMsg ? <p className="mb-2 px-1 text-[11px] text-subtle">{marketMsg}</p> : null}
            {market.map((item) => (
              <div key={item.id} className="mb-2 rounded-md border border-border px-2 py-2">
                <p className="text-sm text-fg">
                  {item.name}
                  <span className="ml-1.5 font-mono text-[10px] text-subtle">{item.publisher}</span>
                </p>
                <p className="text-xs text-muted text-pretty">{item.description}</p>
                <Button className="mt-1 h-7 px-2 text-[11px]" onClick={() => void installItem(item)}>
                  {t("extInstall")}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          shown.map((p) => {
            const on = !disabled.includes(p.id);
            const cmds = commands.filter((c) => c.plugin === p.id);
            return (
              <div key={p.id} className="mb-2 rounded-md border border-border px-2 py-2">
                <div className="flex items-start gap-2">
                  <Puzzle className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">
                      {p.name}
                      <span className="ml-1.5 font-mono text-[10px] text-subtle">
                        {p.builtin ? t("extBuiltin") : t("extWs")}
                        {p.version ? ` · ${p.version}` : ""}
                      </span>
                    </p>
                    <p className="text-xs text-muted text-pretty">{p.description}</p>
                    {cmds.length ? <p className="mt-1 text-[10px] text-subtle">{t("extCmdsN", { n: cmds.length })}</p> : null}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className={cn(
                      "relative h-7 w-11 shrink-0 rounded-full border",
                      on ? "border-accent bg-accent" : "border-border bg-bg",
                    )}
                    onClick={() => togglePlugin(p.id)}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-5 rounded-full bg-fg",
                        on ? "left-5 bg-accent-fg" : "left-0.5",
                      )}
                    />
                  </button>
                </div>
                {p.path ? (
                  <button
                    type="button"
                    className="mt-1 font-mono text-[11px] text-muted hover:text-fg"
                    onClick={() => openFile(p.path!)}
                  >
                    {p.path}
                  </button>
                ) : null}
              </div>
            );
          })
        )}
        {tab !== "api" && tab !== "market" ? (
          <>
            <p className="px-1 pt-2 pb-1 text-xs font-medium tracking-wide text-subtle uppercase">{t("extCmds")}</p>
            {commands.length === 0 ? (
              <p className="px-1 text-xs text-muted">{t("extNoCmds")}</p>
            ) : (
              commands.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="mb-0.5 block w-full rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg"
                  onClick={() => void c.run()}
                >
                  {c.title}
                </button>
              ))
            )}
          </>
        ) : null}
      </div>
      <div className="border-t border-border p-2">
        <p className="mb-2 px-0.5 text-[11px] text-muted">{t("extVsixHint")}</p>
        <Button
          className="mb-1.5 h-8 w-full text-xs"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".vsix,.zip";
            input.onchange = () => {
              const f = input.files?.[0];
              if (!f) return;
              void f.arrayBuffer().then(async (buf) => {
                const slug = f.name.replace(/\.(vsix|zip)$/i, "").replace(/[^\w.\-]+/g, "-") || "ext";
                const got = await importVsix(buf, `plugins/${slug}`);
                const st = useIde.getState();
                for (const [p, c] of Object.entries(got.files)) st.writeFile(p, c);
                st.setNotice(`${got.name}: ${Object.keys(got.files).length} ${t("extFiles")}`);
              });
            };
            input.click();
          }}
        >
          {t("extImportVsix")}
        </Button>
        {packs.length ? (
          <ul className="mb-2 px-0.5 text-[11px] text-muted">
            {packs.map((p) => {
              const pid = vsPackPluginId(p.id);
              const on = !disabled.includes(pid);
              return (
                <li key={p.id} className="mb-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {p.name} · {t("extSnipsLangs", { snippets: p.snippets, languages: p.languages })}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className={cn("h-5 w-8 shrink-0 rounded-full border", on ? "border-accent bg-accent" : "border-border bg-bg")}
                    onClick={() => togglePlugin(pid)}
                  />
                  <button type="button" className="text-[10px] text-muted hover:text-fg" onClick={() => uninstallPack(p.path)}>
                    {t("extUninstall")}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <Button
          className="h-8 w-full text-xs"
          onClick={() => {
            const path = "plugins/mein-plugin.js";
            writeFile(path, files[path] ?? PLUGIN_TEMPLATE);
            openFile(path);
          }}
        >
          {t("extNewPlugin")}
        </Button>
      </div>
    </div>
  );
}
