import { heuristicAttach, heuristicCommit, heuristicError, heuristicTitle, heuristicTabHint, heuristicStopNote, heuristicLogTrim, heuristicI18nKey, heuristicMention, heuristicComment, leftoverSecretHints } from "./heuristics";
import { useIde } from "@/store/ide";
import { scrubRunError } from "@/lib/run-error";
import { brainGenerate, brainSystem, extractJson, firstUsefulLine } from "./engine";
import { brainReady, useBrain } from "./store";
import { pushLane } from "./lane";

function job(k: keyof ReturnType<typeof useBrain.getState>["jobs"]) {
  const j = useBrain.getState().jobs as Record<string, boolean | undefined>;
  return useBrain.getState().on && j[k] !== false;
}

import { redactSecrets } from "@/lib/vault";

export function scrubSecrets(text: string): { text: string; n: number } {
  return redactSecrets(text);
}

export async function brainCommitMessage(paths: string[], snippets: string): Promise<string> {
  const heur = heuristicCommit(paths);
  if (!brainReady() || !job("commit")) {
    useBrain.getState().logJob("commit", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("One commit line, conventional optional. No trailing period, max 72 chars.") },
        { role: "user", content: `Dateien: ${paths.slice(0, 12).join(", ")}\n${snippets.slice(0, 700)}` },
      ],
      maxTokens: 24,
      temperature: 0.1,
      stop: ["\n"],
      pri: 1,
      job: "commit",
    });
    const line = firstUsefulLine(raw, 72).replace(/^["'`]+|["'`]+$/g, "");
    return line || heur;
  } catch {
    return heur;
  }
}

export async function brainExplainError(stderr: string, path: string): Promise<string> {
  const short = stderr.trim().split("\n").slice(-12).join("\n");
  if (!short) return "";
  const heur = heuristicError(stderr, path);
  if (!brainReady() || !job("errors")) {
    useBrain.getState().logJob("errors", "heur", 0);
    return heur;
  }
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("Explain the error: 2 sentences. Cause + fix. No code except 1 line.") },
      { role: "user", content: `${path}\n${short.slice(0, 800)}` },
    ],
    maxTokens: 80,
    temperature: 0.1,
    stop: ["\n\n\n"],
    pri: 1,
    job: "errors",
  });
  return raw.split("\n").slice(0, 4).join("\n").slice(0, 400) || heur;
}

export async function brainDiffSummary(items: { path: string; before: string; after: string }[]): Promise<string> {
  if (!items.length) return "";
  if (!brainReady() || !job("diffs")) {
    return `${items.length} Datei(en): ${items.map((i) => i.path).slice(0, 4).join(", ")}`;
  }
  const blob = items
    .slice(0, 6)
    .map((i) => `${i.path} ${i.after.length - i.before.length >= 0 ? "+" : ""}${i.after.length - i.before.length}`)
    .join("\n");
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("One sentence what the diff does. No code.") },
      { role: "user", content: blob },
    ],
    maxTokens: 36,
    temperature: 0.1,
    stop: ["\n"],
    pri: 1,
    job: "diffs",
  });
  return firstUsefulLine(raw, 140) || blob;
}

