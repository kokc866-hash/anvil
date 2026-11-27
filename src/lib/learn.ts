import { invalidateMemory } from "./memory-scope";
import { diskWorkspaceHandle } from "./disk";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { idePersistStorage } from "./persist-storage";
import { langFromPath } from "./languages";
import { useIde } from "@/store/ide";
import { debugSkill } from "./skill-debug";
import { SEED } from "./skill-seeds";
import { builtinSkill, librarySeeds, mergeSkillLibrary, selectTaskSkills, SKILL_PRESELECT_LIMIT, type SkillEnvironment, type SkillSelection } from "./skill-library";
import { projectSkillFrameworks } from './skill-project';
import { publicSkill, readSkillResource } from "../../electron/skill-access.mjs";
import { knowledgeFileVersion, knowledgeSkillForgetKeys } from "../../electron/agent-knowledge-state.mjs";
import { recordSkillFeedback, skillInstructionVersion } from "../../electron/skill-feedback.mjs";
import { skillReferencePaths } from "../../electron/knowledge-skill-check.mjs";
import { detectEngines } from "./engines";
import { mcpSnapshot } from "./mcp";
import { isSecretPath } from "./ref";
import { IMPORTED_PLUGIN_PREFIX, importedSkillPaths } from "./agent-plugin-registry";
import {
  type LearnKind,
  type SkillKind,
  type LearnScope,
  idFromPins,
  factsFromUtterance,
  parseSkillMd,
  serializeSkillMd,
  projectish,
  slugSkillId,
  memoryWords,
  legacyProject,
} from "./learn-parse";

export type { LearnKind, SkillKind, LearnScope };
export { idFromPins, factsFromUtterance, parseSkillMd, projectish, slugSkillId };

export type LearnEvent = { t: number; k: string; d?: string };
export type LearnFact = {
  id: string;
  kind: LearnKind;
  text: string;
  conf: number;
  at: number;
  hits: number;
  scope: LearnScope;
  ws?: string;
};
export type LearnSkill = {
  id: string;
  name: string;
  when: string;
  body: string;
  builtin?: boolean;
  file?: string;
  frontmatter?: string;
  fileVersion?: string;
  owned?: boolean;
  feedback?: { id: string; jobId: string; version: string; kind: 'ok' | 'fail' | 'reject' | 'undo'; at: number; source: 'agent' }[];
  kind: SkillKind;
  uses: number;
  at: number;
  score: number;
  wins: number;
  fails: number;
  scope: LearnScope;
  ws?: string;
};
export type LearnNeg = { id: string; path: string; text: string; at: number; ws?: string };

export type LearnPrefs = {
  inject: boolean;
  person: boolean;
  project: boolean;
  profile: boolean;
  negatives: boolean;
  skills: boolean;
  skillAuto: boolean;
  skillBodies: boolean;
  distill: boolean;
  adaptIde: boolean;
  pluginSkills: boolean;
  factLimit: number;
  skillLimit: number;
};

export const LEARN_DEFAULTS: LearnPrefs = {
  inject: true,
  person: true,
  project: true,
  profile: true,
  negatives: true,
  skills: true,
  skillAuto: true,
  skillBodies: true,
  distill: true,
  adaptIde: true,
  pluginSkills: true,
  factLimit: 12,
  skillLimit: 2,
};

type LearnState = {
  on: boolean;
  prefs: LearnPrefs;
  events: LearnEvent[];
  facts: LearnFact[];
  skills: LearnSkill[];
  negs: LearnNeg[];
  forgotten: string[];
  forgottenFacts: string[];
  eventCount: number;
  backgroundKnowledgeEvents: string[];
  assignLegacy: (id: string) => void;
  activeSkills: string[];
  disabledSkills: string[];
  pinnedSkills: Record<string, string[]>;
  skillSelection: SkillSelection[];
  setSkillEnabled: (id: string, enabled: boolean) => void;
  pinSkill: (id: string, pinned: boolean) => void;
  libraryRequested: boolean;
  clearMemories: () => void;
  setOn: (v: boolean) => void;
  setPref: <K extends keyof LearnPrefs>(k: K, v: LearnPrefs[K]) => void;
  resetPrefs: () => void;
  track: (k: string, d?: string) => void;
  addFact: (kind: LearnKind, text: string, conf?: number) => LearnFact;
  forgetFact: (id: string) => void;
  writeSkill: (s: { name: string; when: string; body: string; kind?: SkillKind; scope?: LearnScope }) => LearnSkill;
  forgetSkill: (id: string) => void;
  bumpSkill: (id: string) => LearnSkill | undefined;
  patchSkill: (id: string, patch: Partial<LearnSkill>) => void;
  addNeg: (path: string, text: string) => void;
  forgetNeg: (id: string) => void;
  clear: () => void;
  clearLog: () => void;
  importDump: (d: Partial<Pick<LearnState, "facts" | "skills" | "negs" | "forgotten" | "forgottenFacts" | "on" | "prefs" | "disabledSkills" | "pinnedSkills">>) => void;
};

function nid() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function workspaceId(): string {
  try {
    const ide = useIde.getState();
    return idFromPins({ ...ide, ...(!ide.workspaceCwd && diskWorkspaceHandle() ? { githubRepo: "" } : {}) });
  } catch {
    return "local";
  }
}

