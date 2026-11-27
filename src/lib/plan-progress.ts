import type { PlanStep } from "@/store/ide";
import { applySetPlan, planFromTool, knowledgeStepMatches, mcpStepMatches, mcpPlanStatus } from "./plan.ts";
import { isTestFile } from "./test-parse.ts";
import { executedTestCommand, evidenceTargetKey, inputStamp, toolResultFailed, toolResultPending } from "./agent-evidence.ts";
import { isResponseOnlyStep, planDiskRequirements, planFileRequirements, planFileReceiptMatches, planFileTargets, planOperationPaths, planRequiredKinds, planTargetMatches, workspaceFileOperation } from "./plan-targets.ts";
import { validWorkflowSnapshot } from "../../electron/workflow-validation.mjs";
import { MAX_PLAN_STEPS } from './plan-limits.ts';
import { withPlanStatus } from './plan-status.ts';
import type { WorkflowSnapshot } from "./agent-workflow.ts";
import { previewInteractionRequest,previewObservationRequest,previewObservationEvidence } from './preview-task.ts';
import { previewMissingSelector, previewProof, previewStepCovered, validPreviewProof, validPreviewFingerprint, type PreviewProof } from './plan-preview-proof.ts';
import { validWorkspaceFileProof, type WorkspaceFileProof, type VerifyWorkspaceFile } from "./workspace-file-proof.ts";

type Args = Record<string, unknown>;
type Evidence = { id: string; name: string; args: Args; result: Args; revision: number; inputStamp?: string; targetKey: string; preview?: PreviewProof[]; previewLaunch?: string; missingTarget?: string; fileProof?: WorkspaceFileProof };
type PlanUpdateResult = { ok?: boolean; error?: string; plan?: PlanStep[]; applied_steps?: number[]; rejected_updates?: { step: number; error: string }[] };
type McpCompletion = { step: number; stepKey: string; evidenceIds: string[] };
export type PlanProgressSnapshot = { version: 1; revision: number; inputStamp?: string; nextEvidenceId: number; plan: PlanStep[]; evidence: Evidence[]; mcpCompletions?: McpCompletion[] };
const kinds = new Set(["read", "edit", "run", "check", "service", "report"]);
const failed = (r: Args) => toolResultFailed(r) || Boolean(r.truncated || r.already_executed || r.pending);
const targetFields = ["path", "from", "to", "command", "name", "action", "engine", "projectRoot", "cmd", "server"];
const statusFields = ["ok", "error", "isError", "running", "pending", "truncated", "already_executed", "aborted", "timedOut", "interrupted", "cancelled", "canceled", "status", "code", "exitExpectationMatched", "functionalChecks", "rejected", "definitelyNotExecuted"];
const SNAPSHOT_LIMIT = 256;
const stepKey = (step: PlanStep) => evidenceTargetKey(JSON.stringify([step.text, step.kind]));
const projectHtml = (value: unknown): value is string => typeof value === "string" && value.length <= 400
  && /\.html?$/i.test(value) && !value.startsWith("/") && !value.startsWith("\\") && !value.includes(":")
  && ![...value].some(char => char.charCodeAt(0) < 32)
  && !value.split(/[/\\]/).some(part => part === "..");

function suggestedKind(step: PlanStep): PlanStep["kind"] {
  const required = planRequiredKinds(step);
  if (previewMissingSelector(step.text) || previewInteractionRequest(step.text) && required.every(kind => kind === "check" || kind === "run")) return "check";
  return required.length === 1 ? required[0] : undefined;
}

/** The model owns semantic attribution; Anvil requires an actual matching tool result.
 * This is bookkeeping evidence, not an independent correctness verdict. */
export class PlanProgress {
  plan: PlanStep[] = [];
  private evidence: Evidence[] = [];
  private mcpCompletions = new Map<number, McpCompletion>();
  private revision = 0;
  private inputStamp?: string;
  private nextEvidenceId = 1;
  sync(plan: PlanStep[] | undefined) {
    this.plan = (plan || []).map(s => ({ ...s }));
    for (const [index, completion] of this.mcpCompletions) {
      const step = this.plan[index];
      if (!step || step.completedBy === "user" || stepKey(step) !== completion.stepKey) this.mcpCompletions.delete(index);
    }
    if (this.inputStamp || this.evidence.length || this.mcpCompletions.size || this.plan.some(step => step.status === "ok" && planFileTargets(step.text).length)) this.revalidateChecks();
  }

  setInputStamp(stamp: string): void {
    this.inputStamp = inputStamp(stamp);
    if (this.inputStamp) this.revalidateChecks();
  }

