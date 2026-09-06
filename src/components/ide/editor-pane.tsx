import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bug, ChevronDown, Eye, MoreHorizontal, Play, Sparkles, Square, SquareArrowOutUpRight, StepForward, X } from "lucide-react";
import { CodeEditor, type TextSel } from "./code-editor";
import { DiffView } from "./diff-view";
import { PreviewPane } from "./preview-pane";
import { Button } from "@/components/ui/button";
import { completeText, stripFence } from "@/lib/complete";
import { agentGen, beginAgent } from "@/lib/abort";
import { brainGenerate, brainReady, brainSystem, brainTabHint, getTabHint, subscribeTabHints, tabHintSnap, useBrain } from "@/lib/brain";
import { canRun, langFromPath } from "@/lib/languages";
import { selectRunTarget } from "@/lib/run-target";
import { looksGraphical } from "@/lib/game-host";
import { canDebug } from "@/lib/debug-remote";
import { debugContinue, debugStep, debugStop, startDebug } from "@/lib/debug-engine";
import { cn } from "@/lib/cn";
import { isRefImage, refImageSrc, copyIntoRef, isSecretPath } from "@/lib/ref";
import { envNames } from "@/lib/vault";
import { listSymbols } from "@/lib/lsp";
import { gotoFile } from "@/lib/goto";
import { useIde } from "@/store/ide";
import { getDrag, hasOsFiles, importDropped, setDrag } from "@/lib/dnd";
import { dockRunWindow, openRunWindow } from "@/lib/run-window";
import { CtxMenu, FlyAt } from "./ctx-menu";
import { StarterPick } from "./starter-pick";
import { useT } from "@/lib/i18n";
import { useKbd } from "@/lib/use-kbd";
import { EDITOR_COMPACT } from "@/lib/layout";
import { confirmApp } from "@/lib/confirm";
import { EDITOR_MAX_CHARS } from "@/lib/monaco-models";

import { captureDocument, applyDocument } from "@/lib/document";
import { useLivePreview } from "@/lib/live-write";

