import { create } from "zustand";
import { persist } from "zustand/middleware";
import { idePersistStorage } from "@/lib/persist-storage";
import { DEFAULT_BRAIN_MODEL, migrateBrainModel } from "./models";

export type BrainAutonomy = "off" | "quiet" | "on";
export type BrainStatus = "idle" | "checking" | "downloading" | "ready" | "error";

export type BrainJobs = {
  intent: boolean;
  distill: boolean;
  complete: boolean;
  palette: boolean;
  compact: boolean;
  inline: boolean;
  ask: boolean;
  help: boolean;
  usage: boolean;
  commit: boolean;
  errors: boolean;
  diffs: boolean;
  search: boolean;
  attach: boolean;
  title: boolean;
  doc: boolean;
  prompts: boolean;
  followup: boolean;
  review: boolean;
  rename: boolean;
  runpick: boolean;
  fixline: boolean;
  tabHint: boolean;
  secrets: boolean;
  mention: boolean;
  stopNote: boolean;
  planText: boolean;
  comment: boolean;
  i18n: boolean;
  logTrim: boolean;
};

const JOBS: BrainJobs = {
  intent: true,
  distill: false,
  complete: false,
  palette: false,
  compact: false,
  inline: false,
  ask: false,
  help: true,
  usage: false,
  commit: true,
  errors: true,
  diffs: false,
  search: false,
  attach: false,
  title: true,
  doc: false,
  prompts: false,
  followup: false,
  review: false,
  rename: false,
  runpick: false,
  fixline: false,
  tabHint: false,
  secrets: true,
  mention: false,
  stopNote: false,
  planText: false,
  comment: false,
  i18n: false,
  logTrim: false,
};

export type BrainLog = { t: number; job: string; src: "heur" | "llm" | "cache"; ms: number };

export type LaneKind = "brief" | "risk" | "error" | "next" | "review";
export type LaneNote = { t: number; kind: LaneKind; text: string };

export type HelperSlot = {
  context: number;
  temperature: number;
  maxTokens: number;
  sliding: boolean;
  repeatPenalty: number;
  systemExtra: string;
};

export type HelperProfile = HelperSlot & {
  id: string;
  name: string;
  modelId: string;
  customId: string;
};

function helperSnap(s: HelperSlot): HelperSlot {
  return {
    context: s.context,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    sliding: s.sliding,
    repeatPenalty: s.repeatPenalty,
    systemExtra: s.systemExtra,
  };
}

function helperKey(s: { customId: string; modelId: string }): string {
  return s.customId.trim() || s.modelId;
}

type BrainState = {
  on: boolean;
  autoLoad: boolean;
  autoUpdate: boolean;
  modelId: string;
  customId: string;
  status: BrainStatus;
  progress: number;
  progressText: string;
  error: string;
  loadedId: string;
  libVersion: string;
  modelStamp: string;
  updateHint: string;
  fp16: boolean;
  gpu: string;
  gpuPower: "high-performance" | "low-power";
  useWorker: boolean;
  gpuKeepAlive: boolean;
  gpuFitBuffer: boolean;
  gpuWarmShaders: boolean;
  sliding: boolean;
  repeatPenalty: number;
  context: number;
  temperature: number;
  maxTokens: number;
  systemExtra: string;
  jobs: BrainJobs;
  prompts: string[];
  followups: string[];
  autonomy: BrainAutonomy;
  lastAuto: string;
  lane: LaneNote[];
  busy: boolean;
  stats: { jobs: number; cache: number; llm: number; heur: number };
  log: BrainLog[];
  helperSlots: Record<string, HelperSlot>;
  helperProfiles: HelperProfile[];
  autoProfile: boolean;
  setOn: (v: boolean) => void;
  setAutoLoad: (v: boolean) => void;
  setAutoUpdate: (v: boolean) => void;
  setModelId: (v: string) => void;
  setCustomId: (v: string) => void;
  setStatus: (s: Partial<Pick<BrainState, "status" | "progress" | "progressText" | "error" | "loadedId" | "libVersion" | "gpu" | "fp16" | "modelStamp" | "updateHint">>) => void;
  setContext: (n: number) => void;
  setTemperature: (n: number) => void;
  setMaxTokens: (n: number) => void;
  setSystemExtra: (v: string) => void;
  setJob: (k: keyof BrainJobs, v: boolean) => void;
  setPrompts: (v: string[]) => void;
  setFollowups: (v: string[]) => void;
  setGpuPower: (v: "high-performance" | "low-power") => void;
  setUseWorker: (v: boolean) => void;
  setGpuKeepAlive: (v: boolean) => void;
  setGpuFitBuffer: (v: boolean) => void;
  setGpuWarmShaders: (v: boolean) => void;
  setSliding: (v: boolean) => void;
  setRepeatPenalty: (n: number) => void;
  setAutonomy: (v: BrainAutonomy) => void;
  setLastAuto: (v: string) => void;
  pushLane: (n: LaneNote) => void;
  clearLane: () => void;
  setBusy: (v: boolean) => void;
  setAutoProfile: (v: boolean) => void;
  saveHelperProfile: (name: string) => void;
  applyHelperProfile: (id: string) => void;
  deleteHelperProfile: (id: string) => void;
  logJob: (job: string, src: BrainLog["src"], ms: number) => void;
};

