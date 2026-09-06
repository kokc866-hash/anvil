import { toolTargetKey, toolCompatibility } from "@/lib/tool-compat";
import { sanitizeToolLearning } from "@/lib/tool-learning";
import { migrateLegacyCaps } from "@/lib/model-caps";
import type { LlmSlot, LlmProfile, ChatRole, PanelId, ThemeName, MotionLevel, SplitMode, SidebarId, PaletteMode, AgentMode, OutputDock, StorageMode, DebugFrame, McpCallLog, McpView, DebugState, FileDiff, PlanStep, Checkpoint, ChatVoice, ChatMsg, AgentStep, GitCommit, RunResult, Panels, IdeState } from "./ide-types";
export type { LlmSlot, LlmProfile, ChatRole, PanelId, ThemeName, MotionLevel, SplitMode, SidebarId, PaletteMode, AgentMode, OutputDock, StorageMode, DebugFrame, McpCallLog, McpView, DebugState, FileDiff, PlanStep, Checkpoint, ChatVoice, ChatMsg, AgentStep, GitCommit, RunResult, Panels, IdeState } from "./ide-types";
import { create } from "zustand";
import { partializeIde } from "./ide-persist";
import { syncWrite, syncRemove, syncMkdir, scheduleSyncWrite } from "@/lib/disk-sync";
import { persist } from "zustand/middleware";
import { idePersistStorage } from "@/lib/persist-storage";
import { SEED_FILES } from "@/lib/seed-files";
import { langFromPath } from "@/lib/languages";
import { modelForProvider, providerOf, connectionMode, connectionSlot, connectionDefaults, type LlmProvider } from "@/lib/providers";
import { ancestorDirs, autoCollapsePaths, cleanPath, dropRecord, dupPath, isInside, joinPath, parentDir, remapList, remapPath, remapRecord } from "@/lib/fs";
import { DEFAULT_INPUT_MAP, normalizeInputMap, type InputMap } from "@/lib/input-map";
import { KEY_DEFAULTS, normalizeKeyMap } from "@/lib/keymap";
import type { CompactMode } from "@/lib/compact";
import type { ThinkingMode } from "@/lib/llm-options";

import { ANVIL_SURFACE } from "@/lib/surface";
import type { LspHit } from "@/lib/lsp";

import { isTestFile, parseTests, dropTestPaths, remapTestMap } from "@/lib/test-parse";
import { normalizeThinking } from "@/lib/llm-options";
import { emitPlugin } from "@/lib/plugins/events";
import { saveSecrets, keyForProvider, saveKeyForProvider } from "@/lib/secrets";
import { clampContext } from "@/lib/tokens";
import { rejectHunk as rejectHunkLines } from "@/lib/diff";
import { parseRunTrace } from "@/lib/parse-run";
import type { AfterWrite } from "@/lib/harness";
import { normalizePlanWho, type PlanWho } from "@/lib/plan";
import { abortReason } from "@/lib/abort";
import { dropCoveredHeuristics, dropStaleRun, localLintHits, LSP_BUCKET } from "@/lib/problems";
import { isToolTemplateEcho } from "@/lib/agent-parse";
import { EMPTY_JOURNAL, normalizeJournal } from "@/lib/session";
import { normalizeJob, type AgentJob } from "@/lib/agent-ask";
import { AGENT_MIN, AGENT_MAX, SIDE_MIN, SIDE_MAX, TRAIL_MIN, TRAIL_MAX } from "@/lib/layout";
import { fitCloudAbo } from "@/lib/llm-fit";

const THINK_CAP = 64_000;

let liveThink = "";
let liveText = "";
let livePump: ReturnType<typeof setTimeout> | 0 = 0;
let liveFlush: (() => void) | null = null;

function queueLive(kind: "think" | "text", s: string) {
  if (kind === "think") liveThink += s;
  else liveText += s;
  if (livePump || !liveFlush) return;
  livePump = globalThis.setTimeout(() => {
    livePump = 0;
    liveFlush?.();
  }, 80);
}

export function flushLiveChat() {
  if (livePump) {
    globalThis.clearTimeout(livePump);
    livePump = 0;
  }
  liveFlush?.();
}