export async function brainSearchNeedle(q: string): Promise<string> {
  const quoted = q.match(/"([^"]{2,40})"/);
  if (quoted) return quoted[1];
  if (!job("search") || !brainReady()) {
    useBrain.getState().logJob("search", "heur", 0);
    return q.trim();
  }
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("One grep string. No sentence, no regex unless needed.") },
      { role: "user", content: q },
    ],
    maxTokens: 10,
    temperature: 0,
    stop: ["\n", " "],
    pri: 1,
    job: "search",
  });
  const n = firstUsefulLine(raw, 32).replace(/['"]/g, "");
  return n.length >= 2 ? n : q;
}

export async function brainAttach(ask: string, files: string[]): Promise<string[]> {
  const named = heuristicAttach(ask, files);
  if (named.length) {
    useBrain.getState().logJob("attach", "heur", 0);
    return named;
  }
  if (!brainReady() || !job("attach") || files.length === 0) return [];
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("JSON {\"paths\":[...]} max 4 paths from the list. Else {\"paths\":[]}.") },
      { role: "user", content: `Frage: ${ask.slice(0, 300)}\nDateien:\n${files.slice(0, 60).join("\n")}` },
    ],
    maxTokens: 70,
    temperature: 0,
    json: true,
    pri: 1,
    job: "attach",
  });
  const j = extractJson(raw) as { paths?: string[] } | null;
  const set = new Set(files);
  return (j?.paths ?? []).filter((p) => set.has(p)).slice(0, 4);
}

export async function brainChatTitle(user: string): Promise<string> {
  const heur = heuristicTitle(user);
  if (!brainReady() || !job("title") || user.length < 24) {
    useBrain.getState().logJob("title", "heur", 0);
    return heur;
  }
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("Title 3–6 words, no quotes. User-visible: German.") },
      { role: "user", content: user.slice(0, 240) },
    ],
    maxTokens: 14,
    temperature: 0.15,
    stop: ["\n"],
    pri: 2,
    job: "title",
  });
  return firstUsefulLine(raw, 48) || heur;
}

export async function brainDocstring(lang: string, code: string): Promise<string> {
  if (!brainReady() || !job("doc")) return "";
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem(`Only the comment/docstring for ${lang}. No other text.`) },
      { role: "user", content: code.slice(0, 1200) },
    ],
    maxTokens: 70,
    temperature: 0.1,
    stop: ["```"],
    pri: 1,
    job: "doc",
  });
  return raw.replace(/^```[\w]*\n?|\n?```$/g, "").trim().slice(0, 400);
}

export async function brainBreakpoint(stderr: string): Promise<{ path: string; line: number } | null> {
  const m = stderr.match(/([^\s:]+\.\w+):(\d+)/);
  if (m) return { path: m[1], line: Number(m[2]) };
  if (!brainReady() || !job("errors")) return null;
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("JSON {\"path\":\"file.py\",\"line\":12} oder {\"path\":\"\",\"line\":0}") },
      { role: "user", content: stderr.slice(0, 800) },
    ],
    maxTokens: 36,
    temperature: 0,
    json: true,
    pri: 1,
    job: "break",
  });
  const j = extractJson(raw) as { path?: string; line?: number } | null;
  if (!j?.path || !j.line) return null;
  return { path: j.path, line: Number(j.line) };
}

export function heuristicPrompts(): string[] {
  const ide = useIde.getState();
  const out: string[] = [];
  const fail = [...ide.output].reverse().find((r) => !r.ok);
  if (fail) {
    const err = scrubRunError(fail.stderr || fail.stdout);
    const line = err.split("\n").filter(Boolean).at(-1) ?? "";
    out.push(`Fehler in ${fail.label} beheben${line ? `: ${line.slice(0, 80)}` : "."}`);
  }
  if (ide.lspProblems.length) {
    const p = ide.lspProblems[0];
    out.push(`${p.path}:${p.line} — ${p.message.slice(0, 70)}`);
  } else if (ide.pendingDiffs.length) out.push("Offene Diffs prüfen.");
  else if (ide.activePath) out.push(`${ide.activePath} verbessern.`);
  return out.slice(0, 2);
}

