import { create } from "zustand";
import { persist } from "zustand/middleware";
import { idePersistStorage } from "./persist-storage";
import { langFromPath } from "./languages";
import { useIde } from "@/store/ide";
import { debugSkill, SKILL_CREATOR_BODY } from "./skill-debug";

export type LearnKind = "user" | "project" | "lesson";
export type SkillKind = "guide" | "plugin";
export type LearnScope = "user" | "project";

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
  kind: SkillKind;
  uses: number;
  at: number;
  score: number;
  wins: number;
  fails: number;
  scope: LearnScope;
  ws?: string;
};
export type LearnNeg = { id: string; path: string; text: string; at: number };

export type LearnPrefs = {
  inject: boolean;
  person: boolean;
  project: boolean;
  profile: boolean;
  negatives: boolean;
  skills: boolean;
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
  skillBodies: true,
  distill: true,
  adaptIde: true,
  pluginSkills: true,
  factLimit: 8,
  skillLimit: 5,
};

const SEED: LearnSkill[] = [
  {
    id: "skill-creator",
    name: "skill-creator",
    when: "Skill schreiben Skill fixen Skill debuggen skill-creator neuer Ablauf",
    body: SKILL_CREATOR_BODY,
    kind: "guide",
    uses: 0,
    at: 0,
    score: 0.88,
    wins: 0,
    fails: 0,
    scope: "user",
  },
  {
    id: "engine",
    name: "engine-projekt",
    when: "Godot Unity Unreal Bevy Engine Companion MCP",
    body: "1. engine_detect im Workspace.\n2. Scripts mit edit_file/read_file ändern.\n3. engine_run play oder mcp_call. Keine eigene Engine in Anvil — HTML-Vorschau nur Demo.",
    kind: "guide",
    uses: 0,
    at: 0,
    score: 0.72,
    wins: 0,
    fails: 0,
    scope: "user",
  },
  {
    id: "tests",
    name: "tests-schreiben",
    when: "Tests pytest npm test absichern unittest",
    body: "1. tests/ anlegen (write_file).\n2. Python: pytest-Datei. JS: node:test / assert.\n3. shell pytest oder npm test, sonst run_file. Output lesen, bei Fehler edit_file.",
    kind: "guide",
    uses: 0,
    at: 0,
    score: 0.7,
    wins: 0,
    fails: 0,
    scope: "user",
  },
];

type LearnState = {
  on: boolean;
  prefs: LearnPrefs;
  events: LearnEvent[];
  facts: LearnFact[];
  skills: LearnSkill[];
  negs: LearnNeg[];
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
};

function nid() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function workspaceId(): string {
  try {
    const s = useIde.getState();
    return (s.githubRepo || s.diskName || "local").trim().slice(0, 80) || "local";
  } catch {
    return "local";
  }
}

function projectish(text: string) {
  return /\b(test|pytest|src\/|package\.json|anvil\.run|cargo|go\.mod|pom\.xml|jest|vitest)\b/i.test(text);
}

let lastSkillIds: string[] = [];

export function markSkills(ids: string[]) {
  lastSkillIds = ids.filter(Boolean).slice(0, 6);
}

function hydrateSkill(s: LearnSkill): LearnSkill {
  return {
    ...s,
    score: s.score ?? 0.55,
    wins: s.wins ?? 0,
    fails: s.fails ?? 0,
    scope: s.scope ?? "user",
  };
}