function mergeLsp(local: LspHit[], ...rest: LspHit[][]): LspHit[] {
  const seen = new Set<string>();
  const out: LspHit[] = [];
  for (const h of [...dropCoveredHeuristics(local.filter((x) => !LSP_BUCKET.has(x.source))), ...rest.flat()]) {
    const k = `${h.path}:${h.line}:${h.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

function pushDisk(kind: "write" | "remove" | "mkdir", path: string, content = "") {
  const job = kind === "write" ? syncWrite(path, content) : kind === "mkdir" ? syncMkdir(path) : syncRemove(path);
  void job.catch(() => undefined);
}
import { shrinkFiles } from "@/lib/persist-storage";

function slotOf(s: {
  llmAuthMode: "abo" | "key";
  llmContextAuto: boolean;
  llmBaseUrl: string;
  llmModel: string;
  llmContext: number;
  llmThinking: ThinkingMode;
  llmCompact: CompactMode;
  llmTemperature: number;
  llmMaxOut: number;
}): LlmSlot {
  return {
    authMode: s.llmAuthMode,
    contextAuto: s.llmContextAuto,
    baseUrl: s.llmBaseUrl,
    model: s.llmModel,
    context: s.llmContext,
    thinking: s.llmThinking,
    compact: s.llmCompact,
    temperature: s.llmTemperature,
    maxOut: s.llmMaxOut,
  };
}

function noteLearn(k: string, d?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("anvil-learn", { detail: { k, d } }));
}

export type { AfterWrite };
export type { LlmProvider };

export type { AgentJob };

export type { InputMap };

export const PANEL_META: { id: PanelId; label: string; hint: string }[] = [
  { id: "files", label: "Dateien", hint: "Workspace" },
  { id: "code", label: "Code", hint: "Editor" },
  { id: "agent", label: "Agent", hint: "Chat" },
  { id: "trail", label: "Spur", hint: "Denken, Run, To-do" },
  { id: "output", label: "Ausgabe", hint: "Konsole" },
];

export const PRESETS: { id: string; label: string; panels: Panels }[] = [
  { id: "ide", label: "IDE", panels: { files: true, code: true, agent: true, trail: true, output: true } },
  { id: "pair", label: "Code + Agent", panels: { files: false, code: true, agent: true, trail: true, output: false } },
  { id: "focus", label: "Schreiben", panels: { files: true, code: true, agent: false, trail: false, output: false } },
  { id: "run", label: "Ausführen", panels: { files: false, code: true, agent: false, trail: false, output: true } },
];

const EMPTY_DEBUG: DebugState = {
  active: false,
  paused: false,
  path: null,
  line: 0,
  reason: "",
  stack: [],
  locals: {},
  watches: [],
  watchValues: {},
  lastEval: "",
};

function nid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function visibleCount(p: Panels) {
  return (Object.values(p) as boolean[]).filter(Boolean).length;
}

function withParents(dirs: string[], path: string): string[] {
  const next = new Set(dirs);
  for (const d of ancestorDirs(path)) next.add(d);
  return [...next];
}

export const useIde = create<IdeState>()(
  persist(
    (set, get) => {
      liveFlush = () => {
        const t = liveThink;
        const x = liveText;
        liveThink = "";
        liveText = "";
        if (!t && !x) return;
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role !== "assistant") return;
        let thinking = last.thinking ?? "";
        if (t) {
          thinking += t;
          if (thinking.length > THINK_CAP) thinking = thinking.slice(-THINK_CAP);
        }
        chat[chat.length - 1] = {
          ...last,
          content: x ? last.content + x : last.content,
          thinking: t ? thinking : last.thinking,
        };
        set({ chat });
      };
      return {
      files: { ...SEED_FILES },
      openPaths: [],
      activePath: "",
      dirty: {},
      chat: [],
      commits: [],
      output: [],
      running: false,
      testsRunning: false,
      testResults: {},
      agentBusy: false,
      agentStartedAt: 0,
      agentJob: null,
      panels: { files: true, code: true, agent: true, trail: true, output: false },
      settingsOpen: false,
      harnessBoardOpen: false,
      harnessBoardGrid: true,
      harnessBoardSnap: true,
      theme: "dark",
      locale: "de",
      motion: "full",
      fontSize: 13,
      tabSize: 2,
      lineNumbers: true,
      wordWrap: false,
      editorMinimap: false,
      editorSticky: true,
      editorGuides: true,
      editorWheelZoom: true,
      suggestOn: true,
      insertSpaces: true,
      formatOnSave: false,
      autoPreview: true,
      autoAcceptDiffs: false,
      autoRunAgent: true,
      planWho: "auto",
      runLoop: true,
      testLoop: true,
      graphLoop: true,
      engineLoop: false,
      loopTries: 3,
      harnessAfterWrite: "run",
      harnessMaxRounds: 24,
      graphSees: 4,
      liveRun: true,
      liveEditor: true,
      mcpStream: true,
      showStatusBar: true,
      openOutputOnRun: true,
      runInWindow: true,
      runHtml: true,
      autoUpdate: true,
      splitMode: "auto",
      llmProvider: "ollama",
      llmAuthMode: "key",
      llmBaseUrl: "http://127.0.0.1:11434/v1",
      llmModel: "llama3.1",
      llmApiKey: "",
      llmContext: 32768,
      llmContextAuto: true,
      llmThinking: "auto",
      llmCompact: "auto",
      llmTemperature: 0.3,
      llmMaxOut: 0,
      llmRetries: 3,
      llmHardStopMin: 0,
      llmSlots: {},
      llmProfiles: [],
      llmToolModes: {},
      llmToolLearning: {},
      sessionTokens: { prompt: 0, completion: 0 },
      sessionJournal: { ...EMPTY_JOURNAL },
      sidebar: "files",
      palette: null,
      pendingDiffs: [],
      cursor: { line: 1, col: 1 },
      selection: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      searchQuery: "",
      agentMode: "agent",
      agentRules: "",
      attached: [],
      agentDraft: "",
      sidebarWidth: 232,
      agentWidth: 380,
      outputHeight: 220,
      outputWidth: 360,
      outputDock: "bottom",
      outputPopout: false,
      trailWidth: 300,
      trailThinkH: 200,
      trailInChat: false,
      autoHw: false,
      hwNote: "",
      runPopout: false,
      previewOpen: false,
      runPath: null,
      pluginDisabled: [],
      pluginKnown: [],
      pluginStatus: "",
      pluginConfig: {},
      pluginProblems: [],
      lspProblems: [],
      runProblems: [],
      companionProblems: [],
      compileProblems: [],
      mcpServers: [],
      activeSurfaceId: ANVIL_SURFACE,
      surfaceMode: "exclusive",
      mcpLog: [],
      mcpView: {},
      companionUrl: "http://127.0.0.1:7845",
      companionKeep: false,
      netCompiler: true,
      lspEnabled: {},
      lspTimeout: 8,
      lspMaxFiles: 24,
      lspLog: [],
      engineLink: null,
      checkpoints: [],
      agentInbox: null,
      agentQueue: [],
      pendingAsk: null,
      recentPaths: [],
      flashPath: null,
      peek: null,
      jumpStack: [],
      jumpIndex: -1,
      closedTabs: [],
      breakpoints: {},
      debug: EMPTY_DEBUG,
      notice: "",
      undo: {},
      dirs: [],
      collapsed: [],
      diskName: "",
      workspaceCwd: "",
      setupDone: false,
      backupName: "",
      storageMode: "browser",
      autoSaveDisk: false,
      loadOnStart: false,
      githubRepo: "",
      githubToken: "",
      inputMap: normalizeInputMap(DEFAULT_INPUT_MAP),
      keyMap: { ...KEY_DEFAULTS },
      togglePanel: (id) => {
        const panels = { ...get().panels };
        if (panels[id] && visibleCount(panels) <= 1) return;
        panels[id] = !panels[id];
        set({ panels });
      },
      setPanels: (panels) => set({ panels }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setHarnessBoardOpen: (harnessBoardOpen) => set({ harnessBoardOpen }),
      setHarnessBoardGrid: (harnessBoardGrid) => set({ harnessBoardGrid }),
      setHarnessBoardSnap: (harnessBoardSnap) => set({ harnessBoardSnap }),
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setMotion: (motion) => set({ motion }),
      setFontSize: (n) => set({ fontSize: Math.min(22, Math.max(10, Math.round(n))) }),
      setTabSize: (tabSize) => set({ tabSize }),
      setLineNumbers: (lineNumbers) => set({ lineNumbers }),
      setWordWrap: (wordWrap) => set({ wordWrap }),
      setEditorMinimap: (editorMinimap) => set({ editorMinimap }),
      setEditorSticky: (editorSticky) => set({ editorSticky }),
      setEditorGuides: (editorGuides) => set({ editorGuides }),
      setEditorWheelZoom: (editorWheelZoom) => set({ editorWheelZoom }),
      setSuggestOn: (suggestOn) => set({ suggestOn }),
      setInsertSpaces: (insertSpaces) => set({ insertSpaces }),
      setFormatOnSave: (formatOnSave) => set({ formatOnSave }),
      setAutoPreview: (autoPreview) => set({ autoPreview }),
      setAutoAcceptDiffs: (autoAcceptDiffs) => set({ autoAcceptDiffs }),
      setAutoRunAgent: (autoRunAgent) => set({ autoRunAgent }),
      setPlanWho: (planWho) => set({ planWho: normalizePlanWho(planWho) }),
      setRunLoop: (runLoop) => set({ runLoop }),
      setTestLoop: (testLoop) => set({ testLoop }),
      setGraphLoop: (graphLoop) => set({ graphLoop }),
      setEngineLoop: (engineLoop) => set({ engineLoop }),
      setLoopTries: (n) => set({ loopTries: Math.min(5, Math.max(1, n | 0)) }),
      setHarnessAfterWrite: (harnessAfterWrite) => set({ harnessAfterWrite }),
      setHarnessMaxRounds: (n) => set({ harnessMaxRounds: Math.min(48, Math.max(8, n | 0) || 24) }),
      setGraphSees: (n) => set({ graphSees: Math.min(8, Math.max(0, n | 0)) }),
      setLiveRun: (liveRun) => set({ liveRun }),
      setLiveEditor: (liveEditor) => set({ liveEditor }),
      setMcpStream: (mcpStream) => set({ mcpStream }),
      setShowStatusBar: (showStatusBar) => set({ showStatusBar }),
      setOpenOutputOnRun: (openOutputOnRun) => set({ openOutputOnRun }),
      setRunInWindow: (runInWindow) => set({ runInWindow }),
      setRunHtml: (runHtml) => set({ runHtml }),
      setAutoUpdate: (autoUpdate) => set({ autoUpdate }),
      setRunPopout: (runPopout) => set({ runPopout }),
      setRunPath: (runPath) => set({ runPath: runPath || null }),
      setSplitMode: (splitMode) => set({ splitMode }),
      setLlmProvider: (llmProvider, mode) => {
        const cur = get();
        const d = providerOf(llmProvider);
        const slots = { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: slotOf(cur) };
        const leaving = providerOf(cur.llmProvider);
        if (!leaving.needsSub || cur.llmApiKey.trim()) saveKeyForProvider(cur.llmProvider, cur.llmApiKey);
        const authMode = connectionMode(d.id, mode ?? (d.id === cur.llmProvider ? cur.llmAuthMode : "key"));
        const defaults = connectionDefaults(d.id, authMode);
        const legacy = slots[d.id];
        const saved = slots[connectionSlot(d.id, authMode)] ?? (connectionMode(d.id, legacy?.authMode) === authMode ? legacy : undefined);
        const key = keyForProvider(d.id);
        let url = saved?.baseUrl ?? defaults.baseUrl;
        let model = modelForProvider(d.id, saved?.model || defaults.model);
        if (d.id === "github") { url = ""; model = model.replace(/^openai\//, ""); }
        const fit = saved ? null : fitCloudAbo(d.id, model, authMode);
        set({
          llmSlots: slots,
          llmProvider: d.id,
          llmAuthMode: authMode,
          llmBaseUrl: url,
          llmModel: model,
          llmApiKey: key,
          llmCompact: saved?.compact ?? cur.llmCompact,
          ...(fit
            ? fit
            : {
                llmContext: saved?.context ?? cur.llmContext,
                llmThinking: saved?.thinking ?? cur.llmThinking,
                llmTemperature: saved?.temperature ?? cur.llmTemperature,
                llmMaxOut: saved?.maxOut ?? cur.llmMaxOut,
                llmContextAuto: saved?.contextAuto ?? (d.kind === "local" || d.id === "custom" ? cur.llmContextAuto : true),
              }),
        });
        if (fit || get().llmContextAuto) void import("@/lib/model-context").then((m) => m.applyCloudContext());
      },
      setLlmAuthMode: (mode) => get().setLlmProvider(get().llmProvider, mode),
      setLlmBaseUrl: (llmBaseUrl) => {
        const cur = get();
        set({ llmBaseUrl, llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: { ...slotOf(cur), baseUrl: llmBaseUrl } } });
      },
      setLlmToolMode: (mode) => {
        const cur = get();
        const key = toolTargetKey(cur.llmProvider, cur.llmModel, cur.llmBaseUrl || providerOf(cur.llmProvider).baseUrl);
        set({ llmToolModes: { ...cur.llmToolModes, [key]: toolCompatibility(mode) } });
      },
      updateToolLearning: (key, update) => set((cur) => ({
        llmToolLearning: sanitizeToolLearning({ ...cur.llmToolLearning, [key]: update(cur.llmToolLearning[key] || { rules: [] }) }),
      })),
      setLlmModel: (llmModel) => {
        const cur = get();
        const next = modelForProvider(cur.llmProvider, llmModel);
        const fit = fitCloudAbo(cur.llmProvider, next, cur.llmAuthMode);
        set({
          llmModel: next,
          llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: { ...slotOf(cur), model: next } },
          ...(fit ?? {}),
        });
        if (fit || cur.llmContextAuto) void import("@/lib/model-context").then((m) => m.applyCloudContext());
      },
      setLlmApiKey: (llmApiKey) => {
        saveKeyForProvider(get().llmProvider, llmApiKey);
        set({ llmApiKey });
      },
      setLlmContext: (n) => {
        const llmContext = clampContext(n);
        const cur = get();
        set({ llmContext, llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: { ...slotOf(cur), context: llmContext } } });
      },
      setLlmContextAuto: (llmContextAuto) => {
        set({ llmContextAuto });
        if (llmContextAuto) void import("@/lib/model-context").then((m) => m.applyCloudContext());
      },
      setLlmThinking: (v) => {
        const llmThinking = normalizeThinking(v);
        const cur = get();
        set({ llmThinking, llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: { ...slotOf(cur), thinking: llmThinking } } });
      },
      setLlmCompact: (llmCompact) => {
        const cur = get();
        set({ llmCompact, llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: { ...slotOf(cur), compact: llmCompact } } });
      },
      setLlmTemperature: (n) => {
        const llmTemperature = Math.min(2, Math.max(0, Number.isFinite(n) ? n : 0.3));
        const cur = get();
        set({ llmTemperature, llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: { ...slotOf(cur), temperature: llmTemperature } } });
      },
      setLlmMaxOut: (n) => {
        const llmMaxOut = Math.min(65536, Math.max(0, Math.round(n) || 0));
        const cur = get();
        set({ llmMaxOut, llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: { ...slotOf(cur), maxOut: llmMaxOut } } });
      },
      setLlmRetries: (n) => set({ llmRetries: Math.min(8, Math.max(1, Math.round(n))) }),
      setLlmHardStopMin: (n) => set({ llmHardStopMin: Math.min(480, Math.max(0, Math.round(n))) }),
      saveLlmProfile: (name) => {
        const cur = get();
        const label = name.trim() || `${providerOf(cur.llmProvider).label} · ${cur.llmModel || "modell"}`;
        const hit = cur.llmProfiles.find((p) => p.name === label);
        const row: LlmProfile = {
          id: hit?.id ?? `p-${crypto.randomUUID()}`,
          name: label,
          provider: cur.llmProvider,
          toolMode: toolCompatibility(cur.llmToolModes[toolTargetKey(cur.llmProvider, cur.llmModel, cur.llmBaseUrl || providerOf(cur.llmProvider).baseUrl)]),
          ...slotOf(cur),
        };
        if (!providerOf(cur.llmProvider).needsSub || cur.llmApiKey.trim()) saveKeyForProvider(cur.llmProvider, cur.llmApiKey);
        const llmProfiles = hit
          ? cur.llmProfiles.map((p) => (p.id === hit.id ? row : p))
          : [...cur.llmProfiles, row];
        set({ llmProfiles, llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: slotOf(cur) } });
      },
      applyLlmProfile: (id) => {
        const cur = get();
        const p = cur.llmProfiles.find((x) => x.id === id);
        if (!p) return;
        if (!providerOf(cur.llmProvider).needsSub || cur.llmApiKey.trim()) saveKeyForProvider(cur.llmProvider, cur.llmApiKey);
        set({
          llmSlots: { ...(cur.llmSlots ?? {}), [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: slotOf(cur), [connectionSlot(p.provider, p.authMode)]: p },
          ...(p.toolMode ? { llmToolModes: { ...cur.llmToolModes, [toolTargetKey(p.provider, modelForProvider(p.provider, p.model), p.baseUrl || providerOf(p.provider).baseUrl)]: toolCompatibility(p.toolMode) } } : {}),
          llmProvider: p.provider,
          llmAuthMode: connectionMode(p.provider, p.authMode),
          llmBaseUrl: p.provider === "codex" || p.provider === "github" ? "" : p.baseUrl,
          llmModel: modelForProvider(p.provider, p.provider === "github" ? p.model.replace(/^openai\//, "") : p.model),
          llmContext: p.context,
          llmContextAuto: p.contextAuto ?? false,
          llmThinking: p.thinking,
          llmCompact: p.compact,
          llmTemperature: p.temperature ?? 0.3,
          llmMaxOut: p.maxOut ?? 0,
          llmApiKey: keyForProvider(p.provider),
        });
      },
      deleteLlmProfile: (id) => set({ llmProfiles: get().llmProfiles.filter((p) => p.id !== id) }),
      setSidebar: (sidebar) => set({ sidebar }),
      setPalette: (palette) => set({ palette }),
      setCursor: (line, col) => set({ cursor: { line, col } }),
      setSelection: (startLine, startCol, endLine, endCol) =>
        set({ selection: { startLine, startCol, endLine, endCol } }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setAgentMode: (agentMode) => set({ agentMode }),
      setAgentRules: (agentRules) => set({ agentRules }),
      setAttached: (attached) => set({ attached }),
      setAgentDraft: (agentDraft) => set({ agentDraft }),
      setSidebarWidth: (n) => set({ sidebarWidth: Math.min(SIDE_MAX, Math.max(SIDE_MIN, n)) }),
      setAgentWidth: (n) => set({ agentWidth: Math.min(AGENT_MAX, Math.max(AGENT_MIN, n)) }),
      setOutputHeight: (n) => set({ outputHeight: Math.min(520, Math.max(120, n)) }),
      setOutputWidth: (n) => set({ outputWidth: Math.min(640, Math.max(240, n)) }),
      setOutputDock: (outputDock) =>
        set({
          outputDock,
          outputPopout: false,
          panels: { ...get().panels, output: true },
        }),
      setOutputPopout: (outputPopout) => set({ outputPopout }),
      setTrailWidth: (n) => set({ trailWidth: Math.min(TRAIL_MAX, Math.max(TRAIL_MIN, n)) }),
      setTrailThinkH: (n) => set({ trailThinkH: Math.min(720, Math.max(72, Math.round(n))) }),
      setTrailInChat: (trailInChat) => set({ trailInChat }),
      setAutoHw: (autoHw) => set({ autoHw }),
      setHwNote: (hwNote) => set({ hwNote }),
      revealOutput: () => {
        set({ panels: { ...get().panels, output: true } });
        window.dispatchEvent(new Event("anvil-focus-output"));
      },
      setPreviewOpen: (previewOpen) => set({ previewOpen }),
      togglePlugin: (id) => {
        const cur = get().pluginDisabled;
        set({ pluginDisabled: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
      },
      setPluginKnown: (pluginKnown) => set({ pluginKnown }),
      setPluginDisabled: (pluginDisabled) => set({ pluginDisabled }),
      setPluginStatus: (pluginStatus) => set({ pluginStatus }),
      setPluginConfig: (pluginConfig) => set({ pluginConfig }),
      setPluginProblems: (pluginProblems) => set({ pluginProblems }),
      setLspProblems: (hits) => {
        const st = get();
        const run = dropStaleRun(st.runProblems, hits);
        set({
          runProblems: run,
          lspProblems: mergeLsp(hits, run, st.compileProblems, st.companionProblems),
        });
      },
      setCompanionProblems: (companionProblems) =>
        set({
          companionProblems,
          lspProblems: mergeLsp(localLintHits(get().lspProblems), get().runProblems, get().compileProblems, companionProblems),
        }),
      setCompileProblems: (compileProblems) =>
        set({
          compileProblems,
          lspProblems: mergeLsp(localLintHits(get().lspProblems), get().runProblems, compileProblems, get().companionProblems),
        }),
      setMcpServers: (mcpServers) => {
        const cur = get().activeSurfaceId;
        const ok = cur === ANVIL_SURFACE || mcpServers.some((s) => s.id === cur && s.enabled);
        const next = ok ? cur : ANVIL_SURFACE;
        if (mcpServers === get().mcpServers && next === cur) return;
        set({ mcpServers, activeSurfaceId: next });
      },
      setActiveSurface: (id) => {
        const servers = get().mcpServers;
        const ok = id === ANVIL_SURFACE || servers.some((s) => s.id === id && s.enabled);
        const next = ok ? id : ANVIL_SURFACE;
        if (next === get().activeSurfaceId) return;
        set({ activeSurfaceId: next });
      },
      setSurfaceMode: (surfaceMode) => set({ surfaceMode }),
      setMcpContext: (id, context) =>
        set({
          mcpServers: get().mcpServers.map((s) => (s.id === id ? { ...s, context } : s)),
        }),
      pushMcpLog: (e) => set({ mcpLog: [e, ...get().mcpLog].slice(0, 40) }),
      setMcpView: (id, v) => set({ mcpView: { ...get().mcpView, [id]: v } }),
      clearMcpLog: () => set({ mcpLog: [] }),
      setCompanionUrl: (companionUrl) => set({ companionUrl }),
      setCompanionKeep: (companionKeep) => set({ companionKeep }),
      setNetCompiler: (netCompiler) => set({ netCompiler }),
      setLspEnabled: (id, on) => set({ lspEnabled: { ...get().lspEnabled, [id]: on } }),
      setLspTimeout: (n) => set({ lspTimeout: Math.max(4, Math.min(20, Math.round(n) || 8)) }),
      setLspMaxFiles: (n) => set({ lspMaxFiles: Math.max(8, Math.min(48, Math.round(n) || 24)) }),
      pushLspLog: (ok, text) =>
        set({
          lspLog: [{ at: Date.now(), ok, text: text.slice(0, 400) }, ...get().lspLog].slice(0, 12),
        }),
      clearLspLog: () => set({ lspLog: [] }),
      setEngineLink: (engineLink) => set({ engineLink }),
      pushCheckpoint: (label) => {
        const id = nid();
        const st = get();
        const files = shrinkFiles(st.files, 2_000_000, [...st.openPaths, ...Object.keys(st.dirty)]);
        const row: Checkpoint = {
          id,
          at: Date.now(),
          label: label.slice(0, 80) || "Runde",
          files,
          dirs: [...get().dirs],
        };
        set({ checkpoints: [...get().checkpoints, row].slice(-40) });
        return id;
      },
      patchFiles: (next, opts) => {
        const { files } = get();
        const diffs: FileDiff[] = [];
        const merged = { ...files };
        for (const [path, after] of Object.entries(next)) {
          if (files[path] === after) continue;
          diffs.push({ path, before: files[path] ?? "", after, source: "propose" });
          merged[path] = after;
        }
        if (!diffs.length) return 0;
        const first = diffs[0].path;
        const quiet = Boolean(opts?.quiet);
        const open = get().openPaths.includes(first) ? get().openPaths : quiet ? get().openPaths : [...get().openPaths, first];
        set({
          files: merged,
          pendingDiffs: [...get().pendingDiffs.filter((d) => !diffs.some((x) => x.path === d.path)), ...diffs],
          dirty: { ...get().dirty, ...Object.fromEntries(diffs.map((d) => [d.path, true])) },
          openPaths: open,
          activePath: quiet ? get().activePath : first,
          panels: quiet ? get().panels : { ...get().panels, code: true },
        });
        return diffs.length;
      },
      restoreCheckpoint: (id) => {
        const c = get().checkpoints.find((x) => x.id === id);
        if (!c || !Object.keys(c.files).length) return false;
        const keepOpen = get().openPaths.filter((p) => p in c.files);
        const cur = get().activePath;
        const active = cur && cur in c.files ? cur : keepOpen[0] ?? null;
        const curFiles = get().files;
        const dirty: Record<string, boolean> = { ...get().dirty };
        for (const p of Object.keys(c.files)) dirty[p] = true;
        set({
          files: { ...curFiles, ...c.files },
          dirs: [...new Set([...get().dirs, ...c.dirs])],
          dirty,
          pendingDiffs: [],
          openPaths: keepOpen.length ? keepOpen : active ? [active] : [],
          activePath: active,
        });
        noteLearn("checkpoint", id);
        return true;
      },
      setChatChanges: (changes) => {
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role !== "assistant") return;
        chat[chat.length - 1] = { ...last, changes };
        set({ chat });
      },
      setChatLastRun: (lastRun) => {
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role !== "assistant") return;
        chat[chat.length - 1] = { ...last, lastRun };
        set({ chat });
      },
      setChatLastTests: (lastTests) => {
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role !== "assistant") return;
        chat[chat.length - 1] = { ...last, lastTests };
        set({ chat });
      },
      setChatHarness: (harness) => {
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role !== "assistant") return;
        chat[chat.length - 1] = { ...last, harness };
        set({ chat });
      },
      failRunningSteps: () => {
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role !== "assistant") return;
        const why = abortReason() || "Gestoppt";
        const steps = (last.steps ?? []).map((s) =>
          s.status === "run"
            ? { ...s, status: "err" as const, detail: `${s.detail} · ${why}`, ms: Date.now() - (s.at || Date.now()) }
            : s,
        );
        const plan = last.plan?.map((s) => (s.status === "run" ? { ...s, status: "todo" as const } : s));
        const lastRun = last.lastRun
          ? { ...last.lastRun, running: false, ok: false, stderr: last.lastRun.stderr || why }
          : last.lastRun;
        const lastTests = last.lastTests ? { ...last.lastTests, running: false } : last.lastTests;
        const done = Boolean(last.content.trim());
        chat[chat.length - 1] = {
          ...last,
          steps,
          plan,
          lastRun,
          lastTests,
          harness: done ? last.harness : last.harness ? last.harness.replace(/^[A-Za-zäöüÄÖÜß]+/, "Stop") : "Stop",
        };
        set({ chat, agentBusy: false, running: false, testsRunning: false, agentStartedAt: 0 });
      },
      openRoundDiff: (path, checkpointId) => {
        get().openFile(path);
        const ck = checkpointId ? get().checkpoints.find((c) => c.id === checkpointId) : get().checkpoints.at(-1);
        if (!ck) return;
        const before = ck.files[path] ?? "";
        const after = get().files[path] ?? "";
        if (before === after) return;
        set({
          pendingDiffs: [...get().pendingDiffs.filter((d) => d.path !== path), { path, before, after, source: "round" }],
          panels: { ...get().panels, code: true },
        });
      },
      setPendingAsk: (pendingAsk) => set({ pendingAsk }),
      revealPath: (path) => {
        const name = cleanPath(path);
        if (!name) return;
        const parents = ancestorDirs(name);
        set({
          sidebar: "files",
          flashPath: name,
          collapsed: get().collapsed.filter((d) => !parents.includes(d)),
        });
        window.setTimeout(() => {
          if (get().flashPath === name) set({ flashPath: null });
        }, 1400);
      },
      cycleTab: (dir) => {
        const { openPaths, activePath } = get();
        if (openPaths.length < 2) return;
        const i = Math.max(0, openPaths.indexOf(activePath ?? ""));
        const n = (i + dir + openPaths.length) % openPaths.length;
        get().openFile(openPaths[n]);
      },
      reorderTabs: (from, to) => {
        if (from === to) return;
        const list = [...get().openPaths];
        const a = list.indexOf(from);
        const b = list.indexOf(to);
        if (a < 0 || b < 0) return;
        list.splice(a, 1);
        list.splice(b, 0, from);
        set({ openPaths: list, activePath: from });
      },
      setPeek: (peek) => set({ peek }),
      pushJump: () => {
        const { activePath, cursor, jumpStack, jumpIndex } = get();
        if (!activePath) return;
        const cur = { path: activePath, line: cursor.line };
        const stack = jumpStack.slice(0, Math.max(0, jumpIndex) + 1);
        const last = stack.at(-1);
        if (last && last.path === cur.path && last.line === cur.line) {
          set({ jumpIndex: stack.length - 1 });
          return;
        }
        stack.push(cur);
        const next = stack.slice(-40);
        set({ jumpStack: next, jumpIndex: next.length - 1 });
      },
      goJump: (dir) => {
        const { jumpStack, jumpIndex } = get();
        const n = jumpIndex + dir;
        if (n < 0 || n >= jumpStack.length) return;
        const j = jumpStack[n];
        set({ jumpIndex: n });
        (window as unknown as { __anvilGoto?: { path: string; line: number } }).__anvilGoto = j;
        get().openFile(j.path);
      },
      reopenTab: () => {
        const [path, ...rest] = get().closedTabs;
        if (!path || !(path in get().files)) {
          set({ closedTabs: rest });
          return;
        }
        set({ closedTabs: rest });
        get().openFile(path);
      },
      setChatPlan: (plan, id) => {
        const chat = [...get().chat];
        let i = id ? chat.findIndex((m) => m.id === id) : -1;
        if (i < 0) i = chat.length - 1;
        const last = chat[i];
        if (last?.role !== "assistant") return;
        chat[i] = { ...last, plan };
        set({ chat });
      },
      updatePlanStep: (i, status, id) => {
        const chat = [...get().chat];
        let n = id ? chat.findIndex((m) => m.id === id) : -1;
        if (n < 0) n = chat.length - 1;
        const last = chat[n];
        if (last?.role !== "assistant" || !last.plan) return;
        const plan = last.plan.map((s, k) => (k === i ? { ...s, status } : s));
        chat[n] = { ...last, plan };
        set({ chat });
      },
      pushAgent: (text, steal) => {
        const t = text.trim();
        if (!t) return;
        const fix = /^(behebe diese probleme|intern-fehler beheben)/i.test(t);
        if (steal && get().agentBusy) {
          set({
            agentQueue: [...get().agentQueue, t],
            panels: { ...get().panels, agent: true },
            ...(fix ? { agentMode: "agent" as const } : {}),
          });
          get().setNotice("Auftrag in die Warteschlange");
          return;
        }
        if (get().agentBusy || get().agentInbox) {
          set({
            agentQueue: [...get().agentQueue, t],
            panels: { ...get().panels, agent: true },
            ...(fix ? { agentMode: "agent" as const } : {}),
          });
          return;
        }
        set({
          agentInbox: t,
          panels: { ...get().panels, agent: true },
          ...(fix ? { agentMode: "agent" as const } : {}),
        });
      },
      clearAgentInbox: () => set({ agentInbox: null }),
      toggleBreakpoint: (path, line, on) => {
        const cur = get().breakpoints[path] ?? [];
        const has = cur.includes(line);
        const nextOn = on ?? !has;
        const list = nextOn
          ? [...cur.filter((n) => n !== line), line].sort((a, b) => a - b)
          : cur.filter((n) => n !== line);
        set({ breakpoints: { ...get().breakpoints, [path]: list } });
      },
      setDebug: (p) => set({ debug: { ...get().debug, ...p } }),
      addWatch: (expr) => {
        const w = expr.trim();
        if (!w) return;
        const watches = get().debug.watches;
        if (watches.includes(w)) return;
        set({ debug: { ...get().debug, watches: [...watches, w] } });
      },
      removeWatch: (expr) =>
        set({
          debug: {
            ...get().debug,
            watches: get().debug.watches.filter((w) => w !== expr),
          },
        }),
      setDebugWatches: (watchValues) => set({ debug: { ...get().debug, watchValues } }),
      setDebugEval: (lastEval) => set({ debug: { ...get().debug, lastEval } }),
      setNotice: (notice) => set({ notice }),
      undoFile: (path) => {
        const stack = [...(get().undo[path] ?? [])];
        const prev = stack.pop();
        if (prev == null) return;
        set({
          files: { ...get().files, [path]: prev },
          undo: { ...get().undo, [path]: stack },
        });
        noteLearn("undo", path);
      },
      renameFile: (from, to) => {
        const src = cleanPath(from);
        const name = cleanPath(to);
        if (!name || name === src) return;
        const { files, openPaths, activePath, dirty, pendingDiffs, undo, dirs } = get();
        if (!(src in files) || name in files) return;
        const nextFiles = { ...files, [name]: files[src] };
        delete nextFiles[src];
        const nextDirty = { ...dirty };
        if (src in nextDirty) {
          nextDirty[name] = nextDirty[src];
          delete nextDirty[src];
        }
        const nextUndo = { ...undo };
        if (src in nextUndo) {
          nextUndo[name] = nextUndo[src];
          delete nextUndo[src];
        }
        set({
          files: nextFiles,
          dirty: nextDirty,
          undo: nextUndo,
          dirs: withParents(dirs, name),
          pendingDiffs: pendingDiffs.map((d) => (d.path === src ? { ...d, path: name } : d)),
          openPaths: openPaths.map((p) => (p === src ? name : p)),
          activePath: activePath === src ? name : activePath,
          breakpoints: remapRecord(get().breakpoints, src, name),
          attached: remapList(get().attached, src, name),
          recentPaths: remapList(get().recentPaths, src, name),
          closedTabs: remapList(get().closedTabs, src, name),
          testResults: remapTestMap(get().testResults, src, name),
        });
        pushDisk("write", name, nextFiles[name] ?? "");
        pushDisk("remove", src);
      },
      clearChat: () => set({ chat: [], sessionTokens: { prompt: 0, completion: 0 }, agentJob: null }),
      removeChat: (id) => set({ chat: get().chat.filter((m) => m.id !== id) }),
      proposeFiles: (next) => {
        get().patchFiles(next);
      },
      acceptDiff: (path) => {
        const pendingDiffs = get().pendingDiffs.filter((d) => d.path !== path);
        const dirty = { ...get().dirty };
        delete dirty[path];
        set({ pendingDiffs, dirty });
        const content = get().files[path];
        if (content != null) pushDisk("write", path, content);
        noteLearn("accept", path);
      },
      rejectDiff: (path) => {
        const diff = get().pendingDiffs.find((d) => d.path === path);
        if (!diff) return;
        const files = { ...get().files };
        const created = diff.before === "";
        if (created) delete files[path];
        else files[path] = diff.before;
        const dirty = { ...get().dirty };
        delete dirty[path];
        set({
          files,
          pendingDiffs: get().pendingDiffs.filter((d) => d.path !== path),
          dirty,
        });
        if (created) pushDisk("remove", path);
        else pushDisk("write", path, diff.before);
        noteLearn("reject", `${path}::${(diff.after.split("\n").find((l) => l.trim().length > 6) ?? "").trim().slice(0, 100)}`);
      },
      rejectHunk: (path, hunk) => {
        const diff = get().pendingDiffs.find((d) => d.path === path);
        if (!diff) return;
        const cur = get().files[path] ?? diff.after;
        const next = rejectHunkLines(diff.before, cur, hunk);
        if (next === diff.before) {
          get().rejectDiff(path);
          return;
        }
        set({
          files: { ...get().files, [path]: next },
          pendingDiffs: get().pendingDiffs.map((d) => (d.path === path ? { ...d, after: next } : d)),
          dirty: { ...get().dirty, [path]: true },
        });
      },
      acceptAllDiffs: () => {
        noteLearn("accept", "all");
        const pending = get().pendingDiffs;
        set({ pendingDiffs: [], dirty: {} });
        for (const d of pending) {
          const content = get().files[d.path];
          if (content != null) pushDisk("write", d.path, content);
        }
      },
      rejectAllDiffs: () => {
        const { pendingDiffs, files, dirty } = get();
        const next = { ...files };
        const nextDirty = { ...dirty };
        for (const d of pendingDiffs) {
          if (d.before === "") delete next[d.path];
          else next[d.path] = d.before;
          delete nextDirty[d.path];
        }
        set({ files: next, pendingDiffs: [], dirty: nextDirty });
        for (const d of pendingDiffs) {
          if (d.before === "") pushDisk("remove", d.path);
          else pushDisk("write", d.path, d.before);
        }
      },
      openFile: (path) => {
        const { files, openPaths, panels, autoPreview } = get();
        if (!(path in files)) return;
        const lang = langFromPath(path);
        const preview = autoPreview && (lang === "markdown" || lang === "json");
        set({
          activePath: path,
          openPaths: openPaths.includes(path) ? openPaths : [...openPaths, path],
          panels: { ...panels, code: true },
          previewOpen: preview ? true : get().previewOpen,
          recentPaths: [path, ...get().recentPaths.filter((p) => p !== path)].slice(0, 16),
        });
        queueMicrotask(() => {
          emitPlugin("open", path);
          noteLearn("open", path);
        });
      },
      closeFile: (path) => {
        const { openPaths, activePath } = get();
        const next = openPaths.filter((p) => p !== path);
        set({
          openPaths: next,
          activePath: activePath === path ? (next[next.length - 1] ?? null) : activePath,
          closedTabs: [path, ...get().closedTabs.filter((p) => p !== path)].slice(0, 24),
        });
      },
      setContent: (path, content) => {
        const { files, dirty, undo } = get();
        const prev = files[path] ?? "";
        const stack = [...(undo[path] ?? [])];
        if (stack[stack.length - 1] !== prev) stack.push(prev);
        set({
          files: { ...files, [path]: content },
          dirty: { ...dirty, [path]: true },
          undo: { ...undo, [path]: stack.slice(-40) },
        });
        queueMicrotask(() => emitPlugin("change", path));
        scheduleSyncWrite(path, content);
      },
      writeFile: (path, content, opts) => {
        const name = cleanPath(path);
        if (!name) return;
        const { files, openPaths, dirty, panels, dirs, activePath, undo } = get();
        const quiet = Boolean(opts?.quiet);
        const prev = files[name];
        const nextUndo = { ...undo };
        if (!quiet && prev != null && prev !== content) {
          const stack = [...(nextUndo[name] ?? [])];
          if (stack[stack.length - 1] !== prev) stack.push(prev);
          nextUndo[name] = stack.slice(-40);
        }
        set({
          files: { ...files, [name]: content },
          openPaths: quiet || openPaths.includes(name) ? openPaths : [...openPaths, name],
          activePath: quiet ? activePath : name,
          dirty: { ...dirty, [name]: false },
          dirs: withParents(dirs, name),
          panels: quiet ? panels : { ...panels, code: true },
          flashPath: quiet ? get().flashPath : name,
          undo: nextUndo,
        });
        if (!quiet) {
          window.setTimeout(() => {
            if (get().flashPath === name) set({ flashPath: null });
          }, 1400);
        }
        queueMicrotask(() => emitPlugin("change", name));
        pushDisk("write", name, content);
      },
      deleteFile: (path) => {
        const { files, openPaths, activePath, dirty } = get();
        const nextFiles = { ...files };
        delete nextFiles[path];
        const gone = (p: string) => p === path;
        const nextOpen = openPaths.filter((p) => p !== path);
        set({
          files: nextFiles,
          dirty: dropRecord(dirty, gone),
          openPaths: nextOpen,
          activePath: activePath === path ? (nextOpen[nextOpen.length - 1] ?? null) : activePath,
          pendingDiffs: get().pendingDiffs.filter((d) => d.path !== path),
          undo: dropRecord(get().undo, gone),
          breakpoints: dropRecord(get().breakpoints, gone),
          attached: get().attached.filter((p) => p !== path),
          recentPaths: get().recentPaths.filter((p) => p !== path),
          testResults: dropTestPaths(get().testResults, (p) => p === path),
        });
        pushDisk("remove", path);
      },
      createFolder: (path) => {
        const name = cleanPath(path);
        if (!name) return;
        const { files, dirs } = get();
        if (name in files) return;
        set({ dirs: [...new Set([...withParents(dirs, name), name])] });
        pushDisk("mkdir", name);
      },
      deleteDir: (path) => {
        const dir = cleanPath(path);
        if (!dir) return;
        const { files, openPaths, activePath, dirty, dirs } = get();
        const gone = (p: string) => isInside(p, dir);
        const nextFiles = { ...files };
        for (const p of Object.keys(files)) {
          if (gone(p)) delete nextFiles[p];
        }
        const nextOpen = openPaths.filter((p) => !gone(p));
        set({
          files: nextFiles,
          dirty: dropRecord(dirty, gone),
          openPaths: nextOpen,
          activePath: activePath && gone(activePath) ? (nextOpen[nextOpen.length - 1] ?? null) : activePath,
          dirs: dirs.filter((d) => !gone(d)),
          collapsed: get().collapsed.filter((d) => !gone(d)),
          pendingDiffs: get().pendingDiffs.filter((d) => !gone(d.path)),
          undo: dropRecord(get().undo, gone),
          breakpoints: dropRecord(get().breakpoints, gone),
          attached: get().attached.filter((p) => !gone(p)),
          recentPaths: get().recentPaths.filter((p) => !gone(p)),
          testResults: dropTestPaths(get().testResults, gone),
        });
        pushDisk("remove", dir);
      },
      movePath: (from, dest) => {
        const src = cleanPath(from);
        const target = cleanPath(dest);
        if (!src || src === target) return;
        if (target === src || target.startsWith(`${src}/`)) return;
        const { files, dirs } = get();
        const destIsDir =
          !target || dirs.includes(target) || Object.keys(files).some((p) => isInside(p, target) && p !== target);
        if (src in files) {
          const to = destIsDir ? joinPath(target, src.split("/").pop() ?? src) : target;
          if (to === src || to in files) return;
          get().renameFile(src, to);
          return;
        }
        if (!destIsDir && target in files) return;
        const prefix = `${src}/`;
        const nextFiles = { ...files };
        for (const p of Object.keys(files)) {
          if (p === src || p.startsWith(prefix)) {
            const to = destIsDir
              ? joinPath(target, p.slice(src.length > 0 ? src.length + 1 : 0) || p)
              : joinPath(target, p.slice(prefix.length));
            if (p in nextFiles) {
              nextFiles[to] = nextFiles[p];
              delete nextFiles[p];
            }
          }
        }
        const nextDirs = dirs
          .filter((d) => !isInside(d, src))
          .concat(
            dirs
              .filter((d) => isInside(d, src))
              .map((d) => joinPath(target, d.slice(src.length + 1) || d.split("/").pop() || d)),
          );
        const destRoot = destIsDir ? joinPath(target, src.split("/").pop() ?? src) : target;
        set({
          files: nextFiles,
          dirs: [...new Set([...(target ? [target] : []), ...nextDirs.filter(Boolean)])],
          openPaths: remapList(get().openPaths, src, destRoot),
          activePath: get().activePath ? remapPath(get().activePath!, src, destRoot) : get().activePath,
          dirty: remapRecord(get().dirty, src, destRoot),
          undo: remapRecord(get().undo, src, destRoot),
          pendingDiffs: get().pendingDiffs.map((d) => ({ ...d, path: remapPath(d.path, src, destRoot) })),
          breakpoints: remapRecord(get().breakpoints, src, destRoot),
          attached: remapList(get().attached, src, destRoot),
          recentPaths: remapList(get().recentPaths, src, destRoot),
          collapsed: remapList(get().collapsed, src, destRoot),
          closedTabs: remapList(get().closedTabs, src, destRoot),
        });
        pushDisk("remove", src);
        for (const [p, c] of Object.entries(nextFiles)) {
          if (!(p in files)) pushDisk("write", p, c);
        }
      },
      duplicateFile: (path) => {
        const { files } = get();
        if (!(path in files)) return;
        const next = dupPath(path, new Set(Object.keys(files)));
        get().writeFile(next, files[path]);
      },
      toggleCollapsed: (path) => {
        const cur = get().collapsed;
        set({ collapsed: cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path] });
      },
      applyFiles: (next, extraDirs, opts) => {
        const prev = get();
        const { openPaths, activePath, collapsed } = prev;
        let files = { ...next };
        const keepDirty = Boolean(opts?.keepDirty);
        const dirty: Record<string, boolean> = {};
        if (keepDirty) {
          for (const p of Object.keys(prev.dirty)) {
            if (p in prev.files) {
              files[p] = prev.files[p];
              dirty[p] = true;
            }
          }
        }
        const keepOpen = openPaths.filter((p) => p in files);
        const keepActive = activePath && activePath in files ? activePath : keepOpen[0] ?? null;
        const fromFiles = Object.keys(files).flatMap((p) => ancestorDirs(p));
        const paths = Object.keys(files);
        const nextCollapsed =
          extraDirs != null ? autoCollapsePaths(paths, keepActive) : collapsed.length ? collapsed : autoCollapsePaths(paths, keepActive);
        const gone = (p: string) => !(p in files);
        set({
          files,
          dirs: [...new Set([...(extraDirs ?? []), ...fromFiles])].filter(Boolean),
          openPaths: keepOpen.length ? keepOpen : keepActive ? [keepActive] : [],
          activePath: keepActive,
          dirty,
          collapsed: nextCollapsed,
          pendingDiffs: keepDirty ? prev.pendingDiffs.filter((d) => d.path in files) : [],
          undo: dropRecord(prev.undo, gone),
          breakpoints: dropRecord(prev.breakpoints, gone),
          attached: prev.attached.filter((p) => p in files),
          recentPaths: prev.recentPaths.filter((p) => p in files),
        });
        void import("@/lib/learn").then((m) => m.hydrateLearnFromFiles(files)).catch(() => undefined);
      },
      addChat: (msg) => {
        set({ chat: [...get().chat, { ...msg, id: nid() }] });
        if (msg.role === "user") noteLearn("ask", msg.content);
      },
      startAssistant: (opts) => {
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role === "assistant") {
          const blank =
            !(last.content || "").trim() &&
            !(last.thinking || "").trim() &&
            !(last.steps?.length) &&
            !(last.plan?.length);
          if (blank) {
            chat[chat.length - 1] = {
              ...last,
              at: Date.now(),
              voice: opts?.voice ?? last.voice ?? "agent",
            };
            set({ chat });
            return;
          }
        }
        set({ chat: [...chat, { id: nid(), role: "assistant", voice: opts?.voice ?? "agent", content: "", at: Date.now() }] });
      },
      appendAssistant: (s) => {
        queueLive("text", s);
      },
      appendThinking: (s) => {
        queueLive("think", s);
      },
      addAgentStep: (step) => {
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role !== "assistant") return;
        const steps = [...(last.steps ?? [])];
        const i = [...steps].reverse().findIndex((s) => s.name === step.name && s.status === "run");
        const idx = i >= 0 ? steps.length - 1 - i : -1;
        if (idx >= 0 && step.status !== "run") {
          const prev = steps[idx];
          steps[idx] = {
            ...prev,
            ...step,
            id: prev.id,
            at: prev.at,
            ms: Date.now() - (prev.at || Date.now()),
          };
        } else {
          steps.push({ ...step, id: nid(), at: Date.now() });
        }
        chat[chat.length - 1] = { ...last, steps };
        set({ chat });
      },
      addSessionTokens: (prompt, completion) => {
        const cur = get().sessionTokens;
        set({
          sessionTokens: {
            prompt: cur.prompt + Math.max(0, prompt),
            completion: cur.completion + Math.max(0, completion),
          },
        });
      },
      setSessionJournal: (sessionJournal) => {
        set({ sessionJournal: normalizeJournal(sessionJournal) });
        void import("@/lib/session").then((m) => m.persistSessionDisk()).catch(() => undefined);
      },
      finalizeAssistant: (reply, tools, options) => {
        flushLiveChat();
        const chat = [...get().chat];
        const last = chat[chat.length - 1];
        if (last?.role === "assistant") {
          const stopped = /gestoppt|abgebrochen/i.test(reply);
          const echo = isToolTemplateEcho(last.content) || isToolTemplateEcho(reply);
          const now = Date.now();
          chat[chat.length - 1] = {
            ...last,
            content: options?.replace || echo ? reply : last.content.trim() ? last.content : reply,
            tools: tools ?? last.tools,
            ms: now - (last.at || now),
            steps: last.steps?.map((s) => (s.status === "run" ? { ...s, status: stopped ? "err" : "ok", ms: now - (s.at || now) } : s)),
            plan: last.plan?.map((s) => {
              if (s.status !== "run" && s.status !== "todo") return s;
              if (s.status === "run") {
                const runFailed = last.lastRun && last.lastRun.ok === false && /run|ausführ/i.test(s.text);
                return { ...s, status: stopped || runFailed ? "err" : "todo" };
              }
              return s;
            }),
            harness: last.harness
              ? last.harness.replace(/^(Stop|Arbeit|Plan|Run|Vorschau|Patch|Engine)/, stopped ? "Stop" : "Fertig")
              : last.harness,
          };
          set({ chat });
          return;
        }
        set({ chat: [...chat, { id: nid(), role: "assistant", content: reply, tools }] });
      },
      setDiskName: (diskName) => set({ diskName }),
      setWorkspaceCwd: (workspaceCwd) => set({ workspaceCwd }),
      setSetupDone: (setupDone) => set({ setupDone }),
      setBackupName: (backupName) => set({ backupName }),
      setStorageMode: (storageMode) => set({ storageMode }),
      setAutoSaveDisk: (autoSaveDisk) => set({ autoSaveDisk }),
      setLoadOnStart: (loadOnStart) => set({ loadOnStart }),
      setGithubRepo: (githubRepo) => set({ githubRepo }),
      setGithubToken: (githubToken) => {
        saveSecrets({ githubToken });
        set({ githubToken });
      },
      setInputMap: (inputMap) => set({ inputMap: normalizeInputMap(inputMap) }),
      resetInputMap: () => set({ inputMap: normalizeInputMap(DEFAULT_INPUT_MAP) }),
      setKeyBind: (id, chord) => set({ keyMap: { ...get().keyMap, [id]: chord } }),
      resetKeyMap: () => set({ keyMap: { ...KEY_DEFAULTS } }),
      setAgentBusy: (agentBusy) =>
        set(agentBusy ? { agentBusy, agentStartedAt: get().agentStartedAt || Date.now() } : { agentBusy, agentStartedAt: 0 }),
      setAgentJob: (agentJob) => set({ agentJob }),
      setTestsRunning: (testsRunning) => set({ testsRunning }),
      mergeTestResults: (hits) => {
        const next = { ...get().testResults };
        for (const h of hits) next[`${h.path}:${h.name}`] = h;
        set({ testResults: next });
      },
      pushOutput: (r) => {
        const st = get();
        const previewOnly = Boolean(r.html) && r.ok && !(r.stderr || "").trim();
        if (previewOnly) {
          const output = [...st.output.filter((x) => !(x.label === r.label && x.ok && x.html)), r].slice(-24);
          set({ output });
          return;
        }
        const last = st.output[st.output.length - 1];
        if (last && last.ok === r.ok && last.label === r.label && last.stdout === r.stdout && last.stderr === r.stderr) {
          return;
        }
        const openPanel = st.openOutputOnRun;
        const fromRun = r.ok
          ? r.html
            ? []
            : st.runProblems.filter((p) => p.path !== r.label)
          : [
              ...st.runProblems.filter((p) => p.path !== r.label),
              ...parseRunTrace(`${r.stderr}\n${r.stdout}`, r.label, st.files),
            ];
        const prevOut =
          r.ok && r.html
            ? st.output.filter((x) => x.ok || !/\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(x.label))
            : st.output;
        set({
          output: [...prevOut, r].slice(-24).map((x, i, arr) =>
            i < arr.length - 2 ? { ...x, html: undefined } : x,
          ),
          panels: openPanel ? { ...st.panels, output: true } : st.panels,
          runProblems: fromRun,
          lspProblems: mergeLsp(localLintHits(st.lspProblems), fromRun, st.compileProblems, st.companionProblems),
        });
        if (r.ok) {
          void import("@/lib/intern").then((m) => {
            m.resolveKind("js");
            if (r.html) m.resolveKind("preview");
          });
        }
        if (!r.ok) noteLearn("fail", r.label);
        if (r.label !== "tests" && isTestFile(r.label)) {
          const hits = parseTests(r.stdout, r.stderr, { [r.label]: get().files[r.label] ?? "" });
          if (hits.length) get().mergeTestResults(hits);
        }
      },
      clearOutput: () => set({ output: [] }),
      setRunning: (running) => set({ running }),
      commit: (message) => {
        const { files, commits, dirty } = get();
        const paths = Object.keys(dirty).filter(Boolean);
        const snap: Record<string, string> = {};
        for (const p of Object.keys(files)) snap[p] = files[p];
        set({
          commits: [
            ...commits.slice(-23),
            {
              id: nid(),
              message: message.trim() || "Update",
              at: Date.now(),
              paths: paths.length ? paths : Object.keys(files).sort(),
              snap,
            },
          ],
          dirty: {},
        });
      },
      checkout: (id) => {
        const c = get().commits.find((x) => x.id === id);
        if (!c?.snap) return;
        set({ files: { ...c.snap }, dirty: {}, pendingDiffs: [] });
      },
      revertFile: (path) => {
        const hit = [...get().commits].reverse().find((c) => c.snap && path in c.snap);
        if (!hit?.snap) {
          get().setNotice("Kein Commit für diese Datei");
          return;
        }
        const dirty = { ...get().dirty };
        delete dirty[path];
        set({ files: { ...get().files, [path]: hit.snap[path] }, dirty });
      },
      resetWorkspace: () =>
        set({
          files: { ...SEED_FILES },
          openPaths: [],
          activePath: "",
          dirty: {},
          chat: [],
          commits: [],
          output: [],
          testResults: {},
          testsRunning: false,
          dirs: [],
          collapsed: [],
          sessionJournal: { ...EMPTY_JOURNAL },
          sessionTokens: { prompt: 0, completion: 0 },
          agentJob: null,
          pendingDiffs: [],
          undo: {},
          breakpoints: {},
          checkpoints: [],
          attached: [],
        }),
      resetSettings: () =>
        set({
          theme: "dark",
          locale: "de",
          motion: "full",
          fontSize: 13,
          tabSize: 2,
          lineNumbers: true,
          wordWrap: false,
          editorMinimap: false,
          editorSticky: true,
          editorGuides: true,
          editorWheelZoom: true,
          suggestOn: true,
          insertSpaces: true,
          formatOnSave: false,
          autoPreview: true,
          autoAcceptDiffs: false,
          autoRunAgent: true,
          planWho: "auto" as PlanWho,
          runLoop: true,
          testLoop: true,
          graphLoop: true,
          engineLoop: false,
          loopTries: 3,
          harnessAfterWrite: "run",
          harnessMaxRounds: 24,
          graphSees: 4,
          harnessBoardGrid: true,
          harnessBoardSnap: true,
          liveRun: true,
          liveEditor: true,
          mcpStream: true,
          showStatusBar: true,
          openOutputOnRun: true,
          runInWindow: true,
          runHtml: true,
          autoUpdate: true,
          splitMode: "auto",
          outputDock: "bottom",
          trailWidth: 300,
          trailThinkH: 200,
          trailInChat: false,
          autoHw: false,
          hwNote: "",
          agentMode: "agent",
          agentRules: "",
          llmContext: 32768,
          llmContextAuto: true,
          llmThinking: "auto",
          llmCompact: "auto",
          llmTemperature: 0.3,
          llmMaxOut: 0,
          llmRetries: 3,
          llmHardStopMin: 0,
          llmProvider: "ollama",
          llmAuthMode: "key",
          llmBaseUrl: "http://127.0.0.1:11434/v1",
          llmModel: "llama3.1",
          llmToolModes: {},
          llmToolLearning: {},
          companionUrl: "http://127.0.0.1:7845",
          companionKeep: false,
          netCompiler: true,
          lspEnabled: {},
          lspTimeout: 8,
          lspMaxFiles: 24,
          storageMode: "browser",
          autoSaveDisk: false,
          loadOnStart: false,
          inputMap: normalizeInputMap(DEFAULT_INPUT_MAP),
          keyMap: { ...KEY_DEFAULTS },
          panels: { files: true, code: true, agent: true, trail: true, output: false },
        }),
      };
    },
    {
      name: "anvil-ide",
      skipHydration: true,
      storage: idePersistStorage(),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const active = { provider: String(p.llmProvider || current.llmProvider), model: String(p.llmModel || current.llmModel), baseUrl: String(p.llmBaseUrl || current.llmBaseUrl) };
        const slots = Object.entries((p.llmSlots || {}) as Record<string, LlmSlot>).map(([key, slot]) => ({ provider: key.split(":")[0], model: slot.model, baseUrl: slot.baseUrl }));
        const profiles = Array.isArray(p.llmProfiles) ? p.llmProfiles as LlmProfile[] : [];
        migrateLegacyCaps([active, ...slots, ...profiles].filter((c) => c.provider && c.model).map((c) => ({ ...c, baseUrl: c.baseUrl || providerOf(c.provider).baseUrl })));
        return {
          ...current,
          ...p,
          llmAuthMode: connectionMode(String(p.llmProvider || current.llmProvider), String(p.llmAuthMode || "key")),
          ...(p.llmProvider === "codex" || p.llmProvider === "github" ? { llmBaseUrl: "" } : {}),
          llmModel: modelForProvider(String(p.llmProvider || current.llmProvider),
            p.llmProvider === "github" ? String(p.llmModel || "gpt-4.1").replace(/^openai\//, "") : String(p.llmModel || current.llmModel || "")),
          llmSlots: (p.llmSlots as typeof current.llmSlots) ?? {},
          llmToolModes: p.llmToolModes && typeof p.llmToolModes === "object" && !Array.isArray(p.llmToolModes) ? Object.fromEntries(Object.entries(p.llmToolModes).map(([key, mode]) => [key, toolCompatibility(mode)])) : {},
          llmToolLearning: sanitizeToolLearning(p.llmToolLearning),
          llmProfiles: Array.isArray(p.llmProfiles) ? (p.llmProfiles as LlmProfile[]).map((profile) => ({ ...profile, authMode: connectionMode(profile.provider, profile.authMode) })) : [],
          runInWindow: typeof p.runInWindow === "boolean" ? p.runInWindow : true,
          runHtml: p.runHtml !== false,
          autoUpdate: p.autoUpdate !== false,
          planWho: normalizePlanWho(p.planWho),
          engineLoop: p.engineLoop === true,
          locale: p.locale === "en" || p.locale === "de" ? p.locale : current.locale,
          keyMap: normalizeKeyMap(p.keyMap),
          inputMap: normalizeInputMap(p.inputMap ?? current.inputMap),
          panels: {
            ...({ files: true, code: true, agent: true, trail: true, output: false } satisfies Panels),
            ...((p.panels as Partial<Panels>) ?? {}),
          },
          trailInChat: typeof p.trailInChat === "boolean" ? p.trailInChat : false,
          trailWidth: typeof p.trailWidth === "number" ? p.trailWidth : 300,
          trailThinkH: typeof p.trailThinkH === "number" ? Math.min(720, Math.max(72, p.trailThinkH)) : 200,
          llmContextAuto: p.llmContextAuto !== false,
          llmTemperature: typeof p.llmTemperature === "number" ? Math.min(2, Math.max(0, p.llmTemperature)) : 0.3,
          llmMaxOut: typeof p.llmMaxOut === "number" ? Math.min(65536, Math.max(0, p.llmMaxOut)) : 0,
          lspEnabled: p.lspEnabled && typeof p.lspEnabled === "object" ? (p.lspEnabled as Record<string, boolean>) : {},
          lspTimeout: typeof p.lspTimeout === "number" ? p.lspTimeout : 8,
          lspMaxFiles: typeof p.lspMaxFiles === "number" ? p.lspMaxFiles : 24,
          mcpServers: Array.isArray(p.mcpServers) ? (p.mcpServers as typeof current.mcpServers) : current.mcpServers,
          liveEditor: p.liveEditor !== false,
          mcpStream: p.mcpStream !== false,
          activeSurfaceId: typeof p.activeSurfaceId === "string" && p.activeSurfaceId ? p.activeSurfaceId : ANVIL_SURFACE,
          surfaceMode: p.surfaceMode === "bridge" ? "bridge" : "exclusive",
          mcpLog: [],
          mcpView: {},
          agentBusy: false,
          agentStartedAt: 0,
          running: false,
          testsRunning: false,
          agentInbox: null,
          agentJob: normalizeJob(p.agentJob, { revive: true }),
          agentQueue: Array.isArray(p.agentQueue)
            ? (p.agentQueue as unknown[]).filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 8)
            : [],
          sessionJournal: normalizeJournal(p.sessionJournal),
          workspaceCwd: typeof p.workspaceCwd === "string" ? p.workspaceCwd : "",
        };
      },
      partialize: partializeIde,
    },
  ),
);

if (typeof window !== "undefined") {
  (window as unknown as { __anvilIde?: typeof useIde }).__anvilIde = useIde;
}

export { parentDir, langFromPath };