export async function brainSuggestPrompts(): Promise<string[]> {
  const heur = heuristicPrompts();
  const st = useBrain.getState();
  if (!st.on || st.jobs.prompts === false) {
    st.setPrompts([]);
    return [];
  }
  if (!brainReady()) {
    st.setPrompts(heur);
    st.logJob("prompts", "heur", 0);
    return heur;
  }
  try {
    const ide = useIde.getState();
    const fail = [...ide.output].reverse().find((r) => !r.ok);
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("JSON {\"prompts\":[\"...\"]} max 3. Each is an order to the agent, German, under 80 chars.") },
        {
          role: "user",
          content: `Datei: ${ide.activePath || "—"}\nFehler: ${fail ? `${fail.label} ${scrubRunError(fail.stderr || "").slice(0, 200)}` : "keiner"}\nProbleme: ${ide.lspProblems.length}\nDiffs: ${ide.pendingDiffs.length}`,
        },
      ],
      maxTokens: 120,
      temperature: 0.2,
      json: true,
      pri: 2,
      job: "prompts",
    });
    const j = extractJson(raw) as { prompts?: string[] } | null;
    const list = (j?.prompts ?? [])
      .map((s) => String(s).trim())
      .filter((s) => s.length >= 8 && s.length <= 120)
      .slice(0, 3);
    const next = list.length ? list : heur;
    st.setPrompts(next);
    return next;
  } catch {
    st.setPrompts(heur);
    return heur;
  }
}

export function heuristicFollowups(): string[] {
  const ide = useIde.getState();
  const out: string[] = [];
  if (ide.pendingDiffs.length) out.push("Diffs annehmen und Tests dazu schreiben.");
  if (ide.output.some((o) => !o.ok)) out.push("Den letzten Lauf-Fehler beheben.");
  if (ide.activePath && /\.(js|ts|py)$/i.test(ide.activePath) && !Object.keys(ide.files).some((p) => /\.test\.|spec\./i.test(p))) {
    out.push("Tests für die letzte Änderung schreiben.");
  }
  if (ide.activePath) out.push(`${ide.activePath} kurz erklären.`);
  return out.slice(0, 3);
}

export async function brainFollowups(user: string, reply: string): Promise<string[]> {
  const heur = heuristicFollowups();
  const st = useBrain.getState();
  if (!st.on || st.jobs.followup === false) {
    st.setFollowups([]);
    return [];
  }
  if (!brainReady()) {
    st.setFollowups(heur);
    st.logJob("followup", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("JSON {\"next\":[\"...\"]} max 3 follow-up orders to the agent. German, under 70 chars, concrete.") },
        { role: "user", content: `Auftrag: ${user.slice(0, 220)}\nAntwort: ${reply.slice(0, 280)}` },
      ],
      maxTokens: 90,
      temperature: 0.2,
      json: true,
      pri: 2,
      job: "followup",
    });
    const j = extractJson(raw) as { next?: string[] } | null;
    const list = (j?.next ?? [])
      .map((s) => String(s).trim())
      .filter((s) => s.length >= 8 && s.length <= 100)
      .slice(0, 3);
    const next = list.length ? list : heur;
    st.setFollowups(next);
    if (next[0]) {
      const { pushLane } = await import("./lane");
      pushLane("next", next[0]);
    }
    return next;
  } catch {
    st.setFollowups(heur);
    return heur;
  }
}

export async function brainReview(paths: string[]): Promise<string> {
  if (!paths.length) return "";
  const heur = `${paths.length} Datei(en): ${paths.slice(0, 3).join(", ")}`;
  const { pushLane } = await import("./lane");
  if (!brainReady() || !job("review")) {
    useBrain.getState().logJob("review", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("One sentence: what the change does, plus one risk. No code. For the main model.") },
        { role: "user", content: paths.slice(0, 8).join(", ") },
      ],
      maxTokens: 48,
      temperature: 0.1,
      stop: ["\n\n"],
      pri: 2,
      job: "review",
    });
    const out = firstUsefulLine(raw, 160) || heur;
    pushLane("review", out);
    return out;
  } catch {
    return heur;
  }
}

function slugName(s: string, ext: string): string {
  const stem = s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9äöü]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28) || "neu";
  const e = ext.replace(/^\./, "") || "txt";
  return `${stem}.${e}`;
}

