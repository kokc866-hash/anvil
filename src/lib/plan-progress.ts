import type { PlanStep } from "@/store/ide";
import { applySetPlan, planFromTool } from "./plan.ts";
import { isTestFile } from "./test-parse.ts";

type Args = Record<string, unknown>;
type Evidence = { id: string; name: string; args: Args; result: Args; revision: number };
const kinds = new Set(["read", "edit", "run", "check", "service", "report"]);
const failed = (r: Args) => Boolean(r.error || r.isError || r.ok === false || r.truncated || r.already_executed || r.pending);

/** The model owns semantic attribution; Anvil requires an actual matching tool result.
 * This is bookkeeping evidence, not an independent correctness verdict. */
export class PlanProgress {
  plan: PlanStep[] = [];
  private evidence: Evidence[] = [];
  private revision = 0;

  sync(plan: PlanStep[] | undefined) { this.plan = (plan || []).map(s => ({ ...s })); }

  record(name: string, args: Args, result: unknown, changed = false) {
    if (changed) this.revision++;
    if (/^(set_plan|select_tools|harness_|graph_|board_)/.test(name)) return;
    const row = result && typeof result === "object" ? result as Args : {};
    const target = Object.fromEntries(["path", "from", "to", "command", "name", "action", "engine", "projectRoot", "cmd", "server"].filter(k => args[k] !== undefined).map(k => [k, args[k]]));
    const status = Object.fromEntries(["ok", "error", "isError", "running", "pending", "truncated", "already_executed"].filter(k => row[k] !== undefined).map(k => [k, row[k]]));
    this.evidence.push({ id: `e${this.evidence.length + 1}`, name, args: target, result: { ...status, image: Boolean(row.image || row.frame) }, revision: this.revision });
    return this.evidence.at(-1)!.id;
  }

  private contradicted(row: Evidence) {
    const i = this.evidence.indexOf(row);
    return this.evidence.slice(i + 1).some(e => e.name === row.name && JSON.stringify(e.args) === JSON.stringify(row.args)
      && (failed(e.result) || e.result.running === true));
  }

  set(args: Args, mayReplace = true): { ok?: boolean; error?: string; plan?: PlanStep[]; checklist_context?: string; recovery?: string } {
    const result = this.apply(args, mayReplace);
    return result.error ? {
      ...result,
      checklist_context: this.context(),
      recovery: "Use actual evidence IDs listed below or printed with tool results. Do not guess IDs or retry empty evidence. If no matching successful evidence exists, leave the step todo/err with the concrete blocker; do not repeat completed work just to update the checklist.",
    } : result;
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
          if (!rows.length || rows.some(e => !e || failed(e.result) || this.contradicted(e)
            || (e.result.running === true && !(kind === "run" && e.result.ok === true && (e.name === "run_file" || (e.name === "engine_run" && /^(editor|play)$/.test(String(e.args.action))))))))
            return { error: `Step ${i + 1}: ${!refs.length ? "No evidence IDs supplied." : "A supplied evidence ID is missing, failed, contradicted or still running."} Completion requires existing successful evidence IDs, without newer contradictory results. Running checks are not completed checks.` };
          const matched = rows.some(e => {
            if (!e) return false;
            if ((kind === "check" || kind === "run") && e.revision !== this.revision) return false;
            // Executing a recognized test entry is a check, even when launched
            // through run_file instead of a shell/test command.
            if (kind === "check" && e.name === "run_file" && e.result.ok === true && isTestFile(String(e.args.path || ""))) return true;
            // An actual captured interaction can evidence visual checking, a key press alone cannot.
            if (kind === "check" && e.name === "play" && (e.result.image || e.result.frame)) return true;
            const candidate: PlanStep = { ...next[i], kind: kind as PlanStep["kind"], status: "todo" };
            return planFromTool(e.name, [candidate], false, e.args, e.result)?.[0]?.status === "ok";
          });
          if (!matched) return { error: `Step ${i + 1} (${kind}): evidence does not match this step (or its run/check predates the latest change). Report steps close with the final answer.` };
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
    const evidence = visible.map(e => `${e.id}: ${e.name} ${String(e.args.path || e.args.command || e.args.name || e.args.action || "").slice(0, 160)} — ${failed(e.result) || this.contradicted(e) ? "failed/incomplete/superseded" : e.result.running ? "running" : "success"}${e.revision !== this.revision ? " (before latest change)" : ""}`);
    return `Current visible checklist (authoritative; keep its steps):\n${rows.join("\n")}\nUpdate individual steps with set_plan updates: step (1-based), kind, status, evidence (actual IDs listed below), reason (what the result establishes). Evidence IDs are printed directly before tool results; they are not API tool-call IDs. Never invent IDs or infer all tasks complete from one run. For unfinished/blocked steps use todo/err and explain why. Do not repeat completed edits just to fix the checklist.\nEvidence IDs from this request:\n${evidence.join("\n") || "None yet. Do not mark a step ok without evidence."}`;
  }
}
