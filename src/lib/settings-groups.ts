import type { IdeSettings } from "./settings-schema.ts";

export const IDE_SETTINGS_GROUPS = {
  agent: ["llmProvider", "llmAuthMode", "llmBaseUrl", "llmModel", "llmContext", "llmContextAuto", "llmThinking", "llmCompact", "llmTemperature", "llmMaxOut", "llmRetries", "llmHardStopMin", "llmToolModes", "agentMode", "agentRules", "autoAcceptDiffs", "autoRunAgent", "planWho", "runLoop", "testLoop", "graphLoop", "engineLoop", "loopTries", "harnessAfterWrite", "harnessMaxRounds", "graphSees", "harnessBoardGrid", "harnessBoardSnap", "liveEditor", "mcpStream", "activeSurfaceId", "surfaceMode"],
  companion: ["companionUrl", "companionKeep", "netCompiler", "lspEnabled", "lspTimeout", "lspMaxFiles"],
  editor: ["theme", "locale", "fontSize", "tabSize", "lineNumbers", "wordWrap", "editorMinimap", "editorSticky", "editorGuides", "editorWheelZoom", "insertSpaces", "suggestOn", "formatOnSave", "autoPreview", "liveRun"],
  layout: ["panels", "splitMode", "sidebarWidth", "agentWidth", "outputHeight", "outputWidth", "showStatusBar", "trailWidth", "trailThinkH", "trailInChat", "autoHw", "motion", "helpPreferences"],
  output: ["outputDock", "openOutputOnRun", "runInWindow", "runHtml"],
  storage: ["storageMode", "autoSaveDisk", "loadOnStart"],
  input: ["inputMap"],
  keys: ["keyMap"],
  data: ["autoUpdate"],
} as const satisfies Record<string, readonly (keyof IdeSettings)[]>;

export type SettingsCategory = keyof typeof IDE_SETTINGS_GROUPS | "brain" | "models" | "learn" | "intern";
