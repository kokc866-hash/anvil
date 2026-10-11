import type { HarnessOpts, HarnessPhase, HarnessState } from "./harness.ts";
import type { ProjectGraphEdge } from "./harness-project.ts";
import { matchGlob, projectEdgeCondition } from "./harness-graph.ts";
import { effectiveAfterWrite } from "./harness.ts";
import { toolCallFingerprint } from "./tool-call-fingerprint.ts";
import { isExecutablePath, selectRunTarget } from "./run-target.ts";
import { isTestFile, isTestExt, fileHasInlineTests } from "./test-parse.ts";
import { toolResultFailed, toolResultPending, executedTestCommand } from "./agent-evidence.ts";
import { validWorkflowSnapshot } from "../../electron/workflow-validation.mjs";
import { isWorkflowInputPath,workflowInputPaths } from "./workflow-inputs.ts";

export type WorkflowStatus = "ready" | "running" | "passed" | "failed" | "waiting" | "disabled" | "stale";
export type WorkflowNode = { id: string; name: string; label: string; path?: string; action?: string; fingerprint?: string; status: WorkflowStatus; inputStamp?: string; reason: string; automatic: boolean };
export type WorkflowOperation = { id: string; name: string; fingerprint: string; effectFingerprint?: string; inputStamp: string; status: "started" | "confirmed" | "failed" | "unclear"; target: string; external: boolean; nodeId?: string; at: number; recovery?: { mode: 'skip'; at: number }; resolution?: { outcome: 'confirmed' | 'not-executed'; note: string; at: number } };
export type WorkflowSnapshot = {
  schema: 1; id: string; inputStamp: string; definitionStamp: string; phase: HarnessPhase;
  nodes: WorkflowNode[]; operations: WorkflowOperation[]; changed: string[];
  planProgress?: string; verificationEvidence?: string; harness?: HarnessState;
};
export type WorkflowAction = { id: string; name: string; args: Record<string, unknown>; reason: string; phase?: HarnessPhase };
type WorkflowOptions = HarnessOpts & { autoRunAgent?: boolean; recipes?: { id: string; version: number }[] };
const relevant = isWorkflowInputPath;
const mutates = (name: string) => /^(?:write_file|append_file|edit_file|delete_file|rename|mkdir|format_file|git_clone)$/.test(name);
const checks = (name: string) => /^(?:run_file|shell|engine_run|see_run|play)$/.test(name);
const external = (name: string) => /^(?:mcp_call|shell|git_commit|git_push|git_clone|memory_add|memory_forget|skill_write|skill_patch|skill_outcome|debug_start|debug_continue|debug_step|debug_eval|engine_run)$/.test(name);
export const workflowToolFailed = (result: Record<string, unknown>) => toolResultFailed(result) || Boolean(result.interrupted);
const pending = (result: Record<string, unknown>) => toolResultPending(result) || Boolean(result.queued);

/** One execution state for both adapters. It never grants capabilities or interprets labels as code. */
export class AgentWorkflow {
  private state: WorkflowSnapshot;
  private files: Record<string, string>;
  private fileHashes = new Map<string, { content: string; hash: string }>();
  private attempted = new Set<string>();
  private dirty = false;
  private edges: ProjectGraphEdge[] = [];
  private opts: WorkflowOptions;
  private capabilities: Set<string>;
  private inputPaths=new Set<string>();

  constructor(files: Record<string, string>, opts: WorkflowOptions, capabilities: string[], saved?: unknown, id: string = crypto.randomUUID()) {
    this.files = files; this.opts = opts; this.capabilities = new Set(capabilities);
    this.state = validWorkflowSnapshot(saved) ? structuredClone(saved) as WorkflowSnapshot
      : { schema: 1, id, inputStamp: "", definitionStamp: "", phase: "act", nodes: [], operations: [], changed: [] };
    for (const op of this.state.operations) if (op.status === "started") op.status = "unclear";
    for (const node of this.state.nodes) if (node.status === "running") { node.status = "waiting"; node.reason = "Abschluss nach Unterbrechung noch unbestätigt."; }
    for (const node of this.state.nodes) if (node.inputStamp && !["ready", "disabled", "stale"].includes(node.status)) this.attempted.add(`${node.id}:${node.inputStamp}`);
  }