export const useBrain = create<BrainState>()(
  persist(
    (set, get) => ({
      on: true,
      autoLoad: false,
      autoUpdate: true,
      modelId: DEFAULT_BRAIN_MODEL,
      customId: "",
      status: "idle",
      progress: 0,
      progressText: "",
      error: "",
      loadedId: "",
      libVersion: "",
      modelStamp: "",
      updateHint: "",
      fp16: true,
      gpu: "",
      gpuPower: "high-performance",
      useWorker: true,
      gpuKeepAlive: false,
      gpuFitBuffer: true,
      gpuWarmShaders: true,
      sliding: false,
      repeatPenalty: 1.12,
      context: 8192,
      temperature: 0.3,
      maxTokens: 512,
      systemExtra: "",
      jobs: JOBS,
      prompts: [],
      followups: [],
      autonomy: "quiet",
      lastAuto: "",
      lane: [],
      busy: false,
      stats: { jobs: 0, cache: 0, llm: 0, heur: 0 },
      log: [],
      helperSlots: {},
      helperProfiles: [],
      autoProfile: true,
      setOn: (on) => set({ on }),
      setAutoLoad: (autoLoad) => set({ autoLoad }),
      setAutoUpdate: (autoUpdate) => set({ autoUpdate }),
      setModelId: (modelId) => {
        const s = get();
        const helperSlots = s.autoProfile ? { ...(s.helperSlots ?? {}), [helperKey(s)]: helperSnap(s) } : s.helperSlots ?? {};
        const nextKey = modelId;
        const hit = helperSlots[nextKey];
        set({
          modelId,
          helperSlots,
          customId: "",
          ...(hit ?? {}),
        });
      },
      setCustomId: (customId) => {
        const s = get();
        const helperSlots = s.autoProfile ? { ...(s.helperSlots ?? {}), [helperKey(s)]: helperSnap(s) } : s.helperSlots ?? {};
        const hit = helperSlots[customId.trim() || s.modelId];
        set({ customId, helperSlots, ...(hit ?? {}) });
      },
      setStatus: (s) => set(s),
      setContext: (n) => {
        const context = Math.min(32768, Math.max(1024, Math.round(n)));
        const s = get();
        set({
          context,
          helperSlots: s.autoProfile ? { ...(s.helperSlots ?? {}), [helperKey(s)]: { ...helperSnap(s), context } } : s.helperSlots,
        });
      },
      setTemperature: (n) => {
        const temperature = Math.min(1.5, Math.max(0, n));
        const s = get();
        set({
          temperature,
          helperSlots: s.autoProfile ? { ...(s.helperSlots ?? {}), [helperKey(s)]: { ...helperSnap(s), temperature } } : s.helperSlots,
        });
      },
      setMaxTokens: (n) => {
        const maxTokens = Math.min(2048, Math.max(32, Math.round(n)));
        const s = get();
        set({
          maxTokens,
          helperSlots: s.autoProfile ? { ...(s.helperSlots ?? {}), [helperKey(s)]: { ...helperSnap(s), maxTokens } } : s.helperSlots,
        });
      },
      setSystemExtra: (systemExtra) => {
        const s = get();
        set({
          systemExtra,
          helperSlots: s.autoProfile ? { ...(s.helperSlots ?? {}), [helperKey(s)]: { ...helperSnap(s), systemExtra } } : s.helperSlots,
        });
      },
      setJob: (k, v) => set({ jobs: { ...get().jobs, [k]: v } }),
      setPrompts: (prompts) => set({ prompts: prompts.slice(0, 4) }),
      setFollowups: (followups) => set({ followups: followups.slice(0, 3) }),
      setGpuPower: (gpuPower) => set({ gpuPower }),
      setUseWorker: (useWorker) => set({ useWorker }),
      setGpuKeepAlive: (gpuKeepAlive) => set({ gpuKeepAlive }),
      setGpuFitBuffer: (gpuFitBuffer) => set({ gpuFitBuffer }),
      setGpuWarmShaders: (gpuWarmShaders) => set({ gpuWarmShaders }),
      setSliding: (sliding) => {
        const s = get();
        set({
          sliding,
          helperSlots: s.autoProfile ? { ...(s.helperSlots ?? {}), [helperKey(s)]: { ...helperSnap(s), sliding } } : s.helperSlots,
        });
      },
      setRepeatPenalty: (n) => {
        const repeatPenalty = Math.min(1.4, Math.max(1, n));
        const s = get();
        set({
          repeatPenalty,
          helperSlots: s.autoProfile ? { ...(s.helperSlots ?? {}), [helperKey(s)]: { ...helperSnap(s), repeatPenalty } } : s.helperSlots,
        });
      },
      setAutonomy: (autonomy) => set({ autonomy }),
      setLastAuto: (lastAuto) => set({ lastAuto: lastAuto.replace(/<\/?think>/gi, "").trim().slice(0, 40) }),
      pushLane: (n) => set({ lane: [...get().lane, n].slice(-5) }),
      clearLane: () => set({ lane: [] }),
      setBusy: (busy) => set({ busy }),
      setAutoProfile: (autoProfile) => set({ autoProfile }),
      saveHelperProfile: (name) => {
        const s = get();
        const label = name.trim() || (s.customId.trim() || s.modelId);
        const hit = s.helperProfiles.find((p) => p.name === label);
        const row: HelperProfile = {
          id: hit?.id ?? `h-${Date.now()}`,
          name: label,
          modelId: s.modelId,
          customId: s.customId,
          ...helperSnap(s),
        };
        const helperProfiles = hit ? s.helperProfiles.map((p) => (p.id === hit.id ? row : p)) : [...s.helperProfiles, row];
        set({
          helperProfiles,
          helperSlots: { ...(s.helperSlots ?? {}), [helperKey(s)]: helperSnap(s) },
        });
      },
      applyHelperProfile: (id) => {
        const s = get();
        const p = s.helperProfiles.find((x) => x.id === id);
        if (!p) return;
        set({
          modelId: p.modelId,
          customId: p.customId,
          context: p.context,
          temperature: p.temperature,
          maxTokens: p.maxTokens,
          sliding: p.sliding,
          repeatPenalty: p.repeatPenalty,
          systemExtra: p.systemExtra,
          helperSlots: { ...(s.helperSlots ?? {}), [p.customId.trim() || p.modelId]: helperSnap(p) },
        });
      },
      deleteHelperProfile: (id) => set({ helperProfiles: get().helperProfiles.filter((p) => p.id !== id) }),
      logJob: (job, src, ms) =>
        set((s) => ({
          stats: {
            jobs: s.stats.jobs + 1,
            cache: s.stats.cache + (src === "cache" ? 1 : 0),
            llm: s.stats.llm + (src === "llm" ? 1 : 0),
            heur: s.stats.heur + (src === "heur" ? 1 : 0),
          },
          log: [{ t: Date.now(), job, src, ms }, ...s.log].slice(0, 24),
        })),
    }),
    {
      name: "anvil-brain",
      skipHydration: true,
      storage: idePersistStorage(),
      merge: (persisted, current) => {
        const p = persisted as Partial<BrainState> | undefined;
        return {
          ...current,
          ...p,
          modelId: migrateBrainModel(p?.modelId),
          customId: p?.customId && /[-.]4B-q4f/i.test(p.customId) ? "" : (p?.customId ?? current.customId),
          jobs: { ...JOBS, ...p?.jobs },
          helperSlots: p?.helperSlots ?? {},
          helperProfiles: p?.helperProfiles ?? [],
          autoProfile: p?.autoProfile !== false,
          gpuKeepAlive: Boolean(p?.gpuKeepAlive),
          gpuFitBuffer: p?.gpuFitBuffer !== false,
          gpuWarmShaders: p?.gpuWarmShaders !== false,
          lane: [],
        };
      },
      partialize: (s) => ({
        on: s.on,
        autoLoad: s.autoLoad,
        autoUpdate: s.autoUpdate,
        modelId: s.modelId,
        customId: s.customId,
        context: s.context,
        temperature: s.temperature,
        maxTokens: s.maxTokens,
        systemExtra: s.systemExtra,
        jobs: { ...JOBS, ...s.jobs },
        gpuPower: s.gpuPower,
        useWorker: s.useWorker,
        gpuKeepAlive: Boolean(s.gpuKeepAlive),
        gpuFitBuffer: s.gpuFitBuffer !== false,
        gpuWarmShaders: s.gpuWarmShaders !== false,
        sliding: s.sliding,
        repeatPenalty: s.repeatPenalty,
        autonomy: s.autonomy,
        libVersion: s.libVersion,
        modelStamp: s.modelStamp,
        helperSlots: s.helperSlots ?? {},
        helperProfiles: s.helperProfiles ?? [],
        autoProfile: s.autoProfile !== false,
      }),
    },
  ),
);

export function activeModelId(): string {
  const s = useBrain.getState();
  return (s.customId.trim() || s.modelId).trim();
}

export function brainReady(): boolean {
  const s = useBrain.getState();
  return s.on && s.status === "ready" && Boolean(s.loadedId);
}
