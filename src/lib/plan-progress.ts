import type { PlanStep } from "@/store/ide";
import { applySetPlan, planFromTool, knowledgeStepMatches, mcpStepMatches, mcpPlanStatus } from "./plan.ts";
import { isTestFile } from "./test-parse.ts";
import { executedTestCommand, evidenceTargetKey, inputStamp, toolResultFailed, toolResultPending } from "./agent-evidence.ts";
import { TaskAcceptance, type AcceptanceSnapshot, type AcceptanceResult } from "../../electron/task-acceptance.mjs";

type Args = Record<string, unknown>;
type Evidence = { id: string; name: string; args: Args; result: Args; revision: number; inputStamp?: string; targetKey: string };
export type PlanProgressSnapshot = { version: 1; revision: number; inputStamp?: string; nextEvidenceId: number; plan: PlanStep[]; evidence: Evidence[]; acceptance?: AcceptanceSnapshot };
const kinds = new Set(["read", "edit", "run", "check", "service", "report"]);
const failed = (r: Args) => toolResultFailed(r) || Boolean(r.truncated || r.already_executed || r.pending);
const targetFields = ["path", "from", "to", "command", "name", "action", "engine", "projectRoot", "cmd", "server"];
const statusFields = ["ok", "error", "isError", "running", "pending", "truncated", "already_executed", "aborted", "timedOut", "interrupted", "cancelled", "canceled", "status", "code", "exitExpectationMatched"];
const SNAPSHOT_LIMIT = 256;

/** The model owns semantic attribution; Anvil requires an actual matching tool result.
 * This is bookkeeping evidence, not an independent correctness verdict. */
export class PlanProgress {
  plan: PlanStep[] = [];
  private evidence: Evidence[] = [];
  private revision = 0;
  private inputStamp?: string;
  private nextEvidenceId = 1;
  private acceptance = new TaskAcceptance();

  acceptanceResult(context?: { verification?: { state: string }; open?: boolean }) { return this.acceptance.result(context); }
  uncertainAcceptanceRecovery() { this.acceptance.uncertain(); }

  sync(plan: PlanStep[] | undefined) {
    this.plan = (plan || []).map(s => ({ ...s }));
    if (this.inputStamp) this.revalidateChecks();
  }

  setInputStamp(stamp: string): void {
    this.inputStamp = inputStamp(stamp);
    this.acceptance.setInputStamp(this.inputStamp || "");
    if (this.inputStamp) this.revalidateChecks();
  }

  private current(row: Evidence) { return this.inputStamp ? row.inputStamp === this.inputStamp : row.revision === this.revision; }

  private available(row: Evidence, kind?: PlanStep["kind"]) {
    return !failed(row.result) && !this.contradicted(row) && (!toolResultPending(row.result)
      || (kind === "run" && row.result.ok === true && row.result.running === true
        && (row.name === "run_file" || (row.name === "engine_run" && /^(editor|play)$/.test(String(row.args.action))))));
  }

  private matches(row: Evidence, step: PlanStep) {
    if (row.name === "mcp_call") return mcpStepMatches(step, row.args, true);
    const candidate = { ...step, status: "todo" as const };
    return (step.kind === "check" && row.name === "run_file" && row.result.ok === true && isTestFile(String(row.args.path || "")))
      || (step.kind === "check" && row.name === "shell" && row.result.ok === true && executedTestCommand(String(row.args.command || "")))
      || (step.kind === "check" && row.name === "play" && Boolean(row.result.image || row.result.frame))
      || planFromTool(row.name, [candidate], false, row.args, row.result)?.[0]?.status === "ok";
  }

  private revalidateChecks() {
    this.plan = this.plan.map(step => step.status === "ok" && (step.kind === "run" || step.kind === "check")
      && !this.evidence.some(row => this.current(row) && this.available(row, step.kind) && this.matches(row, step))
      ? { ...step, status: "todo" } : step);
  }