  async update(files: Record<string, string>, opts = this.opts, edges = this.edges): Promise<boolean> {
    this.files = files; this.opts = opts; this.edges = edges.slice(0, 64);
    const previous = this.state.inputStamp, previousDefinition = this.state.definitionStamp;
    this.inputPaths=workflowInputPaths(files);
    const inputs: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (!this.inputPaths.has(path)) continue;
      let entry = this.fileHashes.get(path);
      if (entry?.content !== content) {
        entry = { content, hash: await toolCallFingerprint("file", { content }) };
        this.fileHashes.set(path, entry);
      }
      inputs[path] = entry.hash;
    }
    for (const path of this.fileHashes.keys()) if (!(path in files)) this.fileHashes.delete(path);
    this.state.inputStamp = await toolCallFingerprint("execution-inputs", inputs);
    this.state.definitionStamp = await toolCallFingerprint("workflow-definition", { opts, edges: this.edges });
    if (previousDefinition && previousDefinition !== this.state.definitionStamp) {
      for (const node of this.state.nodes) if (!node.id.startsWith("observed:")) {
        node.status = "stale"; node.reason = "Ablaufregeln seit dieser Prüfung geändert.";
        node.fingerprint = undefined;
        if (node.inputStamp) this.attempted.delete(`${node.id}:${node.inputStamp}`);
        const edge = this.edges.find(e => e.id === node.id);
        if (edge) { node.name = edge.tool || edge.edge; node.action = typeof edge.args?.action === "string" ? edge.args.action : undefined; if (typeof edge.args?.path === "string") node.path = edge.args.path; }
      }
    }
    if (previous && previous !== this.state.inputStamp) {
      this.dirty = true;
      for (const node of this.state.nodes) if (node.status === "passed") {
        node.status = "stale"; node.reason = "Relevante Dateien seit dieser Prüfung geändert.";
      }
    }
    return previous !== this.state.inputStamp;
  }

  get inputStamp() { return this.state.inputStamp; }
  get phase() { return this.state.phase; }
  get completed() { return new Set(this.state.nodes.filter(n => n.status === "passed" && n.inputStamp === this.inputStamp).map(n => n.id)); }
  get testsPassed() {
    const required = this.opts.testLoop ? Object.keys(this.files).filter(p => isTestExt(p) && (isTestFile(p) || fileHasInlineTests(p, this.files[p]))) : [];
    if (required.some(path => !this.state.nodes.some(n => n.id === `test:${path}` && n.status === "passed" && n.inputStamp === this.inputStamp))) return false;
    const current = this.state.nodes.filter(n => n.id.startsWith("test:") && n.inputStamp === this.inputStamp && n.status !== "disabled" && (n.name !== "run_file" || !!n.path && n.path in this.files));
    return current.length > 0 && current.every(n => n.status === "passed");
  }
  confirmedChanges(paths: string[]) { this.state.changed = [...new Set([...this.state.changed, ...paths])].slice(-256); this.dirty ||= paths.some(relevant); }
  setPhase(phase: HarnessPhase) { this.state.phase = phase; }
  outstandingChecks() {
    const current = this.state.nodes.filter(node => checks(node.name) && node.inputStamp === this.inputStamp);
    const launchConfirmed = (node: WorkflowNode) => node.name === "engine_run" && ["editor", "play"].includes(node.action || "") && this.state.operations.some(op => op.name === node.name && op.fingerprint === node.fingerprint && op.inputStamp === this.inputStamp && op.status === "confirmed");
    return {
      failed: current.filter(node => node.status === "failed").map(node => `${node.label}: ${node.reason}`),
      pending: current.filter(node => ["waiting", "running", "disabled", "ready"].includes(node.status) && !launchConfirmed(node)).map(node => `${node.label}: ${node.reason}`),
    };
  }
  snapshot(): WorkflowSnapshot { return structuredClone(this.state); }
  recoveryNeedsInspection() {
    const skipped=this.state.operations.filter(op=>op.external&&op.status==='unclear'&&op.recovery?.mode==='skip');
    if(!skipped.length)return false;
    const since=Math.max(...skipped.map(op=>op.recovery!.at));
    return !this.state.operations.some(op=>op.status==='confirmed'&&op.at>=since&&['read_file','grep','git_status','engine_status','debug_state','mcp_read_resource'].includes(op.name));
  }
  proof(kind: "planProgress" | "verificationEvidence"): unknown {
    try { return this.state[kind] ? JSON.parse(this.state[kind]!) : undefined; } catch { return undefined; }
  }
  checkpoint(extra: { planProgress?: unknown; verificationEvidence?: unknown; harness?: HarnessState }): WorkflowSnapshot {
    if (extra.planProgress) this.state.planProgress = JSON.stringify(extra.planProgress);
    if (extra.verificationEvidence) this.state.verificationEvidence = JSON.stringify(extra.verificationEvidence);
    const observation = (o: HarnessState["last"]) => o && { kind: o.kind, name: o.name, ok: o.ok, path: o.path, image: o.image, graphical: o.graphical };
    if (extra.harness) this.state.harness = { ...extra.harness, reason: extra.harness.reason.slice(0, 500), last: observation(extra.harness.last), history: extra.harness.history.slice(-20).map(o => observation(o)!) };
    return this.snapshot();
  }

  private node(id: string, name: string, args: Record<string, unknown>, reason: string): WorkflowNode {
    let node = this.state.nodes.find(n => n.id === id);
    if (!node) {
      node = { id, name, label: reason.slice(0, 160), path: typeof args.path === "string" ? args.path : undefined, action: typeof args.action === "string" ? args.action.slice(0,100) : undefined, status: "ready", reason: reason.slice(0, 500), automatic: true };
      if (this.state.nodes.length >= 256) throw new Error("Zu viele Ablaufknoten. Auftrag vor dem Fortsetzen prüfen.");
      this.state.nodes.push(node);
    }
    node.name = name; node.path = typeof args.path === "string" ? args.path : undefined;
    node.action = typeof args.action === "string" ? args.action.slice(0,100) : undefined;
    return node;
  }

  async begin(name: string, args: Record<string, unknown>, nodeId?: string): Promise<{ id?: string; error?: string }> {
    const fingerprint = await toolCallFingerprint(name, args);
    const effectArgs = name === "mcp_call" ? { server: String(args.server || ""), name: String(args.name || "") }
      : name === "shell" ? { command: String(args.command || "").trim() } : args;
    const effectFingerprint = await toolCallFingerprint(name, effectArgs);
    if (external(name) && this.state.operations.some(op => op.external && op.status === 'unclear' && ((op.effectFingerprint || op.fingerprint) === effectFingerprint || op.recovery && name==='mcp_call' && op.name===name && op.target===String(args.name)))) {
      return { error: "Der Ausgang dieser früher gestarteten Aktion ist unklar. Zuerst beim Dienst oder im Protokoll nachprüfen; die Aktion wird nicht automatisch wiederholt." };
    }
    if(this.recoveryNeedsInspection()&&!['read_file','list_files','grep','git_status','engine_detect','engine_status','debug_state','mcp_list','mcp_read_resource','mcp_read_output','set_plan','select_tools','ask_user','memory_list','skill_list','skill_read'].includes(name))return {error:'Lies zuerst den aktuellen Projekt- oder Dienststand. Die frühere unbestätigte Aktion bleibt gesperrt.'};
    if (this.state.operations.length >= 2048) throw new Error("Werkzeugprotokoll voll. Auftrag kontrolliert abschließen oder prüfen.");
    const id = `${this.state.id}:${this.state.operations.length + 1}`;
    this.state.operations.push({ id, name, fingerprint, effectFingerprint, inputStamp: this.inputStamp, status: "started", target: String(args.path || args.from || args.action || args.name || name).slice(0, 256), external: external(name), nodeId, at: Date.now() });
    if (nodeId) { const node = this.node(nodeId, name, args, "Prüfung läuft."); node.status = "running"; node.inputStamp = this.inputStamp; node.fingerprint = fingerprint; this.attempted.add(`${nodeId}:${this.inputStamp}`); }
    this.state.phase = checks(name) ? "observe" : "act";
    return { id };
  }

  finish(id: string | undefined, name: string, args: Record<string, unknown>, result: Record<string, unknown>) {
    const op = this.state.operations.find(op => op.id === id);
    const failed = workflowToolFailed(result), running = pending(result);
    const interrupted = Boolean(result.aborted || result.timedOut || result.interrupted || result.cancelled || result.canceled) || /abort|cancel|timed.?out|interrupted/i.test(String(result.status || ""));
    const knownFailure = result.definitelyNotExecuted || !interrupted && !running && (typeof result.code === "number" || result.ok === false && !result.error && !result.isError);
    const launchConfirmed = name==='engine_run'&&['editor','play'].includes(String(args.action))&&result.ok===true&&!failed;
    if (op) op.status = running && !launchConfirmed ? "unclear" : failed ? (op.external && !knownFailure ? "unclear" : "failed") : "confirmed";
    if (!failed && mutates(name) && !result.already_executed) {
      const paths = [args.path, args.from, args.to].filter((p): p is string => typeof p === "string");
      this.state.changed = [...new Set([...this.state.changed, ...paths])].slice(-256);
      this.dirty ||= paths.some(relevant);
    }
    if (checks(name)) {
      const target = String(args.path || args.action || name);
      const matching = op ? this.state.nodes.filter(n => n.id === op.nodeId || n.fingerprint === op.fingerprint && n.name === name) : [];
      if (!matching.length) {
        const observed = this.node(`observed:${name}:${op?.fingerprint || target.slice(0, 160)}`, name, args, "Ausdrücklich ausgeführte Prüfung.");
        observed.automatic = false; matching.push(observed);
      }
      for (const node of matching) {
        node.status = running ? "waiting" : failed ? "failed" : result.ok === true ? "passed" : "waiting";
        node.inputStamp = op?.inputStamp ?? this.inputStamp; node.fingerprint = op?.fingerprint;
        node.reason = running ? "Gestartet; abgeschlossene Prüfung noch unbestätigt." : failed ? "Prüfung fehlgeschlagen. Einzelheiten stehen im Werkzeugprotokoll." : result.ok === true ? "Prüfung für diesen Dateistand bestätigt." : "Erfolg nicht ausdrücklich bestätigt.";
        this.attempted.add(`${node.id}:${node.inputStamp}`);
      }
      const negativeCase = name === "shell" && Number(args.expected_exit_code) > 0 && result.exitExpectationMatched === true;
      const tested = !negativeCase && (name === "run_file" && (isTestFile(String(args.path || "")) || fileHasInlineTests(String(args.path || ""), this.files[String(args.path || "")] || "")) || name === "shell" && executedTestCommand(String(args.command || "")) || name === "engine_run" && args.action === "test");
      if (tested) {
        const test = this.node(`test:${name === "run_file" ? target : op?.fingerprint}`, name, args, "Testausführung für den aktuellen Dateistand.");
        Object.assign(test, { status: matching[0].status, inputStamp: matching[0].inputStamp, reason: matching[0].reason, fingerprint: op?.fingerprint });
      }
      if (name === "run_file" && !failed && !running && result.ok === true && (result.image || result.frame)) {
        const frame = this.node(`preview:${String(args.path || "")}`, "see_run", args, "Aufnahme bereits im Run-Ergebnis enthalten.");
        frame.status = "passed"; frame.inputStamp = op?.inputStamp ?? this.inputStamp; this.attempted.add(`${frame.id}:${frame.inputStamp}`);
      }
      this.state.phase = failed ? "patch" : "act";
    }
  }

  /** Queue safe, available checks only. Explicit service/Git/interactive actions stay with the model. */
  async next(final = false, remainingSees = this.opts.graphSees ?? 4): Promise<WorkflowAction | undefined> {
    if (!this.dirty && !this.state.changed.some(relevant)) return;
    const mode = effectiveAfterWrite(this.opts);
    const actions: WorkflowAction[] = [];
    const path = selectRunTarget(Object.keys(this.files), this.state.changed.at(-1));
    const configured = this.opts.graphLoop && mode!=="none" ? this.edges.filter(edge=>edge.enabled!==false&&projectEdgeCondition(edge)!=="manual"&&edge.glob&&this.state.changed.some(p=>relevant(p)&&matchGlob(p,edge.glob!))) : [];
    const configuredRun=configured.some(edge=>edge.edge!=="test"&&edge.tool===(mode==='engine'?'engine_run':'run_file'));
    if (!configuredRun && mode === "run" && this.opts.runLoop && path && isExecutablePath(path)) actions.push({ id: `run:${path}`, name: "run_file", args: { path }, reason: "Geänderten Dateistand ausführen." });
    if (!configuredRun && mode === "engine" && this.opts.engineLoop) actions.push({ id: "engine:check", name: "engine_run", args: { action: "check" }, reason: "Geänderte Engine-Dateien prüfen." });
    if (!configuredRun && mode === "preview" && this.opts.graphLoop && path && /\.html?$/i.test(path)) actions.push({ id: `run:${path}`, name: "run_file", args: { path }, reason: "Aktuelle HTML-Vorschau laden." });
    if (final && this.opts.autoRunAgent && path && isExecutablePath(path) && mode === "none") actions.push({ id: `run:${path}`, name: "run_file", args: { path }, reason: "Dateistand vor dem Abschluss ausführen." });
    if (this.opts.testLoop && final) {
      const tests = Object.keys(this.files).filter(p => isTestExt(p) && (isTestFile(p) || fileHasInlineTests(p, this.files[p]))).sort();
      for (const test of tests.slice(0, 64)) if(!configured.some(edge=>edge.edge==='test'&&edge.tool==='run_file'&&edge.args?.path===test))actions.push({ id: `test:${test}`, name: "run_file", args: { path: test }, reason: "Tests für den aktuellen Dateistand ausführen." });
    }
    if (this.opts.graphLoop && mode !== "none") for (const [i, edge] of this.edges.entries()) {
      const condition = projectEdgeCondition(edge);
      if (edge.enabled === false || condition === "manual" || !edge.glob) continue;
      const matches = this.state.changed.filter(p => relevant(p) && matchGlob(p, edge.glob!));
      if (!matches.length) continue;
      const id = edge.id || `edge:${i}`;
      if (condition === "failure" && !this.state.nodes.some(n => n.inputStamp === this.inputStamp && n.status === "failed")) continue;
      if (condition === "success" && !this.state.nodes.some(n => n.inputStamp === this.inputStamp && n.status === "passed")) continue;
      if (edge.phase && !["act", "observe", "see", "engine"].includes(edge.phase)) continue;
      if (edge.tool === 'engine_run' && mode === 'engine' && (edge.args?.cmd || edge.args?.command || edge.args?.action && !['check', 'test'].includes(String(edge.args.action)))) {
        const node = this.node(id, edge.tool, edge.args || {}, edge.when);
        node.status = 'disabled'; node.inputStamp = this.inputStamp;
        node.reason = 'Eigene Engine-Befehle und interaktive Engine-Aktionen werden nicht automatisch aus Projektregeln ausgeführt.';
        continue;
      }
      let action: WorkflowAction | undefined;
      if (edge.tool === "run_file" && (mode === "run" || mode === "preview")) action = { id, name: edge.tool, args: { path: String(edge.args?.path || selectRunTarget(Object.keys(this.files), matches[0])) }, reason: edge.when, phase:edge.phase };
      if (edge.tool === "engine_run" && mode === "engine" && this.opts.engineLoop) action = { id, name: edge.tool, args: { ...edge.args, action: edge.args?.action || "check" }, reason: edge.when, phase:edge.phase };
      if (edge.tool === "see_run" && remainingSees > 0 && condition === "success") action = { id, name: edge.tool, args: {}, reason: edge.when, phase:edge.phase };
      if (!action) continue;
      if (edge.dependsOn?.some(dep => !this.completed.has(dep)) || condition === "tests-passed" && !this.testsPassed) {
        const node = this.node(id, action.name, action.args, edge.when);
        node.status = "waiting"; node.inputStamp = this.inputStamp;
        node.reason = condition === "tests-passed" && !this.testsPassed ? "Wartet auf bestätigte Tests für den aktuellen Dateistand." : "Wartet auf bestätigte Vorgänger für den aktuellen Dateistand.";
        continue;
      }
      actions.push(action);
      // Formatting/interaction/service recipes describe available next work but never execute arbitrary project commands.
    }
    for (const action of actions) {
      const node = this.node(action.id, action.name, action.args, action.reason);
      const fingerprint = await toolCallFingerprint(action.name, action.args);
      if (!this.capabilities.has(action.name)) { node.status = "disabled"; node.inputStamp = this.inputStamp; node.reason = "Werkzeug in diesem Auftrag nicht freigegeben oder nicht verfügbar."; continue; }
      if (node.status === "passed" && node.inputStamp === this.inputStamp || this.attempted.has(`${node.id}:${this.inputStamp}`)) continue;
      const edge=this.edges.find(e=>e.id===action.id);
      const dependencyPath=edge?.dependsOn?.map(id=>this.state.nodes.find(n=>n.id===id&&n.name==='run_file')?.path).find(Boolean);
      const previewPath=String(action.args.path||dependencyPath||path||"");
      const equivalent = this.state.nodes.find(n => (n.fingerprint === fingerprint || action.name === "see_run" && n.id === `preview:${previewPath}`) && n.inputStamp === this.inputStamp && ["passed", "failed", "waiting"].includes(n.status));
      if (equivalent) { node.status = equivalent.status; node.inputStamp = equivalent.inputStamp; node.reason = equivalent.reason; node.fingerprint = fingerprint; this.attempted.add(`${node.id}:${this.inputStamp}`); continue; }
      if(action.phase&&action.phase!==this.phase){
        const checking=['act','patch','observe','engine','see'].includes(this.phase);
        const transition=checking&&(action.phase==='observe'&&action.name==='run_file'||action.phase==='engine'&&action.name==='engine_run'||action.phase==='see'&&action.name==='see_run'&&this.state.nodes.some(n=>n.name==='run_file'&&/\.html?$/i.test(n.path||'')&&this.completed.has(n.id)));
        if(!transition){node.status='waiting';node.inputStamp=this.inputStamp;node.reason='Wartet auf die zugeordnete Ablaufphase.';continue;}
        this.state.phase=action.phase;
      }
      node.status = "ready"; node.fingerprint = fingerprint; return action;
    }
    this.dirty = false;
  }

  summary() {
    return [...this.state.nodes.slice(-12).map(n => `${n.label}: ${n.status} — ${n.reason}`),
      ...this.state.operations.filter(op=>op.external&&op.status==='unclear').slice(-8).map(op=>`Unconfirmed external effect ${op.id} (${op.target}): do not repeat it, including with different arguments or through another tool. ${op.recovery?'Continue from the observed current state; this action remains unknown and blocked. No user outcome declaration is required.':'Inspect its actual outcome or resume while keeping it blocked.'}`),
      ...this.state.operations.filter(op=>op.resolution).slice(-8).map(op=>`User-reviewed effect ${op.id} (${op.target}): ${op.resolution!.outcome}. ${op.resolution!.note}. This review is not task acceptance and does not authorize replay.`),
    ].join("\n");
  }
}