export async function brainRename(hint: string, ext: string): Promise<string> {
  const heur = slugName(hint.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join("-") || "neu", ext);
  if (!brainReady() || !job("rename") || hint.trim().length < 4) {
    useBrain.getState().logJob("rename", "heur", 0);
    return heur;
  }
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem(`Filename only with .${ext.replace(/^\./, "")}. lowercase, hyphens, no paths.`) },
      { role: "user", content: hint.slice(0, 200) },
    ],
    maxTokens: 12,
    temperature: 0.1,
    stop: ["\n", " ", "/"],
    pri: 2,
    job: "rename",
  });
  const line = firstUsefulLine(raw, 40).replace(/^["'`]+|["'`]+$/g, "");
  if (!line) return heur;
  return slugName(line, ext);
}

export function heuristicRunPick(files: string[], active: string): string {
  if (active && /\.(html?|py|js|ts|go|rs)$/i.test(active)) return active;
  const rank = (p: string) => {
    const b = p.split("/").pop() ?? p;
    if (/^index\.html?$/i.test(b)) return 0;
    if (/^main\.(py|js|ts)$/i.test(b)) return 1;
    if (/^app\.(py|js|ts)$/i.test(b)) return 2;
    if (/\.html?$/i.test(b)) return 3;
    if (/\.(py|js|ts)$/i.test(b) && !/test|spec/i.test(b)) return 4;
    return 9;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0] ?? active;
}

export async function brainRunPick(files: string[], active: string): Promise<string> {
  const heur = heuristicRunPick(files, active);
  if (active && /\.(html?|py|js|ts)$/i.test(active)) return active;
  if (!brainReady() || !job("runpick") || files.length < 2) {
    useBrain.getState().logJob("runpick", "heur", 0);
    return heur;
  }
  const cand = files.filter((p) => /\.(html?|py|js|ts|go)$/i.test(p)).slice(0, 40);
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("One path from the list. Path only.") },
      { role: "user", content: `Aktiv: ${active || "—"}\n${cand.join("\n")}` },
    ],
    maxTokens: 20,
    temperature: 0,
    stop: ["\n", " "],
    pri: 1,
    job: "runpick",
  });
  const line = firstUsefulLine(raw, 80);
  return cand.includes(line) ? line : heur;
}

export async function brainFixLine(): Promise<string> {
  const hits = useIde.getState().lspProblems.slice(0, 6);
  if (!hits.length) return "";
  const heur = `${hits[0].path}:${hits[0].line} — ${hits[0].message.slice(0, 80)}`;
  if (!brainReady() || !job("fixline")) {
    useBrain.getState().logJob("fixline", "heur", 0);
    return heur;
  }
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("One order to the agent: which squiggles to fix. One line, German.") },
      { role: "user", content: hits.map((h) => `${h.path}:${h.line} ${h.message}`).join("\n").slice(0, 500) },
    ],
    maxTokens: 40,
    temperature: 0.1,
    stop: ["\n\n"],
    pri: 1,
    job: "fixline",
  });
  return firstUsefulLine(raw, 120) || heur;
}

const TAB: Record<string, string> = {};
const tabSubs = new Set<() => void>();
let tabGen = 0;

export function getTabHint(path: string): string {
  return TAB[path] ?? "";
}

export function tabHintSnap(): number {
  return tabGen;
}

export function subscribeTabHints(cb: () => void): () => void {
  tabSubs.add(cb);
  return () => {
    tabSubs.delete(cb);
  };
}

function setTabHint(path: string, hint: string) {
  if (TAB[path] === hint) return;
  TAB[path] = hint;
  tabGen += 1;
  tabSubs.forEach((f) => f());
}

