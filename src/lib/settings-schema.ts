import { z } from "zod";
import { PROVIDERS, type ProviderId } from "./providers.ts";
import { INPUT_ACTIONS, normalizeInputMap } from "./input-map.ts";
import { KEY_DEFAULTS, normalizeKeyMap } from "./keymap.ts";
import { sanitizeToolLearning } from "./tool-learning.ts";
import { CONTEXT_MAX, CONTEXT_MIN } from "./tokens.ts";

const bool = z.boolean();
const text = z.string();
const count = (min: number, max: number) => z.number().int().min(min).max(max);
const number = (min: number, max: number) => z.number().min(min).max(max);
const recordKey = text.refine((v) => !["__proto__", "constructor", "prototype"].includes(v), "Ungültiger Schlüssel");
const provider = z.custom<ProviderId>((v) => typeof v === "string" && PROVIDERS.some((p) => p.id === v));
const thinking = z.enum(["off", "auto", "low", "medium", "high"]);
const compact = z.enum(["off", "auto", "aggressive"]);
const toolMode = z.enum(["standard", "compact", "text"]);
const context = count(CONTEXT_MIN, CONTEXT_MAX);

const slot = z.object({
  authMode: z.enum(["abo", "key"]).optional(),
  contextAuto: bool.optional(),
  baseUrl: text,
  model: text,
  context,
  thinking,
  compact,
  temperature: number(0, 2).default(0.3),
  maxOut: count(0, 65536).default(0),
});
const profile = slot.extend({ id: text.min(1), name: text, provider, toolMode: toolMode.optional() });
const binding = z.object({ keys: z.array(text).optional(), pad: z.array(count(0, 255)).optional() });
const inputMap = z.object({
  ...Object.fromEntries(INPUT_ACTIONS.map((key) => [key, binding.optional()])),
  stick: bool.optional(), deadzone: number(0.05, 0.8).optional(),
}).transform(normalizeInputMap);
const chord = z.object({ key: text, ctrl: bool.optional(), shift: bool.optional(), alt: bool.optional() });
const keyMap = z.object(Object.fromEntries(Object.keys(KEY_DEFAULTS).map((key) => [key, chord.optional()]))).transform(normalizeKeyMap);

export const ideSettingsSchema = z.object({
  theme: z.enum(["dark", "light"]),
  locale: z.enum(["de", "en"]),
  motion: z.enum(["off", "reduced", "full"]),
  fontSize: count(10, 22),
  tabSize: z.union([z.literal(2), z.literal(4), z.literal(8)]),
  lineNumbers: bool, wordWrap: bool, editorMinimap: bool, editorSticky: bool,
  editorGuides: bool, editorWheelZoom: bool, insertSpaces: bool, suggestOn: bool,
  formatOnSave: bool, autoPreview: bool, liveRun: bool, liveEditor: bool, mcpStream: bool,
  autoAcceptDiffs: bool, autoRunAgent: bool,
  planWho: z.enum(["auto", "agent", "anvil", "helper"]),
  runLoop: bool, testLoop: bool, graphLoop: bool, engineLoop: bool,
  loopTries: count(1, 5),
  harnessAfterWrite: z.enum(["run", "engine", "preview", "none"]),
  harnessMaxRounds: count(8, 48), graphSees: count(0, 8),
  harnessBoardGrid: bool, harnessBoardSnap: bool,
  showStatusBar: bool, openOutputOnRun: bool, runInWindow: bool, runHtml: bool, autoUpdate: bool,
  panels: z.object({ files: bool, code: bool, agent: bool, trail: bool, output: bool })
    .refine((v) => Object.values(v).some(Boolean), "Mindestens ein Bereich muss sichtbar bleiben"),
  splitMode: z.enum(["auto", "side", "stack"]),
  sidebarWidth: number(160, 420), agentWidth: number(240, 640),
  outputHeight: number(120, 520), outputWidth: number(240, 640),
  outputDock: z.enum(["bottom", "side"]),
  trailWidth: number(180, 560), trailThinkH: number(72, 720), trailInChat: bool, autoHw: bool,
  llmProvider: provider, llmAuthMode: z.enum(["abo", "key"]),
  llmBaseUrl: text, llmModel: text, llmContext: context, llmContextAuto: bool,
  llmThinking: thinking, llmCompact: compact,
  llmTemperature: number(0, 2), llmMaxOut: count(0, 65536),
  llmRetries: count(1, 8), llmHardStopMin: count(0, 480),
  llmSlots: z.record(recordKey, slot), llmProfiles: z.array(profile),
  llmToolModes: z.record(recordKey, toolMode),
  llmToolLearning: z.record(recordKey, z.unknown()).transform((v) => sanitizeToolLearning(v)),
  agentMode: z.enum(["ask", "agent"]), agentRules: text,
  storageMode: z.enum(["browser", "disk"]), autoSaveDisk: bool, loadOnStart: bool,
  companionUrl: text, companionKeep: bool, netCompiler: bool,
  lspEnabled: z.record(recordKey, bool), lspTimeout: number(1, 60), lspMaxFiles: count(1, 200),
  mcpServers: z.array(z.object({
    id: recordKey.min(1), name: text, url: text, enabled: bool,
    transport: z.enum(["http", "stdio"]).optional(), command: text.optional(), args: z.array(text).optional(), cwd: text.optional(),
    auth: z.enum(["bearer", "oauth"]).optional(), oauthClientId: text.optional(),
    context: z.record(recordKey, text).optional(), timeoutMs: number(1, 3_600_000).optional(),
  })).refine((servers) => new Set(servers.map((s) => s.id)).size === servers.length, "Doppelte MCP-ID"),
  activeSurfaceId: text, surfaceMode: z.enum(["exclusive", "bridge"]),
  inputMap, keyMap,
}).partial();

