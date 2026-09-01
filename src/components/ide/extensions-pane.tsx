import { useMemo, useState, useSyncExternalStore } from "react";
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
import { importVsix, listVsPacks } from "@/lib/plugins/vscode";
import { downloadVsix, FEATURED, searchMarket, type MarketItem } from "@/lib/market";
import { cn } from "@/lib/cn";
import { useIde } from "@/store/ide";

const TABS = [
  { id: "all", label: "Alle" },
  { id: "core", label: "Core" },
  { id: "edit", label: "Edit" },
  { id: "web", label: "Web" },
  { id: "tools", label: "Tools" },
  { id: "market", label: "Markt" },
  { id: "api", label: "API" },
] as const;

export function ExtensionsPane() {
  const disabled = useIde((s) => s.pluginDisabled);
  const files = useIde((s) => s.files);
  const togglePlugin = useIde((s) => s.togglePlugin);
  const writeFile = useIde((s) => s.writeFile);
  const openFile = useIde((s) => s.openFile);
  const setSidebar = useIde((s) => s.setSidebar);
  useSyncExternalStore(subscribePlugins, pluginSnapshot, pluginSnapshot);
  const plugins = listPlugins();
  const commands = listCommands();
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [market, setMarket] = useState<MarketItem[]>(FEATURED);
  const [marketMsg, setMarketMsg] = useState("");
  const q = filter.toLowerCase();

  const shown = useMemo(() => {
    return plugins.filter((p) => {
      if (tab !== "all" && tab !== "api" && tab !== "market" && (p.category ?? "core") !== tab) return false;
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    });
  }, [plugins, q, tab]);

  async function installItem(item: MarketItem) {
    if (!item.vsix) return;
    setMarketMsg(`Lade ${item.name}…`);
    try {
      const buf = await downloadVsix(item.vsix);
      const slug = item.id.replace(/[^\w.\-]+/g, "-");
      const got = await importVsix(buf, `plugins/${slug}`);
      for (const [p, c] of Object.entries(got.files)) writeFile(p, c);
      useIde.getState().setNotice(`${item.name}: ${Object.keys(got.files).length} Dateien`);
      setMarketMsg(`${item.name} — Snippets und Sprachen übernommen. vscode-Code läuft hier nicht.`);
    } catch (err) {
      setMarketMsg(err instanceof Error ? err.message : "Download fehlgeschlagen");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 flex-1 px-1 text-xs font-medium tracking-wide text-muted uppercase">
          Erweiterungen
        </span>
        <Button variant="quiet" className="h-8 w-8 p-0" aria-label="Schließen" onClick={() => setSidebar(null)}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="border-b border-border px-2 py-2">
        <input
          value={filter}
          placeholder="Suchen"
          className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-subtle"
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn(
                "h-7 rounded-md px-2 text-[11px]",
                tab === t.id ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {tab === "api" ? (
          <pre className="whitespace-pre-wrap px-1 font-mono text-[11px] leading-5 text-muted">{PLUGIN_API_DOC}</pre>
        ) : tab === "market" ? (
          <div>
            <p className="mb-2 px-1 text-[11px] text-muted">
              Markt von Open VSX. Anvil übernimmt Snippets, Sprachen und Kommentare — nicht den vscode-Code.
            </p>
            <Button
              className="mb-2 h-7 px-2 text-[11px]"
              onClick={() => {
                setMarketMsg("Suche…");
                void searchMarket(filter || "snippets")
                  .then((rows) => {
                    setMarket(rows.length ? rows : FEATURED);
                    setMarketMsg(rows.length ? `${rows.length} Treffer` : "Keine Treffer — Vorschläge");
                  })
                  .catch((e) => setMarketMsg(e instanceof Error ? e.message : "Suche fehlgeschlagen"));
              }}
            >
              Open VSX suchen
            </Button>
            {marketMsg ? <p className="mb-2 px-1 text-[11px] text-subtle">{marketMsg}</p> : null}
            {market.map((item) => (
              <div key={item.id} className="mb-2 rounded-md border border-border px-2 py-2">
                <p className="text-sm text-fg">
                  {item.name}
                  <span className="ml-1.5 font-mono text-[10px] text-subtle">{item.publisher}</span>
                </p>
                <p className="text-xs text-muted text-pretty">{item.description}</p>
                <Button className="mt-1 h-7 px-2 text-[11px]" onClick={() => void installItem(item)}>
                  Installieren
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
                        {p.builtin ? "built-in" : "ws"}
                        {p.version ? ` · ${p.version}` : ""}
                      </span>
                    </p>
                    <p className="text-xs text-muted text-pretty">{p.description}</p>
                    {cmds.length ? <p className="mt-1 text-[10px] text-subtle">{cmds.length} Befehle</p> : null}
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
            <p className="px-1 pt-2 pb-1 text-xs font-medium tracking-wide text-subtle uppercase">Befehle</p>
            {commands.length === 0 ? (
              <p className="px-1 text-xs text-muted">Keine Befehle aktiv.</p>
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
        <p className="mb-2 px-0.5 text-[11px] text-muted">
          VS Code-Erweiterungen laufen hier nicht vollständig. .vsix liefert Snippets, Sprachen und Kommentare.
        </p>
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
                st.setNotice(`${got.name}: ${Object.keys(got.files).length} Dateien`);
              });
            };
            input.click();
          }}
        >
          VSIX importieren
        </Button>
        {listVsPacks().length ? (
          <ul className="mb-2 px-0.5 text-[11px] text-muted">
            {listVsPacks().map((p) => (
              <li key={p.id}>
                {p.name} · {p.snippets} Snippets · {p.languages} Sprachen
              </li>
            ))}
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
          Neues Plugin
        </Button>
      </div>
    </div>
  );
}
