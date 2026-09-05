import { useBrain } from "@/lib/brain";
import { useIntern } from "@/lib/intern";
import { LEARN_DEFAULTS, useLearn } from "@/lib/learn";
import { normalizeKeyMap } from "@/lib/keymap";
import { normalizeInputMap } from "@/lib/input-map";
import { useIde } from "@/store/ide";

const IDE_KEYS = [
  "theme",
  "locale",
  "motion",
  "fontSize",
  "tabSize",
  "lineNumbers",
  "wordWrap",
  "editorMinimap",
  "editorSticky",
  "editorGuides",
  "editorWheelZoom",
  "insertSpaces",
  "suggestOn",
  "formatOnSave",
  "autoPreview",
  "liveRun",
  "liveEditor",
  "mcpStream",
  "autoAcceptDiffs",
  "autoRunAgent",
  "planWho",
  "runLoop",
  "testLoop",
  "graphLoop",
  "engineLoop",
  "loopTries",
  "harnessAfterWrite",
  "harnessMaxRounds",
  "graphSees",
  "harnessBoardGrid",
  "harnessBoardSnap",
  "showStatusBar",
  "openOutputOnRun",
  "runInWindow",
  "splitMode",
  "outputDock",
  "trailWidth",
  "trailInChat",
  "autoHw",
  "llmProvider",
  "llmBaseUrl",
  "llmModel",
  "llmContext",
  "llmContextAuto",
  "llmThinking",
  "llmCompact",
  "llmTemperature",
  "llmMaxOut",
  "llmRetries",
  "llmHardStopMin",
  "agentMode",
  "agentRules",
  "storageMode",
  "autoSaveDisk",
  "loadOnStart",
  "companionUrl",
  "companionKeep",
  "lspEnabled",
  "lspTimeout",
  "lspMaxFiles",
  "mcpServers",
  "activeSurfaceId",
  "surfaceMode",
  "inputMap",
  "keyMap",
  "llmProfiles",
] as const;

export function exportSettingsPack(): Record<string, unknown> {
  const s = useIde.getState();
  const ide: Record<string, unknown> = {};
  for (const k of IDE_KEYS) ide[k] = s[k as keyof typeof s];
  const b = useBrain.getState();
  const l = useLearn.getState();
  const i = useIntern.getState();
  return {
    v: 1,
    ide,
    brain: {
      on: b.on,
      autoLoad: b.autoLoad,
      autoUpdate: b.autoUpdate,
      modelId: b.modelId,
      customId: b.customId,
      context: b.context,
      temperature: b.temperature,
      maxTokens: b.maxTokens,
      systemExtra: b.systemExtra,
      jobs: b.jobs,
      autonomy: b.autonomy,
      sliding: b.sliding,
      repeatPenalty: b.repeatPenalty,
      gpuPower: b.gpuPower,
      useWorker: b.useWorker,
      gpuKeepAlive: b.gpuKeepAlive,
      gpuFitBuffer: b.gpuFitBuffer,
      gpuWarmShaders: b.gpuWarmShaders,
    },
    learn: { on: l.on, prefs: l.prefs, facts: l.facts, skills: l.skills, negs: l.negs, forgotten: l.forgotten },
    intern: { prefs: i.prefs },
  };
}

export function applySettingsPack(data: Record<string, unknown>): void {
  const ide = (data.ide && typeof data.ide === "object" ? data.ide : data) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of IDE_KEYS) {
    if (k in ide) patch[k] = ide[k];
  }
  if (patch.inputMap) patch.inputMap = normalizeInputMap(patch.inputMap);
  if (patch.keyMap) patch.keyMap = normalizeKeyMap(patch.keyMap);
  useIde.setState(patch as Partial<ReturnType<typeof useIde.getState>>);
  const brain = data.brain as Record<string, unknown> | undefined;
  if (brain && typeof brain === "object") {
    const st = useBrain.getState();
    if (typeof brain.on === "boolean") st.setOn(brain.on);
    if (typeof brain.autoLoad === "boolean") st.setAutoLoad(brain.autoLoad);
    if (typeof brain.modelId === "string") st.setModelId(brain.modelId);
    if (typeof brain.customId === "string") st.setCustomId(brain.customId);
    if (typeof brain.context === "number") st.setContext(brain.context);
    if (typeof brain.temperature === "number") st.setTemperature(brain.temperature);
    if (typeof brain.maxTokens === "number") st.setMaxTokens(brain.maxTokens);
    if (typeof brain.systemExtra === "string") st.setSystemExtra(brain.systemExtra);
    if (typeof brain.autonomy === "string") st.setAutonomy(brain.autonomy as "off" | "quiet" | "on");
    if (typeof brain.sliding === "boolean") st.setSliding(brain.sliding);
    if (typeof brain.repeatPenalty === "number") st.setRepeatPenalty(brain.repeatPenalty);
    if (typeof brain.gpuPower === "string") st.setGpuPower(brain.gpuPower as "high-performance" | "low-power");
    if (typeof brain.useWorker === "boolean") st.setUseWorker(brain.useWorker);
    if (typeof brain.gpuKeepAlive === "boolean") st.setGpuKeepAlive(brain.gpuKeepAlive);
    if (typeof brain.gpuFitBuffer === "boolean") st.setGpuFitBuffer(brain.gpuFitBuffer);
    if (typeof brain.gpuWarmShaders === "boolean") st.setGpuWarmShaders(brain.gpuWarmShaders);
    if (brain.jobs && typeof brain.jobs === "object") {
      for (const [k, v] of Object.entries(brain.jobs as Record<string, boolean>)) {
        if (typeof v === "boolean") st.setJob(k as keyof ReturnType<typeof useBrain.getState>["jobs"], v);
      }
    }
  }
  const learn = data.learn as {
    on?: boolean;
    prefs?: Record<string, unknown>;
    facts?: unknown;
    skills?: unknown;
    negs?: unknown;
    forgotten?: unknown;
  } | undefined;
  if (learn) {
    if (typeof learn.on === "boolean") useLearn.getState().setOn(learn.on);
    if (learn.prefs) {
      const l = useLearn.getState();
      for (const [k, v] of Object.entries(learn.prefs)) l.setPref(k as keyof typeof LEARN_DEFAULTS, v as never);
    }
    if (learn.facts || learn.skills || learn.negs || learn.forgotten) {
      useLearn.getState().importDump({
        facts: learn.facts as never,
        skills: learn.skills as never,
        negs: learn.negs as never,
        forgotten: learn.forgotten as never,
      });
    }
  }
  const intern = data.intern as { prefs?: Record<string, unknown> } | undefined;
  if (intern?.prefs) useIntern.getState().setPrefs(intern.prefs as Partial<ReturnType<typeof useIntern.getState>["prefs"]>);
}

export function resetAllSettings(): void {
  useIde.getState().resetSettings();
  useLearn.getState().resetPrefs();
  useIntern.getState().setPrefs({ on: true, autoHeal: true, autoSoft: false });
  const b = useBrain.getState();
  b.setAutonomy("quiet");
  b.setContext(8192);
  b.setMaxTokens(512);
  b.setTemperature(0.3);
  b.setRepeatPenalty(1.12);
}
