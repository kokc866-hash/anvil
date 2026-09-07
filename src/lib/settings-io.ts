import { useBrain } from "@/lib/brain/store";
import { useIntern } from "@/lib/intern";
import { useLearn } from "@/lib/learn";
import { useModelLib } from "@/lib/model-lib";
import { useIde } from "@/store/ide";
import { applyLang } from "./i18n";
import { appLogOn, setAppLogOn } from "./app-log";
import { connectionMode, providerOf } from "./providers";
import { sanitizeToolLearning } from "./tool-learning";
import { IDE_SETTINGS_GROUPS, type SettingsCategory } from "./settings-groups";
import { BRAIN_SETTINGS_KEYS, IDE_SETTINGS_KEYS, MODEL_SETTINGS_KEYS, parseSettingsPack, pickSettings, type IdeSettings } from "./settings-schema";

function mergeProfiles<T extends { id: string }>(existing: T[], incoming?: T[]): T[] {
  return incoming ? [...new Map([...existing, ...incoming].map((p) => [p.id, p])).values()] : existing;
}

export function exportSettingsPack(): Record<string, unknown> {
  const ide = useIde.getState(), brain = useBrain.getState(), learn = useLearn.getState();
  return {
    v: 2,
    ide: pickSettings(ide, IDE_SETTINGS_KEYS),
    brain: pickSettings(brain, BRAIN_SETTINGS_KEYS),
    models: pickSettings(useModelLib.getState(), MODEL_SETTINGS_KEYS),
    learn: { on: learn.on, prefs: learn.prefs, facts: learn.facts, skills: learn.skills, negs: learn.negs, forgotten: learn.forgotten },
    intern: { prefs: useIntern.getState().prefs, appLog: appLogOn() },
  };
}

function restoreConnectionMode(patch: IdeSettings) {
  if (!patch.llmProvider) return;
  const provider = patch.llmProvider;
  if (patch.llmAuthMode !== undefined) {
    patch.llmAuthMode = connectionMode(provider, patch.llmAuthMode);
    return;
  }
  if (!providerOf(provider).needsSub || provider === "codex" || provider === "github") {
    patch.llmAuthMode = connectionMode(provider);
    return;
  }
  const modes = new Set((patch.llmProfiles ?? []).filter((p) => p.provider === provider && p.model === patch.llmModel && p.baseUrl === patch.llmBaseUrl && p.authMode).map((p) => p.authMode));
  if (modes.size === 1) patch.llmAuthMode = [...modes][0];
  else if (provider === useIde.getState().llmProvider) patch.llmAuthMode = useIde.getState().llmAuthMode;
  else throw new Error(`Die ältere Sicherung enthält keinen API-/Abo-Modus für ${providerOf(provider).label}. Wähle den Anbieter mit API oder Abo unter Agent und lade die Sicherung erneut. Es wurde nichts übernommen.`);
}

export function applySettingsPack(data: unknown): void {
  // Validate every section before touching any store, including memory and helper preferences.
  const pack = parseSettingsPack(data);
  const ide = { ...pack.ide };
  restoreConnectionMode(ide);
  const cur = useIde.getState();
  if (ide.llmProfiles) ide.llmProfiles = mergeProfiles(cur.llmProfiles, ide.llmProfiles);
  if (ide.llmToolLearning) ide.llmToolLearning = { ...cur.llmToolLearning, ...sanitizeToolLearning(ide.llmToolLearning, true) };
  if (ide.mcpServers) ide.mcpServers = mergeProfiles(cur.mcpServers, ide.mcpServers);
  const brain = pack.brain;
  if (brain) {
    const current = useBrain.getState();
    const jobs = { ...current.jobs };
    for (const key of Object.keys(jobs) as (keyof typeof jobs)[]) {
      if (brain.jobs?.[key] !== undefined) jobs[key] = brain.jobs[key];
    }
    useBrain.setState({ ...brain, jobs,
      helperProfiles: mergeProfiles(current.helperProfiles, brain.helperProfiles),
      helperSlots: { ...current.helperSlots, ...brain.helperSlots },
    });
  }
  if (pack.models) useModelLib.setState(pack.models);
  if (pack.learn) useLearn.getState().importDump({ ...pack.learn,
    prefs: pack.learn.prefs ? { ...useLearn.getState().prefs, ...pack.learn.prefs } : undefined,
  });
  if (pack.intern?.prefs) useIntern.getState().setPrefs(pack.intern.prefs);
  if (pack.intern?.appLog !== undefined) setAppLogOn(pack.intern.appLog);
  if (Object.keys(ide).length) useIde.getState().applySettings(ide);
  applyLang(useIde.getState().locale);
}

function resetHelperSettings() {
  const current = useBrain.getState();
  const defaults = structuredClone(pickSettings(useBrain.getInitialState(), BRAIN_SETTINGS_KEYS));
  useBrain.setState({ ...defaults, helperProfiles: current.helperProfiles, helperSlots: current.helperSlots });
}

export function resetSettingsCategory(category: SettingsCategory): void {
  if (category === "brain") resetHelperSettings();
  else if (category === "models") useModelLib.setState(structuredClone(pickSettings(useModelLib.getInitialState(), MODEL_SETTINGS_KEYS)));
  else if (category === "learn") useLearn.getState().resetPrefs();
  else if (category === "intern") {
    useIntern.getState().setPrefs({ ...useIntern.getInitialState().prefs });
    setAppLogOn(true);
  } else {
    const patch = structuredClone(pickSettings(useIde.getInitialState(), IDE_SETTINGS_GROUPS[category]));
    useIde.getState().applySettings(patch);
  }
  applyLang(useIde.getState().locale);
}

export function resetAllSettings(): void {
  useIde.getState().resetSettings();
  for (const category of ["brain", "models", "learn", "intern"] as const) resetSettingsCategory(category);
  applyLang(useIde.getState().locale);
}