  record(name: string, args: Args, result: unknown, changed = false) {
    if (changed) this.revision++;
    if (/^(set_plan|select_tools|harness_|graph_|board_)/.test(name)) return;
    const raw = result && typeof result === "object" ? result as Args : {};
    const row = name === "mcp_call" ? mcpPlanStatus(raw, args) : raw;
    const target = Object.fromEntries(targetFields.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
    const status = Object.fromEntries(statusFields.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
    const targetJson = name === "mcp_call" ? JSON.stringify({ ...target, arguments: args.arguments ?? {} },
      (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value) : JSON.stringify(target);
    this.evidence.push({ id: `e${this.nextEvidenceId++}`, name, args: target, result: { ...status, image: Boolean(row.image || row.frame) }, revision: this.revision,
      inputStamp: this.inputStamp, targetKey: evidenceTargetKey(targetJson) });
    const id = this.evidence.at(-1)!.id;
    this.acceptance.record(name, raw, id, { failed: toolResultFailed(row), pending: failed(row) && !toolResultFailed(row) || toolResultPending(row), changed });
    return id;
  }

  private contradicted(row: Evidence) {
    const i = this.evidence.indexOf(row);
    // Old v1 snapshots did not fingerprint MCP arguments. Their exact target
    // cannot be recovered: retain the former conservative invalidation rule.
    const legacyMcp = row.name === "mcp_call" && row.targetKey === evidenceTargetKey(JSON.stringify(row.args));
    return this.evidence.slice(i + 1).some(e => e.name === row.name && (e.targetKey === row.targetKey
      || (legacyMcp && e.args.server === row.args.server && e.args.name === row.args.name))
      && (failed(e.result) || toolResultPending(e.result)));
  }

  set(args: Args, mayReplace = true): { ok?: boolean; error?: string; plan?: PlanStep[]; acceptance?: AcceptanceResult; checklist_context?: string; recovery?: string } {
    const nextAcceptance = new TaskAcceptance();
    nextAcceptance.restore(this.acceptance.snapshot());
    const criteria = args.criteria === undefined ? undefined : nextAcceptance.define(args.criteria, args.criteria_change_reason);
    const result = criteria?.error ? criteria : args.criteria !== undefined && args.steps === undefined && args.updates === undefined
      ? { ok: true, plan: this.plan } : this.apply(args, mayReplace);
    // A rejected amendment remains visible; an invalid plan cannot commit a new contract.
    if (!result.error || criteria?.error) this.acceptance = nextAcceptance;
    return result.error ? {
      ...result,
      acceptance: this.acceptance.result(),
      checklist_context: this.context(),
      recovery: "Use actual evidence IDs listed below or printed with tool results. Do not guess IDs or retry empty evidence. If no matching successful evidence exists, leave the step todo/err with the concrete blocker; do not repeat completed work just to update the checklist.",
    } : { ...result, acceptance: this.acceptance.result() };
  }

  private apply(args: Args, mayReplace: boolean): { ok?: boolean; error?: string; plan?: PlanStep[] } {
    if (args.updates !== undefined) {
      if (args.steps !== undefined) return { error: "Use either steps or updates, never both." };
      if (!this.plan.length) return { error: "No checklist yet. Create it with steps and kinds first." };
      if (!Array.isArray(args.updates) || !args.updates.length || args.updates.length > 10) return { error: "updates must contain 1–10 items." };
      const next = this.plan.map(s => ({ ...s }));
      const seen = new Set<number>();
      for (const value of args.updates) {
        if (!value || typeof value !== "object") return { error: "Invalid plan update." };
        const u = value as Args;
        const i = Number(u.step) - 1;
        if (!Number.isInteger(u.step) || i < 0 || i >= next.length || seen.has(i)) return { error: "step must be a unique existing 1-based checklist number." };
        seen.add(i);
        if (!["todo", "run", "ok", "err"].includes(String(u.status))) return { error: "Invalid status: use todo, run, ok or err." };
        if (typeof u.reason !== "string" || !u.reason.trim()) return { error: "Explain the actual result or remaining blocker in reason." };
        const kind = next[i].kind || u.kind;
        if (!kinds.has(String(kind))) return { error: "Supply a kind for this unclassified step: read, edit, run, check, service or report." };
        if (u.kind && next[i].kind && u.kind !== next[i].kind) return { error: "An existing step kind cannot be changed by a status update." };
        if (u.status === "ok") {
          const refs = Array.isArray(u.evidence) ? u.evidence : [];
          const rows = refs.map(id => this.evidence.find(e => e.id === id));
          if (!rows.length || rows.some(e => !e || !this.available(e, kind as PlanStep["kind"])))
            return { error: `Step ${i + 1}: ${!refs.length ? "No evidence IDs supplied." : "A supplied evidence ID is missing, failed, contradicted or still running."} Completion requires existing successful evidence IDs, without newer contradictory results. Running checks are not completed checks.` };
          const candidate: PlanStep = { ...next[i], kind: kind as PlanStep["kind"], status: "todo" };
          let staleMatch = false;
          const knowledgeMatch = knowledgeStepMatches(candidate, rows.map(e => e!.name));
          const matched = knowledgeMatch ?? rows.some(e => {
            if (!e) return false;
            // Executing a recognized test entry is a check, even when launched
            // through run_file instead of a shell/test command.
            // An actual captured interaction can evidence visual checking, a key press alone cannot.
            const matches = this.matches(e, candidate);
            if (matches && (kind === "check" || kind === "run") && !this.current(e)) { staleMatch = true; return false; }
            return matches;
          });
          if (!matched) return { error: `Step ${i + 1} (${kind}): ${kind === "report" ? "Report steps close with the final answer." : staleMatch ? "The matching run/check predates the latest change; verify the current files." : `Evidence from ${rows.map(e => e!.name).join(", ")} does not match the required actions in this step. Supply successful evidence for each named action; do not repeat completed work.`}` };
        }
        next[i] = { ...next[i], kind: kind as PlanStep["kind"], status: u.status as PlanStep["status"] };
      }
      this.plan = next;
      return { ok: true, plan: this.plan };
    }
    if (!Array.isArray(args.steps) || args.steps.some(s => typeof s !== "string")) return { error: "Create with steps and kinds, or update existing steps with updates." };
    const next = applySetPlan(this.plan, args.steps as string[], !mayReplace, Array.isArray(args.kinds) ? args.kinds : undefined);
    if (!next) return { error: "Checklist preserved. Use updates with its existing step numbers; do not replace a locked or started plan." };
    this.plan = next;
    return { ok: true, plan: this.plan };
  }

  hasOpenWork() { return this.plan.some(s => s.status !== "ok" && s.kind !== "report"); }

  context() {
    if (!this.plan.length) return "";
    const rows = this.plan.map((s, i) => `${i + 1}. [${s.status}] (${s.kind || "unclassified"}) ${s.text}`);
    // Retain an early successful example per tool as well as the tail. Otherwise
    // compaction plus many edits hides the initial read needed to reconcile step 1.
    const first = new Map<string, Evidence>();
    for (const e of this.evidence) if (!first.has(e.name) && !failed(e.result) && !this.contradicted(e)) first.set(e.name, e);
    const visible = [...new Set([...first.values()].slice(0, 25).concat(this.evidence.slice(-60)))];
    const evidence = visible.map(e => `${e.id}: ${e.name} ${String(e.args.path || e.args.command || e.args.name || e.args.action || "").slice(0, 160)} — ${failed(e.result) || this.contradicted(e) ? "failed/incomplete/superseded" : toolResultPending(e.result) ? "running" : "success"}${!this.current(e) ? " (before latest execution-input change; age blocks only run/check steps)" : ""}`);
    return `Current visible checklist (authoritative; keep its steps):\n${rows.join("\n")}\nUpdate individual steps with set_plan updates: step (1-based), kind, status, evidence (actual IDs listed below), reason (what the result establishes). Evidence IDs appear as plan_evidence_id in JSON results or as Plan evidence ID before text results; they are not API tool-call IDs. Never invent IDs or infer all tasks complete from one run. For unfinished/blocked steps use todo/err and explain why. Do not repeat completed edits just to fix the checklist.\nEvidence IDs from this request:\n${evidence.join("\n") || "None yet. Do not mark a step ok without evidence."}`;
  }

  snapshot(): PlanProgressSnapshot {
    const first = new Map<string, Evidence>();
    for (const row of this.evidence) if (!first.has(row.name) && this.available(row)) first.set(row.name, row);
    const retained = [...new Set([...first.values()].slice(0, 25).concat(this.evidence.slice(-(SNAPSHOT_LIMIT - 25))))].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const evidence = retained.map(row => {
      // A command's classification is sufficient to match check/run steps after
      // restart. Its arguments and any output stay out of the recovery record.
      const args = Object.fromEntries(targetFields.filter(key => key !== "command" && key !== "cmd" && typeof row.args[key] === "string")
        .map(key => [key, String(row.args[key]).slice(0, 400)]));
      if (row.args.command !== undefined) args.command = executedTestCommand(String(row.args.command)) ? "npm test" : "node";
      const result = Object.fromEntries(statusFields.filter(key => row.result[key] !== undefined && (key !== "code" || (typeof row.result[key] === "number" && Number.isFinite(row.result[key])))).map(key => [key,
        key === "status" ? (/^(?:failed|error|aborted|interrupted|cancelled|canceled|timed[_ -]?out|running|pending|queued|waiting)$/i.test(String(row.result[key])) ? String(row.result[key]) : "unknown")
          : key === "code" ? row.result[key] : key === "ok" ? row.result[key] === true : Boolean(row.result[key]) ]));
      result.image = Boolean(row.result.image);
      return { ...row, args, result };
    });
    return { version: 1, revision: this.revision, ...(this.inputStamp ? { inputStamp: this.inputStamp } : {}), nextEvidenceId: this.nextEvidenceId, plan: this.plan.slice(0, 10).map(step => ({ text: step.text.slice(0, 1000), status: step.status, ...(step.kind ? { kind: step.kind } : {}) })), evidence, acceptance: this.acceptance.snapshot() };
  }

  restore(snapshot: unknown): boolean {
    if (!snapshot || typeof snapshot !== "object") return false;
    const saved = snapshot as Args;
    const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
    if (saved.version !== 1 || !count(saved.revision) || !count(saved.nextEvidenceId) || saved.nextEvidenceId < 1
      || (saved.inputStamp !== undefined && !inputStamp(saved.inputStamp)) || !Array.isArray(saved.plan) || saved.plan.length > 10
      || !Array.isArray(saved.evidence) || saved.evidence.length > SNAPSHOT_LIMIT) return false;
    const plan: PlanStep[] = [];
    for (const value of saved.plan) {
      if (!value || typeof value !== "object") return false;
      const step = value as Args;
      if (typeof step.text !== "string" || !step.text.trim() || step.text.length > 1000 || !["todo", "run", "ok", "err"].includes(String(step.status)) || (step.kind !== undefined && !kinds.has(String(step.kind)))) return false;
      plan.push({ text: step.text, status: step.status as PlanStep["status"], ...(step.kind ? { kind: step.kind as PlanStep["kind"] } : {}) });
    }
    const evidence: Evidence[] = [];
    let previousId = 0;
    for (const value of saved.evidence) {
      if (!value || typeof value !== "object") return false;
      const row = value as Args;
      if (typeof row.id !== "string" || !/^e\d+$/.test(row.id) || !count(Number(row.id.slice(1))) || Number(row.id.slice(1)) <= previousId || Number(row.id.slice(1)) >= saved.nextEvidenceId
        || typeof row.name !== "string" || !/^[a-zA-Z][\w-]{0,79}$/.test(row.name) || typeof row.targetKey !== "string" || row.targetKey.length > 100
        || !count(row.revision) || row.revision > saved.revision || (row.inputStamp !== undefined && !inputStamp(row.inputStamp))
        || !row.args || typeof row.args !== "object" || Array.isArray(row.args) || !row.result || typeof row.result !== "object" || Array.isArray(row.result)) return false;
      const args = row.args as Args;
      const result = row.result as Args;
      if (Object.entries(args).some(([key, value]) => !targetFields.includes(key) || typeof value !== "string" || value.length > 400)
        || Object.entries(result).some(([key, value]) => ![...statusFields, "image"].includes(key) || (key === "status" ? typeof value !== "string" || value.length > 32 : key === "code" ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== "boolean"))) return false;
      previousId = Number(row.id.slice(1));
      evidence.push({ id: row.id, name: row.name, args: { ...args }, result: { ...result }, revision: row.revision, inputStamp: inputStamp(row.inputStamp), targetKey: row.targetKey });
    }
    const acceptance = new TaskAcceptance();
    if (saved.acceptance !== undefined && !acceptance.restore(saved.acceptance)) return false;
    // Legacy work may have already started: it must not acquire post-hoc criteria.
    if (saved.acceptance === undefined && evidence.length) acceptance.lock();
    this.acceptance = acceptance;
    this.revision = saved.revision;
    this.inputStamp = inputStamp(saved.inputStamp);
    this.nextEvidenceId = saved.nextEvidenceId;
    this.evidence = evidence;
    this.plan = plan;
    this.revalidateChecks();
    return true;
  }
}
