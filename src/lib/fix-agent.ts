import { problemsPrompt } from "./lsp";
import { testsPrompt, type TestHit } from "./test-parse";
import { isSecretPath } from "./ref";
import { t } from "./i18n";
import { useIde } from "@/store/ide";

function send(text: string): boolean {
  const st = useIde.getState();
  const body = text.trim();
  if (!body) return false;
  st.pushAgent(body);
  return true;
}

function snippet(path: string, line?: number): string {
  if (isSecretPath(path)) return `(gesperrt) ${path}`;
  const src = useIde.getState().files[path] ?? "";
  if (!src) return `(leer) ${path}`;
  if (!line) return src.slice(0, 5000);
  const lines = src.split("\n");
  const from = Math.max(0, line - 10);
  return lines
    .slice(from, line + 10)
    .map((l, i) => `${from + i + 1}| ${l}`)
    .join("\n")
    .slice(0, 4000);
}

export const AGENT_PINS = ["run", "debug", "problems", "tests", "git"] as const;
export type AgentPin = (typeof AGENT_PINS)[number];

export function pinContext(text: string): string {
  const found = new Set(
    [...text.matchAll(/@(run|debug|problems|tests|git)\b/gi)].map((m) => m[1].toLowerCase() as AgentPin),
  );
  if (!found.size) return "";
  const parts: string[] = [];
  if (found.has("run")) parts.push(contextRun());
  if (found.has("debug")) parts.push(contextDebug());
  if (found.has("problems")) parts.push(contextProblems());
  if (found.has("tests")) parts.push(contextTests());
  if (found.has("git")) parts.push(contextGit());
  return parts.filter(Boolean).join("\n\n");
}

export function contextRun(): string {
  const st = useIde.getState();
  const last = [...st.output].reverse().find((r) => !r.ok) ?? st.output.at(-1);
  if (!last) return "Kein Lauf.";
  const file = last.label && last.label in st.files ? last.label : "";
  return `Letzter Lauf ${last.ok ? "ok" : "fehlgeschlagen"}: ${last.label} (${last.duration.toFixed(2)}s)\nstderr:\n${(last.stderr || "").slice(0, 2000) || "(leer)"}\nstdout:\n${(last.stdout || "").slice(0, 800) || "(leer)"}${file ? `\n\n${snippet(file).slice(0, 2000)}` : ""}`;
}

export function contextDebug(): string {
  const d = useIde.getState().debug;
  if (!d.paused || !d.path) return "Debugger hält nicht.";
  const stack = d.stack.slice(0, 8).map((f) => `${f.fn || "?"} ${f.path}:${f.line}`).join("\n") || "—";
  const locals = Object.entries(d.locals)
    .slice(0, 16)
    .map(([k, v]) => `${k} = ${String(v).slice(0, 100)}`)
    .join("\n") || "—";
  return `Debugger ${d.path}:${d.line} (${d.reason || "pause"})\nStack:\n${stack}\nLocals:\n${locals}\n\n${snippet(d.path, d.line)}`;
}

export function contextProblems(): string {
  const st = useIde.getState();
  const hits = st.lspProblems;
  if (!hits.length) return "Es liegen keine Codeprobleme vor.";
  return problemsPrompt(hits, st.files);
}

export function contextTests(): string {
  const rows = Object.values(useIde.getState().testResults);
  if (!rows.length) return "Keine Testergebnisse.";
  return testsPrompt(rows as TestHit[]);
}

export function contextGit(): string {
  const st = useIde.getState();
  const dirty = Object.keys(st.dirty).filter(Boolean);
  if (!dirty.length) return "Arbeitsbaum sauber.";
  return `Geändert: ${dirty.slice(0, 16).join(", ")}`;
}

export function askFile(path: string, kind: "explain" | "tests" | "review" | "fix"): boolean {
  const head =
    kind === "tests"
      ? `Schreibe Tests für ${path} (tests/ oder *.test.*), führe sie aus, rote Tests patchen.`
      : kind === "review"
        ? `Review ${path}: Fehler, Lücken, unsichere Stellen. Kleine Patches, keine Umschreibung.`
        : kind === "fix"
          ? `Behebe die Probleme in ${path}. Danach Run/Tests.`
          : `Erkläre ${path}: Zweck, Ablauf, Kanten. Kurz.`;
  return send(`${head}\n\n\`\`\`\n${snippet(path)}\n\`\`\``);
}

export function askDebug(): boolean {
  const d = useIde.getState().debug;
  if (!d.paused || !d.path) {
    useIde.getState().setNotice(t("agentDebugIdle"));
    return false;
  }
  const stack = d.stack.slice(0, 10).map((f) => `${f.fn || "?"} ${f.path}:${f.line}`).join("\n") || "—";
  const locals = Object.entries(d.locals)
    .slice(0, 20)
    .map(([k, v]) => `${k} = ${String(v).slice(0, 120)}`)
    .join("\n") || "—";
  return send(
    `Debugger hält in ${d.path}:${d.line} (${d.reason || "pause"}). Warum, und wenn Bug: patchen.\n\nStack:\n${stack}\n\nLocals:\n${locals}\n\nCode:\n\`\`\`\n${snippet(d.path, d.line)}\n\`\`\``,
  );
}