export async function brainTabHint(path: string, src: string): Promise<string> {
  const heur = heuristicTabHint(path, src);
  if (!job("tabHint") || !brainReady() || src.length < 40) {
    setTabHint(path, heur);
    useBrain.getState().logJob("tabHint", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("One line what the file is for. No path, no code.") },
        { role: "user", content: `${path}\n${src.slice(0, 700)}` },
      ],
      maxTokens: 24,
      temperature: 0.1,
      stop: ["\n"],
      pri: 2,
      job: "tabHint",
    });
    const line = firstUsefulLine(raw, 72) || heur;
    setTabHint(path, line);
    return line;
  } catch {
    setTabHint(path, heur);
    return heur;
  }
}

export async function brainSecretWarn(text: string): Promise<string> {
  const hits = leftoverSecretHints(text);
  if (!hits.length) return "";
  const heur = `Sieht nach Geheimnis aus (${hits.length}). Kommt nicht in den Prompt.`;
  if (!job("secrets")) return heur;
  pushLane("risk", heur);
  if (!brainReady()) {
    useBrain.getState().logJob("secrets", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("One warning line or NO. Do not repeat values.") },
        { role: "user", content: `Treffer: ${hits.length}\n${text.slice(0, 400).replace(/[A-Za-z0-9_\-]{12,}/g, "…")}` },
      ],
      maxTokens: 28,
      temperature: 0,
      stop: ["\n\n"],
      pri: 0,
      job: "secrets",
    });
    const line = firstUsefulLine(raw, 100);
    if (!line || /^nein/i.test(line)) return heur;
    pushLane("risk", line);
    return line;
  } catch {
    return heur;
  }
}

export async function brainMentionRank(q: string, files: string[]): Promise<string[]> {
  const ide = useIde.getState();
  const heur = heuristicMention(q, files, {
    dirty: Object.keys(ide.dirty),
    recent: ide.recentPaths,
    active: ide.activePath,
  });
  if (!job("mention") || !brainReady() || q.trim().length < 2 || files.length < 8) {
    useBrain.getState().logJob("mention", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("JSON {\"paths\":[...]} max 8 paths from the list, relevant to the query.") },
        { role: "user", content: `@${q}\n${files.slice(0, 80).join("\n")}` },
      ],
      maxTokens: 80,
      temperature: 0,
      json: true,
      pri: 2,
      job: "mention",
    });
    const j = extractJson(raw) as { paths?: string[] } | null;
    const set = new Set(files);
    const extra = (j?.paths ?? []).filter((p) => set.has(p));
    return [...new Set([...extra, ...heur])].slice(0, 10);
  } catch {
    return heur;
  }
}

export async function brainStopNote(steps: { name: string; detail?: string; status: string }[]): Promise<string> {
  const heur = heuristicStopNote(steps);
  if (!job("stopNote") || !brainReady() || steps.length < 2) {
    useBrain.getState().logJob("stopNote", "heur", 0);
    return heur;
  }
  try {
    const blob = steps
      .slice(-12)
      .map((s) => `${s.status} ${s.name} ${s.detail ?? ""}`)
      .join("\n")
      .slice(0, 800);
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("Max 3 bullets of what already happened. No next-plan.") },
        { role: "user", content: blob },
      ],
      maxTokens: 80,
      temperature: 0.1,
      stop: ["\n\n\n"],
      pri: 0,
      job: "stopNote",
    });
    const clean = raw
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 3)
      .join("\n");
    return clean || heur;
  } catch {
    return heur;
  }
}

export async function brainPlanText(ask: string): Promise<string[]> {
  const fallback = ["Verstehen", "Ändern", "Run", "Prüfen"];
  if (!job("planText") || !brainReady() || ask.trim().length < 12) {
    useBrain.getState().logJob("planText", "heur", 0);
    return fallback;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("JSON {\"steps\":[\"…\"]} 3–5 short steps, German, no numbers.") },
        { role: "user", content: ask.slice(0, 400) },
      ],
      maxTokens: 70,
      temperature: 0.15,
      json: true,
      pri: 1,
      job: "planText",
    });
    const j = extractJson(raw) as { steps?: string[] } | null;
    const steps = (j?.steps ?? []).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 42);
    return steps.length >= 3 ? steps.slice(0, 6) : fallback;
  } catch {
    return fallback;
  }
}

