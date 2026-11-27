import { isTestFile, parseTestCommand } from "./test-parse.ts";
import { selectRunTarget } from "./run-target.ts";
import { summarizeTestRun, describeTestRun, validTestRunSummary, type TestRunSummary } from "./test-run-summary.ts";

type VerificationScope = "execution" | "tests" | "render" | "interaction";
export type Verification = { state: "none" | "passed" | "failed" | "stale"; detail: string; tests?: boolean; scope?: VerificationScope; limitations?: string[]; observedFailure?: boolean };

type Result = Record<string, unknown>;
const SNAPSHOT_LIMIT = 256;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const targetKey = (value: unknown): value is string => typeof value === "string" && value.length <= 80 && /^k\d+-[a-f\d]+-[a-f\d]+$/.test(value);

/** Only provenance identifiers, never access grants or replay decisions, use this key. */
export function evidenceTargetKey(value: string): string {
  let first = 2166136261;
  let second = 2246822507;
  for (let i = 0; i < value.length; i++) {
    first = Math.imul(first ^ value.charCodeAt(i), 16777619);
    second = Math.imul(second ^ value.charCodeAt(i), 3266489909);
  }
  return `k${value.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}

export function inputStamp(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && ![...value].some(char => char.charCodeAt(0) < 32) ? value : undefined;
}

export function toolResultFailed(result: Result): boolean {
  return Boolean(result.error || result.isError || result.ok === false || result.aborted || result.timedOut || result.interrupted || result.cancelled || result.canceled
    || /^(?:failed|error|aborted|interrupted|cancelled|canceled|timed[_ -]?out)$/i.test(String(result.status || ""))
    || (typeof result.code === "number" && result.code !== 0 && result.exitExpectationMatched !== true));
}

export function toolResultPending(result: Result): boolean {
  return Boolean(result.running || result.pending || /^(?:running|pending|queued|waiting)$/i.test(String(result.status || "")));
}

type RunEvidence = { revision: number; inputStamp?: string; ok: boolean; pending?: boolean; tests?: boolean; functionalChecks?: boolean; detail: string; scope?: VerificationScope; targetKey?: string; incidentalModule?: boolean; exitCode?: number; testSummary?: TestRunSummary };
export type AgentEvidenceSnapshot = {
  version: 1;
  revision: number;
  inputStamp?: string;
  previewTarget?: string;
  unconfirmedActions?: string[];
  incompleteHistory?: boolean;
  invalidCalls: [string, string][];
  writes: [string, string][];
  runs: [string, RunEvidence][];
};

/** Render once from current evidence; keep the model's text separate from status chrome. */
export function verifiedReply(reply: string, verification?: Verification, includeSuccess = false): string {
  if (verification?.state === "failed" && verification.observedFailure) return `${reply}\n\nFehler beobachtet; die Ausführung blieb fehlgeschlagen.\n${verification.detail}`;
  if (verification?.state === "failed" || verification?.state === "stale") {
    return `${verification.state === "failed" ? "Nicht abgeschlossen" : "Noch nicht bestätigt"}: ${verification.detail}\n\nModellantwort:\n${reply}`;
  }
  if (verification?.limitations?.length) return `${reply}\n\nPrüfumfang: ${verification.detail}\nNicht geprüft: ${verification.limitations.join(" ")}`;
  return (includeSuccess || verification?.tests === true) && verification?.state === "passed" ? `${reply}\n\n${verification.detail}` : reply;
}

function executesProject(command: string): boolean {
  const first = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*([\s\S]*)$/.exec(command);
  if (!first) return false;
  const program = (first[1] || first[2] || first[3]).split(/[/\\]/).pop()!.replace(/\.exe$/i, "");
  const args = first[4].trim();
  if (!/^(pytest|tsc|javac|gcc|clang|cargo|go|dotnet|zig|python\d*(?:\.\d+)?|node|npm|npx|pnpm|yarn)$/i.test(program)) return false;
  if (!args) return /^(pytest|tsc)$/i.test(program);
  if (/(?:^|\s)(?:--version|-version|--help|--showConfig|-V{1,2}|-h)(?:\s|$)/.test(args)) return false;
  if (/^(node|python\d*(?:\.\d+)?|npm|npx|pnpm|yarn)$/i.test(program) && /(?:^|\s)-v(?:\s|$)/.test(args)) return false;
  if (/^(npm|pnpm|yarn)$/i.test(program)) return /^(?:run(?:-script)?|test|exec|build)\b/.test(args);
  if (/^(cargo|go|dotnet|zig)$/i.test(program)) return /^(?:test|build|run|check|clippy|cc|c\+\+)(?:\s|$)/.test(args);
  return true;
}

export function executedTestCommand(command: string): boolean {
  if (parseTestCommand(command)) return true;
  const first = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*([\s\S]*)$/.exec(command);
  if (!first || !/^node(?:\.exe)?$/i.test((first[1] || first[2] || first[3]).split(/[/\\]/).pop()!)) return false;
  for (const token of first[4].trim().split(/\s+/)) {
    if (!token.startsWith("--")) return false;
    if (token === "--test" || token.startsWith("--test=")) return true;
  }
  return false;
}

export function automaticRunVerification(previous: Verification | undefined, ok: boolean, current: boolean): Verification {
  const run: Verification = !ok
    ? { state: "failed", detail: "Automatischer Run nach der letzten Änderung fehlgeschlagen." }
    : !current
      ? { state: "stale", detail: "Dateien während des automatischen Runs geändert. Aktueller Stand noch nicht bestätigt." }
      : { state: "passed", detail: "Automatischer Run nach der letzten Änderung erfolgreich." };
  if (previous?.state === "failed") return { state: "failed", detail: `${previous.detail}\n${run.detail}` };
  if (previous?.state === "passed" && ok && current) return { ...previous, detail: `${previous.detail}\n${run.detail}` };
  return run;
}

/** Only a successful execution of the same target can replace its failure. Edits invalidate prior runs. */
export class AgentEvidence {
  revision = 0;
  private inputStamp?: string;
  private incompleteHistory = false;
  private previewTarget?: string;
  private unconfirmedActions = new Set<string>();
  private invalidCalls = new Map<string, string>();
  private writes = new Map<string, string>();
  private runs = new Map<string, RunEvidence>();
  // Freshness is local to this invocation. Restored proofs remain useful, but
  // must never be described as new actions performed after a resume.
  private freshRuns = new Set<string>();
  setInputStamp(stamp: string): void { this.inputStamp = inputStamp(stamp); }
  changed() { this.revision++; }
  private current(run: RunEvidence) { return this.inputStamp ? run.inputStamp === this.inputStamp : run.revision === this.revision; }
  private htmlTarget(files: Record<string, string>) {
    const paths = Object.keys(files).filter(path => /\.html?$/i.test(path));
    return paths.find(path => evidenceTargetKey(path.replaceAll("\\", "/")) === this.previewTarget) || selectRunTarget(paths);
  }
  private rendered(targetKey: string) { return [...this.runs.values()].some(run => run.ok && !run.pending && this.current(run) && run.scope === "render" && run.targetKey === targetKey); }
  /** A suggested next check, never a manual approval or a claim of complete coverage. */
  interactionNeeded(files: Record<string, string>): string | undefined {
    const path = this.htmlTarget(files);
    if (!path || !/<(?:script|canvas|button|input|select|textarea|form)\b|\bon(?:click|key\w+|submit|change|input)\s*=/i.test(files[path])) return;
    const key = evidenceTargetKey(path.replaceAll("\\", "/"));
    if (!this.rendered(key)) return `HTML-Anwendung ${path} mit run_file starten; ein Modulaufruf bestätigt ihre Oberfläche nicht. Danach die geänderte Funktion gezielt prüfen.`;
    if (![...this.runs.values()].some(run => run.ok && !run.pending && this.current(run) && run.scope === "interaction" && run.targetKey === key)) return `In ${path} fehlt eine gezielte Funktionsprüfung. Mit play passende Tasten, Klicks oder Texteingaben ausführen und die erwartete Wirkung mit actions/type:assert prüfen. DOM-Selektoren und Werte stehen in run_file/see_run. Für Programmlogik passende Tests ausführen; nicht erreichbare Funktionen ausdrücklich als ungeprüft benennen.`;
  }
  /** The caller still decides whether observing a negative case was explicitly requested. */
  canObserveFailure(): boolean {
    if (this.invalidCalls.size || this.writes.size || this.incompleteHistory || this.unconfirmedActions.size) return false;
    const runs = [...this.runs.values()];
    const failures = runs.filter(run => !run.ok);
    return failures.length > 0 && !runs.some(run => run.pending) && failures.every(run => this.current(run) && Number.isSafeInteger(run.exitCode) && run.exitCode !== 0);
  }
  invalid(name: string, detail: string) { this.invalidCalls.set(name, `${name}: ${detail}`); }
  record(name: string, args: Record<string, unknown>, result: Record<string, unknown>) {
    // A command rejected before process start is a tool diagnostic, not an
    // execution result. It cannot replace either passing or failing run proof.
    if (/^(shell|play|write_file|edit_file|append_file|delete_file|rename|mkdir|format_file)$/.test(name) && result.rejected === true && result.definitelyNotExecuted === true) return;
    const failed = toolResultFailed(result);
    // A suppressed replay delivers no new evidence and cannot invalidate a prior result.
    if (!failed && result.ok === true && result.already_executed === true) return;
    const incomplete = toolResultPending(result) || Boolean(result.truncated || result.already_executed);
    if (!/^(run_file|engine_run|shell)$/.test(name)) {
      if (failed || incomplete) this.unconfirmedActions.add(name.slice(0, 80));
      else this.unconfirmedActions.delete(name.slice(0, 80));
    }
    if (!failed && !incomplete) this.invalidCalls.delete(name);
    if (/^(write_file|edit_file|append_file|delete_file|rename_file|rename|move_file|format_file|mkdir)$/.test(name)) {
      const path = String(args.path ?? args.from ?? name);
      const key = evidenceTargetKey(path);
      if (failed || incomplete) this.writes.set(key, `${path}: ${String(result.error || "Dateiänderung nicht abgeschlossen").slice(0, 1000)}`);
      else this.writes.delete(key);
    }
    if (/^(memory_add|memory_forget|skill_write|skill_patch|skill_outcome)$/.test(name)) {
      // A partial or rejected knowledge save is an unfinished requested action,
      // independently of unchanged source-code verification. Only a confirmed
      // correction of that resource can clear it; another successful save cannot.
      const target = name === "memory_add"
        ? [name, args.kind || "lesson", args.scope || "", args.id || args.text || ""]
        : name === "memory_forget"
          ? [name, args.id || args.text || ""]
          : [name === "skill_outcome" ? name : "skill_save", args.scope || "project", args.name || args.id || "active", name === "skill_outcome" ? args.kind || "ok" : ""];
      const key = `knowledge:${evidenceTargetKey(JSON.stringify(target))}`;
      if (failed || incomplete || result.ok !== true) this.writes.set(key, `${name}${args.name ? ` ${String(args.name).slice(0, 200)}` : ""}: ${String(result.error || "Wissensänderung nicht vollständig bestätigt").slice(0, 1000)}`);
      else this.writes.delete(key);
    }
    if (name === "play" || name === "see_run") {
      const key = this.previewTarget;
      if (!key || !this.rendered(key)) return;
      if (name === "see_run") return; // Another frame is still rendering, not an interaction.
      const keys = Array.isArray(args.keys) ? args.keys.map(String).filter(key => key === " " || key.trim()) : String(args.keys || "").split(/[,\s]+/).filter(Boolean);
      const actions=Array.isArray(args.actions)?args.actions.filter(a=>a && typeof a==='object' && ['key','click','move','drag','scroll','type','assert'].includes(String((a as Record<string,unknown>).type))):[];
      const observed = Boolean(result.image || result.frame || result.observation || result.state && typeof result.state === "object");
      if (!keys.length && !actions.length || !failed && !observed) return;
      this.runs.set(`interaction:${key}`, { revision: this.revision, inputStamp: this.inputStamp, targetKey: key, scope: "interaction", pending: incomplete, tests: false, functionalChecks:result.functionalChecks===true, ok: result.ok === true && !failed,
        detail: failed ? String(result.error || result.stderr || "Interaktion fehlgeschlagen.").slice(0, 1000) : result.functionalChecks===true ? "Angegebene Vorschauerwartungen geprüft; dies bestätigt nur die ausgeführten Testfälle." : "Vorschaueingabe zugestellt und anschließenden Zustand beobachtet; keine automatische Funktionsbestätigung." });
      this.freshRuns.add(`interaction:${key}`);
      return;
    }
    if (!/^(run_file|engine_run|shell)$/.test(name)) return;
    if (name === "shell" && !executesProject(String(args.command ?? ""))) return;
    if (name === "engine_run" && /(?:^|\s)(?:--version|--help|-h)(?:\s|$)/i.test(String(args.cmd ?? ""))) return;
    const target = name === "engine_run"
      ? `${String(result.engineId || args.engine || result.engine || "engine").toLowerCase()}:${result.projectRoot ?? args.projectRoot ?? ""}:${args.cmd || args.action || "check"}`
      : String(args.path ?? args.command ?? args.project ?? name);
    const key = `${name}:${evidenceTargetKey(target)}`;
    const pending = !failed && (incomplete || (name === "engine_run" && args.action === "editor"));
    // An asserted negative case proves its exit path, not the current build.
    // Keep failures visible; don't let a passing negative case certify a project.
    if (name === "shell" && typeof args.expected_exit_code === "number" && args.expected_exit_code > 0 && result.expectedExitCode === args.expected_exit_code && result.code === args.expected_exit_code && result.exitExpectationMatched === true && result.ok === true && !failed && !incomplete) {
      this.runs.delete(key);
      return;
    }
    const tests = (name === "run_file" && isTestFile(String(args.path || "")))
      || (name === "shell" && executedTestCommand(String(args.command || "")))
      || (name === "engine_run" && args.action === "test");
    const html = name === "run_file" && /\.html?$/i.test(String(args.path || ""));
    const testSummary = tests && !incomplete ? summarizeTestRun(result.stdout, result.stderr) : undefined;
    const reportedFailure = Boolean(testSummary?.tests?.failed || testSummary?.tests?.cancelled || testSummary?.checks?.failed);
    const targetKey = html ? evidenceTargetKey(String(args.path).replaceAll("\\", "/")) : undefined;
    if (html) this.previewTarget = targetKey;
    const interrupted = result.aborted || result.timedOut || result.interrupted || result.cancelled || result.canceled || result.signal || /abort|cancel|timed.?out|interrupted/i.test(String(result.status || ""));
    const concreteExit = !incomplete && !interrupted && !result.error && !result.isError && Number.isSafeInteger(result.code) && result.code !== 0;
    this.runs.set(key, { revision: this.revision, inputStamp: this.inputStamp, pending: pending || Boolean(incomplete), tests, scope: html ? "render" : tests ? "tests" : "execution", targetKey,
      ...(testSummary ? { testSummary } : {}),
      incidentalModule: name === "run_file" && !tests && /\.(?:[cm]?js|jsx|ts|tsx)$/i.test(String(args.path || "")), exitCode: concreteExit ? result.code as number : undefined, ok: result.ok === true && !failed && !reportedFailure,
      detail: `${target}: ${pending ? "Gestartet; keine abgeschlossene Prüfung." : reportedFailure ? describeTestRun(testSummary) : String(result.error || result.stderr || (result.ok === true && !failed ? "Run erfolgreich" : "Run nicht erfolgreich bestätigt")).slice(0, 1000)}` });
    this.freshRuns.add(key);
  }
  private summary(files?: Record<string, string>): string {
    const labels = new Map<string, string>();
    for (const path of Object.keys(files || {})) {
      // Source paths are available in the current workspace. Never persist a
      // command, a credential-bearing argument or raw output as a label.
      const label = [...path].map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char).join("").slice(0, 200);
      labels.set(`run_file:${evidenceTargetKey(path)}`, label);
      labels.set(`interaction:${evidenceTargetKey(path.replaceAll("\\", "/"))}`, label);
    }
    const rows = [...this.runs].filter(([, run]) => run.ok && !run.pending && this.current(run));
    const rank = (run: RunEvidence) => run.tests ? 0 : run.scope === "render" ? 1 : run.scope === "interaction" ? 2 : 3;
    const parts: string[] = [];
    for (const fresh of [true, false]) {
      const group = rows.filter(([key]) => this.freshRuns.has(key) === fresh).sort((a, b) => rank(a[1]) - rank(b[1]));
      if (!group.length) continue;
      const descriptions = group.slice(0, 12).map(([key, run]) => {
        const label = labels.get(key) || (run.tests ? "Automatisierte Testausführung" : run.scope === "render" ? "HTML-Vorschau" : run.scope === "interaction" ? "Vorschau" : "Programmausführung");
        const detail = run.tests ? describeTestRun(run.testSummary) : run.scope === "render" ? "Oberfläche geladen; Lade- und Konsolenprüfung erfolgreich" : run.scope === "interaction" ? run.functionalChecks===true ? "angegebene Vorschauerwartungen nach der Bedienung geprüft; bestätigt nur die ausgeführten Fälle" : "Vorschaueingabe zugestellt und anschließenden Zustand beobachtet" : "ohne gemeldeten Ausführungsfehler beendet";
        return label + ": " + detail;
      });
      if (group.length > 12) descriptions.push(`${group.length - 12} weitere bestätigte Ausführungen`);
      parts.push((fresh ? "Aktuell geprüft: " : "Übernommene Nachweise für denselben Dateistand: ") + descriptions.join("; "));
    }
    return parts.join("\n");
  }
  status(files?: Record<string, string>): Verification {
    if (this.invalidCalls.size) return { state: "failed", detail: [...this.invalidCalls.values(), ...this.writes.values()].join("\n") };
    if (this.writes.size) return { state: "failed", detail: [...this.writes.values()].join("\n") };
    if (this.incompleteHistory) return { state: "stale", detail: "Gesicherte Prüfnachweise sind unvollständig. Aktueller Stand muss nach Wiederaufnahme erneut vollständig geprüft werden." };
    const runs = [...this.runs.values()];
    const failed = runs.filter((r) => !r.ok);
    if (failed.length) return { state: "failed", detail: failed.map((r) => r.detail).join("\n") };
    if (!runs.length) return { state: "none", detail: "Kein bestätigter Run." };
    const completed = runs.filter((r) => !r.pending);
    if (!completed.length) return { state: "none", detail: runs.map((r) => r.detail).join("\n") };
    const path = files ? this.htmlTarget(files) : undefined;
    const currentHtml = Boolean(path && this.rendered(evidenceTargetKey(path.replaceAll("\\", "/"))));
    if (completed.some(run => !this.current(run) && !(currentHtml && run.incidentalModule))) return { state: "stale", detail: "Ausführungseingaben nach der letzten Prüfung geändert. Aktueller Stand noch nicht durch Run bestätigt." };
    const tests = completed.some(run => run.tests && this.current(run));
    if (path) {
      const key = evidenceTargetKey(path.replaceAll("\\", "/"));
      const rendered = this.rendered(key);
      const interacted = rendered && completed.some(run => run.scope === "interaction" && run.targetKey === key);
      const scope: VerificationScope = interacted ? "interaction" : rendered ? "render" : tests ? "tests" : "execution";
      const limitations = interacted
        ? ["Weitere Funktionen und der vollständige Ablauf sind dadurch nicht bestätigt."]
        : rendered
          ? ["Interaktionen und die Wirkung der Funktionen sind durch das Laden der Oberfläche nicht bestätigt."]
          : ["Die HTML-Anwendung wurde mit dem aktuellen Dateistand nicht geladen. Ein erfolgreicher Modul- oder Konsolenaufruf bestätigt ihre Funktionen nicht."];
      return { state: "passed", scope, tests, detail: this.summary(files), limitations };
    }
    return { state: "passed", detail: this.summary(files), tests, scope: tests ? "tests" : "execution" };
  }

  /** A small local recovery record: no commands, source bodies, output or credentials. */
  snapshot(): AgentEvidenceSnapshot {
    return {
      version: 1, revision: this.revision, ...(this.inputStamp ? { inputStamp: this.inputStamp } : {}),
      ...(this.previewTarget ? { previewTarget: this.previewTarget } : {}),
      ...(this.unconfirmedActions.size ? { unconfirmedActions: [...this.unconfirmedActions].slice(-SNAPSHOT_LIMIT) } : {}),
      incompleteHistory: this.incompleteHistory || this.invalidCalls.size > SNAPSHOT_LIMIT || this.writes.size > SNAPSHOT_LIMIT || this.runs.size > SNAPSHOT_LIMIT || this.unconfirmedActions.size > SNAPSHOT_LIMIT,
      invalidCalls: [...this.invalidCalls].slice(-SNAPSHOT_LIMIT).map(([name]) => [name, `${name}: Aufruf noch nicht bestätigt.`]),
      writes: [...this.writes].slice(-SNAPSHOT_LIMIT).map(([key]) => [key, "Dateiänderung noch nicht bestätigt."]),
      runs: [...this.runs].slice(-SNAPSHOT_LIMIT).map(([key, run]) => [key, { ...run, detail: run.ok ? (run.pending ? "Ausführung noch nicht abgeschlossen." : "Ausführung erfolgreich.") : "Ausführung fehlgeschlagen; Fehlerdetails erneut prüfen." }]),
    };
  }

  restore(snapshot: unknown): boolean {
    if (!snapshot || typeof snapshot !== "object") return false;
    const saved = snapshot as Record<string, unknown>;
    if (saved.version !== 1 || !count(saved.revision) || (saved.inputStamp !== undefined && !inputStamp(saved.inputStamp))
      || (saved.previewTarget !== undefined && !targetKey(saved.previewTarget))
      || (saved.unconfirmedActions !== undefined && (!Array.isArray(saved.unconfirmedActions) || saved.unconfirmedActions.length > SNAPSHOT_LIMIT || saved.unconfirmedActions.some(name => typeof name !== "string" || name.length > 80)))
      || (saved.incompleteHistory !== undefined && typeof saved.incompleteHistory !== "boolean")) return false;
    const pairs = (value: unknown): value is [string, string][] => Array.isArray(value) && value.length <= SNAPSHOT_LIMIT
      && value.every(row => Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && row[0].length <= 200 && typeof row[1] === "string" && row[1].length <= 1200)
      && new Set(value.map(row => row[0])).size === value.length;
    if (!pairs(saved.invalidCalls) || !pairs(saved.writes) || !Array.isArray(saved.runs) || saved.runs.length > SNAPSHOT_LIMIT) return false;
    const runs = new Map<string, RunEvidence>();
    for (const row of saved.runs) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || row[0].length > 200 || runs.has(row[0]) || !row[1] || typeof row[1] !== "object") return false;
      const run = row[1] as Result;
      if (!count(run.revision) || run.revision > saved.revision || typeof run.ok !== "boolean" || typeof run.detail !== "string" || run.detail.length > 1200
        || (run.scope !== undefined && !["execution", "tests", "render", "interaction"].includes(String(run.scope)))
        || (run.targetKey !== undefined && !targetKey(run.targetKey))
        || (run.incidentalModule !== undefined && typeof run.incidentalModule !== "boolean")
        || (run.functionalChecks !== undefined && typeof run.functionalChecks !== 'boolean')
        || (run.exitCode !== undefined && (!Number.isSafeInteger(run.exitCode) || run.exitCode === 0))
        || (run.testSummary !== undefined && !validTestRunSummary(run.testSummary))
        || (run.inputStamp !== undefined && !inputStamp(run.inputStamp)) || (run.pending !== undefined && typeof run.pending !== "boolean") || (run.tests !== undefined && typeof run.tests !== "boolean")) return false;
      runs.set(row[0], { revision: run.revision, ok: run.ok, detail: run.detail, inputStamp: inputStamp(run.inputStamp), pending: run.pending as boolean | undefined, tests: run.tests as boolean | undefined, functionalChecks:run.functionalChecks as boolean|undefined, scope: run.scope as VerificationScope | undefined, targetKey: run.targetKey as string | undefined, incidentalModule: run.incidentalModule as boolean | undefined, exitCode: run.exitCode as number | undefined, ...(run.testSummary ? { testSummary: structuredClone(run.testSummary as TestRunSummary) } : {}) });
    }
    this.revision = saved.revision;
    this.inputStamp = inputStamp(saved.inputStamp);
    this.previewTarget = saved.previewTarget as string | undefined;
    this.unconfirmedActions = new Set(saved.unconfirmedActions as string[] | undefined);
    this.incompleteHistory = saved.incompleteHistory === true;
    this.invalidCalls = new Map(saved.invalidCalls);
    this.writes = new Map(saved.writes);
    this.runs = runs;
    this.freshRuns.clear();
    return true;
  }
}