export function EditorPane() {
  const draft = useLivePreview((s) => s.draft);
  const t = useT();
  const kNew = useKbd("newFile");
  const kAgent = useKbd("agent");
  const kInline = useKbd("inline");
  const kRun = useKbd("run");
  const kRunWin = useKbd("runWin");
  const kDbg = useKbd("debug");
  const kStep = useKbd("debugStep");
  const kDbgStop = useKbd("debugStop");
  const openPaths = useIde((s) => s.openPaths);
  const activePath = useIde((s) => s.activePath);
  const activeSrc = useIde((s) => (s.activePath ? s.files[s.activePath] ?? "" : ""));
  const hintN = useSyncExternalStore(subscribeTabHints, tabHintSnap, tabHintSnap);
  void hintN;
  const dirty = useIde((s) => s.dirty);
  const running = useIde((s) => s.running);
  const pending = useIde((s) => s.pendingDiffs);
  const openFile = useIde((s) => s.openFile);
  const setContent = useIde((s) => s.setContent);
  const acceptAllDiffs = useIde((s) => s.acceptAllDiffs);
  const rejectAllDiffs = useIde((s) => s.rejectAllDiffs);
  const acceptDiff = useIde((s) => s.acceptDiff);
  const rejectDiff = useIde((s) => s.rejectDiff);
  const inlineTicket = useRef(0);
  const epoch = useIde((s) => s.workspaceEpoch);
  const [inline, setInline] = useState<(TextSel & { prompt: string; busy: boolean }) | null>(null);
  const [find, setFind] = useState<{ q: string; i: number; repl?: string } | null>(null);
  const [sym, setSym] = useState("");
  const [symOpen, setSymOpen] = useState(false);
  const [goto, setGoto] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(true);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [tabOver, setTabOver] = useState<string | null>(null);
  const [tabFly, setTabFly] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [tabFit, setTabFit] = useState(24);
  const [moreOpen, setMoreOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const tabStrip = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [edOver, setEdOver] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [diffSum, setDiffSum] = useState("");
  const previewOpen = useIde((s) => s.previewOpen);
  const runPopout = useIde((s) => s.runPopout);
  const setPreviewOpen = useIde((s) => s.setPreviewOpen);
  const liveRun = useIde((s) => s.liveRun);
  const agentBusy = useIde((s) => s.agentBusy);
  const setLiveRun = useIde((s) => s.setLiveRun);
  const debug = useIde((s) => s.debug);
  const liveGen = useRef(0);
  const currentDiff = pending.find((d) => d.path === activePath);

  async function askClose(path: string) { await import("@/lib/save").then((s) => s.closeTabs([path])); }
  async function askCloseOthers(keep: string) { await import("@/lib/save").then((s) => s.closeTabs(useIde.getState().openPaths.filter((p) => p !== keep))); }

  useEffect(() => {
    if (!activePath) return;
    const src = useIde.getState().files[activePath] ?? "";
    const tmr = window.setTimeout(() => void brainTabHint(activePath, src), 700);
    return () => window.clearTimeout(tmr);
  }, [activePath, activeSrc]);

  useEffect(() => {
    const el = tabStrip.current;
    if (!el) return;
    const MIN = 92;
    const read = () => setTabFit(Math.max(1, Math.floor((el.clientWidth - 36) / MIN)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [Boolean(activePath)]);

  const shownTabs = useMemo(
    () => pickVisibleTabs(openPaths, activePath, tabFit),
    [openPaths, activePath, tabFit],
  );
  const packedTabs = useMemo(() => packTabs(openPaths.filter((p) => !shownTabs.includes(p))), [openPaths, shownTabs]);

  useEffect(() => {
    if (!activePath) return;
    const el = tabStrip.current?.querySelector(`[data-tab="${CSS.escape(activePath)}"]`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activePath]);

  useEffect(() => {
    const el = paneRef.current;
    if (!el) {
      setCompact(false);
      return;
    }
    const read = () => setCompact(el.clientWidth < EDITOR_COMPACT);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activePath]);

  useEffect(() => {
    if (!tabFly && !moreOpen) return;
    function close() {
      setTabFly(null);
      setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabFly, moreOpen]);

  useEffect(() => {
    function onGoto() {
      setGoto("");
    }
    function onEsc() {
      setFind(null);
      setGoto(null);
      (inlineTicket.current++, setInline(null));
      setSymOpen(false);
    }
    function onReplace() {
      setFind((f) => ({ q: f?.q ?? "", i: f?.i ?? 0, repl: f?.repl ?? "" }));
    }
    function onFind() {
      setFind((f) => ({ q: f?.q || "", i: 0, repl: f?.repl }));
    }
    function onSymbols() {
      setSymOpen(true);
      setSym("");
    }
    window.addEventListener("anvil-goto", onGoto);
    window.addEventListener("anvil-escape", onEsc);
    window.addEventListener("anvil-replace", onReplace);
    window.addEventListener("anvil-find", onFind);
    window.addEventListener("anvil-symbols", onSymbols);
    return () => {
      window.removeEventListener("anvil-goto", onGoto);
      window.removeEventListener("anvil-escape", onEsc);
      window.removeEventListener("anvil-replace", onReplace);
      window.removeEventListener("anvil-find", onFind);
      window.removeEventListener("anvil-symbols", onSymbols);
    };
  }, []);

  useEffect(() => {
    if (!pending.length) {
      setDiffSum("");
      return;
    }
    let alive = true;
    void import("@/lib/brain")
      .then((b) => b.brainDiffSummary(pending))
      .then((t) => {
        if (alive) setDiffSum(t);
      });
    return () => {
      alive = false;
    };
  }, [pending]);

  const findHits = useMemo(() => {
    if (!find?.q || !activePath) return [];
    const src = activeSrc;
    const q = find.q;
    const hits: number[] = [];
    const lower = src.toLowerCase(), query = q.toLowerCase();
    let from = 0;
    while (q && from < src.length) {
      const at = lower.indexOf(query, from);
      if (at < 0) break;
      hits.push(at);
      from = at + q.length;
    }
    return hits;
  }, [find?.q, activeSrc, activePath]);

  async function run(opts?: { live?: boolean; tok?: number }) {
    await import("@/lib/editor-run").then((r) => r.runFromEditor(activePath, { live: opts?.live, current: opts?.live ? () => opts.tok === liveGen.current : undefined }));
  }

  useEffect(() => {
    if (!liveRun || !activePath) return;
    if (useIde.getState().agentBusy) return;
    const lang = langFromPath(activePath);
    const src = activeSrc;
    if (lang !== "python" && lang !== "javascript" && lang !== "typescript") return;
    if (looksGraphical(src) || /\bcurses\b|\binput\s*\(/.test(src)) return;
    if (!src.trim() || src.length > 24000) return;
    const id = ++liveGen.current;
    const t = window.setTimeout(() => {
      if (id !== liveGen.current || useIde.getState().agentBusy) return;
      void run({ live: true, tok: id });
    }, 700);
    return () => {
      window.clearTimeout(t);
      liveGen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRun, activePath, activeSrc, agentBusy]);

  useEffect(() => { inlineTicket.current++; setInline(null); return () => { inlineTicket.current++; }; }, [activePath, epoch]);

  async function applyInline() {
    if (!inline || !activePath || !inline.prompt.trim()) return;
    const ticket = ++inlineTicket.current;
    const snap = captureDocument(activePath);
    setInline({ ...inline, busy: true });
    try {
      const s = useIde.getState();
      const prompt = `Du editierst ${activePath}. Anweisung: ${inline.prompt}\n\nGib NUR den Ersatzcode zurück, ohne Erklärung, ohne Markdown.\n\nCODE:\n${inline.text}`;
      const helper = brainReady() && useBrain.getState().jobs.inline;
      let raw: string;
      if (helper) {
        const st = useBrain.getState();
        raw = await brainGenerate({
          messages: [
            { role: "system", content: brainSystem("Replacement code only. No markdown, no explanation.") },
            { role: "user", content: prompt.slice(0, 6000) },
          ],
          maxTokens: st.maxTokens,
          temperature: st.temperature,
          pri: 0,
          job: "inline",
        });
      } else {
        raw = await completeText({
          prompt,
          provider: s.llmProvider === "brain" ? "ollama" : s.llmProvider,
          baseUrl: s.llmBaseUrl,
          model: s.llmModel,
          apiKey: s.llmApiKey,
        });
      }
      const next = stripFence(raw);
      if (ticket !== inlineTicket.current) return;
      const cur = snap.content ?? "";
      if (!applyDocument(snap, cur.slice(0, inline.start) + next + cur.slice(inline.end))) { useIde.getState().setNotice("Datei inzwischen geändert; Inline-Edit nicht übernommen."); }
      (inlineTicket.current++, setInline(null));
    } catch (err) {
      if (ticket !== inlineTicket.current) return;
      setInline({
        ...inline,
        busy: false,
        prompt: err instanceof Error ? err.message : "Fehler",
      });
    }
  }

  function jumpFind(dir: number) {
    if (!findHits.length || !activePath) return;
    const i = ((find?.i ?? 0) + dir + findHits.length) % findHits.length;
    setFind({ q: find?.q ?? "", i, repl: find?.repl });
  }

  useEffect(() => {
    if (!find?.q || !activePath || !findHits.length) return;
    const at = findHits[((find.i % findHits.length) + findHits.length) % findHits.length];
    window.dispatchEvent(
      new CustomEvent("anvil-reveal-offset", { detail: { path: activePath, offset: at, len: find.q.length } }),
    );
  }, [find?.q, find?.i, findHits, activePath]);

  function replaceOne() {
    if (!activePath || !find?.q || find.repl == null || !findHits.length) return;
    const i = find.i % findHits.length;
    const at = findHits[i];
    const src = activeSrc;
    const next = src.slice(0, at) + find.repl + src.slice(at + find.q.length);
    useIde.getState().setContent(activePath, next);
  }

  function replaceAll() {
    if (!activePath || !find?.q || find.repl == null) return;
    const src = activeSrc;
    const q = find.q;
    const parts = src.split(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"));
    useIde.getState().setContent(activePath, parts.join(find.repl));
    setFind({ ...find, i: 0 });
  }

  function goLine() {
    if (!activePath || !goto) return;
    const n = Number(goto);
    if (!Number.isFinite(n) || n < 1) return;
    gotoFile(activePath, n, false);
    setGoto(null);
  }

    const liveDraft = draft ? (
        <details open className="max-h-[40%] shrink-0 overflow-auto border-b border-border bg-surface">
          <summary className="sticky top-0 bg-surface px-3 py-1 text-xs text-muted">Live-Entwurf · {draft.path} · noch nicht übernommen</summary>
          <pre className="whitespace-pre-wrap p-3 font-mono text-xs">{draft.content}</pre>
        </details>
      ) : null;

  if (!activePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-8 text-center">
        {liveDraft}
        <p className="font-display text-lg font-medium tracking-tight text-fg">{t("emptyEditor")}</p>
        <p className="mt-2 max-w-sm text-sm text-muted text-pretty">{t("emptyEditorH")}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="primary"
            className="h-8 px-3 text-xs"
            onClick={() => {
              void import("@/lib/disk").then(async (d) => {
                if (!d.diskSupported()) {
                  useIde.getState().setNotice("Ordnerwahl nur in Chrome/Edge/Electron.");
                  return;
                }
                try {
                  const pack = await d.pickFolder();
                  const st = useIde.getState();
                  st.applyFiles(pack.files, pack.dirs);
                  st.setDiskName(d.diskFolderName());
                  const first = Object.keys(pack.files).sort()[0];
                  if (first) st.openFile(first);
                  const n = Object.keys(pack.files).length;
                  st.setNotice(pack.skipped ? `${n} Dateien, ${pack.skipped} übersprungen` : `${n} Dateien geladen`);
                } catch (err) {
                  useIde.getState().setNotice(err instanceof Error ? err.message : "Ordner fehlgeschlagen");
                }
              });
            }}
          >
            Ordner öffnen
          </Button>
          <Button
            className="h-8 px-3 text-xs"
            kbd={kNew}
            onClick={() => {
              useIde.getState().setSidebar("files");
              window.dispatchEvent(new CustomEvent("anvil-new-file", { detail: "file" }));
            }}
          >
            Neue Datei
          </Button>
          <Button className="h-8 px-3 text-xs" kbd={kAgent} onClick={() => useIde.getState().togglePanel("agent")}>
            Agent
          </Button>
        </div>
        <div className="mt-6">
          <StarterPick />
        </div>
      </div>
    );
  }

  const lang = langFromPath(activePath);
  const runnable = canRun(activePath) || Boolean(selectRunTarget(Object.keys(useIde.getState().files), activePath));
  const crumbs = activePath.split("/");

  return (
    <div ref={paneRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-bg">
      {pending.length > 0 ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 text-xs">
          <span className="truncate text-fg" title={diffSum}>
            {currentDiff?.source === "round" ? `${t("roundDiff")} · ` : ""}
            {t("roundFiles", { n: pending.length })}
            {diffSum ? ` · ${diffSum}` : ""}
          </span>
          {currentDiff ? (
            <>
              <Button variant="primary" className="h-7 px-2 text-xs" onClick={() => acceptDiff(activePath)}>
                {currentDiff.source === "external" ? "Editorstand speichern" : currentDiff.source === "round" ? t("keepFile") : t("accept")}
              </Button>
              <Button className="h-7 px-2 text-xs" onClick={() => rejectDiff(activePath)}>
                {currentDiff.source === "external" ? "Plattenstand laden" : currentDiff.source === "round" ? t("revertFile") : t("reject")}
              </Button>
            </>
          ) : null}
          <Button variant="primary" className="h-7 px-2 text-xs" onClick={acceptAllDiffs}>
            Alle
          </Button>
          <Button className="h-7 px-2 text-xs" onClick={rejectAllDiffs}>
            Alle verwerfen
          </Button>
          {currentDiff ? (
            <button
              type="button"
              className="ml-auto text-muted hover:text-fg"
              onClick={() => setShowDiff((v) => !v)}
            >
              {showDiff ? "Code" : "Diff"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex h-10 min-w-0 shrink-0 items-center overflow-hidden border-b border-border bg-surface">
        <div
          ref={tabStrip}
          className="bar-scroll flex h-10 min-w-0 flex-1 items-center"
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) {
              useIde.getState().setSidebar("files");
              window.dispatchEvent(new CustomEvent("anvil-new-file", { detail: "file" }));
            }
          }}
        >
          {shownTabs.map((p) => (
            <div
              key={p}
              className={cn(
                "relative flex h-10 min-w-[4.5rem] max-w-[11rem] flex-1 items-center overflow-hidden border-r border-border",
                p === activePath ? "bg-bg text-fg" : "text-muted hover:bg-hover hover:text-fg",
                tabOver === p ? "border-l-2 border-l-accent bg-hover" : "",
              )}
              data-tab={p}
              onDragOver={(e) => {
                e.preventDefault();
                setTabOver(p);
              }}
              onDragLeave={() => setTabOver((x) => (x === p ? null : x))}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTabOver(null);
                if (hasOsFiles(e.dataTransfer) && e.dataTransfer.files.length) {
                  const files = [...e.dataTransfer.files];
                  void confirmApp(t("dropFiles").replace("{n}", String(files.length)), { ok: t("dropOk") }).then((ok) => {
                    if (!ok) return;
                    void importDropped(files, "").then((n) => {
                      if (n) useIde.getState().setNotice(`${n} Dateien`);
                    });
                  });
                  return;
                }
                const drag = getDrag(e.dataTransfer);
                if (!drag?.path) return;
                if (drag.kind === "tab") useIde.getState().reorderTabs(drag.path, p);
                else openFile(drag.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ x: e.clientX, y: e.clientY, path: p });
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void askClose(p);
                }
              }}
              title={getTabHint(p) ? `${p} — ${getTabHint(p)}` : p}
            >
              <button
                type="button"
                draggable
                className="h-full min-w-0 flex-1 truncate px-2 text-left text-sm"
                onClick={() => openFile(p)}
                onDragStart={(e) => {
                  setDrag(e.dataTransfer, { kind: "tab", path: p });
                }}
              >
                {p.split("/").pop()}
                {dirty[p] ? <span className="ml-1 inline-block size-1.5 rounded-full bg-accent align-middle think-live" /> : null}
              </button>
              {p === activePath ? <span className="ui-line pointer-events-none absolute inset-x-3 bottom-0 h-px bg-accent" /> : null}
              <button
                type="button"
                className="h-full pr-2 text-subtle hover:text-fg"
                aria-label="Tab schließen"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void askClose(p);
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="h-10 w-8 shrink-0 text-subtle hover:text-fg"
            title={t("newFile")}
            onClick={() => {
              useIde.getState().setSidebar("files");
              window.dispatchEvent(new CustomEvent("anvil-new-file", { detail: "file" }));
            }}
          >
            +
          </button>
        </div>
        {openPaths.length > 1 || (!compact && packedTabs.length) ? (
          <div className="flex shrink-0 items-center self-stretch">
            {openPaths.length > 1 ? (
              <div className="relative h-10">
                <button
                  type="button"
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-1 border-l border-border px-2.5 font-mono text-[11px] tabular-nums hover:bg-hover hover:text-fg",
                    tabFly?.id === "all" ? "bg-bg text-fg" : "text-muted",
                  )}
                  title="Offene Dateien"
                  aria-expanded={tabFly?.id === "all"}
                  onClick={(e) =>
                    setTabFly((v) => (v?.id === "all" ? null : { id: "all", el: e.currentTarget }))
                  }
                >
                  {openPaths.length}
                  <ChevronDown className={cn("size-3 shrink-0", tabFly?.id === "all" && "rotate-180")} />
                </button>
              </div>
            ) : null}
            {compact
              ? null
              : packedTabs.map((g) => (
              <div key={g.k} className="relative h-10">
                <button
                  type="button"
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-1 border-l border-border px-2 font-mono text-[11px] hover:bg-hover hover:text-fg",
                    tabFly?.id === g.k ? "bg-bg text-fg" : "text-muted",
                  )}
                  title={`${g.paths.length} ${g.k}`}
                  aria-expanded={tabFly?.id === g.k}
                  onClick={(e) =>
                    setTabFly((v) => (v?.id === g.k ? null : { id: g.k, el: e.currentTarget }))
                  }
                >
                  {g.k}
                  <span className="tabular-nums">{g.paths.length}</span>
                  <ChevronDown className={cn("size-3 shrink-0", tabFly?.id === g.k && "rotate-180")} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex h-10 shrink-0 items-center gap-0.5 px-1">
          <Button
            variant="ghost"
            className={cn("h-8 w-8 p-0", previewOpen && !runPopout ? "text-fg" : "")}
            onClick={() => {
              if (runPopout) dockRunWindow();
              else setPreviewOpen(!previewOpen);
            }}
            aria-label={t("preview")}
            title={t("preview")}
          >
            <Eye className="size-3.5" />
          </Button>
          <Button variant="primary" className={cn("h-8 px-2", compact && "w-8 p-0")} disabled={!runnable || running} onClick={() => void run()} title={t("execute")} kbd={kRun}>
            <Play className="size-3.5" />
            {compact ? null : running && !debug.active ? t("busy") : t("run")}
          </Button>
          <Button
            className="h-8 w-8 p-0"
            title={t("runWindow")}
            aria-label="Run-Fenster"
            kbd={kRunWin}
            onClick={() => {
              if (/\.html?$/i.test(activePath || "")) openRunWindow();
              void run();
            }}
          >
            <SquareArrowOutUpRight className="size-3.5" />
          </Button>
          <Button
            className="h-8 w-8 p-0"
            disabled={!canDebug(activePath) || running}
            title={t("debug")}
            kbd={kDbg}
            onClick={() => {
              const hasBp = Object.values(useIde.getState().breakpoints).some((a) => a.length);
              useIde.getState().revealOutput();
              void startDebug(activePath, useIde.getState().files, { pauseOnEntry: !hasBp });
            }}
          >
            <Bug className="size-3.5" />
          </Button>
          {debug.active ? (
            <>
              <Button className="h-8 w-8 p-0" disabled={!debug.paused} onClick={() => debugContinue()} title="Weiter" kbd={kDbg}>
                <Play className="size-3.5" />
              </Button>
              <Button className="h-8 w-8 p-0" disabled={!debug.paused} onClick={() => debugStep()} title="Schritt" kbd={kStep}>
                <StepForward className="size-3.5" />
              </Button>
              <Button className="h-8 w-8 p-0" variant="danger" onClick={() => debugStop()} title="Stop" kbd={kDbgStop}>
                <Square className="size-3.5" />
              </Button>
            </>
          ) : null}
          <div className="relative">
            <Button
              className="h-8 w-8 p-0"
              title="Mehr"
              aria-expanded={moreOpen}
              onClick={(e) => {
                moreBtn.current = e.currentTarget;
                setMoreOpen((v) => !v);
              }}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
      <div className="bar-scroll flex h-7 shrink-0 items-center gap-1 border-b border-border px-3 font-mono text-[11px] text-subtle">
        {crumbs.map((c, i) => {
          const full = crumbs.slice(0, i + 1).join("/");
          const last = i === crumbs.length - 1;
          return (
            <span key={full} className="flex items-center">
              {i > 0 ? <span className="mx-1 text-border">/</span> : null}
              <button
                type="button"
                className={cn("hover:text-fg", last ? "text-fg" : "")}
                title={full}
                onClick={() => {
                  if (last) openFile(full);
                  else useIde.getState().revealPath(full);
                }}
              >
                {c}
              </button>
            </span>
          );
        })}
      </div>
      <ResultStrip path={activePath} />
      <PeekBar />
      {find ? (
        <div className="flex items-center gap-2 border-b border-border bg-surface px-2 py-1">
          <input
            autoFocus
            value={find.q}
            placeholder="Suchen in Datei"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none"
            onChange={(e) => setFind({ q: e.target.value, i: 0 })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                jumpFind(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") setFind(null);
            }}
          />
          <span className="text-xs tabular-nums text-muted">
            {findHits.length ? `${(find.i % findHits.length) + 1}/${findHits.length}` : "0"}
          </span>
          <Button className="h-8 px-2 text-xs" onClick={() => jumpFind(-1)}>
            ↑
          </Button>
          <Button className="h-8 px-2 text-xs" onClick={() => jumpFind(1)}>
            ↓
          </Button>
          {find.repl != null ? (
            <>
              <input
                value={find.repl}
                placeholder="Ersetzen durch"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none"
                onChange={(e) => setFind({ ...find, repl: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    replaceOne();
                  }
                }}
              />
              <Button className="h-8 px-2 text-xs" onClick={replaceOne}>
                Eins
              </Button>
              <Button className="h-8 px-2 text-xs" onClick={replaceAll}>
                Alle
              </Button>
            </>
          ) : (
            <Button className="h-8 px-2 text-xs" onClick={() => setFind({ ...find, repl: "" })}>
              Ersetzen
            </Button>
          )}
        </div>
      ) : null}
      {symOpen && activePath ? (
        <div className="max-h-48 overflow-auto border-b border-border bg-surface px-2 py-1">
          <input
            autoFocus
            value={sym}
            placeholder="Symbol in Datei…"
            className="mb-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none"
            onChange={(e) => setSym(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSymOpen(false);
              if (e.key === "Enter") {
                const hits = listSymbols(activeSrc, activePath).filter((s) =>
                  s.text.toLowerCase().includes(sym.toLowerCase()),
                );
                if (hits[0]) {
                  gotoFile(hits[0].path, hits[0].line, false);
                  setSymOpen(false);
                }
              }
            }}
          />
          {listSymbols(activeSrc, activePath)
            .filter((s) => !sym || s.text.toLowerCase().includes(sym.toLowerCase()))
            .slice(0, 20)
            .map((s) => (
              <button
                key={`${s.line}:${s.text}`}
                type="button"
                className="block w-full truncate px-1 py-0.5 text-left font-mono text-[11px] text-muted hover:bg-hover hover:text-fg"
                onClick={() => {
                  gotoFile(s.path, s.line, false);
                  setSymOpen(false);
                }}
              >
                {s.line}  {s.text}
              </button>
            ))}
        </div>
      ) : null}
      {goto !== null ? (
        <form
          className="flex items-center gap-2 border-b border-border bg-surface px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            goLine();
          }}
        >
          <input
            autoFocus
            value={goto}
            placeholder="Zeile"
            className="h-8 w-24 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none"
            onChange={(e) => setGoto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setGoto(null);
            }}
          />
          <Button type="submit" className="h-8 px-2 text-xs" variant="primary">
            Gehe zu
          </Button>
        </form>
      ) : null}
      {inline ? (
        <form
          className="flex gap-2 border-b border-border bg-surface px-2 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void applyInline();
          }}
        >
          <input
            autoFocus
            value={inline.prompt}
            disabled={inline.busy}
            placeholder="Änderung beschreiben…"
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-ring"
            onChange={(e) => setInline({ ...inline, prompt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") (inlineTicket.current++, setInline(null));
            }}
          />
          <Button type="submit" variant="primary" className="h-9" disabled={inline.busy || !inline.prompt.trim()}>
            {inline.busy ? "…" : "Edit"}
          </Button>
          <Button type="button" className="h-9" onClick={() => (inlineTicket.current++, setInline(null))}>
            Abbrechen
          </Button>
        </form>
      ) : null}
      {liveDraft}
      {currentDiff && showDiff ? (
        <DiffView path={currentDiff.path} before={currentDiff.before} after={currentDiff.after} />
      ) : (
        <div
          className={cn("flex min-h-0 flex-1", edOver ? "ring-1 ring-inset ring-accent/40" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            setEdOver(true);
          }}
          onDragLeave={() => setEdOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEdOver(false);
            const dir = activePath.includes("/") ? activePath.slice(0, activePath.lastIndexOf("/")) : "";
            if (hasOsFiles(e.dataTransfer) && e.dataTransfer.files.length) {
              const files = [...e.dataTransfer.files];
              void confirmApp(t("dropFiles").replace("{n}", String(files.length)), { ok: t("dropOk") }).then((ok) => {
                if (!ok) return;
                void importDropped(files, dir).then((n) => {
                  if (n) useIde.getState().setNotice(`${n} nach ${dir || "/"}`);
                });
              });
              return;
            }
            const drag = getDrag(e.dataTransfer);
            if (drag?.path) openFile(drag.path);
          }}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {isSecretPath(activePath) && !reveal[activePath] ? (
              <SecretGate
                path={activePath}
                src={activeSrc}
                onReveal={() => setReveal({ ...reveal, [activePath]: true })}
              />
            ) : isRefImage(activeSrc) ? (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-bg p-4">
                <img src={refImageSrc(activeSrc)} alt={activePath} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (activeSrc?.length ?? 0) > EDITOR_MAX_CHARS ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
                <p className="mb-2 text-xs text-muted">{t("fileTooBig").replace("{n}", String(activeSrc.length))}</p>
                <pre className="whitespace-pre-wrap font-mono text-[11px] text-subtle">{activeSrc.slice(0, 24_000)}…</pre>
              </div>
            ) : (
            <CodeEditor
              path={activePath}
              value={activeSrc}
              language={lang}
              onChange={(v) => setContent(activePath, v)}
              onRun={() => void run()}
              onInlineEdit={(sel) => setInline({ ...sel, prompt: "", busy: false })}
              onAskSelection={(sel) => {
                useIde.getState().setPendingAsk({ path: activePath, text: sel.text });
                useIde.getState().setAgentMode("ask");
                useIde.getState().togglePanel("agent");
              }}
              onFind={() => setFind({ q: "", i: 0 })}
              onGoto={() => setGoto("")}
            />
            )}
          </div>
          {previewOpen && !runPopout ? (
            <div className="flex min-h-0 w-[min(48%,28rem)] shrink-0 flex-col border-l border-border">
              <PreviewPane />
            </div>
          ) : null}
        </div>
      )}
      {tabMenu ? (
        <CtxMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          items={[
            { label: "Schließen", onClick: () => void askClose(tabMenu.path) },
            {
              label: "Andere schließen",
              onClick: () => void askCloseOthers(tabMenu.path),
            },
            { label: "Im Explorer", onClick: () => useIde.getState().revealPath(tabMenu.path) },
            { label: "Pfad kopieren", onClick: () => void navigator.clipboard.writeText(tabMenu.path) },
            {
              label: "Nach ref/",
              onClick: () => {
                const st = useIde.getState();
                const dest = copyIntoRef(st.files, tabMenu.path);
                if ("error" in dest) {
                  st.setNotice(dest.error);
                  return;
                }
                st.writeFile(dest.path, st.files[tabMenu.path] ?? "");
                st.setNotice(`→ ${dest.path}`);
              },
            },
            {
              label: "Agent: erklären",
              onClick: () => void import("@/lib/fix-agent").then((m) => m.askFile(tabMenu.path, "explain")),
            },
            {
              label: "Agent: Tests",
              onClick: () => void import("@/lib/fix-agent").then((m) => m.askFile(tabMenu.path, "tests")),
            },
            {
              label: "Agent: Review",
              onClick: () => void import("@/lib/fix-agent").then((m) => m.askFile(tabMenu.path, "review")),
            },
          ]}
        />
      ) : null}
      {tabFly ? (
        <FlyAt anchor={tabFly.el} within={paneRef.current} onClose={() => setTabFly(null)}>
          {(tabFly.id === "all" ? openPaths : packedTabs.find((g) => g.k === tabFly.id)?.paths ?? []).map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              className={cn(
                "flex h-8 w-full items-center justify-between gap-2 px-3 text-left text-xs hover:bg-hover",
                p === activePath ? "text-fg" : "text-muted",
              )}
              onClick={() => {
                openFile(p);
                setTabFly(null);
              }}
            >
              <span className="min-w-0 truncate">{tabFly.id === "all" ? p : p.split("/").pop()}</span>
              {dirty[p] ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
              <span
                role="button"
                className="shrink-0 text-subtle hover:text-fg"
                onClick={(e) => {
                  e.stopPropagation();
                  void askClose(p);
                }}
              >
                ×
              </span>
            </button>
          ))}
        </FlyAt>
      ) : null}
      {moreOpen && moreBtn.current ? (
        <FlyAt
          anchor={moreBtn.current}
          within={paneRef.current}
          onClose={() => setMoreOpen(false)}
        >
          <button
            type="button"
            role="menuitem"
            className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs hover:bg-hover"
            onClick={() => {
              const v = activeSrc;
              setInline({ start: 0, end: v.length, text: v, prompt: "", busy: false });
              setMoreOpen(false);
            }}
          >
            <Sparkles className="size-3.5" />
            {t("inlineEdit")}
            {kInline ? <span className="ml-auto font-mono text-[10px] text-subtle">{kInline}</span> : null}
          </button>
          <button
            type="button"
            role="menuitem"
            className={cn("flex h-8 w-full items-center gap-2 px-3 text-left text-xs hover:bg-hover", liveRun && "text-fg")}
            onClick={() => {
              setLiveRun(!liveRun);
              setMoreOpen(false);
            }}
          >
            {t("liveRun")}
            <span className="ml-auto text-[10px] text-subtle">{liveRun ? "an" : "aus"}</span>
          </button>
        </FlyAt>
      ) : null}
    </div>
  );
}

function PeekBar() {
  const peek = useIde((s) => s.peek);
  const files = useIde((s) => s.files);
  const setPeek = useIde((s) => s.setPeek);
  if (!peek) return null;
  return (
    <div className="max-h-44 shrink-0 overflow-auto border-b border-border bg-surface">
      <div className="flex h-7 items-center justify-between px-3">
        <span className="text-[11px] text-muted">
          Peek <span className="font-mono text-fg">{peek.word}</span>
        </span>
        <button type="button" className="text-subtle hover:text-fg" onClick={() => setPeek(null)}>
          Esc
        </button>
      </div>
      {peek.defs.map((d) => {
        const lines = (files[d.path] ?? "").split("\n");
        const from = Math.max(0, d.line - 2);
        const snip = lines.slice(from, d.line + 4);
        return (
          <button
            key={`${d.path}:${d.line}`}
            type="button"
            className="block w-full border-t border-border px-3 py-1.5 text-left hover:bg-hover"
            onClick={() => {
              gotoFile(d.path, d.line);
              setPeek(null);
            }}
          >
            <span className="font-mono text-[11px] text-muted">
              {d.path}:{d.line}
            </span>
            <pre className="mt-1 font-mono text-[11px] leading-4 text-fg">
              {snip.map((l, i) => (
                <span key={i} className={from + i + 1 === d.line ? "block bg-hover" : "block"}>
                  {l || " "}
                </span>
              ))}
            </pre>
          </button>
        );
      })}
    </div>
  );
}

function SecretGate({ path, src, onReveal }: { path: string; src: string; onReveal: () => void }) {
  const t = useT();
  const names = envNames(src);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 p-6">
      <p className="text-sm text-fg">{t("vaultLock")}</p>
      <p className="max-w-md text-xs text-muted">{t("vaultHint")}</p>
      <p className="font-mono text-[11px] text-subtle">{path}</p>
      {names.length ? (
        <ul className="font-mono text-xs text-muted">
          {names.slice(0, 24).map((n) => (
            <li key={n}>{n}=••••</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-subtle">{src.split("\n").length} Zeilen</p>
      )}
      <Button className="h-8" onClick={onReveal}>
        {t("vaultReveal")}
      </Button>
    </div>
  );
}

function ResultStrip({ path }: { path: string }) {
  const output = useIde((s) => s.output);
  const last = [...output].reverse().find((r) => r.label === path);
  if (!last) return null;
  const snap = last;
  const text = (snap.ok ? snap.stdout : snap.stderr || snap.stdout).trim();
  const preview = text.split("\n").slice(0, 3).join(" · ").slice(0, 220);

  async function explain() {
    const s = useIde.getState();
    if (s.agentBusy) {
      s.pushAgent(`Erkläre die letzte Ausführung von ${path} anhand der echten Ausgabe.`);
      return;
    }
    s.setPanels({ ...s.panels, agent: true });
    const my = beginAgent();
    s.addChat({
      role: "user",
      content: `Erkläre die letzte Ausführung von ${path} anhand der echten Ausgabe.`,
    });
    s.startAssistant();
    s.setAgentBusy(true);
    try {
      const reply = await completeText({
        prompt: `Du erklärst, was dieser Code GETAN hat — nicht was er tun sollte. Kurz, auf Deutsch.\n\nDATEI ${path}:\n${(s.files[path] ?? "").slice(0, 6000)}\n\nAUSGABE:\n${(snap.stdout || "(leer)").slice(0, 3000)}\n\nFEHLER:\n${(snap.stderr || "(keiner)").slice(0, 2000)}`,
        provider: s.llmProvider,
        baseUrl: s.llmBaseUrl,
        model: s.llmModel,
        apiKey: s.llmApiKey,
      });
      if (my !== agentGen()) return;
      s.finalizeAssistant(reply);
    } catch (err) {
      if (my !== agentGen()) return;
      s.finalizeAssistant(err instanceof Error ? err.message : "Erklärung fehlgeschlagen");
    } finally {
      if (my === agentGen()) s.setAgentBusy(false);
    }
  }

  return (
    <div className="bar-scroll flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
      <span className={cn("shrink-0 text-[11px] tabular-nums", snap.ok ? "text-ok" : "text-danger")}>
        {snap.ok ? "ok" : "fehler"} {snap.duration.toFixed(2)}s
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{preview || "kein Output"}</span>
      <Button variant="quiet" className="h-7 px-2 text-[11px]" onClick={() => void explain()}>
        Erklären
      </Button>
      {!snap.ok ? (
        <Button
          variant="quiet"
          className="h-7 px-2 text-[11px]"
          onClick={() => void import("@/lib/fix-agent").then((m) => m.askRun(path))}
        >
          Agent
        </Button>
      ) : null}
    </div>
  );
}

function tabKind(path: string) {
  const name = path.split(/[/\\]/).pop() ?? path;
  const i = name.lastIndexOf(".");
  if (i <= 0) return "Datei";
  return name.slice(i + 1).toUpperCase();
}

function pickVisibleTabs(paths: string[], active: string | null, fit: number) {
  if (paths.length <= fit) return paths;
  const must = active && paths.includes(active) ? active : null;
  const out: string[] = [];
  for (const p of paths) {
    if (out.length >= fit) break;
    if (must && p !== must && out.length === fit - 1 && !out.includes(must)) continue;
    out.push(p);
  }
  if (must && !out.includes(must)) {
    if (out.length >= fit) out[out.length - 1] = must;
    else out.push(must);
  }
  return out;
}

function packTabs(hidden: string[]) {
  const map = new Map<string, string[]>();
  for (const p of hidden) {
    const k = tabKind(p);
    const row = map.get(k);
    if (row) row.push(p);
    else map.set(k, [p]);
  }
  return [...map.entries()].map(([k, paths]) => ({ k, paths }));
}