export const useLearn = create<LearnState>()(
  persist(
    (set, get) => ({
      on: true,
      prefs: { ...LEARN_DEFAULTS },
      events: [],
      facts: [],
      skills: SEED,
      negs: [],
      setOn: (on) => set({ on }),
      setPref: (k, v) => set({ prefs: { ...get().prefs, [k]: v } }),
      resetPrefs: () => set({ on: true, prefs: { ...LEARN_DEFAULTS } }),
      track: (k, d) => {
        if (!get().on) return;
        const events = [{ t: Date.now(), k, d: d?.slice(0, 180) }, ...get().events].slice(0, 200);
        set({ events });
        if (k === "reject" && d && prefs().negatives) extractNegative(d);
        if (k === "accept") skillOutcome("ok");
        if (k === "reject" || k === "undo") skillOutcome(k === "undo" ? "undo" : "reject");
        if (events.length % 6 === 0) {
          if (prefs().distill) distill();
          if (prefs().adaptIde) adaptIde();
        }
        if (events.length % 12 === 0 && typeof window !== "undefined") {
          window.dispatchEvent(new Event("anvil-brain-usage"));
        }
      },
      addFact: (kind, text, conf = 0.7) => {
        const t = text.trim().slice(0, 220);
        if (!t) return { id: "", kind, text: "", conf: 0, at: 0, hits: 0, scope: "user" };
        const scope: LearnScope = kind === "project" || projectish(t) ? "project" : kind === "lesson" ? "user" : "user";
        const ws = scope === "project" ? workspaceId() : undefined;
        const hit = get().facts.find(
          (f) => f.kind === kind && norm(f.text) === norm(t) && (f.ws ?? "") === (ws ?? ""),
        );
        if (hit) {
          const next = { ...hit, hits: hit.hits + 1, conf: Math.min(1, hit.conf + 0.08), at: Date.now() };
          set({ facts: get().facts.map((f) => (f.id === hit.id ? next : f)) });
          return next;
        }
        const fact: LearnFact = { id: nid(), kind, text: t, conf, at: Date.now(), hits: 1, scope, ws };
        set({ facts: [fact, ...get().facts].slice(0, 48) });
        return fact;
      },
      forgetFact: (id) => set({ facts: get().facts.filter((f) => f.id !== id) }),
      writeSkill: (s) => {
        const name = s.name.trim().slice(0, 40) || "skill";
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || nid();
        const cur = get().skills.find((x) => x.id === id || x.name === name);
        const scope = s.scope ?? (projectish(`${s.when} ${s.body}`) ? "project" : "user");
        const skill: LearnSkill = {
          id: cur?.id ?? id,
          name,
          when: s.when.trim().slice(0, 160) || name,
          body: s.body.trim().slice(0, 8000),
          kind: s.kind === "plugin" ? "plugin" : "guide",
          uses: cur?.uses ?? 0,
          at: Date.now(),
          score: cur?.score ?? 0.6,
          wins: cur?.wins ?? 0,
          fails: cur?.fails ?? 0,
          scope,
          ws: scope === "project" ? workspaceId() : undefined,
        };
        set({ skills: [skill, ...get().skills.filter((x) => x.id !== skill.id)].slice(0, 28) });
        if (skill.kind === "plugin" && prefs().pluginSkills) writePluginSkill(skill);
        persistSkillFile(skill);
        return skill;
      },
      forgetSkill: (id) => set({ skills: get().skills.filter((s) => s.id !== id) }),
      bumpSkill: (id) => {
        const s =
          get().skills.find((x) => x.id === id || x.name === id) ??
          matchSkills(String(id), 1)[0];
        if (!s) return;
        const next = { ...hydrateSkill(s), uses: (s.uses ?? 0) + 1, at: Date.now() };
        set({ skills: get().skills.map((x) => (x.id === s.id ? next : x)) });
        lastSkillIds = [...new Set([next.id, ...lastSkillIds])].slice(0, 6);
        return next;
      },
      patchSkill: (id, patch) => {
        set({
          skills: get().skills.map((s) => (s.id === id || s.name === id ? { ...hydrateSkill(s), ...patch } : s)),
        });
      },
      addNeg: (path, text) => {
        const t = text.trim().slice(0, 140);
        if (!t) return;
        const neg: LearnNeg = { id: nid(), path, text: t, at: Date.now() };
        set({ negs: [neg, ...get().negs.filter((n) => n.text !== t)].slice(0, 18) });
        get().addFact("lesson", `Nicht so (${path}): ${t}`, 0.72);
      },
      forgetNeg: (id) => set({ negs: get().negs.filter((n) => n.id !== id) }),
      clear: () => set({ events: [], facts: [], skills: SEED, negs: [] }),
      clearLog: () => set({ events: [] }),
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
        negs: s.negs,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LearnState>;
        const skills = [...(p.skills ?? current.skills)];
        for (const seed of SEED) {
          if (!skills.some((s) => s.id === seed.id || s.name === seed.name)) skills.push(seed);
        }
        return { ...current, ...p, skills };
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

export function skillOutcome(kind: "ok" | "fail" | "reject" | "undo") {
  const st = useLearn.getState();
  if (!st.on || !lastSkillIds.length || !prefs().skills) return;
  const delta = kind === "ok" ? 0.12 : -0.14;
  for (const id of lastSkillIds) {
    const raw = st.skills.find((x) => x.id === id || x.name === id);
    if (!raw) continue;
    const s = hydrateSkill(raw);
    const score = Math.max(0.05, Math.min(1, s.score + delta));
    const wins = s.wins + (kind === "ok" ? 1 : 0);
    const fails = s.fails + (kind === "ok" ? 0 : 1);
    let body = s.body.replace(/\n⚠[^\n]*/g, "");
    if (kind !== "ok" && fails >= 2) {
      body += "\n⚠ Letzte Nutzung schlug fehl oder wurde verworfen — Variante prüfen, nicht blind wiederholen.";
    }
    st.patchSkill(s.id, { score, wins, fails, body, at: Date.now() });
  }
  if (kind === "ok") lastSkillIds = [];
}

export function reflectUtterance(text: string, mode: "ask" | "abort" | "batch" = "ask") {
  const st = useLearn.getState();
  if (!st.on || !prefs().distill) return;
  const t = text.toLowerCase();
  if (mode === "abort") {
    st.addFact("user", "Bricht ab, wenn es zu lange dauert — kürzer arbeiten.", 0.74);
    skillOutcome("fail");
    return;
  }
  if (/(^|\b)(nein|nicht so|falsch|stopp|das will ich nicht|zu lang|zu ausführlich|zu viel text)\b/.test(t)) {
    st.addFact("user", "Korrigiert oft. Erst Plan in 2 Sätzen, dann kleine Diffs.", 0.86);
    if (mode === "ask") skillOutcome("fail");
  }
  const immer = text.match(/\bimmer\s+(.{4,90}?)(?:\.|$|\n)/i);
  if (immer) st.addFact(projectish(immer[1]) ? "project" : "user", `Immer: ${immer[1].trim()}`, 0.82);
  const lieber = text.match(/\blieber\s+(.{4,90}?)(?:\.|$|\n)/i);
  if (lieber) st.addFact("user", `Lieber: ${lieber[1].trim()}`, 0.8);
  const kein = text.match(/\bkein(?:e|en|er)?\s+([a-zA-Zäöü][\w.+-]{1,40})/i);
  if (kein) st.addFact("lesson", `Nicht verwenden: ${kein[1].trim()}`, 0.76);
  if (/\bpytest\b/.test(t)) st.addFact("project", "Python-Tests mit pytest.", 0.78);
  if (/\b(knapp|kurz|ohne essay|ohne blabla)\b/.test(t)) st.addFact("user", "Antworten kurz halten.", 0.84);
  if (/\btypescript\b/.test(t) && /\blieber|immer|statt\b/.test(t)) st.addFact("user", "Bevorzugt TypeScript.", 0.7);
}

export function adaptIde() {
  const st = useLearn.getState();
  if (!st.on || !prefs().adaptIde) return;
  const p = profile();
  const ide = useIde.getState();
  if (p.reject >= 3 && p.reject > p.accept && ide.autoAcceptDiffs) {
    ide.setAutoAcceptDiffs(false);
    ide.setNotice("Lernen: Diffs nicht mehr automatisch übernehmen");
  }
  if (p.debug >= 4 && p.debug >= p.run && ide.liveRun) {
    ide.setLiveRun(false);
  }
  let runAfterAsk = 0;
  const ev = st.events;
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].k !== "run") continue;
    if (ev.slice(i + 1, i + 8).some((e) => e.k === "ask")) runAfterAsk += 1;
  }
  if (runAfterAsk >= 3 && !ide.autoRunAgent) ide.setAutoRunAgent(true);
}

function persistSkillFile(skill: LearnSkill) {
  const path = `.anvil/skills/${skill.id}.md`;
  const src = `---\nname: ${skill.name}\nwhen: ${skill.when.replace(/\n/g, " ")}\nkind: ${skill.kind}\nscope: ${skill.scope}\n---\n${skill.body}\n`;
  try {
    useIde.getState().writeFile(path, src);
  } catch {
    /* workspace not ready */
  }
}

function writePluginSkill(skill: LearnSkill) {
  const path = `plugins/skills/${skill.id}.js`;
  const src = `// @desc ${skill.when.replace(/\n/g, " ")}
function activate(anvil) {
  anvil.command({
    id: ${JSON.stringify(`skill.${skill.id}`)},
    title: ${JSON.stringify(skill.name)},
    run() {
      anvil.agent(${JSON.stringify(`Skill ${skill.name}:\n${skill.body}`)});
    },
  });
}
`;
  try {
    useIde.getState().writeFile(path, src);
  } catch {
    /* workspace not ready */
  }
}

function scoreSkill(s: LearnSkill, q: string) {
  const bag = `${s.name} ${s.when}`.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((w) => w.length > 2);
  const words = q.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((w) => w.length > 2);
  let n = (s.score ?? 0.5) * 2;
  for (const w of words) if (bag.includes(w)) n += 1;
  n += (s.uses ?? 0) * 0.1;
  n -= (s.fails ?? 0) * 0.2;
  return n;
}

function visibleSkills(): LearnSkill[] {
  const ws = workspaceId();
  return useLearn
    .getState()
    .skills.map(hydrateSkill)
    .filter((s) => (s.score ?? 0.5) >= 0.22)
    .filter((s) => s.scope !== "project" || !s.ws || s.ws === ws);
}

function visibleFacts(): LearnFact[] {
  const ws = workspaceId();
  return useLearn.getState().facts.filter((f) => {
    if (f.scope === "project" || f.kind === "project") return !f.ws || f.ws === ws;
    return true;
  });
}

export function matchSkills(query: string, limit = 3): LearnSkill[] {
  const q = query.trim();
  const all = visibleSkills();
  if (!q) return all.slice(0, limit);
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
  if (!st.on || !p.inject) return "";
  const prof = profile();
  const facts = [...visibleFacts()].sort((a, b) => b.conf * b.hits - a.conf * a.hits);
  const cap = Math.min(12, Math.max(2, p.factLimit | 0));
  const skillCap = Math.min(8, Math.max(1, p.skillLimit | 0));
  const person = p.person ? facts.filter((f) => f.scope !== "project" && f.kind !== "project").slice(0, cap) : [];
  const proj = p.project ? facts.filter((f) => f.scope === "project" || f.kind === "project").slice(0, cap) : [];
  const negs = p.negatives ? st.negs.slice(0, 6) : [];
  const matched = p.skills ? matchSkills(lastAsk, Math.min(2, skillCap)) : [];
  const rest = p.skills
    ? visibleSkills()
        .filter((s) => !matched.some((m) => m.id === s.id))
        .slice(0, Math.max(0, skillCap - matched.length))
    : [];
  const lines = [
    "Gelerntes (lokal). Person und Projekt getrennt halten.",
    p.profile && (prof.topLang || prof.run || prof.ask)
      ? `Profil: Sprache ${prof.topLang || "—"} · Run ${prof.run} · Debug ${prof.debug} · Agent ${prof.ask} · Diffs +${prof.accept}/-${prof.reject} · Undo ${prof.undo}.`
      : "",
    person.length ? `Person:\n${person.map((f) => `- ${f.text}`).join("\n")}` : "",
    proj.length ? `Dieses Projekt (${workspaceId()}):\n${proj.map((f) => `- ${f.text}`).join("\n")}` : "",
    negs.length ? `Nicht so (abgelehnte Muster):\n${negs.map((n) => `- ${n.path}: ${n.text}`).join("\n")}` : "",
    p.skills && visibleSkills().length
      ? `Skills — passende skill_run, neue skill_write. Nach Fehlern Skill anpassen:\n${[...matched, ...rest]
          .map((s) => `- ${s.name} [${s.scope}, ${Math.round((s.score ?? 0.5) * 100)}%]: ${s.when}${matched.some((m) => m.id === s.id) ? " ← jetzt" : ""}`)
          .join("\n")}`
      : "",
    p.skillBodies && matched.length ? `Aktive Skill-Anweisung:\n${matched.map((s) => `### ${s.name}\n${s.body}`).join("\n\n")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function agentLearn(action: string, args: Record<string, unknown>): Promise<unknown> {
  const st = useLearn.getState();
  if (!st.on && action !== "state") return { error: "Lernen aus" };
  if (action === "list" || action === "state") {
    return {
      person: visibleFacts().filter((f) => f.scope !== "project"),
      project: visibleFacts().filter((f) => f.scope === "project" || f.kind === "project"),
      skills: visibleSkills().map((s) => ({ name: s.name, when: s.when, score: s.score, uses: s.uses, scope: s.scope })),
      negatives: st.negs.slice(0, 8),
      profile: profile(),
      workspace: workspaceId(),
    };
  }
  if (action === "add") {
    const kind = (["user", "project", "lesson"].includes(String(args.kind)) ? args.kind : "lesson") as LearnKind;
    const fact = st.addFact(kind, String(args.text ?? ""), 0.85);
    return { ok: true, fact };
  }
  if (action === "forget") {
    st.forgetFact(String(args.id ?? ""));
    return { ok: true };
  }
  if (action === "skills") {
    return visibleSkills().map((s) => ({ name: s.name, when: s.when, score: s.score, uses: s.uses, scope: s.scope }));
  }
  if (action === "write") {
    const skill = st.writeSkill({
      name: String(args.name ?? ""),
      when: String(args.when ?? ""),
      body: String(args.body ?? ""),
      kind: args.kind === "plugin" ? "plugin" : "guide",
      scope: args.scope === "project" ? "project" : "user",
    });
    st.track("skill", skill.name);
    const dbg = debugSkill(skill);
    return { ok: dbg.ok, skill: { name: skill.name, kind: skill.kind, scope: skill.scope, path: `.anvil/skills/${skill.id}.md` }, issues: dbg.issues };
  }
  if (action === "read") {
    const id = String(args.name ?? "");
    const s = visibleSkills().find((x) => x.id === id || x.name === id) ?? matchSkills(id, 1)[0];
    if (!s) return { error: "skill missing" };
    return { ...s, debug: debugSkill(s) };
  }
  if (action === "run") {
    const id = String(args.name ?? "");
    const s = st.bumpSkill(id) ?? matchSkills(id, 1)[0];
    if (!s) return { error: "no skill" };
    markSkills([s.id]);
    const dbg = debugSkill(s);
    return {
      skill: s.name,
      body: s.body,
      score: s.score,
      issues: dbg.issues,
      do: "Follow these steps with tools now. Then skill_outcome ok or fail.",
    };
  }
  if (action === "debug") {
    const id = String(args.name ?? "").trim();
    const list = id ? [visibleSkills().find((x) => x.id === id || x.name === id) ?? matchSkills(id, 1)[0]].filter(Boolean) : visibleSkills();
    const report = (list as LearnSkill[]).map((s) => ({ name: s.name, ...debugSkill(s), fails: s.fails, score: s.score }));
    const broken = report.filter((r) => !r.ok);
    return {
      skills: report,
      broken,
      issues: broken.flatMap((r) => r.issues.map((i) => `${r.name}: ${i}`)),
    };
  }
  if (action === "patch") {
    const id = String(args.name ?? "");
    const cur = visibleSkills().find((x) => x.id === id || x.name === id);
    if (!cur) return { error: "skill fehlt" };
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
    skillOutcome(String(args.kind ?? "ok") as "ok" | "fail" | "reject" | "undo");
    return { ok: true };
  }
  return { error: `unbekannt ${action}` };
}
