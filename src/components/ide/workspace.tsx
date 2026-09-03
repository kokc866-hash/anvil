import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityBar } from "./activity-bar";
import { FileTree } from "./file-tree";
import { EditorPane } from "./editor-pane";
import { ChatPane } from "./chat-pane";
import { TrailPane } from "./trail-pane";
import { OutputPane } from "./output-pane";
import { SettingsPane } from "./settings-pane";
import { HarnessBoard } from "./harness-board";
import { SearchPane } from "./search-pane";
import { GitPane } from "./git-pane";
import { ExtensionsPane } from "./extensions-pane";
import { MemoryPane } from "./memory-pane";
import { TestsPane } from "./tests-pane";
import { RefPane } from "./ref-pane";
import { McpPane } from "./mcp-pane";
import { StatusBar } from "./status-bar";
import { CommandPalette } from "./command-palette";
import { HSplit, VSplit } from "./splitter";
import { startDebug, debugStep, debugStop } from "@/lib/debug-engine";
import { runFile } from "@/lib/run-client";
import { startIdeSync } from "@/lib/ide-sync";
import { activateBuiltins, loadWorkspacePlugins } from "@/lib/plugins";
import { loadVscodeFromWorkspace } from "@/lib/plugins/vscode";
import { hasOsFiles, importDropped } from "@/lib/dnd";
import { restoreLocations, saveSlot, loadSlotAll, hasLocation } from "@/lib/disk";
import { focusOutputWindow, openOutputWindow } from "@/lib/output-window";
import { openRunWindow } from "@/lib/run-window";
import { DEMO_PATHS, SEED_FILES } from "@/lib/seed-files";
import { loadSecrets, keyForProvider } from "@/lib/secrets";
import { useLearn } from "@/lib/learn";
import { matchKey, typingInField, KEY_IN_FIELD } from "@/lib/keymap";
import { stopAgent } from "@/lib/abort";
import { gotoFile } from "@/lib/goto";
import { saveNow, focusAgent } from "@/lib/save";
import { useIde } from "@/store/ide";
import { applyLang } from "@/lib/i18n";
import { InternPane } from "./intern-pane";
import { ConfirmHost } from "./confirm-host";
import { StarterPick } from "./starter-pick";
import { FirstRun } from "./first-run";
import { startIntern, useIntern } from "@/lib/intern";
import { ACTIVITY_W, EDITOR_MIN, SIDE_MIN, SPLIT_W, applyPaneDrag, fitIdeLayout, fitStackTrail, overlayPanes } from "@/lib/layout";

function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#b4b0a6" : "#0a0a0b");
}