function projectFact(f: LearnFact) { return f.scope === "project" || f.kind === "project" || /^Nicht so \(/.test(f.text); }
function factKey(f: Pick<LearnFact, "text" | "ws">) { return JSON.stringify([f.ws || "", norm(f.text)]); }
function skillKey(s: Pick<LearnSkill, "scope" | "ws" | "name">) { return JSON.stringify([s.scope === "project" ? s.ws || "legacy" : "", norm(s.name)]); }
function importedSkillEnabled(s: LearnSkill) {
  return !s.file?.startsWith(IMPORTED_PLUGIN_PREFIX) || importedSkillPaths(useIde.getState().files).has(s.file);
}
function skillHere(s: LearnSkill) {
  return !useLearn.getState().disabledSkills.includes(s.id) && (s.scope !== "project" || s.ws === workspaceId())
    && (s.scope !== 'project' || !s.file || Object.hasOwn(useIde.getState().files, s.file)) && importedSkillEnabled(s);
}
function findSkill(id: string): LearnSkill | undefined { return useLearn.getState().skills.find(s => skillHere(s) && s.id === id)
  ?? useLearn.getState().skills.find(s => skillHere(s) && s.scope === "project" && s.name === id)
  ?? useLearn.getState().skills.find(s => skillHere(s) && s.name === id); }
let lastSkillIds: string[] = [];
let lastSkillWorkspace = "";
let lastSkillJob = "";
const usedSkillVersions = new Map<string, string>();

export function markSkills(ids: string[]) {
  if (lastSkillWorkspace !== workspaceId()) usedSkillVersions.clear();
  const next = [...new Set(ids.filter(Boolean))].slice(0, 6);
  for (const id of next) {
    const skill = findSkill(id);
    if (skill && !usedSkillVersions.has(id)) usedSkillVersions.set(id, skillInstructionVersion(skill)!);
  }
  for (const id of usedSkillVersions.keys()) if (!next.includes(id)) usedSkillVersions.delete(id);
  if (!next.length) lastSkillJob = '';
  lastSkillIds = next;
  lastSkillWorkspace = workspaceId();
  try {
    useLearn.setState({ activeSkills: next });
  } catch {
    /* store not ready */
  }
}

function hydrateSkill(s: LearnSkill): LearnSkill {
  return {
    ...s,
    score: s.score ?? 0.55,
    wins: s.wins ?? 0,
    fails: s.fails ?? 0,
    scope: s.scope ?? (s.ws ? "project" : "user"),
  };
}

export const useLearn = create<LearnState>()(
  persist(
    (set, get) => ({
      on: true,
      prefs: { ...LEARN_DEFAULTS },
      events: [],
      facts: [],
      skills: librarySeeds(),
      negs: [],
      forgotten: [],
      forgottenFacts: [],
      eventCount: 0,
      backgroundKnowledgeEvents: [],
      activeSkills: [],
      disabledSkills: [],
      pinnedSkills: {},
      skillSelection: [],
      libraryRequested: false,
      setSkillEnabled: (id, enabled) => {
        invalidateMemory();
        set({ disabledSkills: enabled ? get().disabledSkills.filter(key => key !== id) : [...new Set([...get().disabledSkills, id])] });
      },
      pinSkill: (id, pinned) => {
        const ws = workspaceId(), current = (get().pinnedSkills[ws] || []).filter(key => get().skills.some(skill => skill.id === key && (skill.scope !== 'project' || skill.ws === ws)));
        set({ pinnedSkills: { ...get().pinnedSkills, [ws]: pinned ? [...new Set([...current, id])].slice(0, 3) : current.filter(key => key !== id) } });
      },
      clearMemories: () => {
        invalidateMemory();
        set({ facts: [], negs: [], events: [], eventCount: 0, forgottenFacts: [...new Set([...get().forgottenFacts, ...get().facts.map(factKey)])] });
      },
      setOn: (on) => { invalidateMemory(); set({ on }); },
      setPref: (k, v) => { invalidateMemory(); set({ prefs: { ...get().prefs, [k]: v } }); },
      resetPrefs: () => { invalidateMemory(); set({ on: true, prefs: { ...LEARN_DEFAULTS } }); },
      track: (k, d) => {
        if (!get().on) return;
        const events = [{ t: Date.now(), k, d: d?.slice(0, 180) }, ...get().events].slice(0, 200);
        const eventCount = (get().eventCount || 0) + 1;
        set({ events, eventCount });
        if (k === "reject" && d && prefs().negatives) extractNegative(d);
        if (eventCount % 6 === 0) {
          if (prefs().distill) distill();
          if (prefs().adaptIde) adaptIde();
        }
        if (eventCount % 12 === 0 && typeof window !== "undefined") {
          window.dispatchEvent(new Event("anvil-brain-usage"));
        }
      },
      addFact: (kind, text, conf = 0.7) => {
        const t = text.trim().slice(0, 220);
        if (!t) return { id: "", kind, text: "", conf: 0, at: 0, hits: 0, scope: "user" };
        const scope: LearnScope = kind === "project" || projectish(t) ? "project" : kind === "lesson" ? "user" : "user";
        const ws = scope === "project" ? workspaceId() : undefined;
        if (get().forgottenFacts.includes(factKey({ text: t, ws })))
          return { id: "", kind, text: t, conf: 0, at: 0, hits: 0, scope, ws };
        const hit = get().facts.find(
          (f) => f.kind === kind && norm(f.text) === norm(t) && (f.ws ?? "") === (ws ?? ""),
        );
        if (hit) {
          const next = { ...hit, hits: hit.hits + 1, conf: Math.min(1, hit.conf + 0.08), at: Date.now() };
          set({ facts: get().facts.map((f) => (f.id === hit.id ? next : f)) });
          return next;
        }
        const fact: LearnFact = { id: nid(), kind, text: t, conf, at: Date.now(), hits: 1, scope, ws };
        set({ facts: [fact, ...get().facts] });
        return fact;
      },
      forgetFact: (id) => {
        invalidateMemory();
        const fact = get().facts.find(f => f.id === id);
        set({ facts: get().facts.filter(f => f.id !== id), forgottenFacts: [...new Set([...get().forgottenFacts, ...(fact ? [factKey(fact)] : [])])] });
      },
      assignLegacy: (id) => {
        invalidateMemory();
        const ws = workspaceId();
        set({
          facts: get().facts.map(f => f.id === id && projectFact(f) && legacyProject(f.ws) ? { ...f, scope: "project" as const, ws } : f),
          skills: get().skills.map(s => s.id === id && s.scope === "project" && legacyProject(s.ws) ? { ...s, ws } : s),
          negs: get().negs.map(n => n.id === id && legacyProject(n.ws) ? { ...n, ws } : n),
        });
      },
      writeSkill: (s) => {
        const name = s.name.trim() || "skill";
        if (builtinSkill(name)) throw new Error("Anvil-Skills werden mit dem Programm aktualisiert. Für eigene Änderungen einen neuen Skill-Namen verwenden.");
        const scope = s.scope ?? "project";
        const ws = scope === "project" ? workspaceId() : undefined;
        const cur = get().skills.find(x => x.name === name && x.scope === scope && x.ws === ws);
        const base = slugSkillId(name) || "skill";
        const id = get().skills.some(x => x.id === base && x !== cur) ? `${base}-${nid()}` : base;
        const skill: LearnSkill = {
          id: cur?.id ?? id,
          name,
          when: s.when.trim() || name,
          body: s.body.trim(),
          frontmatter: cur?.frontmatter,
          feedback: cur?.feedback,
          kind: s.kind === "plugin" ? "plugin" : "guide",
          file: scope === 'project' ? cur?.file || `.anvil/skills/${cur?.id ?? id}.md` : undefined,
          owned: true,
          uses: cur?.uses ?? 0,
          at: Date.now(),
          score: cur?.score ?? 0.6,
          wins: cur?.wins ?? 0,
          fails: cur?.fails ?? 0,
          scope,
          ws: scope === "project" ? workspaceId() : undefined,
        };
        const forgotten = (get().forgotten ?? []).filter((x) => !knowledgeSkillForgetKeys(skill).includes(x));
        set({ skills: [skill, ...get().skills.filter((x) => x.id !== skill.id)], forgotten });
        if (skill.scope === 'project') {
          if (skill.kind === "plugin" && prefs().pluginSkills) writePluginSkill(skill);
          persistSkillFile(skill);
        }
        return skill;
      },
      forgetSkill: (id) => {
        invalidateMemory();
        const s = get().skills.find(x => x.id === id) ?? findSkill(id);
        if (!s) return;
        if (builtinSkill(s.id)) { get().setSkillEnabled(s.id, false); return; }
        const forgotten = [...new Set([...get().forgotten, skillKey(s), ...(s.scope === "user" ? [s.id] : [])])];
        set({ skills: get().skills.filter(x => x.id !== s.id), forgotten, activeSkills: get().activeSkills.filter(x => x !== s.id), pinnedSkills: Object.fromEntries(Object.entries(get().pinnedSkills).map(([ws, ids]) => [ws, ids.filter(key => key !== s.id)])) });
        lastSkillIds = lastSkillIds.filter(x => x !== s.id);
        if (s.scope === 'project' && s.ws === workspaceId()) dropSkillFiles(s);
      },
      bumpSkill: (id) => {
        const s = findSkill(id);
        if (!s) return;
        const next = { ...hydrateSkill(s), uses: (s.uses ?? 0) + 1, at: Date.now() };
        if (lastSkillWorkspace !== workspaceId()) lastSkillIds = [];
        lastSkillWorkspace = workspaceId();
        lastSkillIds = [...new Set([next.id, ...lastSkillIds])].slice(0, 6);
        set({ skills: get().skills.map((x) => (x.id === s.id ? next : x)), activeSkills: lastSkillIds });
        return next;
      },
      patchSkill: (id, patch) => {
        set({
          skills: get().skills.map((s) => (s.id === findSkill(id)?.id ? { ...hydrateSkill(s), ...patch, id: s.id, name: s.name, scope: s.scope, ws: s.ws } : s)),
        });
      },
      addNeg: (path, text) => {
        const t = text.trim().slice(0, 140);
        if (!t) return;
        const neg: LearnNeg = { id: nid(), path, text: t, at: Date.now(), ws: workspaceId() };
        set({ negs: [neg, ...get().negs.filter(n => n.text !== t || n.path !== path || n.ws !== neg.ws)] });
      },
      forgetNeg: (id) => {
        invalidateMemory();
        const neg = get().negs.find(n => n.id === id);
        if (neg) for (const f of get().facts) {
          if (f.text === `Nicht so (${neg.path}): ${neg.text}` && (!f.ws || f.ws === neg.ws)) get().forgetFact(f.id);
        }
        set({ negs: get().negs.filter(n => n.id !== id) });
      },
      clear: () => {
        invalidateMemory();
        const forgotten = [...new Set([...get().forgotten, ...SEED.map(s => s.id), ...get().skills.map(skillKey)])];
        const forgottenFacts = [...new Set([...get().forgottenFacts, ...get().facts.map(factKey)])];
        for (const s of get().skills.filter(s => !builtinSkill(s.id) && skillHere(s))) dropSkillFiles(s);
        lastSkillIds = [];
        set({ events: [], eventCount: 0, facts: [], skills: librarySeeds(), negs: [], forgotten, forgottenFacts, activeSkills: [], skillSelection: [] });
      },
      clearLog: () => { invalidateMemory(); set({ events: [], eventCount: 0 }); },
      importDump: (d) => {
        invalidateMemory();
        lastSkillIds = [];
        set({
          activeSkills: [],
          forgottenFacts: d.forgottenFacts ?? (d.facts ? [] : get().forgottenFacts),
          facts: Array.isArray(d.facts) ? d.facts : get().facts,
          skills: Array.isArray(d.skills) ? mergeSkillLibrary(d.skills) : get().skills,
          negs: Array.isArray(d.negs) ? d.negs : get().negs,
          forgotten: Array.isArray(d.forgotten) ? d.forgotten : get().forgotten,
          on: typeof d.on === "boolean" ? d.on : get().on,
          prefs: d.prefs ? { ...LEARN_DEFAULTS, ...get().prefs, ...d.prefs } : get().prefs,
          disabledSkills: d.disabledSkills ?? get().disabledSkills,
          pinnedSkills: d.pinnedSkills ?? get().pinnedSkills,
        });
      },
    }),
    {
      name: "anvil-learn",
      storage: idePersistStorage(),
      partialize: (s) => ({
        on: s.on,
        prefs: s.prefs,
        events: s.events.slice(0, 80),
        facts: s.facts,
        skills: s.skills,
        disabledSkills: s.disabledSkills,
        pinnedSkills: s.pinnedSkills,
        negs: s.negs,
        forgotten: s.forgotten ?? [],
        forgottenFacts: s.forgottenFacts,
        eventCount: s.eventCount,
        backgroundKnowledgeEvents: s.backgroundKnowledgeEvents,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LearnState>;
        const forgotten = [...new Set([...(p.forgotten ?? current.forgotten ?? [])])];
        const skills = [...(p.skills ?? current.skills)];
        return { ...current, ...p, forgotten, skills: mergeSkillLibrary(skills), disabledSkills: p.disabledSkills ?? [], pinnedSkills: p.pinnedSkills ?? {}, skillSelection: [], activeSkills: [], forgottenFacts: p.forgottenFacts ?? [], prefs: { ...LEARN_DEFAULTS, ...p.prefs } };
      },
    },
  ),
);

function prefs(): LearnPrefs {
  return { ...LEARN_DEFAULTS, ...(useLearn.getState().prefs ?? {}) };
}

export function profile() {
  const ev = useLearn.getState().events;
  const langs: Record<string, number> = {};
  let run = 0;
  let debug = 0;
  let ask = 0;
  let accept = 0;
  let reject = 0;
  let undo = 0;
  let fail = 0;
  for (const e of ev) {
    if (e.k === "run") run += 1;
    if (e.k === "debug") debug += 1;
    if (e.k === "ask") ask += 1;
    if (e.k === "accept") accept += 1;
    if (e.k === "reject") reject += 1;
    if (e.k === "undo") undo += 1;
    if (e.k === "fail") fail += 1;
    if ((e.k === "open" || e.k === "run") && e.d) {
      const lang = langFromPath(e.d);
      langs[lang] = (langs[lang] ?? 0) + 1;
    }
  }
  const topLang = Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return { langs, run, debug, ask, accept, reject, undo, fail, topLang };
}

export function preferredExt(): string {
  const lang = profile().topLang;
  const map: Record<string, string> = {
    python: ".py",
    javascript: ".js",
    typescript: ".ts",
    go: ".go",
    rust: ".rs",
    java: ".java",
    c: ".c",
    cpp: ".cpp",
    html: ".html",
    csharp: ".cs",
    php: ".php",
    ruby: ".rb",
  };
  return map[lang] ?? "";
}

function distill() {
  const st = useLearn.getState();
  if (!st.on || !prefs().distill) return;
  const p = profile();
  if (p.topLang && p.topLang !== "plaintext") {
    st.addFact("user", `Arbeitet vor allem mit ${p.topLang}.`, 0.62);
  }
  if (p.reject >= 3 && p.reject > p.accept) {
    st.addFact("user", "Prüft Diffs selbst — nichts still übernehmen.", 0.8);
  }
  if (p.undo >= 3) st.addFact("user", "Macht Agent-Änderungen oft rückgängig — kleinere Schritte.", 0.75);
  if (p.debug >= 3 && p.debug >= p.run / 2) {
    st.addFact("user", "Nutzt den Debugger oft, nicht nur Run.", 0.65);
  }
  if (p.fail >= 3) st.addFact("lesson", "Nach Änderungen immer ausführen und Fehler lesen.", 0.7);
  if (p.ask >= 3) {
    const asks = st.events.filter((e) => e.k === "ask").map((e) => e.d ?? "").join(" ");
    reflectUtterance(asks, "batch");
  }
}

function extractNegative(d: string) {
  const [path, ...rest] = d.split("::");
  const line = rest.join("::").trim();
  if (!line) return;
  useLearn.getState().addNeg(path || "?", line);
}

export function skillOutcome(kind: "ok" | "fail" | "reject" | "undo", context: { jobId?: string; eventId?: string } = {}) {
  const st = useLearn.getState();
  const ids = lastSkillWorkspace === workspaceId() ? (st.activeSkills?.length ? st.activeSkills : lastSkillIds).filter(Boolean) : [];
  if (!['ok', 'fail', 'reject', 'undo'].includes(kind)) return { error: 'Unbekannte Skill-Rückmeldung.' };
  if (!ids.length || !prefs().skills) return { error: 'Für diesen Auftrag wurde keine Skill-Verwendung erfasst.' };
  if (context.jobId && lastSkillJob && context.jobId !== lastSkillJob) return { error: 'Die Rückmeldung gehört zu einem anderen Auftrag.' };
  const jobId = context.jobId || lastSkillJob || `manual:${workspaceId()}`;
  const changes: LearnSkill[] = [];
  for (const id of ids) {
    const raw = findSkill(id);
    if (!raw) continue;
    try {
      changes.push(recordSkillFeedback(raw, kind, { id: `${context.eventId || nid()}:${id}`, jobId,
        version: usedSkillVersions.get(id) || '' }));
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }
  if (changes.length) useLearn.setState({ skills: st.skills.map(skill => changes.find(next => next.id === skill.id) || skill) });
  if (kind === "ok") {
    markSkills([]);
  }
  return { ok: true, reported: true, verified: false };
}

export function reflectUtterance(text: string, mode: "ask" | "abort" | "batch" = "ask") {
  const st = useLearn.getState();
  if (!st.on || !prefs().distill) return;
  if (mode === "abort") {
    return;
  }
  for (const f of factsFromUtterance(text)) st.addFact(f.kind, f.text, f.conf);
}

export function adaptIde() {
  const st = useLearn.getState();
  if (!st.on || !prefs().adaptIde) return;
  const p = profile();
  const ide = useIde.getState();
  if (p.reject >= 3 && p.reject > p.accept && ide.autoAcceptDiffs) {
    ide.setNotice("Tipp: oft Diffs verworfen — Auto-Übernehmen ist noch an.");
  }
  if (p.debug >= 4 && p.debug >= p.run && ide.liveRun) {
    ide.setNotice("Tipp: viel Debugger — Live-Run ist noch an.");
  }
  if (p.fail >= 3 && ide.autoRunAgent) {
    ide.setNotice("Tipp: oft fehlgeschlagen — Auto-Start Agent ist noch an.");
  }
}

export function persistSkillFile(skill: LearnSkill) {
  if (skill.scope !== 'project' || skill.ws !== workspaceId()) return;
  const path = skill.file && /^\.anvil\/skills\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.md$/i.test(skill.file) ? skill.file : `.anvil/skills/${skill.id}.md`;
  const src = serializeSkillMd(skill);
  try {
    useIde.getState().writeFile(path, src, { quiet: true });
  } catch {
    /* workspace not ready */
  }
}

function dropSkillFiles(skill?: LearnSkill, id?: string) {
  if (skill?.scope === 'user') return;
  if (skill && !skillHere(skill)) return;
  const names = [skill?.id, id].filter((name): name is string => Boolean(name) && /^[a-z0-9-]+$/i.test(name!));
  if (!names.length) return;
  try {
    const ide = useIde.getState();
    const paths = new Set(names.flatMap(n => [`.anvil/skills/${n}.md`, `plugins/skills/${n}.js`]));
    if (skill?.file && /^\.anvil\/skills\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.md$/i.test(skill.file)) paths.add(skill.file);
    for (const path of paths) ide.deleteFile(path);
  } catch {
    /* */
  }
}

let lastSkillScan: { files: Record<string, string>; ws: string; skills: LearnSkill[]; forgotten: string[]; complete: boolean } | undefined;
export function hydrateLearnFromFiles(files: Record<string, string>, explicitlyImported: string[] = [], options: { complete?: boolean } = {}): void {
  const ws = workspaceId(), st = useLearn.getState();
  const complete = options.complete !== false;
  if (!explicitlyImported.length && lastSkillScan?.files === files && lastSkillScan.ws === ws && lastSkillScan.skills === st.skills && lastSkillScan.forgotten === st.forgotten && lastSkillScan.complete === complete) return;
  const normalized = Object.fromEntries(Object.entries(files).map(([file, src]) => [file.replaceAll('\\', '/'), src]));
  const imported = importedSkillPaths(normalized), explicit = new Set(explicitlyImported.map(file => file.replaceAll('\\', '/')));
  const isManifest = (file: string) => /^\.anvil\/skills\/(?:[^/]+\.md|(?:[^/]+\/)+SKILL\.md)$/i.test(file);
  const removed = new Set<string>();
  const current = new Map<string, LearnSkill>();
  for (const skill of st.skills) {
    if (skill.scope !== 'project' || skill.ws !== ws || !skill.file || !isManifest(skill.file)) continue;
    const present = Object.hasOwn(normalized, skill.file);
    if ((!present && options.complete !== false) || (skill.file.startsWith(IMPORTED_PLUGIN_PREFIX) && !imported.has(skill.file) && options.complete !== false)) removed.add(skill.id);
    else current.set(skill.file, skill);
  }
  let skills = st.skills.filter(skill => !removed.has(skill.id)), forgotten = st.forgotten;
  let changed = removed.size > 0;
  for (const [file, src] of Object.entries(normalized)) {
    if (!isManifest(file)) continue;
    const packageSkill = file.startsWith(IMPORTED_PLUGIN_PREFIX);
    if (packageSkill && !imported.has(file)) continue;
    const previous = current.get(file), fileVersion = knowledgeFileVersion(src)!;
    if (previous?.fileVersion === fileVersion && !explicit.has(file)) continue;
    const parsed = parseSkillMd(src, file);
    if (!parsed) {
      if (previous) { removed.add(previous.id); skills = skills.filter(skill => skill.id !== previous.id); changed = true; }
      continue;
    }
    const cur = previous || skills.find(skill => skill.scope === 'project' && skill.ws === ws && !skill.file && skill.name === parsed.name);
    // Project text describes instructions, never authority to become global or executable.
    const draft = { ...parsed, scope: 'project' as const, kind: cur?.owned && !packageSkill ? cur.kind : 'guide' as const, ws };
    if (explicit.has(file)) {
      const next = forgotten.filter(key => key !== skillKey(draft));
      if (next.length !== forgotten.length) { forgotten = next; changed = true; }
    }
    if (forgotten.includes(skillKey(draft))) continue;
    const identity = `${ws}:${file}`;
    let hash = 2166136261;
    for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
    let id = cur?.id || parsed.id;
    if (!cur && skills.some(skill => skill.id === id)) {
      const base = `${parsed.id}-${(hash >>> 0).toString(36)}`;
      id = base; let count = 2;
      while (skills.some(skill => skill.id === id)) id = `${base}-${count++}`;
    }
    const skill: LearnSkill = { ...cur, ...draft, id, file, fileVersion, uses: cur?.uses ?? 0,
      at: Date.now(), score: cur?.score ?? 0.6, wins: cur?.wins ?? 0, fails: cur?.fails ?? 0 };
    skills = [skill, ...skills.filter(value => value.id !== id)]; changed = true;
  }
  if (!changed) { lastSkillScan = { files, ws, skills: st.skills, forgotten: st.forgotten, complete }; return; }
  const ids = new Set(skills.map(skill => skill.id));
  useLearn.setState({ skills, forgotten, activeSkills: st.activeSkills.filter(id => ids.has(id)),
    skillSelection: st.skillSelection.filter(row => ids.has(row.id)),
    pinnedSkills: Object.fromEntries(Object.entries(st.pinnedSkills).map(([key, pins]) => [key, pins.filter(id => ids.has(id))])) });
  lastSkillIds = lastSkillIds.filter(id => ids.has(id));
  const after = useLearn.getState();
  lastSkillScan = { files, ws, skills: after.skills, forgotten: after.forgotten, complete };
  invalidateMemory();
}

function writePluginSkill(skill: LearnSkill) {
  const path = `plugins/skills/${skill.id}.js`;
  const src = `// @desc ${skill.when.replace(/\n/g, " ")}
function activate(anvil) {
  anvil.command({
    id: ${JSON.stringify(`skill.${skill.id}`)},
    title: ${JSON.stringify(skill.name)},
    run() {
      anvil.agent(${JSON.stringify(`Nutze Skill ${skill.name}. Lade zuerst seine aktuelle Anleitung mit skill_read(name=${JSON.stringify(skill.id)}) und führe sie im Rahmen dieses Auftrags aus.`)});
    },
  });
}
`;
  try {
    useIde.getState().writeFile(path, src, { quiet: true });
  } catch {
    /* workspace not ready */
  }
}

function scoreSkill(s: LearnSkill, q: string) {
  const bag = memoryWords(`${s.name} ${s.when}`);
  const overlap = memoryWords(q).filter(w => bag.includes(w)).length;
  if (!overlap) return 0;
  return overlap * 10 + Math.min(1, (s.uses ?? 0) * 0.01);
}

const skillResourceIndexes = new WeakMap<Record<string, string>, Map<string, string[]>>();
function skillFilesContext(skill: LearnSkill) {
  const builtin = builtinSkill(skill.id);
  if (builtin) return { baseDirectory: `anvil://skills/${builtin.id}`, resources: Object.keys(builtin.resources), resourceContents: builtin.resources };
  if (skill.scope === 'user') return { baseDirectory: undefined, resources: [] };
  const baseDirectory = skill.file?.replace(/\/[^/]+$/, "");
  const files = useIde.getState().files;
  let index = skillResourceIndexes.get(files);
  if (!index) {
    index = new Map();
    for (const file of Object.keys(files)) {
      if (isSecretPath(file)) continue;
      for (let at = file.indexOf('/'); at >= 0; at = file.indexOf('/', at + 1)) {
        const root = file.slice(0, at), list = index.get(root) || [];
        list.push(file); index.set(root, list);
      }
    }
    skillResourceIndexes.set(files, index);
  }
  // A legacy flat file does not own its sibling skills or their private references.
  const resources = !baseDirectory ? [] : /\/SKILL\.md$/i.test(skill.file || '')
    ? (index.get(baseDirectory) || []).filter(file => file !== skill.file)
    : skillReferencePaths(skill.body).map((relative: string) => `${baseDirectory}/${relative}`).filter((file: string) => Object.hasOwn(files, file) && !isSecretPath(file));
  return { baseDirectory, resources };
}

export function skillEnvironment(): SkillEnvironment {
  const ide = useIde.getState(), catalog = mcpSnapshot(ide.mcpServers);
  const execution = ide.agentMode !== "ask" && (ide.activeSurfaceId === "anvil" || !ide.activeSurfaceId || ide.surfaceMode === "bridge");
  return {
    project: Object.keys(ide.files).some(path => !path.startsWith(".anvil/") && !path.startsWith("plugins/")), saved: Boolean(ide.workspaceCwd.trim() || diskWorkspaceHandle()),
    engines: detectEngines(ide.files, ide.dirs).map(hit => hit.id), frameworks: projectSkillFrameworks(ide.files), execution,
    services: ide.mcpServers.map(server => ({ name: `${server.id} ${server.name} ${server.service || ""}`, enabled: server.enabled, catalog: catalog.ready.has(server.id), tools: catalog.tools.some(tool => tool.serverId === server.id) })),
  };
}

export function foregroundKnowledgePermissions() {
  const state = useLearn.getState(), p = prefs(), memoryEnabled = state.on && p.inject;
  return { enabled: memoryEnabled || p.skills, memoryEnabled, skillsEnabled: p.skills, skillBodies: p.skillBodies,
    personEnabled: memoryEnabled && p.person, projectEnabled: memoryEnabled && p.project,
    pluginSkills: p.pluginSkills, disabledSkills: state.disabledSkills };
}

export function openSkillLibrary() {
  useLearn.setState({ libraryRequested: true });
  useIde.getState().setSidebar("ext");
}

export function visibleSkills(): LearnSkill[] {
  const ws = workspaceId();
  return useLearn
    .getState()
    .skills.map(hydrateSkill)
    .filter(skillHere)
    .filter((s) => s.scope !== "project" || s.ws === ws);
}

function visibleFacts(): LearnFact[] {
  const ws = workspaceId();
  return useLearn.getState().facts.filter((f) => {
    if (projectFact(f)) return f.ws === ws;
    return true;
  });
}

export function matchSkills(query: string, limit = 3): LearnSkill[] {
  const q = query.trim();
  const all = visibleSkills();
  if (!q) return [];
  return all
    .map((s) => ({ s, n: scoreSkill(s, q) }))
    .filter((x) => x.n > 0.3)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((x) => x.s);
}

export function learnPrompt(lastAsk = ""): string {
  const st = useLearn.getState();
  const p = prefs();
  const memoryOn = st.on && p.inject;
  const prof = profile();
  const facts = [...visibleFacts()].sort((a, b) => b.at - a.at || b.conf - a.conf);
  const cap = Math.min(20, Math.max(0, p.factLimit | 0));
  const person = p.person ? facts.filter((f) => !projectFact(f)).slice(0, cap) : [];
  const proj = p.project ? facts.filter((f) => projectFact(f)).slice(0, cap) : [];
  const negs = p.negatives && p.project ? st.negs.filter(n => n.ws === workspaceId()).slice(0, 6) : [];
  const selection = p.skills ? selectTaskSkills(lastAsk, visibleSkills(), skillEnvironment(), { automatic: p.skillAuto, pinned: st.pinnedSkills[workspaceId()] || [], limit: SKILL_PRESELECT_LIMIT }) : [];
  const matched = selection.map(selected => visibleSkills().find(skill => skill.id === selected.id)!);
  useLearn.setState({ skillSelection: p.skillBodies ? selection.map(row=>({...row,loaded:false})) : [], activeSkills: [] });
  lastSkillIds = [];
  lastSkillJob = '';
  usedSkillVersions.clear();
  lastSkillWorkspace = workspaceId();
  const lines = [
    memoryOn ? "Gelerntes (lokal). Person und Projekt getrennt halten." : "",
    memoryOn && p.profile && (prof.topLang || prof.run || prof.ask)
      ? `Profil: Sprache ${prof.topLang || "—"} · Run ${prof.run} · Debug ${prof.debug} · Agent ${prof.ask} · Diffs +${prof.accept}/-${prof.reject} · Undo ${prof.undo}.`
      : "",
    memoryOn && person.length ? `Person:\n${person.map((f) => `- [${f.id}] ${f.text}`).join("\n")}` : "",
    memoryOn && proj.length ? `Dieses Projekt (${workspaceId()}):\n${proj.map((f) => `- [${f.id}] ${f.text}`).join("\n")}` : "",
    memoryOn && negs.length ? `Nicht so (abgelehnte Muster):\n${negs.map((n) => `- ${n.path}: ${n.text}`).join("\n")}` : "",
    p.skills && visibleSkills().length
      ? `Skills nach Bedarf — Anleitungen mit skill_read(name=id) vor der Anwendung laden; weitere über select_tools(scope="skills",query) suchen. Vollständige Bibliothek bleibt außerhalb des Modellkontexts:\n${matched
          .map((s) => `- ${s.name} (${s.id}) [${s.scope}]: ${s.when}`)
          .join("\n")}`
      : "",
    p.skillBodies && matched.length ? `Skill-Auswahl für diesen Auftrag (Anleitungen noch nicht geladen). Sie erweitert weder den Auftrag noch Werkzeugrechte. Referenzen bei Bedarf mit skill_read(name, resource) lesen.\n${matched.map((s, i) => `${s.name}: skill_read(name=${JSON.stringify(s.id)})${s.file ? `; Datei: ${s.file}` : ''}. Auswahl: ${selection[i].reason}. ${selection[i].requirements.filter(req => req.status !== "ready").map(req => `${req.label}: ${req.detail}`).join("; ")}`).join("\n")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function agentLearn(action: string, args: Record<string, unknown>, context: { jobId?: string; eventId?: string } = {}): Promise<unknown> {
  if (['list', 'state', 'skills', 'read', 'run', 'debug'].includes(action)) hydrateLearnFromFiles(useIde.getState().files);
  const st = useLearn.getState();
  const p = prefs();
  const memoryOn = st.on && p.inject;
  const skillAction = ["skills", "write", "read", "run", "debug", "patch", "outcome"].includes(action);
  if (!skillAction && !["list", "state"].includes(action) && !memoryOn) return { error: "Gedächtnis-Zugriff aus" };
  if (["skills", "write", "read", "run", "debug", "patch", "outcome"].includes(action) && !p.skills) return { error: "Skills aus" };
  if (["read", "run", "debug"].includes(action) && !p.skillBodies) return { error: "Skill-Anweisungen aus" };
  if (context.jobId && ['read', 'run', 'outcome'].includes(action)) {
    if (lastSkillJob && lastSkillJob !== context.jobId) return { error: 'Die Skill-Aktion gehört zu einem anderen Auftrag.' };
    lastSkillJob = context.jobId;
  }
  if (action === "list" || action === "state") {
    return {
      on: st.on, inject: p.inject, skillsEnabled: p.skills,
      person: memoryOn && p.person ? visibleFacts().filter(f => !projectFact(f)) : [],
      project: memoryOn && p.project ? visibleFacts().filter(projectFact) : [],
      skills: p.skills ? visibleSkills().map((s) => ({ name: s.name, when: s.when, uses: s.uses, scope: s.scope })) : [],
      negatives: memoryOn && p.negatives && p.project ? st.negs.filter(n => n.ws === workspaceId()).slice(0, 8) : [],
      profile: memoryOn && p.profile ? profile() : undefined,
      workspace: workspaceId(),
    };
  }
  if (action === "add") {
    const kind = (["user", "project", "lesson"].includes(String(args.kind)) ? args.kind : "lesson") as LearnKind;
    const text = String(args.text ?? "");
    if (kind === "project" || projectish(text) ? !p.project : !p.person) return { error: "Fakten-Kategorie aus" };
    const fact = st.addFact(kind, text, 0.85);
    return { ok: true, fact };
  }
  if (action === "forget") {
    const key = String(args.id ?? args.text ?? "").trim();
    const facts = visibleFacts();
    const hit = facts.find(f => (projectFact(f) ? p.project : p.person) && (f.id === key || norm(f.text) === norm(key)));
    if (!hit) return { error: "Fakt fehlt" };
    st.forgetFact(hit.id);
    return { ok: true, id: hit?.id || key };
  }
  if (action === "skills") {
    return visibleSkills().map((s) => ({ id:s.id,name: s.name, when: s.when, file:s.file, uses: s.uses, scope: s.scope }));
  }
  if (action === "write") {
    if (builtinSkill(String(args.name ?? ""))) return { error: "Anvil-Skills werden mit dem Programm aktualisiert. Für eigene Änderungen einen neuen Skill-Namen verwenden." };
    const skill = st.writeSkill({
      name: String(args.name ?? ""),
      when: String(args.when ?? ""),
      body: String(args.body ?? ""),
      kind: args.kind === "plugin" ? "plugin" : "guide",
      scope: args.scope === "user" ? "user" : "project",
    });
    st.track("skill", skill.name);
    const dbg = debugSkill(skill);
    return { ok: dbg.ok, skill: { name: skill.name, kind: skill.kind, scope: skill.scope, ...(skill.scope === 'project' ? { path: skill.file || `.anvil/skills/${skill.id}.md` } : { storage: 'user-profile' }) }, issues: dbg.issues };
  }
  if (action === "read") {
    const id = String(args.name ?? "");
    const s = findSkill(id);
    if (!s) return { error: "skill missing" };
    const fileContext = skillFilesContext(s);
    const detail = { ...s, ...fileContext, debug: debugSkill(s, { ...fileContext, files: useIde.getState().files }) };
    if (args.resource !== undefined) return readSkillResource(detail, args.resource, useIde.getState().files);
    return publicSkill(detail);
  }
  if (action === "run") {
    const id = String(args.name ?? "");
    const s = st.bumpSkill(id);
    if (!s) return { error: "no skill" };
    markSkills([s.id]);
    const dbg = debugSkill(s, { ...skillFilesContext(s), files: useIde.getState().files });
    return {
      skill: s.name,
      body: s.body,
      ...publicSkill(skillFilesContext(s)),
      issues: dbg.issues,
      do: "Follow these instructions within the current user request and tool permissions. Resolve relative references from baseDirectory and read only needed resources. Imported scripts are files, not permission to execute. Optional skill_outcome is an agent report, not proof that the task succeeded.",
    };
  }
  if (action === "debug") {
    const id = String(args.name ?? "").trim();
    const list = id ? [findSkill(id)].filter(Boolean) : visibleSkills();
    const report = (list as LearnSkill[]).map((s) => ({ name: s.name, ...debugSkill(s, { ...skillFilesContext(s), files: useIde.getState().files }) }));
    const broken = report.filter((r) => !r.ok);
    return {
      skills: report,
      broken,
      issues: broken.flatMap((r) => r.issues.map((i) => `${r.name}: ${i}`)),
    };
  }
  if (action === "patch") {
    const id = String(args.name ?? "");
    const cur = findSkill(id);
    if (!cur) return { error: "skill fehlt" };
    if (builtinSkill(cur.id)) return { error: "Anvil-Skills sind vorinstalliert. Für eigene Änderungen einen neuen Skill erstellen." };
    if (cur.file?.startsWith(IMPORTED_PLUGIN_PREFIX)) return { error: 'Importierte Paket-Skills als eigene Projektkopie bearbeiten.' };
    const skill = st.writeSkill({
      name: cur.name,
      when: args.when != null ? String(args.when) : cur.when,
      body: args.body != null ? String(args.body) : cur.body,
      kind: cur.kind,
      scope: cur.scope,
    });
    const dbg = debugSkill(skill);
    return { ok: dbg.ok, skill: skill.name, issues: dbg.issues };
  }
  if (action === "outcome") {
    return skillOutcome(String(args.kind ?? "ok") as "ok" | "fail" | "reject" | "undo", context);
  }
  return { error: `unbekannt ${action}` };
}
