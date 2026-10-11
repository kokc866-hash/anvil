import { isTestFile, parseTestCommand } from "./test-parse.ts";

export type Verification = { state: "none" | "passed" | "failed" | "stale"; detail: string; tests?: boolean };

type Result = Record<string, unknown>;
const SNAPSHOT_LIMIT = 256;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

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

type RunEvidence = { revision: number; inputStamp?: string; ok: boolean; pending?: boolean; tests?: boolean; detail: string };
export type AgentEvidenceSnapshot = {
  version: 1;
  revision: number;
  inputStamp?: string;
  incompleteHistory?: boolean;
  invalidCalls: [string, string][];
  writes: [string, string][];
  runs: [string, RunEvidence][];
};

/** Render once from current evidence; keep the model's text separate from status chrome. */
export function verifiedReply(reply: string, verification?: Verification, includeSuccess = false): string {
  if (verification?.state === "failed" || verification?.state === "stale") {
    return `${verification.state === "failed" ? "Nicht abgeschlossen" : "Noch nicht bestätigt"}: ${verification.detail}\n\nModellantwort:\n${reply}`;
  }
  return includeSuccess && verification?.state === "passed" ? `${reply}\n\n${verification.detail}` : reply;
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
  return run;
}

/** Only a successful execution of the same target can replace its failure. Edits invalidate prior runs. */
export class AgentEvidence {
  revision = 0;
  private inputStamp?: string;
  private incompleteHistory = false;
  private invalidCalls = new Map<string, string>();
  private writes = new Map<string, string>();
  private runs = new Map<string, RunEvidence>();
  setInputStamp(stamp: string): void { this.inputStamp = inputStamp(stamp); }
  changed() { this.revision++; }
  invalid(name: string, detail: string) { this.invalidCalls.set(name, `${name}: ${detail}`); }
  record(name: string, args: Record<string, unknown>, result: Record<string, unknown>) {
    const failed = toolResultFailed(result);
    const incomplete = toolResultPending(result) || Boolean(result.truncated || result.already_executed);
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
    this.runs.set(key, { revision: this.revision, inputStamp: this.inputStamp, pending, tests, ok: result.ok === true && !failed,
      detail: `${target}: ${pending ? "Gestartet; keine abgeschlossene Prüfung." : String(result.error || result.stderr || (result.ok === true && !failed ? "Run erfolgreich" : "Run nicht erfolgreich bestätigt")).slice(0, 1000)}` });
  }
  status(): Verification {
    if (this.invalidCalls.size) return { state: "failed", detail: [...this.invalidCalls.values(), ...this.writes.values()].join("\n") };
    if (this.writes.size) return { state: "failed", detail: [...this.writes.values()].join("\n") };
    if (this.incompleteHistory) return { state: "stale", detail: "Gesicherte Prüfnachweise sind unvollständig. Aktueller Stand muss nach Wiederaufnahme erneut vollständig geprüft werden." };
    const runs = [...this.runs.values()];
    const failed = runs.filter((r) => !r.ok);
    if (failed.length) return { state: "failed", detail: failed.map((r) => r.detail).join("\n") };
    if (!runs.length) return { state: "none", detail: "Kein bestätigter Run." };
    const completed = runs.filter((r) => !r.pending);
    if (!completed.length) return { state: "none", detail: runs.map((r) => r.detail).join("\n") };
    if (completed.some((r) => this.inputStamp ? r.inputStamp !== this.inputStamp : r.revision !== this.revision)) return { state: "stale", detail: "Ausführungseingaben nach der letzten Prüfung geändert. Aktueller Stand noch nicht durch Run bestätigt." };
    return { state: "passed", detail: "Run für die aktuellen Ausführungseingaben erfolgreich.", tests: completed.some(r => r.tests) };
  }

  /** A small local recovery record: no commands, source bodies, output or credentials. */
  snapshot(): AgentEvidenceSnapshot {
    return {
      version: 1, revision: this.revision, ...(this.inputStamp ? { inputStamp: this.inputStamp } : {}),
      incompleteHistory: this.incompleteHistory || this.invalidCalls.size > SNAPSHOT_LIMIT || this.writes.size > SNAPSHOT_LIMIT || this.runs.size > SNAPSHOT_LIMIT,
      invalidCalls: [...this.invalidCalls].slice(-SNAPSHOT_LIMIT).map(([name]) => [name, `${name}: Aufruf noch nicht bestätigt.`]),
      writes: [...this.writes].slice(-SNAPSHOT_LIMIT).map(([key]) => [key, "Dateiänderung noch nicht bestätigt."]),
      runs: [...this.runs].slice(-SNAPSHOT_LIMIT).map(([key, run]) => [key, { ...run, detail: run.ok ? (run.pending ? "Ausführung noch nicht abgeschlossen." : "Ausführung erfolgreich.") : "Ausführung fehlgeschlagen; Fehlerdetails erneut prüfen." }]),
    };
  }

  restore(snapshot: unknown): boolean {
    if (!snapshot || typeof snapshot !== "object") return false;
    const saved = snapshot as Record<string, unknown>;
    if (saved.version !== 1 || !count(saved.revision) || (saved.inputStamp !== undefined && !inputStamp(saved.inputStamp))
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
        || (run.inputStamp !== undefined && !inputStamp(run.inputStamp)) || (run.pending !== undefined && typeof run.pending !== "boolean") || (run.tests !== undefined && typeof run.tests !== "boolean")) return false;
      runs.set(row[0], { revision: run.revision, ok: run.ok, detail: run.detail, inputStamp: inputStamp(run.inputStamp), pending: run.pending as boolean | undefined, tests: run.tests as boolean | undefined });
    }
    this.revision = saved.revision;
    this.inputStamp = inputStamp(saved.inputStamp);
    this.incompleteHistory = saved.incompleteHistory === true;
    this.invalidCalls = new Map(saved.invalidCalls);
    this.writes = new Map(saved.writes);
    this.runs = runs;
    return true;
  }
}