export function Workspace() {
  const panels = useIde((s) => s.panels);
  const settingsOpen = useIde((s) => s.settingsOpen);
  const harnessBoardOpen = useIde((s) => s.harnessBoardOpen);
  const theme = useIde((s) => s.theme);
  const locale = useIde((s) => s.locale);
  const motion = useIde((s) => s.motion);
  const sidebar = useIde((s) => s.sidebar);
  const fontSize = useIde((s) => s.fontSize);
  const sidebarWidth = useIde((s) => s.sidebarWidth);
  const agentWidth = useIde((s) => s.agentWidth);
  const outputHeight = useIde((s) => s.outputHeight);
  const outputWidth = useIde((s) => s.outputWidth);
  const trailWidth = useIde((s) => s.trailWidth);
  const outputDock = useIde((s) => s.outputDock);
  const splitMode = useIde((s) => s.splitMode);
  const outputPopout = useIde((s) => s.outputPopout);
  const setSidebarWidth = useIde((s) => s.setSidebarWidth);
  const setAgentWidth = useIde((s) => s.setAgentWidth);
  const setOutputHeight = useIde((s) => s.setOutputHeight);
  const setOutputWidth = useIde((s) => s.setOutputWidth);
  const setTrailWidth = useIde((s) => s.setTrailWidth);
  const setPalette = useIde((s) => s.setPalette);
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const setRunning = useIde((s) => s.setRunning);
  const pushOutput = useIde((s) => s.pushOutput);
  const notice = useIde((s) => s.notice);
  const pluginDisabled = useIde((s) => s.pluginDisabled);
  const setNotice = useIde((s) => s.setNotice);
  const showStatusBar = useIde((s) => s.showStatusBar);
  const autoSaveDisk = useIde((s) => s.autoSaveDisk);
  const boot = useIntern((s) => s.boot);
  const shellRef = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(1280);
  const [starterOpen, setStarterOpen] = useState(false);

  useEffect(() => {
    startIntern();
  }, []);

  useEffect(() => {
    function onStarter() {
      setStarterOpen(true);
    }
    window.addEventListener("anvil-starter", onStarter);
    return () => window.removeEventListener("anvil-starter", onStarter);
  }, []);

  useEffect(() => {
    const done = useIde.persist.rehydrate();
    let stopSync: (() => void) | undefined;
    void Promise.resolve(done).then(() => {
      const files = { ...useIde.getState().files };
      for (const p of DEMO_PATHS) delete files[p];
      const merged = { ...SEED_FILES, ...files };
      for (const p of DEMO_PATHS) delete merged[p];
      const openPaths = useIde.getState().openPaths.filter((p) => p in merged && !DEMO_PATHS.includes(p));
      const current = useIde.getState().activePath;
      const keys = Object.keys(merged).filter((p) => !p.startsWith(".anvil/"));
      const activePath = current && current in merged && !DEMO_PATHS.includes(current) ? current : keys[0] || "";
      const sec = loadSecrets();
      const provider = useIde.getState().llmProvider;
      useIde.setState({
        files: merged,
        openPaths,
        activePath,
        llmApiKey: keyForProvider(provider) || useIde.getState().llmApiKey,
        githubToken: sec.githubToken || useIde.getState().githubToken,
        previewOpen: false,
        agentBusy: false,
        agentStartedAt: 0,
        running: false,
        agentQueue: [],
      });
      if (useIde.getState().llmProvider === "brain") useIde.getState().setLlmProvider("ollama");
      loadWorkspacePlugins(useIde.getState().files);
      loadVscodeFromWorkspace(useIde.getState().files);
      void import("@/lib/brain").then(async (b) => {
        await b.useBrain.persist.rehydrate();
        const lib = await import("@/lib/model-lib");
        await lib.useModelLib.persist.rehydrate();
        if (useIde.getState().autoHw) await import("@/lib/hw").then((h) => h.applyHwTune());
        if (b.useBrain.getState().on && b.useBrain.getState().autoLoad) void b.loadBrain();
        b.startBrainAuto();
        const ml = lib.useModelLib.getState();
        if (ml.prefetchOnStart && ml.pinHelper.length) {
          const local = await import("@/lib/helper-local");
          for (const id of ml.pinHelper) {
            if (local.nativeHelper()) void local.downloadHelperLocal(id).catch(() => undefined);
            else void b.prefetchBrain(id).catch(() => undefined);
          }
        }
      });
      const native = (window as unknown as { anvilNative?: { companionToken?: () => Promise<string> } }).anvilNative;
      void native?.companionToken?.().then((tok) => {
        if (tok) void import("@/lib/companion").then((c) => c.setCompanionToken(tok));
      });
      void restoreLocations().then(async (names) => {
        const st = useIde.getState();
        st.setDiskName(names.workspace);
        st.setBackupName(names.backup);
        const cwd = st.workspaceCwd?.trim();
        if (cwd) {
          try {
            const { holdCompanion, releaseCompanion } = await import("@/lib/companion-life");
            const { companionTree } = await import("@/lib/companion");
            await holdCompanion();
            const tree = await companionTree(cwd);
            if (tree.ok && tree.files) {
              st.applyFiles(tree.files, tree.dirs);
              if (tree.skipped) st.setNotice(`${tree.n} Dateien, ${tree.skipped} übersprungen (Platten-Stand)`);
            }
            if (!st.companionKeep) await releaseCompanion();
          } catch {
            /* companion down — keep persisted cache */
          }
          return;
        }
        if (st.loadOnStart && names.workspace) {
          try {
            const pack = await loadSlotAll("workspace");
            st.applyFiles(pack.files, pack.dirs);
          } catch {
            st.setNotice("Workspace-Ordner in Einstellungen → Speicher erneut erlauben");
          }
        }
      });
      stopSync = startIdeSync();
      void import("@/lib/model-context").then((m) => m.applyCloudContext());
    });
    return () => stopSync?.();
  }, []);

  useEffect(() => {
    let t = 0;
    const tick = () => {
      void import("@/lib/engines").then(async ({ hasEngineHint, primaryEngine }) => {
        const { companionPing } = await import("@/lib/companion");
        const st = useIde.getState();
        if (!hasEngineHint(st.files, st.dirs)) {
          if (st.engineLink) st.setEngineLink(null);
          return;
        }
        const hit = primaryEngine(st.files, st.dirs);
        if (!hit) {
          if (st.engineLink) st.setEngineLink(null);
          return;
        }
        const ping = await companionPing(st.companionUrl);
        st.setEngineLink({ label: hit.label, ok: ping.ok });
      });
    };
    tick();
    t = window.setInterval(tick, 45000);
    const vis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyLang(locale);
  }, [locale]);

  useEffect(() => {
    const applyFiles = (files: Record<string, string>) => {
      (window as unknown as { __anvilFiles?: Record<string, string> }).__anvilFiles = files;
      (window as unknown as { __anvilIde?: typeof useIde }).__anvilIde = useIde;
    };
    applyFiles(useIde.getState().files);
    let lint = 0;
    const kick = () => {
      window.clearTimeout(lint);
      lint = window.setTimeout(() => {
        void import("@/lib/lsp").then((l) => {
          const st = useIde.getState();
          void import("@/lib/ws-index").then((w) => w.rebuildIndex(st.files));
          st.setLspProblems(l.lintWorkspace(st.files, st.openPaths));
          void import("@/lib/lsp-compile").then((c) =>
            c.lintDeep(st.files, st.openPaths).then((deep) => {
              void import("@/lib/problems").then((p) => p.noteCompileChecked(deep.checked));
              useIde.getState().setCompileProblems(deep.hits);
            }),
          );
          void import("@/lib/companion-lint").then((c) => c.scheduleCompanionLint());
        });
      }, 400);
    };
    kick();
    const unsub = useIde.subscribe((s, prev) => {
      if (s.files === prev.files && s.openPaths === prev.openPaths) return;
      applyFiles(s.files);
      kick();
    });
    return () => {
      unsub();
      window.clearTimeout(lint);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  useEffect(() => {
    if (!autoSaveDisk) return;
    let t = 0;
    const unsub = useIde.subscribe((s, prev) => {
      if (s.files === prev.files) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (!hasLocation("workspace")) return;
        void saveSlot("workspace", useIde.getState().files, useIde.getState().dirs).catch(() => undefined);
      }, 1800);
    });
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, [autoSaveDisk]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const read = () => setInner(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    activateBuiltins();
    const plugSig = (files: Record<string, string>) =>
      Object.keys(files)
        .filter((p) => p.startsWith("plugins/") || p.startsWith(".vscode/") || p.startsWith(".anvil/") || /\.anvil\.(js|mjs|json)$/.test(p) || p.endsWith(".code-snippets"))
        .sort()
        .map((p) => `${p}:${files[p].length}`)
        .join("|");
    let last = "";
    const boot = () => {
      const files = useIde.getState().files;
      const sig = plugSig(files);
      if (sig === last) return;
      last = sig;
      loadWorkspacePlugins(files);
      loadVscodeFromWorkspace(files);
    };
    boot();
    return useIde.subscribe((s, prev) => {
      if (s.files === prev.files && s.pluginDisabled === prev.pluginDisabled) return;
      boot();
    });
  }, [pluginDisabled]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(t);
  }, [notice, setNotice]);

  useEffect(() => {
    async function runActive() {
      const st = useIde.getState();
      const path = st.activePath;
      if (!path) return;
      st.setRunPath(path);
      if (/\.html?$/i.test(path) || st.runInWindow || st.runPopout) {
        openRunWindow();
        st.setPreviewOpen(false);
      } else if (st.openOutputOnRun) st.revealOutput();
      setRunning(true);
      try {
        pushOutput(await runFile(path, st.files));
      } catch (err) {
        pushOutput({
          ok: false,
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
          duration: 0,
          label: path,
        });
      } finally {
        setRunning(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if ((window as Window & { __anvilBindKey?: boolean }).__anvilBindKey) return;
      const st = useIde.getState();
      if (e.key === "Escape") {
        if (st.palette) {
          st.setPalette(null);
          return;
        }
        if (st.settingsOpen) {
          st.setSettingsOpen(false);
          return;
        }
        if (useIntern.getState().pane) {
          useIntern.getState().setPane(false);
          return;
        }
        if (st.harnessBoardOpen) {
          st.setHarnessBoardOpen(false);
          return;
        }
        if (st.peek) {
          st.setPeek(null);
          return;
        }
        if (st.pendingAsk) {
          st.setPendingAsk(null);
          return;
        }
        window.dispatchEvent(new Event("anvil-escape"));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Tab") {
        e.preventDefault();
        st.cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      const id = matchKey(e, st.keyMap);
      if (!id) return;
      if (typingInField(e) && !KEY_IN_FIELD.includes(id)) return;
      e.preventDefault();
      e.stopPropagation();
      switch (id) {
        case "openFile":
          setPalette("files");
          break;
        case "palette":
          setPalette("commands");
          break;
        case "settings":
          setSettingsOpen(!st.settingsOpen);
          break;
        case "save":
          void saveNow();
          break;
        case "saveAll":
          void saveNow();
          break;
        case "newFile":
          st.setSidebar("files");
          window.dispatchEvent(new CustomEvent("anvil-new-file", { detail: "file" }));
          break;
        case "newFolder":
          st.setSidebar("files");
          window.dispatchEvent(new CustomEvent("anvil-new-file", { detail: "dir" }));
          break;
        case "askSel":
          focusAgent();
          window.dispatchEvent(new Event("anvil-ask-sel"));
          break;
        case "closeTab":
          if (st.activePath) st.closeFile(st.activePath);
          break;
        case "gotoLine":
          window.dispatchEvent(new Event("anvil-goto"));
          break;
        case "files":
          st.setSidebar(st.sidebar === "files" ? null : "files");
          break;
        case "agent":
          st.togglePanel("agent");
          break;
        case "git":
          st.setSidebar(st.sidebar === "git" ? null : "git");
          break;
        case "refs":
          st.setSidebar(st.sidebar === "ref" ? null : "ref");
          break;
        case "tests":
          st.setSidebar(st.sidebar === "tests" ? null : "tests");
          break;
        case "memory":
          st.setSidebar(st.sidebar === "learn" ? null : "learn");
          break;
        case "board":
          st.setHarnessBoardOpen(!st.harnessBoardOpen);
          break;
        case "intern":
          void import("@/lib/intern").then((m) => m.useIntern.getState().setPane(!m.useIntern.getState().pane));
          break;
        case "problems":
          st.revealOutput();
          window.dispatchEvent(new Event("anvil-problems"));
          break;
        case "output":
          st.togglePanel("output");
          break;
        case "trail":
          st.togglePanel("trail");
          break;
        case "reopen":
          st.reopenTab();
          break;
        case "nextTab":
          st.cycleTab(1);
          break;
        case "prevTab":
          st.cycleTab(-1);
          break;
        case "back":
          st.goJump(-1);
          break;
        case "forward":
          st.goJump(1);
          break;
        case "fontUp":
          st.setFontSize(st.fontSize + 1);
          break;
        case "fontDown":
          st.setFontSize(Math.max(10, st.fontSize - 1));
          break;
        case "zoomReset":
          st.setFontSize(13);
          break;
        case "wrap":
          st.setWordWrap(!st.wordWrap);
          break;
        case "run":
          window.dispatchEvent(new Event("anvil-run"));
          break;
        case "runWin":
          openRunWindow();
          break;
        case "debug":
          window.dispatchEvent(new Event("anvil-debug"));
          break;
        case "debugStep":
          window.dispatchEvent(new Event("anvil-debug-step"));
          break;
        case "debugStop":
          window.dispatchEvent(new Event("anvil-debug-stop"));
          break;
        case "search":
          st.setSidebar(st.sidebar === "search" ? null : "search");
          break;
        case "preview":
          st.setPreviewOpen(!st.previewOpen);
          break;
        case "stopAgent":
          stopAgent("Gestoppt");
          break;
        case "copyPath": {
          const p = st.activePath;
          if (p) {
            void navigator.clipboard.writeText(p);
            st.revealPath(p);
            st.setNotice(p);
          }
          break;
        }
        case "focusEditor":
          window.dispatchEvent(new Event("anvil-focus-editor"));
          break;
        case "nextProblem":
        case "prevProblem": {
          const hits = st.lspProblems;
          if (!hits.length) {
            st.revealOutput();
            break;
          }
          const dir = id === "nextProblem" ? 1 : -1;
          const cur = hits.findIndex((h) => h.path === st.activePath && h.line === st.cursor.line);
          const n = hits[(cur + dir + hits.length) % hits.length];
          if (n) void gotoFile(n.path, n.line);
          break;
        }
        default:
          window.dispatchEvent(new Event(`anvil-${id}`));
      }
    }
    function onUsage() {
      void import("@/lib/brain").then((b) => b.brainUsage());
    }
    function onLearn(e: Event) {
      const d = (e as CustomEvent<{ k?: string; d?: string }>).detail;
      if (d?.k) useLearn.getState().track(d.k, d.d);
    }
    function onRun() {
      const path = useIde.getState().activePath;
      if (path) useLearn.getState().track("run", path);
      void runActive();
    }
    function onDebug() {
      const st = useIde.getState();
      const path = st.activePath;
      if (!path) return;
      const hasBp = Object.values(st.breakpoints).some((a) => a.length);
      st.revealOutput();
      void startDebug(path, st.files, { pauseOnEntry: !hasBp });
    }
    function onDebugStep() {
      debugStep();
    }
    function onDebugStop() {
      debugStop();
    }
    function onFocusOutput() {
      if (useIde.getState().outputPopout) focusOutputWindow();
    }
    function onPopout() {
      openOutputWindow();
    }
    function onRunPopout() {
      openRunWindow();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("anvil-run", onRun);
    window.addEventListener("anvil-learn", onLearn as EventListener);
    window.addEventListener("anvil-brain-usage", onUsage);
    window.addEventListener("anvil-debug", onDebug);
    window.addEventListener("anvil-debug-step", onDebugStep);
    window.addEventListener("anvil-debug-stop", onDebugStop);
    window.addEventListener("anvil-focus-output", onFocusOutput);
    window.addEventListener("anvil-output-popout", onPopout);
    window.addEventListener("anvil-run-popout", onRunPopout);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("anvil-run", onRun);
      window.removeEventListener("anvil-learn", onLearn as EventListener);
      window.removeEventListener("anvil-brain-usage", onUsage);
      window.removeEventListener("anvil-debug", onDebug);
      window.removeEventListener("anvil-debug-step", onDebugStep);
      window.removeEventListener("anvil-debug-stop", onDebugStop);
      window.removeEventListener("anvil-focus-output", onFocusOutput);
      window.removeEventListener("anvil-output-popout", onPopout);
      window.removeEventListener("anvil-run-popout", onRunPopout);
    };
  }, [setPalette, setSettingsOpen, setRunning, pushOutput]);

  const showSide = Boolean(sidebar);
  const showOutput = panels.output && !outputPopout;
  const trailOpen = panels.trail;
  const agentOn = panels.agent;

  const fitArgs = {
    inner,
    splitMode,
    sideOn: showSide,
    trailOn: trailOpen,
    agentOn,
    sideW: sidebarWidth,
    trailW: trailWidth,
    agentW: agentWidth,
  };
  let fit = fitIdeLayout(fitArgs);
  let outputSide = false;
  if (showOutput && outputDock === "side" && splitMode !== "stack") {
    const outW = Math.min(640, Math.max(240, outputWidth)) + SPLIT_W;
    const withOut = fitIdeLayout({ ...fitArgs, inner: inner - outW });
    if (!withOut.overlayTrail && !withOut.overlayAgent) {
      fit = withOut;
      outputSide = true;
    }
  }
  const outputBottom = showOutput && !outputSide;
  const overlaySide = fit.overlaySide && showSide;
  const overlayTrailRow = fit.overlayTrail && trailOpen && splitMode !== "stack";
  const overlayAgent = fit.overlayAgent && agentOn && splitMode !== "stack";
  const agentBeside = agentOn && !overlayAgent && splitMode !== "stack";
  const agentBelow = agentOn && splitMode === "stack";
  const sideW = overlaySide ? 0 : fit.sideW;
  const trailW = overlayTrailRow ? 0 : fit.trailW;
  const agentW = overlayAgent ? 0 : fit.agentW;
  const trailBeside = trailOpen && !overlayTrailRow && splitMode !== "stack";
  const belowW = inner - ACTIVITY_W - (overlaySide ? 0 : sideW);
  const stackTrail = splitMode === "stack" ? fitStackTrail(belowW, trailOpen, trailWidth) : { trailW: 0, overlayTrail: false };
  const trailBelow = trailOpen && splitMode === "stack" && !stackTrail.overlayTrail;
  const overlayTrail = overlayTrailRow || (trailOpen && splitMode === "stack" && stackTrail.overlayTrail);
  const ov = overlayPanes({
    inner,
    overlayTrail,
    overlayAgent,
    trailW: trailWidth,
    agentW: agentWidth,
    besideAgentW: agentBeside ? agentW : 0,
  });
  const overlayRightW = ov.trailOnTop
    ? Math.max(ov.trailW, ov.agentW)
    : (overlayTrail ? ov.trailW : 0) + (overlayAgent ? ov.agentW : 0);
  const rightChrome =
    (outputSide ? outputWidth + SPLIT_W : 0) +
    (trailBeside ? trailW + SPLIT_W : 0) +
    (agentBeside ? agentW + SPLIT_W : 0) +
    overlayRightW;
  const overlaySideW = Math.min(Math.max(sidebarWidth, SIDE_MIN), 420, Math.max(SIDE_MIN, inner - ACTIVITY_W - 48));
  const edge = showStatusBar ? "bottom-6" : "bottom-0";
  const dragInner = outputSide ? inner - outputWidth - SPLIT_W : inner;
  const syncShown = () => {
    if (!overlaySide && sideW > 0) setSidebarWidth(sideW);
    if (trailBeside && trailW > 0) setTrailWidth(trailW);
    if (agentBeside && agentW > 0) setAgentWidth(agentW);
  };
  const commitDrag = (pane: "side" | "trail" | "agent", grow: number) => {
    const s = useIde.getState();
    const cur = pane === "side" ? s.sidebarWidth : pane === "trail" ? s.trailWidth : s.agentWidth;
    const w = applyPaneDrag({
      inner: dragInner,
      splitMode: s.splitMode,
      sideOn: showSide,
      trailOn: trailOpen,
      agentOn,
      sideW: s.sidebarWidth,
      trailW: s.trailWidth,
      agentW: s.agentWidth,
      pane,
      next: cur + grow,
    });
    s.setSidebarWidth(w.sideW);
    s.setTrailWidth(w.trailW);
    s.setAgentWidth(w.agentW);
  };

  return (
    <div
      ref={shellRef}
      className="relative flex h-dvh flex-col bg-bg text-fg"
      style={{ ["--editor-size" as string]: `${fontSize}px` }}
      onDragOver={(e) => {
        if (hasOsFiles(e.dataTransfer)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (![...e.dataTransfer.files].length) return;
        e.preventDefault();
        void importDropped([...e.dataTransfer.files], "").then((n) => {
          if (n) setNotice(`${n} Dateien importiert`);
        });
      }}
    >
      <FirstRun />
      <div key={boot} className="flex min-h-0 flex-1">
        <ActivityBar />
        {showSide && !overlaySide && sideW > 0 ? (
          <>
            <aside key={sidebar} className="ui-rail shrink-0 overflow-hidden border-r border-border" style={{ width: sideW }}>
              {sideBody(sidebar)}
            </aside>
            <VSplit onBegin={syncShown} onDrag={(dx) => commitDrag("side", dx)} />
          </>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1">
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                {harnessBoardOpen ? <HarnessBoard /> : <EditorPane />}
              </div>
              {outputSide ? (
                <>
                  <VSplit
                    onDrag={(dx) => {
                      const cur = useIde.getState().outputWidth;
                      const taken =
                        ACTIVITY_W +
                        EDITOR_MIN +
                        (overlaySide ? 0 : sideW + SPLIT_W) +
                        (trailBeside ? trailW + SPLIT_W : 0) +
                        (agentBeside ? agentW + SPLIT_W : 0) +
                        SPLIT_W;
                      setOutputWidth(Math.min(Math.max(240, inner - taken), cur + dx));
                    }}
                  />
                  <aside className="ui-pane min-h-0 shrink-0 border-l border-border" style={{ width: outputWidth }}>
                    <OutputPane />
                  </aside>
                </>
              ) : null}
              {trailBeside && trailW > 0 ? (
                <>
                  <VSplit onBegin={syncShown} onDrag={(dx) => commitDrag("trail", -dx)} />
                  <aside className="ui-pane relative z-0 isolate min-h-0 shrink-0 overflow-hidden border-l border-border" style={{ width: trailW }}>
                    <TrailPane />
                  </aside>
                </>
              ) : null}
            </div>
            {agentBelow ? (
              <>
                <HSplit onDrag={(dy) => setAgentWidth(useIde.getState().agentWidth - dy)} />
                <div
                  className="flex min-h-0 shrink-0 border-t border-border"
                  style={{ height: Math.max(180, Math.min(420, agentWidth)) }}
                >
                  <div className="min-h-0 min-w-0 flex-1">
                    <ChatPane />
                  </div>
                  {trailBelow && stackTrail.trailW > 0 ? (
                    <aside className="ui-pane relative z-0 isolate min-h-0 shrink-0 overflow-hidden border-l border-border" style={{ width: stackTrail.trailW }}>
                      <TrailPane />
                    </aside>
                  ) : null}
                </div>
              </>
            ) : null}
            {outputBottom ? (
              <>
                <HSplit onDrag={(dy) => setOutputHeight(useIde.getState().outputHeight - dy)} />
                <div className="min-h-0 shrink-0" style={{ height: outputHeight }}>
                  <OutputPane />
                </div>
              </>
            ) : null}
          </div>
          {agentBeside && agentW > 0 ? (
            <>
              <VSplit onBegin={syncShown} onDrag={(dx) => commitDrag("agent", -dx)} />
              <aside className="ui-pane min-h-0 shrink-0 overflow-hidden" style={{ width: agentW }}>
                <ChatPane />
              </aside>
            </>
          ) : null}
        </div>
      </div>
      {showStatusBar ? <StatusBar /> : null}
      {overlaySide ? (
        <>
          <button
            type="button"
            className="ui-overlay absolute inset-y-0 z-20 bg-bg/50"
            style={{ left: ACTIVITY_W, right: rightChrome }}
            aria-label="Sidebar schließen"
            onClick={() => useIde.getState().setSidebar(null)}
          />
          <aside
            className="ui-rail absolute inset-y-0 z-30 overflow-hidden border-r border-border bg-surface"
            style={{ left: ACTIVITY_W, width: overlaySideW }}
          >
            {sideBody(sidebar)}
          </aside>
        </>
      ) : null}
      {overlayAgent && ov.agentW > 0 ? (
        <aside
          className={`ui-pane absolute top-0 z-20 overflow-hidden border-l border-border bg-surface ${edge}`}
          style={{ right: ov.agentRight, width: ov.agentW }}
        >
          <ChatPane />
        </aside>
      ) : null}
      {overlayTrail && ov.trailW > 0 ? (
        <aside
          className={`ui-pane isolate absolute top-0 overflow-hidden border-l border-border bg-surface ${ov.trailOnTop ? "z-30" : "z-20"} ${edge}`}
          style={{ right: ov.trailRight, width: ov.trailW }}
        >
          <TrailPane />
        </aside>
      ) : null}
      {settingsOpen ? (
        <div className="ui-overlay absolute inset-0 z-50 flex items-stretch justify-center bg-bg/70 p-0 sm:items-center sm:p-6">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Einstellungen schließen"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="ui-sheet relative flex h-full w-full max-w-3xl flex-col overflow-hidden border border-border bg-surface shadow-lg sm:h-[min(40rem,90dvh)] sm:rounded-lg">
            <SettingsPane />
          </div>
        </div>
      ) : null}
      <CommandPalette />
      {starterOpen ? (
        <div className="ui-overlay absolute inset-0 z-50 flex items-center justify-center bg-bg/70 p-4">
          <button type="button" className="absolute inset-0" aria-label="close" onClick={() => setStarterOpen(false)} />
          <div className="ui-sheet relative w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg">
            <StarterPick onDone={() => setStarterOpen(false)} />
          </div>
        </div>
      ) : null}
      <InternPane />
      <ConfirmHost />
      {notice ? (
        <div className="ui-notice absolute bottom-8 left-1/2 z-40 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-lg">
          {notice}
        </div>
      ) : null}
    </div>
  );
}

function sideBody(id: ReturnType<typeof useIde.getState>["sidebar"]): ReactNode {
  if (id === "search") return <SearchPane />;
  if (id === "git") return <GitPane />;
  if (id === "ext") return <ExtensionsPane />;
  if (id === "learn") return <MemoryPane />;
  if (id === "tests") return <TestsPane />;
  if (id === "ref") return <RefPane />;
  if (id === "mcp") return <McpPane />;
  return <FileTree />;
}