  private current(row: Evidence) { return Boolean(row.fileProof) || (this.inputStamp ? row.inputStamp === this.inputStamp : row.revision === this.revision); }

  private available(row: Evidence, kind?: PlanStep["kind"]) {
    if (row.name === "verify_file" && !row.fileProof) return false;
    if (/^(write_file|edit_file|append_file|delete_file|rename|mkdir|format_file)$/.test(row.name) && row.result.ok !== true) return false;
    return !failed(row.result) && !this.conflictingReceipt(row) && (!toolResultPending(row.result)
      || (kind === "run" && row.result.ok === true && row.result.running === true
        && (row.name === "run_file" || (row.name === "engine_run" && /^(editor|play)$/.test(String(row.args.action))))));
  }

  private confirmsMissing(row: Evidence, step: PlanStep) {
    const selector = step.kind === "check" ? previewMissingSelector(step.text) : undefined;
    return selector !== undefined && row.name === "play" && row.missingTarget === evidenceTargetKey(selector)
      && row.result.rejected === true && row.result.definitelyNotExecuted === true && this.current(row);
  }

  private receipts(step: PlanStep) {
    return this.evidence.filter(row => this.available(row, step.kind) || this.confirmsMissing(row, step));
  }

  private selectedMcpReceipts(completion: McpCompletion, kind: PlanStep["kind"]): Evidence[] | undefined {
    const rows = completion.evidenceIds.map(id => this.evidence.find(row => row.id === id));
    if (!rows.length || rows.some(row => !row || !this.available(row, kind))) return undefined;
    return rows as Evidence[];
  }

  private matches(row: Evidence, step: PlanStep) {
    if (row.name === "verify_file") return step.kind === "check" && Boolean(row.fileProof)
      && planDiskRequirements(step).some(requirement => planTargetMatches(requirement.path, String(row.args.path)));
    const observation=row.name==='see_run'||row.name==='run_file'&&/\.html?$/i.test(String(row.args.path||''));
    if(step.kind==='check'&&observation&&!previewObservationEvidence(step.text,Boolean(row.result.image)))return false;
    if (step.kind === 'check' && row.name === 'play') return row.result.functionalChecks === true || this.confirmsMissing(row, step);
    if (step.kind === 'check' && previewInteractionRequest(step.text)&&!previewObservationRequest(step.text)) return row.name === 'play' && row.result.functionalChecks === true;
    if (row.name === "mcp_call") return mcpStepMatches(step, row.args, true);
    const candidate = { ...step, status: "todo" as const };
    return (step.kind === "check" && row.name === "run_file" && row.result.ok === true && isTestFile(String(row.args.path || "")))
      || (step.kind === "check" && row.name === "shell" && row.result.ok === true && executedTestCommand(String(row.args.command || "")))
      || (step.kind === "check" && row.name === "play" && (row.result.functionalChecks===true || Boolean(row.result.image || row.result.frame)))
      || planFromTool(row.name, [candidate], false, row.args, row.result, true)?.[0]?.status === "ok";
  }