const helperSlot = z.object({
  context: count(1024, 32768), temperature: number(0, 1.5), maxTokens: count(32, 2048),
  sliding: bool, repeatPenalty: number(1, 1.4), systemExtra: text,
});
export const brainSettingsSchema = helperSlot.extend({
  on: bool, autoLoad: bool, autoUpdate: bool, modelId: text, customId: text,
  autonomy: z.enum(["off", "quiet", "on"]), gpuPower: z.enum(["high-performance", "low-power"]),
  useWorker: bool, gpuKeepAlive: bool, gpuFitBuffer: bool, gpuWarmShaders: bool,
  jobs: z.record(recordKey, bool),
  autoProfile: bool,
  helperSlots: z.record(recordKey, helperSlot),
  helperProfiles: z.array(helperSlot.extend({ id: text.min(1), name: text, modelId: text, customId: text })),
}).partial();

export const modelSettingsSchema = z.object({
  cacheBackend: z.enum(["auto", "opfs", "indexeddb"]), keepHelperCache: bool, prefetchOnStart: bool,
  pinHelper: z.array(text), pinAgent: z.array(text),
}).partial();

const learnPrefs = z.object({
  inject: bool, person: bool, project: bool, profile: bool, negatives: bool, skills: bool,
  skillBodies: bool, distill: bool, adaptIde: bool, pluginSkills: bool,
  factLimit: count(0, 1000), skillLimit: count(0, 1000),
}).partial();
const fact = z.object({
  id: text, kind: z.enum(["user", "project", "lesson"]), text, conf: number(0, 1),
  at: number(0, Number.MAX_SAFE_INTEGER), hits: count(0, Number.MAX_SAFE_INTEGER),
  scope: z.enum(["user", "project"]).default("user"), ws: text.optional(),
});
const skill = z.object({
  id: text, name: text, when: text, body: text, file: text.optional(), kind: z.enum(["guide", "plugin"]),
  uses: count(0, Number.MAX_SAFE_INTEGER), at: number(0, Number.MAX_SAFE_INTEGER),
  score: z.number(), wins: count(0, Number.MAX_SAFE_INTEGER), fails: count(0, Number.MAX_SAFE_INTEGER),
  scope: z.enum(["user", "project"]).default("user"), ws: text.optional(),
});
export const settingsPackSchema = z.object({
  v: z.union([z.literal(1), z.literal(2)]).optional(),
  ide: ideSettingsSchema.optional(), brain: brainSettingsSchema.optional(), models: modelSettingsSchema.optional(),
  learn: z.object({
    on: bool.optional(), prefs: learnPrefs.optional(), facts: z.array(fact).optional(), skills: z.array(skill).optional(),
    negs: z.array(z.object({ id: text, path: text, text, ws: text.optional(), at: number(0, Number.MAX_SAFE_INTEGER) })).optional(),
    forgotten: z.array(text).optional(),
    forgottenFacts: z.array(text).optional(),
  }).optional(),
  intern: z.object({ prefs: z.object({ on: bool, autoHeal: bool, autoSoft: bool }).partial().optional(), appLog: bool.optional() }).optional(),
});

export type IdeSettings = z.infer<typeof ideSettingsSchema>;
export type SettingsPack = z.infer<typeof settingsPackSchema>;
export const IDE_SETTINGS_KEYS = Object.keys(ideSettingsSchema.shape) as (keyof IdeSettings)[];
export const BRAIN_SETTINGS_KEYS = Object.keys(brainSettingsSchema.shape) as (keyof z.infer<typeof brainSettingsSchema>)[];
export const MODEL_SETTINGS_KEYS = Object.keys(modelSettingsSchema.shape) as (keyof z.infer<typeof modelSettingsSchema>)[];

export function pickSettings<T extends object, K extends keyof T>(state: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<T, K>;
}

export function parseSettingsPack(value: unknown): SettingsPack {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Keine gültige Einstellungsdatei");
  const raw = value as Record<string, unknown>;
  const wrapped = ["ide", "brain", "models", "learn", "intern"].some((key) => key in raw);
  const parsed = settingsPackSchema.safeParse(wrapped ? raw : { v: raw.v, ide: raw });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "Datei";
    throw new Error(`Ungültige Einstellung: ${field}. Es wurde nichts übernommen.`);
  }
  if (![parsed.data.ide, parsed.data.brain, parsed.data.models, parsed.data.learn, parsed.data.intern].some((part) => part && Object.keys(part).length)) {
    throw new Error("Die Datei enthält keine Einstellungen");
  }
  return parsed.data;
}