export async function brainComment(lang: string, code: string): Promise<string> {
  const heur = heuristicComment(lang, code);
  if (!job("comment") || !brainReady() || code.trim().length < 8) {
    useBrain.getState().logJob("comment", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem(`One comment line for ${lang}. No code, no block.`) },
        { role: "user", content: code.slice(0, 600) },
      ],
      maxTokens: 36,
      temperature: 0.1,
      stop: ["\n\n"],
      pri: 1,
      job: "comment",
    });
    const line = firstUsefulLine(raw, 100).replace(/^```[\w]*\s?|\s?```$/g, "");
    if (!line) return heur;
    if (/^py|python$/i.test(lang) && !line.startsWith("#")) return `# ${line}`;
    if (!/^\/[/*]|<!--|#/.test(line)) return `// ${line}`;
    return line;
  } catch {
    return heur;
  }
}

export async function brainI18nKey(phrase: string): Promise<{ key: string; de: string; en: string }> {
  const key = heuristicI18nKey(phrase);
  const heur = { key, de: phrase.trim(), en: phrase.trim() };
  if (!job("i18n") || !brainReady() || phrase.trim().length < 2) {
    useBrain.getState().logJob("i18n", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("JSON {\"key\":\"camelCase\",\"de\":\"…\",\"en\":\"…\"}. key short, no spaces.") },
        { role: "user", content: phrase.slice(0, 120) },
      ],
      maxTokens: 50,
      temperature: 0.1,
      json: true,
      pri: 2,
      job: "i18n",
    });
    const j = extractJson(raw) as { key?: string; de?: string; en?: string } | null;
    const k = heuristicI18nKey(j?.key || key);
    return { key: k, de: (j?.de || heur.de).slice(0, 80), en: (j?.en || heur.en).slice(0, 80) };
  } catch {
    return heur;
  }
}

export async function brainLogTrim(stderr: string): Promise<string> {
  const heur = heuristicLogTrim(stderr);
  if (!job("logTrim") || !brainReady() || stderr.trim().length < 80) {
    useBrain.getState().logJob("logTrim", "heur", 0);
    return heur;
  }
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("Max 5 lines: what is broken. No stack, no code except file:line.") },
        { role: "user", content: stderr.slice(0, 1200) },
      ],
      maxTokens: 90,
      temperature: 0.1,
      stop: ["\n\n\n"],
      pri: 1,
      job: "logTrim",
    });
    const clean = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 5)
      .join("\n");
    return clean || heur;
  } catch {
    return heur;
  }
}

export function brainNextAction(): string {
  const ide = useIde.getState();
  if (ide.pendingDiffs.length) return `${ide.pendingDiffs.length} Diffs prüfen`;
  if (ide.debug.paused) return "Debug: F10 Step / F5 Continue";
  if (ide.output.some((o) => !o.ok)) return "Letzten Fehler prüfen";
  const dirty = Object.keys(ide.dirty).filter(Boolean);
  if (dirty.length) return `${dirty.length} geändert`;
  if (!ide.activePath) return "Datei öffnen (Ctrl+P)";
  return "";
}

export type RouteKind = "intent" | "ask-local" | "agent";

export function routeKind(text: string): RouteKind {
  const t = text.trim();
  if (t.length < 4) return "intent";
  if (/^(run|debug|suche|settings|einstellungen|vorschau|commit|speichern)\b/i.test(t) && t.length < 40) return "intent";
  if (/^(was|wo|wie|warum|erkläre|erklär|was ist)\b/i.test(t) && t.length < 160 && !/schreib|änder|mach|erstell|fix/i.test(t)) {
    return "ask-local";
  }
  return "agent";
}