  private coverage(step: PlanStep, rows: Evidence[], fresh = false): { matched: boolean; stale: boolean } {
    const knowledge = knowledgeStepMatches(step, rows.map(row => row.name));
    if (knowledge !== undefined) return { matched: knowledge, stale: false };
    let stale = false;
    const required = planRequiredKinds(step);
    const checksPreview = previewMissingSelector(step.text) || previewInteractionRequest(step.text) && !previewObservationRequest(step.text);
    if (checksPreview && !required.includes("check")) required.push("check");
    // A compound report is completed by its underlying actions and file receipts.
    if (step.kind === "report" && required.length > 1) required.shift();
    const targets = planFileTargets(step.text);
    const disk = planDiskRequirements(step);
    if (disk.some(({ path, width, height }) => !rows.some(row => row.fileProof && planTargetMatches(path, String(row.args.path))
      && (width === undefined || row.fileProof.width === width && row.fileProof.height === height)))) {
      return { matched: false, stale: false };
    }
    if (required.includes("check")) {
      if (previewMissingSelector(step.text)) {
        if (!rows.some(row => this.confirmsMissing(row, { ...step, kind: "check" }))) return { matched: false, stale };
      } else {
        const played = rows.filter(row => row.name === "play"
          && (row.result.functionalChecks === true || row.previewLaunch !== undefined && row.preview !== undefined)
          && (!fresh || this.current(row))
          && (!targets.length || typeof row.args.path === "string" && targets.some(target => planTargetMatches(target, String(row.args.path)))));
        const checkedLaunches = new Set(played.filter(row => row.result.functionalChecks === true).map(row => row.previewLaunch));
        if (checkedLaunches.size) {
          const launches = new Map<string | undefined, PreviewProof[]>();
          for (const row of played.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))) {
            if (!checkedLaunches.has(row.previewLaunch)) continue;
            const proof = launches.get(row.previewLaunch) ?? [];
            for (const action of row.preview || []) proof.push(action);
            launches.set(row.previewLaunch, proof);
          }
          if (![...launches.values()].some(proof => previewStepCovered(step.text, proof))) return { matched: false, stale };
        }
      }
    }
    const actions = (required.length ? required : [step.kind]).every(kind => rows.some(row => {
      const candidate = { ...step, kind };
      if (!this.matches(row, candidate)) return false;
      if (kind === "check" && row.name === "play" && targets.length && !planOperationPaths(row.args).some(path => targets.some(target => planTargetMatches(target, path)))) return false;
      if ((kind === "check" || kind === "run") && fresh && !this.current(row)) { stale = true; return false; }
      return true;
    }));
    const executions = required.filter(kind => kind === "run" || kind === "check").every(kind => {
      const executionTargets = kind === "check" ? targets.filter(isTestFile) : targets;
      return executionTargets.every(target => rows.some(row => this.matches(row, { ...step, kind })
        && (!fresh || this.current(row)) && planOperationPaths(row.args).some(path => planTargetMatches(target, path))));
    });
    // MCP code is deliberately opaque and retains its existing explicit attribution contract.
    const opaqueService = step.kind !== "report" && rows.length > 0 && rows.every(row => row.name === "mcp_call");
    const paths = rows.filter(row => workspaceFileOperation(row.name) || row.name === "play" && required.includes("check")).flatMap(row => planOperationPaths(row.args));
    const files = opaqueService || targets.every(target => paths.some(path => planTargetMatches(target, path))) && planFileRequirements(step).every(requirement => {
      const receipts = rows.filter(row => planFileReceiptMatches(requirement.action, row.name));
      if (requirement.action === "rename" && requirement.targets.length >= 2)
        return receipts.some(row => typeof row.args.from === "string" && typeof row.args.to === "string"
          && planTargetMatches(requirement.targets[0], row.args.from) && planTargetMatches(requirement.targets.at(-1)!, row.args.to));
      return requirement.targets.every(target => receipts.some(row => planOperationPaths(row.args).some(path => planTargetMatches(target, path))));
    });
    return { matched: actions && files && (opaqueService || executions), stale };
  }

  private revalidateChecks() {
    this.plan = this.plan.map((step, index) => {
      if (step.status !== "ok" || step.completedBy === "user") return step;
      const completion = this.mcpCompletions.get(index);
      const validate = completion || step.kind === "run" || step.kind === "check" || step.kind === "report" && !isResponseOnlyStep(step)
        || planFileTargets(step.text).length > 0 || this.evidence.length > 0 && planRequiredKinds(step).length > 1;
      if (!validate) return step;
      const rows = completion ? this.selectedMcpReceipts(completion, step.kind) : this.receipts(step);
      return rows && this.coverage(step, rows, true).matched ? step : withPlanStatus(step, "todo");
    });
  }

  async revalidateFiles(verify: VerifyWorkspaceFile) {
    const targets = this.plan.flatMap(step => planDiskRequirements(step).map(requirement => requirement.path));
    const bound = new Map<string, Evidence[]>();
    for (const row of this.evidence) {
      const path = row.args.path;
      if (!row.fileProof || typeof path !== "string" || !targets.some(target => planTargetMatches(target, path))) continue;
      const rows = bound.get(path) ?? [];
      rows.push(row);
      bound.set(path, rows);
    }
    let invalidated = false;
    for (const [path, rows] of bound) {
      const file = await verify({ path, versionOnly: true });
      for (const row of rows) if (!file.ok || file.version !== row.fileProof?.version) {
        delete row.fileProof;
        row.result = { ...row.result, ok: false, error: true };
        invalidated = true;
      }
    }
    const previous = this.plan;
    if (invalidated) this.revalidateChecks();
    return this.plan.some((step, index) => step.status !== previous[index]?.status);
  }

  record(name: string, args: Args, result: unknown, changed = false, fileProof?: WorkspaceFileProof) {
    if (changed) this.revision++;
    if (/^(set_plan|select_tools|harness_|graph_|board_)/.test(name)) return;
    const raw = result && typeof result === "object" ? result as Args : {};
    const row = name === "mcp_call" ? mcpPlanStatus(raw, args) : raw;
    const target = Object.fromEntries(targetFields.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
    let previewCurrent = true;
    let previewLaunch: string | undefined;
    if (name === "play") {
      // The renderer owns the identity of the live preview. Older transports
      // can prove it only through the latest successful launch of that view.
      delete target.path;
      const launched = this.evidence.filter(e => e.name === "open_preview" || e.name === "run_file" && projectHtml(e.args.path)).at(-1);
      const currentLaunch = launched && this.current(launched) && this.available(launched, "run") ? launched.args.path : undefined;
      const path = row.previewPath === undefined ? currentLaunch : row.previewPath;
      previewCurrent = row.previewPath === undefined
        ? !launched || projectHtml(currentLaunch)
        : projectHtml(path) && projectHtml(currentLaunch) && planTargetMatches(path, currentLaunch) && planTargetMatches(currentLaunch, path);
      if (previewCurrent) previewLaunch = launched?.id;
      if (projectHtml(path)) target.path = path;
    }
    if (name === "shell" && typeof args.command === "string" && executedTestCommand(args.command)) {
      const files = planFileTargets(args.command).filter(isTestFile);
      if (files.length === 1) target.path = files[0];
    }
    const status = Object.fromEntries(statusFields.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
    if (!previewCurrent) status.functionalChecks = false;
    const targetJson = name === "mcp_call" ? JSON.stringify({ ...target, arguments: args.arguments ?? {} },
      (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)
      : name === "verify_file" ? JSON.stringify([target.path, args.width, args.height]) : JSON.stringify(target);
    const preview = name === "play" && previewCurrent ? previewProof(args, row) : undefined;
    const missingClick = Array.isArray(args.actions) && args.actions.length === 1 && args.actions[0]?.type === "click" && args.actions[0].selector === row.previewMissingTarget
      && (args.keys === undefined || args.keys === "" || Array.isArray(args.keys) && args.keys.length === 0);
    const missingTarget = name === "play" && previewCurrent && missingClick && row.ok === false && row.rejected === true && row.definitelyNotExecuted === true && typeof row.previewMissingTarget === "string"
      ? evidenceTargetKey(row.previewMissingTarget) : undefined;
    const playTargetJson = name === "play" ? JSON.stringify([target, args.keys, args.actions],
      (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value) : targetJson;
    this.evidence.push({ id: `e${this.nextEvidenceId++}`, name, args: target, result: { ...status, image: Boolean(row.image || row.frame) }, revision: this.revision,
      inputStamp: this.inputStamp, targetKey: evidenceTargetKey(playTargetJson), ...(preview ? { preview } : {}),
      ...(name === "verify_file" && raw.ok === true && typeof target.path === "string" && target.path === raw.path && validWorkspaceFileProof(fileProof) ? { fileProof } : {}),
      ...(previewLaunch ? { previewLaunch } : {}), ...(missingTarget ? { missingTarget } : {}) });
    const id = this.evidence.at(-1)!.id;
    return id;
  }

  private conflictingReceipt(row: Evidence) {
    const i = this.evidence.indexOf(row);
    // Old v1 snapshots did not fingerprint MCP arguments. Their exact target
    // cannot be recovered: retain the former conservative invalidation rule.
    const legacyMcp = row.name === "mcp_call" && row.targetKey === evidenceTargetKey(JSON.stringify(row.args));
    return this.evidence.slice(i + 1).find(e => e.name === row.name && (e.targetKey === row.targetKey
      || (legacyMcp && e.args.server === row.args.server && e.args.name === row.args.name))
      && !(e.result.rejected === true && e.result.definitelyNotExecuted === true && /^(shell|play|write_file|edit_file|append_file|delete_file|rename|mkdir|format_file)$/.test(e.name))
      && (failed(e.result) || toolResultPending(e.result)));
  }

  set(args: Args, mayReplace = true): PlanUpdateResult & { checklist_context?: string; recovery?: string } {
    const result = this.apply(args, mayReplace);
    return result.error || result.rejected_updates?.length ? {
      ...result,
      checklist_context: this.context(),
      recovery: "Use actual evidence IDs listed below or printed with tool results. Do not guess IDs or retry empty evidence. If no matching successful evidence exists, leave the step todo/err with the concrete blocker; do not repeat completed work just to update the checklist."
        + (result.applied_steps?.length ? " Leave applied steps as recorded and address only the rejected updates when you have matching evidence." : ""),
    } : result;
  }

  private apply(args: Args, mayReplace: boolean): PlanUpdateResult {
    if (args.updates !== undefined) {
      if (args.steps !== undefined) return { error: "Use either steps or updates, never both." };
      if (!this.plan.length) return { error: "No checklist yet. Create it with steps and kinds first." };
      if (!Array.isArray(args.updates) || !args.updates.length || args.updates.length > 10) return { error: "updates must contain 1–10 items." };
      const updates = new Map<number, Args>();
      for (const value of args.updates) {
        if (!value || typeof value !== "object") return { error: "Invalid plan update." };
        const u = value as Args;
        const i = Number(u.step) - 1;
        if (!Number.isInteger(u.step) || i < 0 || i >= this.plan.length || updates.has(i)) return { error: "step must be a unique existing 1-based checklist number." };
        if (!["todo", "run", "ok", "err"].includes(String(u.status))) return { error: "Invalid status: use todo, run, ok or err." };
        if (typeof u.reason !== "string" || !u.reason.trim()) return { error: "Explain the actual result or remaining blocker in reason." };
        if (u.kind !== undefined && (typeof u.kind !== "string" || !kinds.has(u.kind))) return { error: `Step ${i + 1}: Invalid kind. Use read, edit, run, check, service or report.` };
        updates.set(i, u);
      }
      const next = [...this.plan];
      const mcpUpdates = new Map<number, McpCompletion | undefined>();
      const applied_steps: number[] = [];
      const rejected_updates: NonNullable<PlanUpdateResult["rejected_updates"]> = [];
      for (const [i, update] of updates) {
        const current = next[i];
        const result = this.updatedStep(current, update, i + 1);
        if (typeof result === "string") {
          rejected_updates.push({ step: i + 1, error: result });
          continue;
        }
        next[i] = result.step;
        mcpUpdates.set(i, result.mcpEvidenceIds && { step: i, stepKey: stepKey(result.step), evidenceIds: result.mcpEvidenceIds });
        if (result.step.status !== current.status || result.step.kind !== current.kind) applied_steps.push(i + 1);
      }
      const diagnostics = rejected_updates.length ? { applied_steps, rejected_updates } : {};
      if (rejected_updates.length && !applied_steps.length) return { error: rejected_updates[0].error, ...diagnostics };
      this.plan = next;
      for (const [index, completion] of mcpUpdates) {
        if (completion) this.mcpCompletions.set(index, completion);
        else this.mcpCompletions.delete(index);
      }
      return { ok: true, plan: this.plan, ...diagnostics };
    }
    if (!Array.isArray(args.steps) || args.steps.some(s => typeof s !== "string")) return { error: "Create with steps and kinds, or update existing steps with updates." };
    const next = applySetPlan(this.plan, args.steps as string[], !mayReplace, Array.isArray(args.kinds) ? args.kinds : undefined);
    if (!next) return { error: "Checklist preserved. Use updates with its existing step numbers; do not replace a locked or started plan." };
    this.plan = next;
    this.mcpCompletions.clear();
    return { ok: true, plan: this.plan };
  }

  private updatedStep(step: PlanStep, update: Args, number: number): { step: PlanStep; mcpEvidenceIds?: string[] } | string {
    if (update.kind && step.kind && update.kind !== step.kind) return "An existing step kind cannot be changed by a status update.";
    const suggested = suggestedKind(step);
    const completingReport = update.kind === "report" && update.status === "ok";
    if (!step.kind && suggested === "check" && update.kind && update.kind !== "check" && !completingReport) {
      return `Step ${number}: This check requires kind check and matching tool evidence.`;
    }
    if (!step.kind && update.kind === "report" && !completingReport && !isResponseOnlyStep({ ...step, kind: "report" }))
      return `Step ${number} requests work. Leave it open until its required actions have matching evidence.`;
    const kind = (step.kind || update.kind || suggested) as PlanStep["kind"];
    let mcpEvidenceIds: string[] | undefined;
    if (update.status === "ok") {
      if (!kind) return `Step ${number}: Supply a kind for this ambiguous step and matching evidence. Otherwise leave it open and perform the next actionable check.`;
      const candidate: PlanStep = { ...step, kind, status: "todo" };
      const refs = Array.isArray(update.evidence) ? update.evidence : [];
      const rows = refs.map(id => this.evidence.find(e => e.id === id));
      if (!rows.length || rows.some(e => !e || !this.available(e, kind) && !this.confirmsMissing(e, candidate)))
        return `Step ${number}: ${!refs.length ? "No evidence IDs supplied." : "A supplied evidence ID is missing, failed, contradicted or still running."} Completion requires existing successful evidence IDs, without newer contradictory results. Running checks are not completed checks.`;
      const coverage = this.coverage(candidate, rows as Evidence[], true);
      if (!coverage.matched && planDiskRequirements(candidate).some(({ path, width, height }) => !rows.some(row => row?.fileProof
        && planTargetMatches(path, String(row.args.path)) && (width === undefined || row.fileProof.width === width && row.fileProof.height === height)))) {
        return `Step ${number}: Use verify_file on each named saved asset and cite its successful evidence ID. Match any specified workspace-relative path, including its output folder. Include expected width and height for PNG checks. Preview assertions and service replies alone cannot verify files on disk.`;
      }
      if (!coverage.matched && !coverage.stale && kind === 'check' && (previewInteractionRequest(candidate.text)||rows.every(row=>row?.name==='see_run'||row?.name==='run_file'&&/\.html?$/i.test(String(row.args.path||''))))&&!previewObservationRequest(candidate.text)
        && !rows.some(row => row?.name === 'play' && row.result.functionalChecks === true))
        return `Step ${number}: Use a successful play call with actions of type assert to confirm the expected state. Loading HTML or delivering input alone cannot complete this interaction check. Keep the step open until that result is verified.`;
      if (!coverage.matched) return `Step ${number} (${kind}): ${isResponseOnlyStep(candidate) ? "Report steps close with the final answer." : coverage.stale ? "The matching run/check predates the latest change; verify the current files." : `Evidence from ${rows.map(e => e!.name).join(", ")} does not cover every named file and required action (${planFileTargets(candidate.text).join(", ") || "the requested operation"}). Supply successful evidence for each named action; do not repeat completed work.`}`;
      // Keep the explicitly attributed service check together with the report's file receipts.
      if (rows.every(row => row?.name === "mcp_call") || kind === "report" && rows.some(row => row?.name === "mcp_call")) {
        mcpEvidenceIds = [...new Set(rows.map(row => row!.id))];
      }
    }
    return { step: withPlanStatus({ ...step, ...(kind ? { kind } : {}) }, update.status as PlanStep["status"], "agent"), mcpEvidenceIds };
  }

  hasOpenWork() { return this.plan.some(s => s.status !== "ok" && !isResponseOnlyStep(s)); }

  context() {
    if (!this.plan.length) return "";
    const rows = this.plan.map((s, i) => `${i + 1}. [${s.status}${s.completedBy === "user" ? "; marked manually by the user" : ""}] (${s.kind || suggestedKind(s) || "unclassified"}) ${s.text}`);
    // Retain an early successful example per tool as well as the tail. Otherwise
    // compaction plus many edits hides the initial read needed to reconcile step 1.
    const visible = this.retainedEvidence(85);
    const evidence = visible.map(e => `${e.id}: ${e.name} ${String(e.args.path || e.args.command || e.args.name || e.args.action || "").slice(0, 160)} — ${e.missingTarget ? "verified missing click target; applies only to a matching expected-rejection test" : failed(e.result) || this.conflictingReceipt(e) ? "failed/incomplete/superseded" : toolResultPending(e.result) ? "running" : "success"}${!this.current(e) ? " (before latest execution-input change; age blocks only run/check steps)" : ""}`);
    return `Current visible checklist (authoritative; keep its steps):\n${rows.join("\n")}\nUpdate individual steps with set_plan updates: step (1-based), status, evidence (actual IDs listed below), reason (what the result establishes). Supply kind for an ambiguous unclassified step when marking it ok. Evidence IDs appear as plan_evidence_id in JSON results or as Plan evidence ID before text results; they are not API tool-call IDs. Never invent IDs or infer all tasks complete from one run. For unfinished/blocked steps use todo/err and explain why. Do not repeat completed edits just to fix the checklist.\nEvidence IDs from this request:\n${evidence.join("\n") || "None yet. Do not mark a step ok without evidence."}`;
  }

  snapshot(): PlanProgressSnapshot {
    const retained = this.retainedEvidence(SNAPSHOT_LIMIT);
    const retainedIds = new Set(retained.map(row => row.id));
    const mcpCompletions: McpCompletion[] = [];
    const plan = this.plan.slice(0, MAX_PLAN_STEPS).map((step, index) => {
      let saved = { ...step, text: step.text.slice(0, 1000) };
      const completion = this.mcpCompletions.get(index);
      if (completion && step.completedBy !== "user") {
        const key = stepKey(saved);
        const rows = this.selectedMcpReceipts(completion, step.kind);
        const recoverable = key === completion.stepKey && rows?.every(row => retainedIds.has(row.id));
        // Remember whether this used an explicit selection even when some
        // receipts cannot be retained. Recovery must not infer a new selection.
        mcpCompletions.push({ step: index, stepKey: key, evidenceIds: recoverable ? [...completion.evidenceIds] : [] });
        if (!recoverable && saved.status === "ok") saved = withPlanStatus(saved, "todo");
      }
      return { text: saved.text, status: saved.status, ...(saved.kind ? { kind: saved.kind } : {}), ...(saved.status === "ok" && saved.completedBy ? { completedBy: saved.completedBy } : {}) };
    });
    const evidence = retained.map(row => {
      // A command's classification is sufficient to match check/run steps after
      // restart. Its arguments and any output stay out of the recovery record.
      const args = Object.fromEntries(targetFields.filter(key => key !== "command" && key !== "cmd" && typeof row.args[key] === "string")
        .map(key => [key, String(row.args[key]).slice(0, row.name === "verify_file" && key === "path" ? 511 : 400)]));
      if (row.args.command !== undefined) args.command = executedTestCommand(String(row.args.command)) ? "npm test" : "node";
      const result = Object.fromEntries(statusFields.filter(key => row.result[key] !== undefined && (key !== "code" || (typeof row.result[key] === "number" && Number.isFinite(row.result[key])))).map(key => [key,
        key === "status" ? (/^(?:failed|error|aborted|interrupted|cancelled|canceled|timed[_ -]?out|running|pending|queued|waiting)$/i.test(String(row.result[key])) ? String(row.result[key]) : "unknown")
          : key === "code" ? row.result[key] : key === "ok" ? row.result[key] === true : Boolean(row.result[key]) ]));
      result.image = Boolean(row.result.image);
      return { ...row, args, result };
    });
    return { version: 1, revision: this.revision, ...(this.inputStamp ? { inputStamp: this.inputStamp } : {}), nextEvidenceId: this.nextEvidenceId, plan, evidence,
      ...(mcpCompletions.length ? { mcpCompletions } : {}) };
  }

  private retainedEvidence(limit: number): Evidence[] {
    const retained = new Set<Evidence>();
    const latest = this.evidence.slice().reverse();
    const keep = (row: Evidence | undefined) => { if (row && retained.size < limit) retained.add(row); };
    // Preserve the receipts supporting named checklist work, even when hundreds
    // of unrelated tool calls follow it. Do not retain full commands or output.
    const ordered = this.plan.map((step, index) => ({ step, index }))
      .sort((a, b) => Number(b.step.status === "ok") - Number(a.step.status === "ok"));
    for (const { step, index } of ordered) {
      const completion = this.mcpCompletions.get(index);
      if (completion) {
        const supporting = new Set<Evidence>();
        for (const id of completion.evidenceIds) {
          const selected = this.evidence.find(row => row.id === id);
          if (!selected) continue;
          supporting.add(selected);
          const conflict = this.conflictingReceipt(selected);
          if (conflict) supporting.add(conflict);
        }
        // Incomplete groups can no longer recover the completion. Leave room
        // for other steps' receipts instead of retaining much of an oversized set.
        if (retained.size + [...supporting].filter(row => !retained.has(row)).length <= limit) {
          for (const row of supporting) keep(row);
        }
        continue;
      }
      for (const requirement of planFileRequirements(step)) for (const target of requirement.targets)
        keep(latest.find(row => this.available(row, step.kind) && planFileReceiptMatches(requirement.action, row.name)
          && planOperationPaths(row.args).some(path => planTargetMatches(target, path))));
      for (const { path, width, height } of planDiskRequirements(step))
        keep(latest.find(row => this.available(row) && row.fileProof && planTargetMatches(path, String(row.args.path))
          && (width === undefined || row.fileProof.width === width && row.fileProof.height === height)));
      for (const kind of planRequiredKinds(step)) {
        const candidate = { ...step, kind };
        const candidates = latest.filter(row => (this.available(row, kind) || this.confirmsMissing(row, candidate)) && this.matches(row, candidate)
          && (kind !== "run" && kind !== "check" || this.current(row)));
        for (const target of planFileTargets(step.text)) keep(candidates.find(row => planOperationPaths(row.args).some(path => planTargetMatches(target, path))));
        keep(candidates[0]);
      }
    }
    const first = new Map<string, Evidence>();
    for (const row of this.evidence) if (!first.has(row.name) && this.available(row)) first.set(row.name, row);
    for (const row of [...first.values()].slice(0, 25)) keep(row);
    for (const row of latest) keep(row);
    return [...retained].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  }

  restore(snapshot: unknown): boolean {
    if (!snapshot || typeof snapshot !== "object") return false;
    const saved = snapshot as Args;
    const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
    if (saved.version !== 1 || !count(saved.revision) || !count(saved.nextEvidenceId) || saved.nextEvidenceId < 1
      || (saved.inputStamp !== undefined && !inputStamp(saved.inputStamp)) || !Array.isArray(saved.plan) || saved.plan.length > MAX_PLAN_STEPS
      || !Array.isArray(saved.evidence) || saved.evidence.length > SNAPSHOT_LIMIT
      || saved.mcpCompletions !== undefined && (!Array.isArray(saved.mcpCompletions) || saved.mcpCompletions.length > MAX_PLAN_STEPS)) return false;
    const plan: PlanStep[] = [];
    for (const value of saved.plan) {
      if (!value || typeof value !== "object") return false;
      const step = value as Args;
      if (typeof step.text !== "string" || !step.text.trim() || step.text.length > 1000 || !["todo", "run", "ok", "err"].includes(String(step.status)) || (step.kind !== undefined && !kinds.has(String(step.kind)))) return false;
      if (step.completedBy !== undefined && (step.status !== "ok" || !["user", "agent"].includes(String(step.completedBy)))) return false;
      plan.push({ text: step.text, status: step.status as PlanStep["status"], ...(step.kind ? { kind: step.kind as PlanStep["kind"] } : {}), ...(step.completedBy ? { completedBy: step.completedBy as PlanStep["completedBy"] } : {}) });
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
      if (row.preview !== undefined && (row.name !== "play" || !validPreviewProof(row.preview)) || row.missingTarget !== undefined &&
        (row.name !== "play" || !validPreviewFingerprint(row.missingTarget) || result.ok !== false || result.rejected !== true || result.definitelyNotExecuted !== true)) return false;
      if (row.previewLaunch !== undefined && (row.name !== "play" || typeof row.previewLaunch !== "string" || !/^e\d+$/.test(row.previewLaunch)
        || !count(Number(row.previewLaunch.slice(1))) || Number(row.previewLaunch.slice(1)) < 1 || Number(row.previewLaunch.slice(1)) >= Number(row.id.slice(1)))) return false;
      if (row.fileProof !== undefined && (row.name !== "verify_file" || result.ok !== true || !validWorkspaceFileProof(row.fileProof))) return false;
      if (Object.entries(args).some(([key, value]) => !targetFields.includes(key) || typeof value !== "string" || value.length > (row.name === "verify_file" && key === "path" ? 511 : 400))
        || Object.entries(result).some(([key, value]) => ![...statusFields, "image"].includes(key) || (key === "status" ? typeof value !== "string" || value.length > 32 : key === "code" ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== "boolean"))) return false;
      previousId = Number(row.id.slice(1));
      evidence.push({ id: row.id, name: row.name, args: { ...args }, result: { ...result }, revision: row.revision, inputStamp: inputStamp(row.inputStamp), targetKey: row.targetKey,
        ...(row.fileProof ? { fileProof: row.fileProof as WorkspaceFileProof } : {}),
        ...(row.preview ? { preview: row.preview as PreviewProof[] } : {}), ...(row.previewLaunch ? { previewLaunch: row.previewLaunch as string } : {}),
        ...(row.missingTarget ? { missingTarget: row.missingTarget as string } : {}) });
    }
    const mcpCompletions = new Map<number, McpCompletion>();
    const savedCompletions = Array.isArray(saved.mcpCompletions) ? saved.mcpCompletions : [];
    for (const value of savedCompletions) {
      if (!value || typeof value !== "object") return false;
      const { step, stepKey: key, evidenceIds } = value as Args;
      if (!count(step) || !plan[step] || mcpCompletions.has(step) || key !== stepKey(plan[step])
        || !Array.isArray(evidenceIds) || evidenceIds.length > SNAPSHOT_LIMIT || new Set(evidenceIds).size !== evidenceIds.length
        || evidenceIds.some(id => typeof id !== "string" || !evidence.some(row => row.id === id && (row.name === "mcp_call" || plan[step].kind === "report")))
        || evidenceIds.length && !evidence.some(row => row.name === "mcp_call" && evidenceIds.includes(row.id))) return false;
      mcpCompletions.set(step, { step, stepKey: key, evidenceIds: [...evidenceIds] });
    }
    this.revision = saved.revision;
    this.inputStamp = inputStamp(saved.inputStamp);
    this.nextEvidenceId = saved.nextEvidenceId;
    this.evidence = evidence;
    this.plan = plan;
    this.mcpCompletions = mcpCompletions;
    this.revalidateChecks();
    return true;
  }
}

/** Project a stopped job's checklist from its own receipts without changing the saved job. */
export function reconcileRecoveredPlan(plan: PlanStep[] | undefined, workflow: WorkflowSnapshot | undefined, jobId: string): PlanStep[] | undefined {
  if (!plan?.length || !workflow || workflow.id !== jobId || !validWorkflowSnapshot(workflow) || !workflow.planProgress) return plan;
  try {
    const progress = new PlanProgress();
    if (!progress.restore(JSON.parse(workflow.planProgress))) return plan;
    progress.sync(plan);
    return plan.some((step, i) => step.status !== progress.plan[i]?.status) ? progress.plan : plan;
  } catch { return plan; }
}