export function askRun(path?: string): boolean {
  const st = useIde.getState();
  const last = [...st.output].reverse().find((r) => (path ? r.label === path : true) && !r.ok);
  if (!last) {
    st.setNotice(t("noOutput"));
    return false;
  }
  const file = last.label && last.label in st.files ? last.label : path || st.activePath;
  const code = file ? `\n\n\`\`\`\n${snippet(file)}\n\`\`\`` : "";
  return send(
    `Lauf fehlgeschlagen: ${last.label} (${last.duration.toFixed(2)}s). Patchen und erneut ausführen.\n\nstderr:\n${(last.stderr || "").slice(0, 2500) || "(leer)"}\n\nstdout:\n${(last.stdout || "").slice(0, 1200) || "(leer)"}${code}`,
  );
}

export async function askGit(paths?: string[]): Promise<boolean> {
  const st = useIde.getState();
  const project = st.workspaceCwd || st.memoryWorkspace, epoch = st.workspaceEpoch;
  try {
    let changed = paths ?? Object.keys(st.dirty).filter(path => st.dirty[path]);
    if (!paths && st.workspaceCwd) {
      const { companionGit } = await import('./companion');
      const status = await companionGit('status', { cwd: st.workspaceCwd }, st.companionUrl || undefined);
      if (!status.ok) throw Error(status.error || 'Git-Dateistand konnte nicht gelesen werden.');
      changed = [...new Set([...changed, ...(status.files || []).map(file => file.path)])];
    }
    const dirty = [...new Set(changed)].filter(path => typeof path === 'string' && !isSecretPath(path));
    if (!dirty.length) {
      const current = useIde.getState();
      if (current.workspaceEpoch === epoch && (current.workspaceCwd || current.memoryWorkspace) === project)
        current.setNotice(changed.length ? 'Die geänderten Dateien sind von der Prüfung ausgeschlossen.' : t("agentGitClean"));
      return false;
    }
    const [{ createReviewRequest, buildReviewPrompt }, { beginTaskReview }] = await Promise.all([
      import('./task-review'), import('./task-review-store'),
    ]);
    const knownEdits = dirty.every(path => Object.hasOwn(st.editBases, path));
    const checkpoint = [...st.checkpoints].reverse().find(item => item.workspace === project && !item.archiveMissing && Object.keys(item.files).length);
    // A missing entry in a partial edit baseline is not proof of a newly added file.
    const baselineFiles = knownEdits ? Object.fromEntries(dirty.filter(path => st.editBases[path] !== null).map(path => [path, st.editBases[path]!])) : checkpoint?.files;
    const request = await createReviewRequest({ project, files: st.files, paths: dirty, baselineFiles,
      basisLabel: knownEdits ? 'Ausgangsinhalte der offenen Änderungen' : checkpoint ? `Sicherungspunkt: ${checkpoint.label}` : 'Aktueller Inhalt · Vergleichsbasis fehlt' });
    const current = useIde.getState();
    if (current.workspaceEpoch !== epoch || (current.workspaceCwd || current.memoryWorkspace) !== project || current.files !== st.files)
      throw Error('Projekt oder Dateien inzwischen geändert. Prüfung erneut starten.');
    if (!request.files.length) { current.setNotice('Für diese Prüfung liegen keine Änderungen vor.'); return false; }
    beginTaskReview(request);
    current.pushAgent(buildReviewPrompt(request), false, 'ask');
    return true;
  } catch (error) {
    const current = useIde.getState();
    if (current.workspaceEpoch === epoch && (current.workspaceCwd || current.memoryWorkspace) === project)
      current.setNotice(error instanceof Error ? error.message : 'Prüfung konnte nicht gestartet werden.');
    return false;
  }
}

export async function fixHere(path?: string, line?: number): Promise<boolean> {
  const st = useIde.getState();
  const p = path || st.activePath;
  const all = st.lspProblems;
  let hits = line && p ? all.filter((h) => h.path === p && h.line === line) : [];
  if (!hits.length && p) hits = all.filter((h) => h.path === p);
  if (!hits.length) hits = all;
  const testsAll = Object.values(st.testResults).filter((h) => !h.ok && !h.skip);
  let tests = line && p ? testsAll.filter((h) => h.path === p && (!h.line || h.line === line)) : [];
  if (!tests.length && p) tests = testsAll.filter((h) => h.path === p);
  if (!tests.length) tests = testsAll;
  const parts: string[] = [];
  if (hits.length) parts.push(problemsPrompt(hits, st.files));
  if (tests.length) parts.push(testsPrompt(tests as TestHit[]));
  if (!parts.length) {
    if (p) return askFile(p, "fix");
    st.setNotice(t("noProblemsHere"));
    return false;
  }
  if (p && line) parts.push(`Stelle:\n\`\`\`\n${snippet(p, line)}\n\`\`\``);
  const { brainFixLine, brainReady, useBrain } = await import("./brain");
  if (hits.length && brainReady() && useBrain.getState().jobs.fixline) {
    const hint = await brainFixLine(hits);
    if (hint) parts.unshift(`Helfer-Hinweis (Fehlermeldungen unten sind maßgeblich): ${hint}`);
  }
  if (useIde.getState().workspaceEpoch !== st.workspaceEpoch || useIde.getState().lspProblems !== st.lspProblems) return false;
  return send(parts.join("\n\n"));
}
