import type { IdeState } from "./ide";

function memo<T extends unknown[], R>(fn: (...args: T) => R): (...args: T) => R {
  let previous: T | undefined;
  let value: R;
  return (...args) => {
    if (!previous || args.some((arg, i) => arg !== previous![i])) {
      previous = args;
      value = fn(...args);
    }
    return value;
  };
}

const commits = memo((items: IdeState["commits"]) =>
  items.slice(-12).map((c, i, arr) => ({ ...c, snap: i >= arr.length - 2 ? c.snap : undefined })),
);
const undo = memo((items: IdeState["undo"], open: string[], dirty: IdeState["dirty"]) =>
  Object.fromEntries(
    Object.entries(items)
      .filter(([path]) => open.includes(path) || Boolean(dirty[path]))
      .slice(0, 10)
      .map(([path, stack]) => [path, stack.slice(-4)]),
  ),
);
const diffs = memo((items: IdeState["pendingDiffs"]) =>
  items.slice(0, 16).map((d) => ({ ...d, before: d.before.slice(0, 400_000), after: d.after.slice(0, 400_000) })),
);
const queue = memo((items: string[]) => items.slice(0, 8).map((t) => t.slice(0, 2000)));

export function partializeIde(s: IdeState) {
  return {
    files: s.files,
    openPaths: s.openPaths,
    activePath: s.activePath,
    chat: s.chat,
    commits: commits(s.commits),
    panels: s.panels,
    theme: s.theme,
    locale: s.locale,
    motion: s.motion,
    fontSize: s.fontSize,
    tabSize: s.tabSize,
    lineNumbers: s.lineNumbers,
    wordWrap: s.wordWrap,
    editorMinimap: s.editorMinimap,
    editorSticky: s.editorSticky,
    editorGuides: s.editorGuides,
    editorWheelZoom: s.editorWheelZoom,
    suggestOn: s.suggestOn,
    insertSpaces: s.insertSpaces,
    formatOnSave: s.formatOnSave,
    autoPreview: s.autoPreview,
    autoAcceptDiffs: s.autoAcceptDiffs,
    autoRunAgent: s.autoRunAgent,
    planWho: s.planWho,
    runLoop: s.runLoop,
    testLoop: s.testLoop,
    graphLoop: s.graphLoop,
    engineLoop: s.engineLoop,
    loopTries: s.loopTries,
    harnessAfterWrite: s.harnessAfterWrite,
    harnessMaxRounds: s.harnessMaxRounds,
    graphSees: s.graphSees,
    harnessBoardGrid: s.harnessBoardGrid,
    harnessBoardSnap: s.harnessBoardSnap,
    liveRun: s.liveRun,
    liveEditor: s.liveEditor,
    mcpStream: s.mcpStream,
    showStatusBar: s.showStatusBar,
    openOutputOnRun: s.openOutputOnRun,
    runInWindow: s.runInWindow,
    runHtml: s.runHtml,
    autoUpdate: s.autoUpdate,
    splitMode: s.splitMode,
    llmProvider: s.llmProvider,
    llmAuthMode: s.llmAuthMode,
    llmBaseUrl: s.llmBaseUrl,
    llmModel: s.llmModel,
    llmContext: s.llmContext,
    llmContextAuto: s.llmContextAuto,
    llmThinking: s.llmThinking,
    llmCompact: s.llmCompact,
    llmTemperature: s.llmTemperature,
    llmMaxOut: s.llmMaxOut,
    llmRetries: s.llmRetries,
    llmHardStopMin: s.llmHardStopMin,
    llmSlots: s.llmSlots,
    llmProfiles: s.llmProfiles,
    sessionTokens: s.sessionTokens,
    sessionJournal: s.sessionJournal,
    agentJob: s.agentJob,
    undo: undo(s.undo, s.openPaths, s.dirty),
    sidebar: s.sidebar,
    agentMode: s.agentMode,
    agentRules: s.agentRules,
    sidebarWidth: s.sidebarWidth,
    agentWidth: s.agentWidth,
    outputHeight: s.outputHeight,
    outputWidth: s.outputWidth,
    outputDock: s.outputDock,
    trailWidth: s.trailWidth,
    trailThinkH: s.trailThinkH,
    trailInChat: s.trailInChat,
    autoHw: s.autoHw,
    hwNote: s.hwNote,
    agentQueue: queue(s.agentQueue),
    pluginDisabled: s.pluginDisabled,
    pluginKnown: s.pluginKnown,
    pluginConfig: s.pluginConfig,
    breakpoints: s.breakpoints,
    dirs: s.dirs,
    collapsed: s.collapsed,
    diskName: s.diskName,
    workspaceCwd: s.workspaceCwd,
    setupDone: s.setupDone,
    backupName: s.backupName,
    storageMode: s.storageMode,
    autoSaveDisk: s.autoSaveDisk,
    loadOnStart: s.loadOnStart,
    githubRepo: s.githubRepo,
    inputMap: s.inputMap,
    keyMap: s.keyMap,
    mcpServers: s.mcpServers,
    activeSurfaceId: s.activeSurfaceId,
    surfaceMode: s.surfaceMode,
    companionUrl: s.companionUrl,
    companionKeep: s.companionKeep,
    netCompiler: s.netCompiler,
    lspEnabled: s.lspEnabled,
    lspTimeout: s.lspTimeout,
    lspMaxFiles: s.lspMaxFiles,
    recentPaths: s.recentPaths,
    dirty: s.dirty,
    pendingDiffs: diffs(s.pendingDiffs),
    attached: s.attached,
  };
}
