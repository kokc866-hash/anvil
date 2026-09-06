import { useEffect, useMemo, useRef, useState } from "react";
import { useIde } from "@/store/ide";
import { CtxMenu } from "./ctx-menu";
import { gotoFile } from "@/lib/goto";
import { rebuildIndex, searchIndex } from "@/lib/ws-index";
import { afterLine, type SearchHit, type SearchOpts } from "@/lib/search";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

import { searchJob } from "@/lib/search-job";

export function SearchPane() {
  const t = useT();
  const files = useIde((s) => s.files);
  const q = useIde((s) => s.searchQuery);
  const setSearchQuery = useIde((s) => s.setSearchQuery);
  const setNotice = useIde((s) => s.setNotice);
  const [busy, setBusy] = useState(false);
  const [repl, setRepl] = useState("");
  const [regex, setRegex] = useState(false);
  const [cs, setCs] = useState(false);
  const [word, setWord] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [ask, setAsk] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; text: string } | null>(null);
  const opts: SearchOpts = { regex, case: cs, word };

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [more, setMore] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchSnapshot = useRef<Record<string, string> | null>(null);
  const applyControl = useRef<AbortController | null>(null);
  useEffect(() => {
    const control = new AbortController();
    searchSnapshot.current = null; setHits([]); setMore(false); setAsk(false); setPicked({}); setSearchError("");
    const timer = setTimeout(() => {
      if (!q) return;
      void searchJob({ files, needle: q, opts }, control.signal).then((result) => {
        if (control.signal.aborted) return;
        searchSnapshot.current = files; setHits(result.hits ?? []); setMore(Boolean(result.more));
      }).catch((e) => { if (!control.signal.aborted) setSearchError(e.message); });
    }, 180);
    return () => { clearTimeout(timer); control.abort(); applyControl.current?.abort(); };
  }, [files, q, regex, cs, word]);

  const symbols = useMemo(() => {
    const needle = q.trim();
    if (needle.length < 2) return [];
    rebuildIndex(files);
    return searchIndex(needle, files, 16).filter((h) => h.kind === "symbol");
  }, [files, q]);

  const groups = useMemo(() => {
    const g = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const list = g.get(h.path) ?? [];
      list.push(h);
      g.set(h.path, list);
    }
    return [...g.entries()];
  }, [hits]);

  const selected = hits.filter((h) => picked[`${h.path}:${h.line}:${h.col}`] !== false);
  const showRepl = repl.length > 0 || ask;

  async function apply(list?: SearchHit[]) {
    const st = useIde.getState();
    if (searchSnapshot.current !== st.files) { setNotice("Suchergebnisse werden aktualisiert."); return; }
    const control = new AbortController(); applyControl.current?.abort(); applyControl.current = control;
    setBusy(true);
    try {
      const result = await searchJob({ files, needle: q, opts, replacement: repl, selected: list }, control.signal);
      const cur = useIde.getState();
      if (control.signal.aborted || cur.workspaceEpoch !== st.workspaceEpoch || cur.files !== files) return;
      cur.pushCheckpoint(t("searchReplace"));
      const n = cur.patchFiles(result.patched ?? {});
      setAsk(false);
      setNotice(n ? t("replacedN", { n: result.total ?? 0, f: n }) : t("noneFound"));
    } catch (e) { if (!control.signal.aborted) setNotice(e instanceof Error ? e.message : "Ersetzen fehlgeschlagen"); }
    finally { if (applyControl.current === control) setBusy(false); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border p-2">
        <input
          autoFocus
          value={q}
          placeholder={t("searchPh")}
          className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-ring"
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setAsk(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim().split(/\s+/).length >= 3) {
              e.preventDefault();
              setBusy(true);
              void import("@/lib/brain")
                .then((b) => b.brainSearchNeedle(q))
                .then((n) => {
                  if (n && n !== q) setSearchQuery(n);
                })
                .finally(() => setBusy(false));
            }
          }}
        />
        <input
          value={repl}
          placeholder={t("replacePh")}
          className="mt-1.5 h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-subtle"
          onChange={(e) => {
            setRepl(e.target.value);
            setAsk(false);
          }}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <label className="flex items-center gap-1 text-[11px] text-muted">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            {t("reFlag")}
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted">
            <input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} />
            Aa
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted" title={t("wordFlag")}>
            <input type="checkbox" checked={word} onChange={(e) => setWord(e.target.checked)} />
            W
          </label>
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            disabled={busy || !selected.length}
            onClick={() => apply(selected)}
          >
            {t("replaceSel")}
          </Button>
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            disabled={busy || !hits.length}
            onClick={() => (hits.length > 3 || more ? setAsk(true) : void apply())}
          >
            {t("replaceAll")}
          </Button>
          <span className="font-mono text-[11px] text-subtle">
            {hits.length}{more ? "+" : ""}
            {groups.length ? ` · ${groups.length}` : ""}
            {symbols.length ? ` · ${symbols.length} ${t("symbols")}` : ""}
          </span>
        </div>
        {ask ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-fg">
            <span>{more ? "Alle Treffer im Projekt ersetzen (auch außerhalb der angezeigten 200)?" : t("confirmReplace", { n: hits.length, f: groups.length })}</span>
            <button type="button" className="text-danger hover:underline" onClick={() => void apply()}>
              {t("replaceAll")}
            </button>
            <button type="button" className="text-muted hover:underline" onClick={() => setAsk(false)}>
              {t("roundKeep")}
            </button>
          </div>
        ) : null}
        {searchError ? <p className="mt-1 text-xs text-danger">{searchError}</p> : null}
        {busy ? <p className="mt-1 text-[10px] text-subtle">{t("helperSearch")}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {q.length < 1 ? (
          <p className="px-3 py-2 text-xs text-muted">{t("searchHint")}</p>
        ) : hits.length === 0 && symbols.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">{t("noneFound")}</p>
        ) : (
          <>
            {symbols.length ? <p className="px-3 pt-1 text-[10px] tracking-wide text-subtle uppercase">{t("symbols")}</p> : null}
            {symbols.map((s, i) => (
              <button
                key={`s-${s.path}:${s.line}:${i}`}
                type="button"
                className="block w-full px-3 py-1 text-left hover:bg-hover"
                onClick={() => gotoFile(s.path, s.line)}
              >
                <span className="font-mono text-xs text-fg">{s.label}</span>
              </button>
            ))}
            {groups.map(([path, list]) => (
              <div key={path} className="mb-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover"
                  onClick={() => gotoFile(path, list[0]?.line ?? 1)}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle">{path}</span>
                  <span className="font-mono text-[10px] text-muted">{list.length}</span>
                </button>
                {list.map((h, i) => {
                  const pk = `${h.path}:${h.line}:${h.col}`;
                  const on = picked[pk] !== false;
                  const after = showRepl ? afterLine(h, q, repl, opts) : "";
                  return (
                    <div key={`${pk}:${i}`} className="flex items-start gap-1 px-2 py-0.5 hover:bg-hover">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={(e) => setPicked({ ...picked, [pk]: e.target.checked })}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => gotoFile(h.path, h.line)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, path: h.path, text: h.text });
                        }}
                      >
                        <span className="font-mono text-[10px] text-subtle">{h.line}</span>
                        <HitLine hit={h} after={showRepl ? after : null} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>
      {menu ? (
        <CtxMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: t("open"), onClick: () => gotoFile(menu.path, 1) },
            { label: t("agent"), onClick: () => void import("@/lib/fix-agent").then((m) => m.askFile(menu.path, "review")) },
          ]}
        />
      ) : null}
    </div>
  );
}

function HitLine({ hit, after }: { hit: SearchHit; after: string | null }) {
  const i = Math.max(0, hit.col - 1);
  const j = Math.max(i, Math.min(hit.text.length, hit.end - 1));
  const before = hit.text.slice(0, i);
  const mid = hit.text.slice(i, j) || hit.match;
  const rest = hit.text.slice(j);
  if (after == null) {
    return (
      <span className="block truncate font-mono text-xs text-muted">
        {before}
        <span className="bg-accent/25 text-fg">{mid}</span>
        {rest}
      </span>
    );
  }
  const aMid = after.slice(i, i + after.length - hit.text.length + (j - i));
  return (
    <span className="block truncate font-mono text-xs">
      <span className="text-muted">{before}</span>
      <span className="text-danger line-through decoration-danger/80">{mid}</span>
      <span className="text-ok">{aMid === "" ? "∅" : aMid}</span>
      <span className="text-muted">{rest}</span>
    </span>
  );
}

