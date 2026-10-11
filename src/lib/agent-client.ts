import { chatUsage, resolvedUsage, withRequestTokens, type TokenUsage, type RequestTokens } from "./token-usage";
import { verifyForegroundArtifacts } from "./acceptance-artifacts";
import { modelSeesImages, ingestModelInputs } from "./ref";
import { ToolSession, toolTargetKey, toolCompatibility } from "./tool-compat";
import { ToolLearningSession } from "./tool-learning";
import { grokRound } from "./agent";
import {
  pickAgentTools,
  runAgentLoop,
  type AgentFile,
  type AgentMessage,
  type AgentResult,
  type LlmChoice,
  type GitInfo,
  type WorkspaceEvent,
} from "./agent-core";
import { stripPayload, shrinkTools, prepareTextTools } from "./tool-fallback";
import { runAgentShell } from "./agent-shell";
import { agentDebug } from "./debug-engine";
import { agentLearn, useLearn, foregroundKnowledgePermissions } from "./learn";
import { stripZipRoot, unzipFiles } from "./archive";
import { formatCode } from "./format";
import { cloneGithub, pushGithub } from "./github";
import { applyLlmOptions, patchResponses400, responsesBody, toResponsesTools, usesResponsesApi, type ThinkingMode } from "./llm-options";
import { parseResponsesSse } from "./responses-parse";
import { fitMessages, isContextError, isVramError, prepChatPayload, shrinkLocalCtx, USER_REQUEST_MARK, type CompactMode } from "./compact";
import { isPrivateHost } from "./net-guard";
import { proxyLlm, toAnthropicMessages } from "./llm-proxy";
import { readSseChat, readSseResponses, readSseAnthropic, StreamStallError } from "./sse";
import { fetchWeb } from "./web-fetch";
import {
  PROVIDER_DEFAULTS,
  providerOf,
  type LlmProvider,
  type ProviderSpec,
} from "./providers";

import { keyForProvider } from "./secrets";
import { cliKindFor, completeViaCli } from "./cli-client";
import { fetchModels, normalizeBaseUrl } from "./connection";
export { normalizeBaseUrl } from "./connection";
import { lanFetch, hasLlmTransport } from "./lan-fetch";
import { localChatUrl, sanitizeLocalPayload, wrapOllamaResponse } from "./local-wire";
import { anthropicHeaders, pipeHeaders, responsesNative } from "./llm-headers";
import { AgentAbortError, agentBeat, agentGen, isAbortLike, explainAbort, hardStopMs, cloudStopMs, shouldRetryLocalLlm } from "./abort";
import { bindAgentRun, captureAgentRun, type AgentRun } from "./agent-run";
import { useIde } from "@/store/ide";
import { ANVIL_SURFACE, toolsAllowed } from "./surface";
import { surfaceNote } from "./surface-context";
import { requestPhase } from "./request-state";
import { withCompanion } from "./companion-life";
import {
  applyCapToPayload,
  noteToolSuccess,
  getCap,
  learnFromError,
  sendTools,
} from "./model-caps";
import type { SessionJournal } from "./session";
export type { LlmProvider };
export { PROVIDER_DEFAULTS, providerOf };

function isBrowserTarget(spec: ProviderSpec, baseUrl: string): boolean {
  if (spec.kind === "local" || spec.id === "custom") return true;
  if (spec.id === "grok") return false;
  const raw = (baseUrl || spec.baseUrl).trim();
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return isPrivateHost(u.hostname);
  } catch {
    return spec.kind !== "cloud";
  }
}


function corsHint(spec: ProviderSpec, baseUrl = ""): string {
  if (spec.kind === "local" || isBrowserTarget(spec, baseUrl)) {
    return `${spec.label} nicht erreichbar. API-Adresse, Serverstatus und Netzwerkverbindung prüfen. Anbieter und API-Adresse müssen zum verwendeten Modellserver passen.`;
  }
  return `${spec.label} nicht erreichbar. URL und Key prüfen.`;
}


export function pickListedModel(ids: string[], want: string): string {
  if (!ids.length) return want;
  if (want && ids.includes(want)) return want;
  const stem = (want || "").split(":")[0];
  if (stem) {
    const hit = ids.find((id) => id === stem || id.startsWith(`${stem}:`) || id.includes(stem));
    if (hit) return hit;
  }
  return ids[0];
}

export async function listLocalModels(baseUrl: string, apiKey: string): Promise<string[]> {
  return listModels({ provider: "custom", baseUrl, apiKey });
}

export async function listModels(opts: {
  provider: LlmProvider | string;
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const spec = providerOf(opts.provider);
  if (spec.id === "grok") return spec.models;
  if (spec.id === "brain") {
    const { BRAIN_MODELS } = await import("./brain/models");
    return BRAIN_MODELS.map((m) => m.id);
  }
  if (isBrowserTarget(spec, opts.baseUrl) || hasLlmTransport()) {
    const base = normalizeBaseUrl(opts.baseUrl || spec.baseUrl);
    const result = await fetchModels(opts, (url, init) => lanFetch(url, init, spec.id === "custom" ? base : ""));
    opts.signal?.throwIfAborted();
    const context = await import("./model-context");
    for (const row of result.rows) context.ingestModelRow(row);
    ingestModelInputs(spec.id, base, result.rows);
    return result.ids;
  }
  const r = await proxyLlm({ data: { action: "models", provider: spec.id, baseUrl: opts.baseUrl || spec.baseUrl, model: "", apiKey: opts.apiKey }, signal: opts.signal });
  opts.signal?.throwIfAborted();
  if (!r.ok) throw new Error(r.error || "Modelle fehlgeschlagen");
  if (r.modelRows) {
    const rows = JSON.parse(r.modelRows) as Record<string, unknown>[];
    const context = await import("./model-context");
    for (const row of rows) context.ingestModelRow(row);
    ingestModelInputs(spec.id, normalizeBaseUrl(opts.baseUrl || spec.baseUrl), rows);
  }
  return r.models ?? [];
}

export async function chatWithProvider(opts: {
  authMode?: "key" | "abo";
  run?: AgentRun;
  provider: LlmProvider | string;
  baseUrl: string;
  model: string;
  apiKey: string;
  messages: AgentMessage[];
  files: AgentFile[];
  dirs?: string[];
  git?: GitInfo;
  githubToken?: string;
  context?: number;
  thinking?: ThinkingMode;
  compact?: CompactMode;
  onDelta?: (s: string, kind?: "text" | "think") => void;
  onWorkspace?: (ev: WorkspaceEvent) => void | Promise<void>;
  onTool?: (info: { name: string; args: Record<string, unknown>; result: unknown }) => void;
  onToolStart?: (info: { name: string; args: Record<string, unknown> }) => void;
  getPlan?: () => import("@/store/ide").PlanStep[] | undefined;
  canReplacePlan?: () => boolean;
  onUsage?: (usage: TokenUsage, request?: RequestTokens) => void;
  onHarness?: (bar: string) => void;
  workflow?: import("./agent-workflow").WorkflowSnapshot;
  workflowId?: string;
  onWorkflow?: (snapshot: import("./agent-workflow").WorkflowSnapshot) => void | Promise<void>;
  runLoop?: boolean;
  graphLoop?: boolean;
  testLoop?: boolean;
  engineLoop?: boolean;
  loopTries?: number;
  engineOk?: boolean;
  afterWrite?: "run" | "engine" | "preview" | "none";
  maxRounds?: number;
  autoContinueRounds?: boolean;
  graphSees?: number;
  journal?: SessionJournal;
  memory?: string;
  prefer?: string[];
  locale?: "de" | "en";
  observeOnly?: boolean;
}): Promise<AgentResult> {
  const epoch = useIde.getState().workspaceEpoch;
  const authMode = opts.authMode ?? useIde.getState().llmAuthMode;
  const scope = opts.run ?? captureAgentRun(() => useIde.getState().workspaceEpoch === epoch);
  const run = scope.generation;
  scope.assertCurrent();
  const original = opts;
  opts = bindAgentRun(scope, {
    ...original,
    onDelta: (chunk, kind) => {
      requestPhase(run, kind === "think" ? "thinking" : "answering");
      original.onDelta?.(chunk, kind);
    },
    onToolStart: (info) => { requestPhase(run, "tool", info.name); original.onToolStart?.(info); },
    onTool: (info) => { original.onTool?.(info); requestPhase(run, "preparing"); },
  });
  const spec = providerOf(opts.provider);
  const grokApiKey = spec.id === "grok" ? (opts.apiKey || keyForProvider("xai")).trim() : "";
  const surface = await surfaceNote(scope);
  scope.assertCurrent();
  const mcpCatalog = surface.text;
  if (spec.id === "grok") {
    const complete = async (
      messages: Record<string, unknown>[],
      useTools: boolean | "required",
      onDelta?: (s: string, kind?: "text" | "think") => void,
    ): Promise<LlmChoice> => {
      scope.assertCurrent();
      requestPhase(run, "waiting");
      const stop = cloudStopMs(useIde.getState().llmHardStopMin);
      const key = grokApiKey;
      if (key) {
        try {
          const payload = applyLlmOptions(
            {
              model: "grok-4.5",
              messages,
              stream: Boolean(onDelta),
            },
            { provider: "xai", model: "grok-4.5", api: "openai", context: opts.context ?? 131072, thinking: opts.thinking ?? "auto" },
            { tools: Boolean(useTools) },
          );
          if (useTools) {
            payload.tools = toolsForCall(opts.observeOnly);
            payload.tool_choice = useTools === "required" ? "required" : "auto";
          }
          prepChatPayload(payload, Number(opts.context) || 131072);
          const res = await scope.wait(lanFetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${key}` },
            body: JSON.stringify(payload),
            signal: scope.timeout(stop),
          }));
          if (res.ok) {
            if (payload.stream) return withRequestTokens(await readSseChat(res, onDelta), payload, opts.context ?? 131072);
            const json = (await res.json()) as { choices: { message: LlmChoice }[]; usage?: unknown };
            const choice = json.choices[0]?.message;
            if (choice) choice.usage = chatUsage(json.usage);
            if (!choice) throw new Error("Leere Antwort vom Modell");
            if (!choice.reasoning && typeof choice.reasoning_content === "string") choice.reasoning = choice.reasoning_content;
            if (choice.reasoning) onDelta?.(choice.reasoning, "think");
            if (choice.content) onDelta?.(choice.content, "text");
            return withRequestTokens(choice, payload, opts.context ?? 131072);
          }
        } catch (err) {
          if (err instanceof AgentAbortError) throw err;
          scope.assertCurrent();
        }
      }
      scope.assertCurrent();
      const r = await scope.wait(grokRound({ data: { messages, useTools: Boolean(useTools) }, signal: scope.signal }), stop);
      if (!r.ok || !r.choice) throw new Error(r.error || "Keine Antwort vom Modell");
      if (r.choice.reasoning) onDelta?.(r.choice.reasoning, "think");
      if (r.choice.content && !r.choice.tool_calls?.length) onDelta?.(r.choice.content, "text");
      return r.choice;
    };
    return runAgentLoop(
      {
        messages: opts.messages,
        files: opts.files,
        dirs: opts.dirs,
        git: opts.git,
        context: opts.context,
        compact: opts.compact,
        ...harnessFrom(opts),
        mcpCatalog,
        surfaceId: surface.id,
        surfaceMode: surface.mode,
        journal: opts.journal,
        memory: opts.memory,
        prefer: opts.prefer,
        locale: opts.locale,
        observeOnly: opts.observeOnly,
        workflow: opts.workflow, workflowId: opts.workflowId, autoRunAgent: !opts.observeOnly && useIde.getState().autoRunAgent,
      },
      complete,
      { ...clientTools(opts, scope), run: scope, onHarness: opts.onHarness, onUsage: opts.onUsage, onWorkflow: opts.onWorkflow, capabilities: toolsForCall(opts.observeOnly).map(t => t.function.name) },
    );
  }
  if (spec.id === "brain") {
    return {
      ok: false,
      reply: "Der lokale Helfer denkt nicht. Unter Einstellungen → Agent ein Hauptmodell wählen (Ollama, OpenAI, …).",
      error: "brain-not-agent",
    };
  }
  const model = opts.model.trim() || spec.model;
  if (!model) return { ok: false, reply: "Bitte ein Modell wählen.", error: "no model" };
  const cliKind = cliKindFor(spec.id, authMode);
  if (!cliKind && spec.needsKey && !opts.apiKey.trim()) {
    return { ok: false, reply: `API-Key für ${spec.label} unter Einstellungen eintragen.`, error: "no key" };
  }

  const learningKey = cliKind ? "" : toolTargetKey(spec.id, model, normalizeBaseUrl(opts.baseUrl || spec.baseUrl));
  const toolSession = cliKind ? undefined : new ToolSession(
    toolCompatibility(useIde.getState().llmToolModes[learningKey]),
    opts.messages.filter((m) => m.role === "user").at(-1)?.content || "",
  );
  const toolLearning = toolSession ? new ToolLearningSession({
    get: () => useIde.getState().llmToolLearning[learningKey] || { rules: [] },
    update: (fn) => useIde.getState().updateToolLearning(learningKey, fn),
    contract: () => toolSession.contract, compatibility: toolSession.mode, locale: opts.locale,
  }) : undefined;
  const transport = cliKind
    ? async (messages: Record<string, unknown>[], useTools: boolean | "required", onDelta?: (s: string, kind?: "text" | "think") => void) => {
        const offered = useTools ? toolsForCall(opts.observeOnly) : [];
        scope.assertCurrent();
        const choice = await completeViaCli(cliKind, model, messages, offered, hardStopMs(useIde.getState().llmHardStopMin), onDelta, opts.thinking ?? "auto", scope.signal);
        scope.assertCurrent();
        choice.usage = resolvedUsage(choice, messages, offered);
        return choice;
      }
    : isBrowserTarget(spec, opts.baseUrl)
    ? makeLocalComplete(spec, opts.baseUrl, model, opts.apiKey, opts.context, opts.thinking, opts.observeOnly, toolSession, scope)
    : makeProxyComplete(spec, opts.baseUrl, model, opts.apiKey, opts.context, opts.thinking, opts.observeOnly, toolSession, scope);

  let modelRound = 0;
  const complete: typeof transport = async (messages, tools, onDelta) => {
    scope.assertCurrent();
    requestPhase(run, "waiting");
    const round = ++modelRound;
    const choice = await transport(messages, tools, onDelta);
    const { appLog } = await import("./app-log");
    scope.assertCurrent();
    appLog("agent", `R${run} Antwort ${round} · text=${choice.content?.length ?? 0} think=${choice.reasoning?.length ?? 0} Werkzeugaufrufe=${choice.tool_calls?.length ?? 0} finish=${choice.finish_reason || "-"}`);
    if (toolSession) {
      choice.toolContract = { ...toolSession.contract, names: [...toolSession.contract.names] };
      if (toolSession.mode === "standard" && choice.toolContract.transport === "native" && choice.toolContract.names.length > 0) delete choice.toolContract;
    }
    return choice;
  };

  try {
    return await runAgentLoop(
      {
        messages: opts.messages,
        files: opts.files,
        dirs: opts.dirs,
        git: opts.git,
        context: opts.context,
        compact: opts.compact,
        ...harnessFrom(opts),
        mcpCatalog,
        surfaceId: surface.id,
        surfaceMode: surface.mode,
        journal: opts.journal,
        memory: opts.memory,
        prefer: opts.prefer,
        locale: opts.locale,
        observeOnly: opts.observeOnly,
        workflow: opts.workflow, workflowId: opts.workflowId, autoRunAgent: !opts.observeOnly && useIde.getState().autoRunAgent,
      },
      complete,
      { ...clientTools(opts, scope), run: scope, onHarness: opts.onHarness, onUsage: opts.onUsage,
        onWorkflow: opts.onWorkflow, capabilities: toolsForCall(opts.observeOnly).map(t => t.function.name),
        toolLearning,
        selectTools: toolSession ? (names) => toolSession.select(names) : undefined,
        tryTextFallback: toolSession ? () => toolSession.tryTextFallback() : undefined,
        onNativeToolSuccess: cliKind ? undefined : () => noteToolSuccess(spec.id, model, normalizeBaseUrl(opts.baseUrl || spec.baseUrl)),
      },
    );
  } catch (err) {
    requestPhase(run, isAbortLike(err) ? "stopped" : "error");
    const msg = err instanceof Error ? err.message : String(err);
    const blocked =
      msg === "Failed to fetch" ||
      msg.includes("NetworkError") ||
      msg.includes("Load failed") ||
      msg.includes("CORS");
    return { ok: false, reply: blocked ? corsHint(spec, opts.baseUrl) : msg, error: msg };
  }
}

function harnessFrom(opts: {
  runLoop?: boolean;
  graphLoop?: boolean;
  testLoop?: boolean;
  engineLoop?: boolean;
  loopTries?: number;
  engineOk?: boolean;
  afterWrite?: "run" | "engine" | "preview" | "none";
  maxRounds?: number;
  autoContinueRounds?: boolean;
  graphSees?: number;
}) {
  const st = useIde.getState();
  return {
    runLoop: opts.runLoop ?? st.runLoop ?? false,
    graphLoop: opts.graphLoop ?? st.graphLoop ?? false,
    testLoop: opts.testLoop ?? st.testLoop,
    engineLoop: opts.engineLoop ?? st.engineLoop,
    loopTries: opts.loopTries ?? st.loopTries ?? 3,
    engineOk: opts.engineOk ?? Boolean(st.engineLink?.ok),
    afterWrite: opts.afterWrite ?? st.harnessAfterWrite,
    maxRounds: opts.maxRounds ?? st.harnessMaxRounds,
    autoContinueRounds: opts.autoContinueRounds ?? st.harnessAutoContinue,
    graphSees: opts.graphSees ?? st.graphSees,
  };
}

export const chatWithLocalAgent = chatWithProvider;

function clientTools(opts: {
  githubToken?: string;
  git?: GitInfo;
  onDelta?: (s: string, kind?: "text" | "think") => void;
  onWorkspace?: (ev: WorkspaceEvent) => void | Promise<void>;
  onTool?: (info: { name: string; args: Record<string, unknown>; result: unknown }) => void;
  onToolStart?: (info: { name: string; args: Record<string, unknown> }) => void;
  getPlan?: () => import("@/store/ide").PlanStep[] | undefined;
  canReplacePlan?: () => boolean;
}, scope: AgentRun) {
  const mcpStart = useIde.getState();
  const mcpGeneration = scope.generation;
  const mcpSignal = scope.signal;
  const mcpScope = new Set((mcpStart.mcpServers || []).filter((s) => mcpStart.surfaceMode === "bridge" || !mcpStart.activeSurfaceId || mcpStart.activeSurfaceId === ANVIL_SURFACE || s.id === mcpStart.activeSurfaceId).map((s) => s.id));
  const mcpCurrent = scope.assertCurrent;
  const tools = {
    verifyArtifacts: (result: Record<string, unknown>) => verifyForegroundArtifacts(result, mcpStart.workspaceCwd || '', scope),
    onNotice: (kind: string, text: string) => {
      if (kind === "agent") void import("./intern").then((m) => { if (scope.current()) m.note("agent", text); });
      else void import("./app-log").then((m) => { if (scope.current()) m.appLog(kind, text); });
    },
    verify: async (paths: string[]) => {
      const { refreshProblems } = await import("./problems");
      scope.assertCurrent();
      const result = await refreshProblems();
      scope.assertCurrent();
      if (!result.current) return { ok: false, detail: "Dateien während der Diagnose geändert. Prüfung ist überholt." };
      const hits = result.hits.filter((h) => !paths.length || paths.includes(h.path));
      const errors = hits.filter((h) => h.severity === "error");
      const missing = paths.filter((p) => /\.(?:py|[cm]?[jt]sx?)$/.test(p) && !result.checked.includes(p));
      if (errors.length || missing.length) return { ok: false, detail: [
        ...errors.slice(0, 20).map((h) => `${h.path}:${h.line} [${h.source}] ${h.message}`),
        ...(missing.length ? [`Prüfung nicht verfügbar für: ${missing.join(", ")}. ${result.errors.join("; ")}`] : []),
      ].join("\n") };
      return { ok: true, detail: hits.length ? `${hits.length} Warnung(en)/Hinweis(e) verbleiben; keine aktuellen Fehler in den betroffenen Dateien.` : "Keine aktuellen Fehler in den betroffenen Dateien." };
    },
    onDelta: opts.onDelta,
    onWorkspace: opts.onWorkspace,
    onTool: opts.onTool,
    onToolStart: opts.onToolStart,
    getPlan: opts.getPlan,
    canReplacePlan: opts.canReplacePlan,
    fetchUrl: async (url: string) => {
      const r = await scope.wait(fetchWeb({ data: { url }, signal: scope.signal }));
      if (!r.ok) throw new Error(r.text);
      return r.text;
    },
    formatFile: (path: string, content: string) => formatCode(path, content),
    gitStatus: async () => {
      const { useIde } = await import("@/store/ide");
      scope.assertCurrent();
      const st = useIde.getState();
      const cwd = st.workspaceCwd?.trim();
      const ram = {
        ram: true,
        dirty: Object.keys(st.dirty || {}),
        commits: (st.commits ?? []).slice(-8),
        repo: st.githubRepo || "",
      };
      if (!cwd) return { ok: false, error: "Kein Projektordner. Companion koppeln für echtes git.", ...ram };
      const { companionGit } = await import("./companion");
      scope.assertCurrent();
      const live = await scope.wait(companionGit("status", { cwd }, st.companionUrl || undefined, scope.signal));
      if (!live.ok) return { ...live, ...ram };
      return {
        ok: true,
        branch: live.branch,
        files: live.files,
        log: live.log,
        repo: live.repo,
        cwd: live.cwd,
      };
    },
    gitCommit: async (message: string) => {
      const { useIde } = await import("@/store/ide");
      scope.assertCurrent();
      const st = useIde.getState();
      const cwd = st.workspaceCwd?.trim();
      if (!cwd) return { ok: false, error: "Kein Projektordner. Commit wäre nur Sitzung — Companion koppeln." };
      const { flushDiskSync } = await import("./disk-sync");
      scope.assertCurrent();
      await flushDiskSync();
      const { companionGit } = await import("./companion");
      scope.assertCurrent();
      return scope.wait(companionGit("commit", { cwd, message }, st.companionUrl || undefined, scope.signal));
    },
    gitClone: async (url: string) => {
      const r = await scope.wait(cloneGithub({ data: { url, token: opts.githubToken }, signal: scope.signal }));
      const raw = atob(r.zipB64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      const pack = stripZipRoot(await unzipFiles(buf.buffer));
      scope.assertCurrent();
      return Object.entries(pack).map(([path, content]) => ({ path, content }));
    },
    gitPush: async (message: string, files: Record<string, string>) => {
      const { useIde } = await import("@/store/ide");
      scope.assertCurrent();
      const cwd = useIde.getState().workspaceCwd?.trim();
      if (cwd) {
        const { flushDiskSync } = await import("./disk-sync");
        scope.assertCurrent();
        await flushDiskSync();
        const { companionGit } = await import("./companion");
        scope.assertCurrent();
        const url = useIde.getState().companionUrl || undefined;
        const c = await scope.wait(companionGit("commit", { cwd, message }, url, scope.signal));
        const p = await scope.wait(companionGit("push", { cwd }, url, scope.signal));
        if (p.ok) return { sha: "git", repo: cwd, via: "companion" as const };
        if (c.ok === false && /nothing to commit|nichts zu/i.test(String(c.error || c.stdout || ""))) {
          const p2 = await scope.wait(companionGit("push", { cwd }, url, scope.signal));
          if (p2.ok) return { sha: "git", repo: cwd, via: "companion" as const };
        }
        if (!opts.githubToken) return { sha: "", repo: cwd, error: p.error || c.error || "git push fehlgeschlagen" };
      }
      const repo = opts.git?.repo?.trim();
      const token = opts.githubToken?.trim() ?? "";
      if (!repo || !token) throw new Error("GitHub-Repo und Token unter Einstellungen eintragen — oder Projektordner koppeln.");
      const { isSecretPath } = await import("./ref");
      scope.assertCurrent();
      const safe: Record<string, string> = {};
      for (const [p, c] of Object.entries(files)) if (!isSecretPath(p)) safe[p] = c;
      return scope.wait(pushGithub({ data: { repo, token, message, files: safe }, signal: scope.signal }));
    },
    shell: (command: string, files: Record<string, string>) => runAgentShell(command, files, scope),
    debug: (action: string, args: Record<string, unknown>) => agentDebug(action, args, scope),
    learn: (action: string, args: Record<string, unknown>) => agentLearn(action, args),
    summarize: async (blob: string) => {
      const { brainCompact, brainReady } = await import("./brain");
      scope.assertCurrent();
      const cut = blob.slice(0, 8000);
      if (!brainReady()) return cut;
      try {
        return await scope.wait(brainCompact(blob, scope.signal));
      } catch {
        scope.assertCurrent();
        return cut;
      }
    },
    mcp: async (action: "list" | "call" | "read" | "output", server?: string, name?: string, args?: unknown) => {
      const { mcpCatalogPage, mcpCall, mcpReadResource, mcpReadOutput, modelMcpResult } = await import("./mcp");
      mcpCurrent();
      const st = useIde.getState();
      const servers = (st.mcpServers ?? []).filter((s) => mcpScope.has(s.id));
      const want = server?.trim() || (mcpStart.activeSurfaceId !== ANVIL_SURFACE ? mcpStart.activeSurfaceId : "");
      const options = args && typeof args === "object" ? args as Record<string, unknown> : {};
      if (action === "output") return mcpReadOutput(servers, options);
      if (action === "list") {
        const page = await mcpCatalogPage(servers, options, mcpSignal);
        mcpCurrent();
        return modelMcpResult(servers.filter((s) => s.enabled).map((s) => s.id), page);
      }
      const t0 = Date.now();
      const sid = servers.find((s) => s.id === want || s.name === want)?.id || want;
      try {
        const raw = action === "read"
          ? await mcpReadResource(servers, want, name || "", mcpSignal)
          : await mcpCall(servers, want, name ?? "", args,
            st.mcpStream ? (chunk) => {
              if (!scope.current()) return;
              agentBeat();
              const prev = useIde.getState().mcpView[sid]?.text ?? "";
              useIde.getState().setMcpView(sid, { text: (prev + chunk).slice(-8000), at: Date.now() });
              void import("./live-write").then((m) => { if (scope.current()) m.applyMcpLive(sid, name ?? "", args, chunk); });
            } : undefined, { cwd: mcpStart.workspaceCwd || undefined, signal: mcpSignal });
        mcpCurrent();
        const rec = raw && typeof raw === "object" ? raw as { text?: string; image?: string; images?: string[]; isError?: boolean } : null;
        const text = rec?.text || (typeof raw === "string" ? raw : JSON.stringify(raw));
        st.pushMcpLog({ at: t0, server: sid, name: name ?? "", ok: !rec?.isError, detail: String(text).slice(0, 400), image: rec?.image });
        st.setMcpView(sid, { text: String(text), image: rec?.image, images: rec?.images, at: Date.now() });
        return modelMcpResult(sid, raw, { images: modelSeesImages(mcpStart.llmProvider, mcpStart.llmModel, normalizeBaseUrl(mcpStart.llmBaseUrl || providerOf(mcpStart.llmProvider).baseUrl)) });
      } catch (error) {
        if (scope.current()) st.pushMcpLog({ at: t0, server: sid, name: name ?? "", ok: false, detail: String(error instanceof Error ? error.message : error).slice(0, 400) });
        throw error;
      } finally {
        if (st.mcpStream) (await import("./live-write")).finishLiveWrite(mcpGeneration);
      }
    },
    engine: async (action: "status" | "run", args?: Record<string, unknown>) => {
      const { companionPing, companionRun } = await import("./companion");
      const { detectEngines } = await import("./engines");
      const { engineReady, planEngineRun } = await import("./engine-request");
      const { useIde } = await import("@/store/ide");
      const st = useIde.getState();
      const url = st.companionUrl || "http://127.0.0.1:7845";
      const hits = detectEngines(st.files, st.dirs);
      const hit = hits[0];
      const current = () => {
        mcpCurrent();
        const live = useIde.getState();
        if (live.workspaceEpoch !== st.workspaceEpoch || live.workspaceCwd !== st.workspaceCwd || live.companionUrl !== st.companionUrl)
          throw new Error("Projekt oder Companion inzwischen gewechselt. Engine-Auftrag erneut starten.");
      };
      current();
      const { withCompanion } = await import("./companion-life");
      current();
      if (args?.detect || action === "status") {
        const ping = await withCompanion(() => { current(); return companionPing(url, scope.signal); }, url, st.workspaceCwd, scope);
        current();
        st.setEngineLink(hit ? { label: hit.label, ok: engineReady(hit, ping) } : null);
        const engines = hits.map((engine) => ({ ...engine, installed: engineReady(engine, ping) }));
        if (args?.detect) return { engines, companion: ping };
        return { ...ping, engines };
      }
      if (!st.workspaceCwd.trim()) return { ok: false, error: "Für die Engine zuerst einen lokalen Projektordner öffnen. Ein Projekt nur in Anvils Sitzung reicht nicht." };
      const plan = planEngineRun(hits, args);
      const { saveNow } = await import("./save");
      current();
      if (!await saveNow({ all: true, format: false })) return { ok: false, error: "Projekt konnte nicht vollständig gespeichert werden. Änderungen zuerst abgleichen." };
      current();
      const job = await withCompanion(() => {
        current();
        return companionRun({ cmd: plan.cmd, action: plan.action, cwd: st.workspaceCwd, timeoutMs: Number(args?.timeoutMs) || 90000 }, url, scope.signal);
      }, url, st.workspaceCwd, scope);
      current();
      st.pushOutput({ ...job, duration: job.duration / 1000, label: `${plan.hit?.label || "Engine"} · ${plan.action}` });
      st.revealOutput();
      return { ...job, engineId: plan.hit?.id, engine: plan.hit?.label, projectRoot: plan.hit?.root,
        ...(job.running ? { status: "Engine läuft. Das bestätigt den Start, keinen erfolgreichen Build oder Test." } : {}) };
    },
    runFile: async (path: string, files: Record<string, string>, asTest = false) => {
      const { runLoopFile } = await import("./run-loop");
      const { prepared } = await import("./test-wrap");
      const { useIde } = await import("@/store/ide");
      scope.assertCurrent();
      const st = useIde.getState();
      st.setRunPath(path);
      const r = await runLoopFile(path, asTest ? prepared(files, path) : files, { graph: st.graphLoop, tries: st.runLoop ? st.loopTries : 1, run: scope });
      scope.assertCurrent();
      st.pushOutput({
        ok: r.ok,
        stdout: r.stdout,
        stderr: r.stderr,
        duration: r.duration,
        label: path,
        html: r.html,
        stage: r.stage,
      });
      if (!r.graphical && (r.stage?.kind === "window" || r.stage?.kind === "log" || st.openOutputOnRun)) {
        st.revealOutput();
        if (r.stage?.kind === "window" || r.stage?.kind === "log") st.setPreviewOpen(false);
      }
      const { html: _html, ...out } = r;
      return out;
    },
    play: async (keys: string[], hold?: number) => {
      const { playLoop } = await import("./run-loop");
      const { useIde } = await import("@/store/ide");
      scope.assertCurrent();
      const st = useIde.getState();
      if (!st.runHtml) return { ok: false, error: "HTML-Run aus (Einstellungen → Ausgabe)." };
      if (!st.graphLoop) return { ok: false, error: "Graph-Schleife aus" };
      const shot = await playLoop(keys, hold, scope);
      return { ok: shot.ok === true, error: shot.error, state: shot.state, keys, logs: shot.logs, size: shot.w ? `${shot.w}×${shot.h}` : undefined, image: shot.image };
    },
    see: async () => {
      const { shotLoop } = await import("./run-loop");
      const { useIde } = await import("@/store/ide");
      const { previewFor } = await import("./preview-doc");
      const { openRunWindow, keepAgentRun } = await import("./run-window");
      scope.assertCurrent();
      const st = useIde.getState();
      keepAgentRun();
      const last = [...st.output].reverse().find((o) => o.stdout || o.stderr || o.html);
      if (last?.stage?.id && last.stage.kind !== "html") {
        st.revealOutput();
        const { companionRunStatus } = await import("./companion");
        scope.assertCurrent();
        const current = await scope.wait(companionRunStatus(last.stage.id, st.companionUrl || undefined, scope));
        return { ok: current.ok, running: current.running, stage: current.stage?.kind,
          out: current.stage?.out, stdout: current.stdout, stderr: current.stderr,
          note: current.running ? "Natives Programm läuft im eigenen Fenster/Terminal. Tasten dort eingeben." : "Native Ausführung beendet; dies ist das tatsächliche Prozessergebnis." };
      }
      if (!st.runHtml) return { ok: false, error: "HTML-Run aus (Einstellungen → Ausgabe)." };
      const htmlPath =
        (st.runPath && /\.html?$/i.test(st.runPath) ? st.runPath : "") ||
        (st.activePath && /\.html?$/i.test(st.activePath) ? st.activePath : "") ||
        (last?.label && /\.html?$/i.test(last.label) ? last.label : "") ||
        Object.keys(st.files).find((p) => /\.html?$/i.test(p)) ||
        "";
      if (!htmlPath && last && !last.html) {
        st.revealOutput();
        return {
          ok: last.ok,
          stage: last.stage?.kind || "log",
          stdout: (last.stdout || "").slice(0, 4000),
          stderr: (last.stderr || "").slice(0, 1500),
          note: "Bühne: Compile/Run-Log. see_run hat bei Native kein iframe.",
        };
      }
      if (st.runInWindow || st.runPopout) {
        openRunWindow({ agent: true });
        st.setPreviewOpen(false);
      } else {
        st.setPreviewOpen(true);
        const { agentOpenedPreview } = await import("./run-window");
        scope.assertCurrent();
        agentOpenedPreview();
      }
      const path = htmlPath;
      const src = path ? st.files[path] : "";
      let html = src;
      if (path && src) {
        const view = await previewFor(path, src, st.files, st.output.at(-1), st.inputMap, st.runHtml);
        scope.assertCurrent();
        if (view.kind === "iframe") html = view.srcDoc;
      }
      const shot = await shotLoop(html || undefined, undefined, scope);
      if (!shot.image) {
        if (last && !last.html) {
          return {
            ok: last.ok,
            stage: "log",
            stdout: (last.stdout || "").slice(0, 4000),
            note: "Kein HTML-Frame. Letzter Compile/Run.",
          };
        }
        return { ok: false, error: shot.error || "Keine Aufnahme der geöffneten Ausgabe verfügbar.", state: shot.state, logs: shot.logs };
      }
      return { ok: shot.ok === true, error: shot.error, state: shot.state, logs: shot.logs, size: shot.w ? `${shot.w}×${shot.h}` : undefined, image: shot.image };
    },
  };
  const guarded = bindAgentRun(scope, tools);
  return bindAgentRun(scope, {
    ...guarded,
    gitStatus: () => withCompanion(guarded.gitStatus, undefined, undefined, scope),
    gitCommit: (...args: Parameters<typeof tools.gitCommit>) => withCompanion(() => guarded.gitCommit(...args), undefined, undefined, scope),
    gitPush: (...args: Parameters<typeof tools.gitPush>) => withCompanion(() => guarded.gitPush(...args), undefined, undefined, scope),
    engine: (...args: Parameters<typeof tools.engine>) => withCompanion(() => guarded.engine(...args), undefined, undefined, scope),
  });
}

function toolsForCall(observeOnly = false, session?: ToolSession) {
  const st = useIde.getState();
  const compatible = Boolean(session && session.mode !== "standard");
  const picked = pickAgentTools({
    observeOnly,
    compatibility: compatible,
    mcp: compatible || st.mcpServers.some((s) => s.enabled) || Boolean(st.activeSurfaceId && st.activeSurfaceId !== "anvil"),
    engine: compatible || Boolean(st.engineLoop || st.engineLink?.ok),
    skills: useLearn.getState().skills.length > 0,
    debug: compatible || Boolean(st.debug.paused) || Object.values(st.breakpoints).some((b) => b.length),
    git: compatible || Boolean(st.workspaceCwd?.trim()),
  });
  const knowledge = foregroundKnowledgePermissions();
  const allowed = picked.filter((t) => {
    const name = t.function.name;
    if (name.startsWith("memory_") && !knowledge.memoryEnabled) return false;
    if (name.startsWith("skill_") && (!knowledge.skillsEnabled || !knowledge.skillBodies && ["skill_read", "skill_run", "skill_debug"].includes(name))) return false;
    return toolsAllowed(st.activeSurfaceId, st.surfaceMode, name);
  });
  return session ? session.tools(allowed) : allowed;
}

function setWireCtx(payload: Record<string, unknown>, ctx: number): void {
  const n = Math.max(2048, ctx);
  if ("n_ctx" in payload) payload.n_ctx = n;
  const opt = ((payload.options as Record<string, unknown>) || {});
  opt.num_ctx = n;
  opt.n_ctx = n;
  payload.options = opt;
}

function makeLocalComplete(
  spec: ProviderSpec,
  baseUrl: string,
  model: string,
  apiKey: string,
  context = 32768,
  thinking: ThinkingMode = "auto",
  observeOnly = false,
  session?: ToolSession,
  scope: AgentRun = captureAgentRun(),
) {
  const base = normalizeBaseUrl(baseUrl || spec.baseUrl);
  const chatUrl = localChatUrl(spec.id, base);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
  };
  const localFetch = bindAgentRun(scope, { send: (url: string, init: RequestInit) => lanFetch(url, init, spec.id === "custom" ? normalizeBaseUrl(baseUrl || spec.baseUrl) : "") }).send;
  return async (
    messages: Record<string, unknown>[],
    useTools: boolean | "required",
    onDelta?: (s: string, kind?: "text" | "think") => void,
  ): Promise<LlmChoice> => {
    if (!base) throw new Error("Bitte eine API-URL eintragen.");
    const learnedCap = getCap(spec.id, model, base);
    const cap0 = session?.text && learnedCap.tools !== "off" ? { ...learnedCap, tools: "text" as const } : learnedCap;
    const offered = toolsForCall(observeOnly, session);
    session?.record(useTools && cap0.tools !== "off" ? offered : [], cap0.tools === "text");
    const wantTools = sendTools(cap0, Boolean(useTools));
    const think = wantTools && cap0.noThinkWithTools ? "off" : thinking;
    const st = useIde.getState();
    let wireCtx = Math.max(2048, context);
    const payload: Record<string, unknown> = applyLlmOptions(
      {
        model,
        temperature: st.llmTemperature,
        messages,
        stream: Boolean(onDelta) && !(wantTools && cap0.noStreamTools),
      },
      { provider: spec.id, model, api: spec.api, context: wireCtx, thinking: think, temperature: st.llmTemperature, maxOut: st.llmMaxOut },
      { tools: wantTools },
    );
    let tools = wantTools ? offered : null;
    let choiceMode: "auto" | "required" = useTools === "required" && (!session || session.mode === "standard") && wantTools && !cap0.noRequired ? "required" : "auto";
    if (tools) {
      payload.tools = tools;
      payload.tool_choice = choiceMode;
    }
    if (useTools) session?.prepare(payload);
    if (useTools && cap0.tools === "text") prepareTextTools(payload, offered);
    applyCapToPayload(payload, cap0, Boolean(tools));
    let last: unknown;
    let stripped = false;
    const current = model;
    const tries = Math.min(8, Math.max(1, useIde.getState().llmRetries || 3));
    const gen = scope.generation;
    for (let attempt = 1; attempt <= tries; attempt++) {
      scope.assertCurrent();
      if (agentGen() !== gen) throw new AgentAbortError("replaced");
      try {
        payload.model = current;
        prepChatPayload(payload, wireCtx);
        const wirePayload = sanitizeLocalPayload(spec.id, payload);
        const res = await localFetch(chatUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(wirePayload),
          signal: scope.timeout(hardStopMs(useIde.getState().llmHardStopMin)),
        });
        if (!res.ok) {
          const body = await res.text();
          scope.assertCurrent();
          if (isVramError(body) && attempt < tries && wireCtx > 4096) {
            wireCtx = shrinkLocalCtx(wireCtx);
            setWireCtx(payload, wireCtx);
            prepChatPayload(payload, wireCtx);
            last = new Error(`VRAM, num_ctx ${wireCtx}`);
            continue;
          }
          if ((isContextError(body) || (res.status === 500 && isContextError(body))) && attempt < tries) {
            const opt = ((payload.options as Record<string, unknown>) || {});
            const curN = Number(payload.max_tokens ?? payload.max_completion_tokens ?? opt.num_predict ?? 2048);
            const half = Math.max(256, Math.floor(curN * 0.5));
            if (payload.max_tokens != null) payload.max_tokens = half;
            if (payload.max_completion_tokens != null) payload.max_completion_tokens = half;
            if (typeof opt.num_predict === "number") opt.num_predict = half;
            payload.options = opt;
            if (Array.isArray(payload.messages)) {
              payload.messages = fitMessages(payload.messages as Record<string, unknown>[], Math.floor(context * (0.45 - attempt * 0.08)));
            }
            if (tools) {
              const smaller = shrinkTools(tools);
              if (smaller && smaller !== tools) {
                tools = smaller;
                payload.tools = smaller;
              }
            }
            last = new Error("Kontext voll, kürze");
            continue;
          }
          if (res.status === 400 || res.status === 422) {
            const learned = learnFromError(spec.id, current, res.status, body, base);
            if (learned) {
              if (useTools && learned.tools === "text") {
                prepareTextTools(payload, tools || offered);
                session?.record(offered, true);
              }
              const still = applyCapToPayload(payload, learned, Boolean(useTools) && learned.tools !== "off" && learned.tools !== "text");
              if (!still) {
                tools = null;
              } else if (learned.noRequired) {
                choiceMode = "auto";
                payload.tool_choice = "auto";
              }
              last = new Error(learned.note || "Format angepasst");
              continue;
            }
          }
          if (res.status === 400 && tools && choiceMode === "required") {
            choiceMode = "auto";
            payload.tool_choice = "auto";
            last = new Error("HTTP 400, tool_choice auto");
            continue;
          }
          if (res.status === 400 && tools) {
            const next = shrinkTools(tools);
            if (next && next !== tools) {
              tools = next;
              payload.tools = next;
              last = new Error(`HTTP 400, Tools reduziert`);
              continue;
            }
          }
          if (res.status === 400 && tools && payload.stream) {
            payload.stream = false;
            last = new Error(`HTTP 400, ohne Stream`);
            continue;
          }
          if (res.status === 400 && !stripped) {
            stripped = true;
            stripPayload(payload, body);
            last = new Error(`HTTP 400, Felder reduziert`);
            continue;
          }
          if (attempt < tries && /500|502|503|unload|runner|out of memory/i.test(body)) {
            last = new Error(`HTTP ${res.status}`);
            await new Promise((r) => setTimeout(r, 700 * attempt));
            continue;
          }
          void import("./app-log").then((m) => m.appLog("http", `${res.status} ${body.slice(0, 160)}`));
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 280)}`);
        }
        if (spec.id === "ollama" || (onDelta && (res.headers.get("content-type")?.includes("text/event-stream") || payload.stream))) {
          const choice = await readSseChat(spec.id === "ollama" ? wrapOllamaResponse(chatUrl, res) : res, onDelta);
          scope.assertCurrent();
          if (!choice.content && !choice.reasoning && !choice.tool_calls?.length) {
            throw new StreamStallError("Leere Antwort");
          }
          return withRequestTokens(choice, payload, wireCtx);
        }
        const json = (await res.json()) as {
          choices: { message: LlmChoice }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const choice = json.choices[0]?.message;
        if (!choice) throw new Error("Leere Antwort vom Modell.");
        choice.usage = chatUsage(json.usage);
        const think = (choice as LlmChoice & { reasoning_content?: string }).reasoning_content;
        if (think && onDelta) onDelta(think, "think");
        if (choice.content && onDelta) onDelta(choice.content, "text");
        return withRequestTokens(choice, payload, wireCtx);
      } catch (err) {
        last = err;
        if (err instanceof AgentAbortError) throw err;
        if (!scope.current()) {
          throw new AgentAbortError(explainAbort(err));
        }
        const retry = shouldRetryLocalLlm(err);
        if (!retry || attempt >= tries) throw err;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    throw last instanceof Error ? last : new Error(String(last ?? "Modell abgebrochen"));
  };
}

function makeProxyComplete(
  spec: ProviderSpec,
  baseUrl: string,
  model: string,
  apiKey: string,
  context = 32768,
  thinking: ThinkingMode = "auto",
  observeOnly = false,
  session?: ToolSession,
  scope: AgentRun = captureAgentRun(),
) {
  const send = bindAgentRun(scope, { send: (url: string, init: RequestInit) => lanFetch(url, init) }).send;
  return async (messages: Record<string, unknown>[], useTools: boolean | "required", onDelta?: (s: string, kind?: "text" | "think") => void): Promise<LlmChoice> => {
    const key = apiKey.trim();
    const nativeHttp = hasLlmTransport();
    const tries = Math.min(8, Math.max(1, useIde.getState().llmRetries || 3));
    let last: unknown;
    const gen = scope.generation;
    const stop = cloudStopMs(useIde.getState().llmHardStopMin);
    const base = normalizeBaseUrl(baseUrl || spec.baseUrl);
    for (let attempt = 1; attempt <= tries; attempt++) {
      scope.assertCurrent();
      if (agentGen() !== gen) throw new AgentAbortError("replaced");
      const learnedCap = getCap(spec.id, model, base);
      const cap = session?.text && learnedCap.tools !== "off" ? { ...learnedCap, tools: "text" as const } : learnedCap;
      const offered = toolsForCall(observeOnly, session);
      session?.record(useTools && cap.tools !== "off" ? offered : [], cap.tools === "text");
      const prepared: Record<string, unknown> = { messages };
      if (useTools) session?.prepare(prepared);
      if (useTools && cap.tools === "text") prepareTextTools(prepared, offered);
      const wireMessages = prepared.messages as Record<string, unknown>[];
      const wantTools = sendTools(cap, Boolean(useTools));
      const think = wantTools && cap.noThinkWithTools ? "off" : thinking;
      const rt = { provider: spec.id, model, api: spec.api, context, thinking: think, temperature: useIde.getState().llmTemperature, maxOut: useIde.getState().llmMaxOut };
      const hdrs = pipeHeaders(spec.id, key);
      const needResponses = responsesNative(spec.id) && (Boolean(cap.responsesApi) || usesResponsesApi(rt, wantTools));
      const pipeOk = nativeHttp && spec.api === "openai" && spec.id !== "codex" && spec.id !== "azure" && Boolean(base);
      const pipeChat = pipeOk && !needResponses;
      try {
        if (nativeHttp && spec.api === "anthropic") {
          const st = useIde.getState();
          const fitted = applyLlmOptions({ messages: [...wireMessages], ...(wantTools ? { tools: offered } : {}) }, { ...rt, api: "anthropic" });
          prepChatPayload(fitted, context);
          const packed = fitted.messages as Record<string, unknown>[];
          const system = packed.filter((m) => m.role === "system").map((m) => String(m.content ?? "")).join("\n\n");
          const body: Record<string, unknown> = applyLlmOptions(
            {
              model,
              temperature: st.llmTemperature,
              system: system || undefined,
              messages: toAnthropicMessages(packed.filter((m) => m.role !== "system")),
              stream: true,
            },
            { ...rt, api: "anthropic" },
          );
          body.max_tokens = fitted.max_tokens;
          if (fitted.thinking) body.thinking = fitted.thinking;
          body.stream = true;
          if (wantTools) {
            body.tools = offered.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters ?? { type: "object", properties: {} },
            }));
          }
          const sendAnt = () =>
            send(`${base}/messages`, {
              method: "POST",
              headers: anthropicHeaders(key),
              body: JSON.stringify(body),
              signal: scope.timeout(stop),
            });
          let res = await sendAnt();
          if (!res.ok && res.status === 400) {
            const errText = await res.text();
            scope.assertCurrent();
            const learned = learnFromError(spec.id, model, res.status, errText, base);
            if (learned && attempt < tries) { last = new Error(learned.note); continue; }
            const think = body.thinking as Record<string, unknown> | undefined;
            if (think && "display" in think && /display/i.test(errText)) {
              delete think.display;
              res = await sendAnt();
            } else {
              last = new Error(`HTTP ${res.status}: ${errText.slice(0, 180)}`);
            }
          }
          if (res.ok) return withRequestTokens(await readSseAnthropic(res, onDelta), fitted, context);
          if (!last) last = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
        } else if (nativeHttp && spec.id === "azure") {
          const raw = (baseUrl || spec.baseUrl).trim();
          const host = new URL(raw.includes("://") ? raw : `https://${raw}`);
          const st = useIde.getState();
          if (needResponses) {
            const chatPayload: Record<string, unknown> = applyLlmOptions(
              { model, temperature: st.llmTemperature, messages: wireMessages },
              { ...rt, api: "azure" },
              { tools: wantTools },
            );
            if (wantTools) chatPayload.tools = offered;
            prepChatPayload(chatPayload, context);
            const body = responsesBody(chatPayload, "azure");
            body.stream = true;
            if (wantTools) {
              body.tools = toResponsesTools(offered);
              body.tool_choice = "auto";
            }
            const res = await send(`${host.origin}/openai/v1/responses`, {
              method: "POST",
              headers: { ...hdrs, Accept: "text/event-stream" },
              body: JSON.stringify(body),
              signal: scope.timeout(stop),
            });
            if (res.ok) return withRequestTokens(await readSseResponses(res, onDelta), chatPayload, context);
            throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
          }
          const payload: Record<string, unknown> = applyLlmOptions(
            { temperature: st.llmTemperature, messages: wireMessages, stream: true },
            { ...rt, api: "azure" },
            { tools: wantTools },
          );
          if (wantTools) {
            payload.tools = offered;
            payload.tool_choice = "auto";
          }
          prepChatPayload(payload, context);
          const res = await send(
            `${host.origin}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=2024-10-21`,
            {
              method: "POST",
              headers: hdrs,
              body: JSON.stringify(payload),
              signal: scope.timeout(stop),
            },
          );
          if (res.ok) return withRequestTokens(await readSseChat(res, onDelta), payload, context);
          last = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
        }
        if (pipeOk && needResponses) {
          const st = useIde.getState();
          const chatPayload: Record<string, unknown> = applyLlmOptions(
            { model, temperature: st.llmTemperature, messages: wireMessages },
            { provider: spec.id, model, api: spec.api, context, thinking: think, temperature: st.llmTemperature, maxOut: st.llmMaxOut },
            { tools: wantTools },
          );
          if (wantTools) chatPayload.tools = offered;
          prepChatPayload(chatPayload, context);
          const body = responsesBody(chatPayload, spec.id);
          body.stream = true;
          if (wantTools) {
            body.tools = toResponsesTools(offered);
            body.tool_choice = useTools === "required" && (!session || session.mode === "standard") && !cap.noRequired ? "required" : "auto";
          }
          let res = await send(`${base}/responses`, {
            method: "POST",
            headers: { ...hdrs, Accept: "text/event-stream" },
            body: JSON.stringify(body),
            signal: scope.timeout(stop),
          });
          if (!res.ok) {
            let errText = await res.text();
            scope.assertCurrent();
            if (res.status === 400 && patchResponses400(body, errText)) {
              res = await send(`${base}/responses`, {
                method: "POST",
                headers: { ...hdrs, Accept: "text/event-stream" },
                body: JSON.stringify(body),
                signal: scope.timeout(stop),
              });
              if (!res.ok) errText = await res.text();
              scope.assertCurrent();
            }
            if (res.ok) {
              /* continue below */
            } else if (res.status === 404) {
              last = new Error(`HTTP 404: ${errText.slice(0, 180)}`);
            } else {
              const learned = learnFromError(spec.id, model, res.status, errText, base);
              if (learned && attempt < tries) {
                last = new Error(learned.note || `HTTP ${res.status}`);
                continue;
              }
              last = new Error(`HTTP ${res.status}: ${errText.slice(0, 280)}`);
              void import("./app-log").then((m) => m.appLog("http", String(last).slice(0, 180)));
              if (attempt >= tries) throw last;
              continue;
            }
          }
          if (res.ok) {
            const ct = res.headers.get("content-type") || "";
            if (/event-stream|text\/plain/i.test(ct) || body.stream) return withRequestTokens(await readSseResponses(res, onDelta), chatPayload, context);
            const raw = await res.text();
            scope.assertCurrent();
            const choice = parseResponsesSse(raw);
            if (choice.reasoning) onDelta?.(choice.reasoning, "think");
            if (choice.content) onDelta?.(choice.content, "text");
            return withRequestTokens(choice, chatPayload, context);
          }
        }
        if (pipeChat) {
          const st = useIde.getState();
          const payload: Record<string, unknown> = applyLlmOptions(
            {
              model,
              temperature: st.llmTemperature,
              messages: wireMessages,
              stream: Boolean(onDelta) && !(wantTools && cap.noStreamTools),
            },
            { provider: spec.id, model, api: spec.api, context, thinking: think, temperature: st.llmTemperature, maxOut: st.llmMaxOut },
            { tools: wantTools },
          );
          if (wantTools) {
            payload.tools = offered;
            payload.tool_choice = useTools === "required" && (!session || session.mode === "standard") && !cap.noRequired ? "required" : "auto";
          }
          if (useTools && cap.tools === "text") prepareTextTools(payload, offered);
          applyCapToPayload(payload, cap, wantTools);
          prepChatPayload(payload, context);
          const res = await send(`${base}/chat/completions`, {
            method: "POST",
            headers: hdrs,
            body: JSON.stringify(payload),
            signal: scope.timeout(stop),
          });
          if (res.ok) {
            if (payload.stream) return withRequestTokens(await readSseChat(res, onDelta), payload, context);
            const json = (await res.json()) as { choices: { message: LlmChoice }[]; usage?: unknown };
            const choice = json.choices[0]?.message;
            if (choice) choice.usage = chatUsage(json.usage);
            if (!choice) throw new Error("Leere Antwort vom Modell.");
            if (!choice.reasoning && typeof choice.reasoning_content === "string") choice.reasoning = choice.reasoning_content;
            if (choice.reasoning) onDelta?.(choice.reasoning, "think");
            if (choice.content) onDelta?.(choice.content, "text");
            return withRequestTokens(choice, payload, context);
          }
          const body = await res.text();
          scope.assertCurrent();
          const learned = learnFromError(spec.id, model, res.status, body, base);
          if (learned && attempt < tries) {
            last = new Error(learned.note || `HTTP ${res.status}`);
            continue;
          }
          if (attempt < tries && (isContextError(body) || /500|502|503|timeout/i.test(body))) {
            last = new Error(`HTTP ${res.status}`);
            await new Promise((r) => setTimeout(r, 700 * attempt));
            continue;
          }
          last = new Error(`HTTP ${res.status}: ${body.slice(0, 280)}`);
        }
        if (nativeHttp) throw last instanceof Error ? last : new Error("Keine Antwort vom Modell.");
        const r = await scope.wait(
          proxyLlm({
            data: {
              action: "chat",
              provider: spec.id,
              baseUrl: baseUrl || spec.baseUrl,
              model,
              apiKey: key,
              messages: wireMessages,
              useTools: wantTools,
              toolNames: session && session.mode !== "standard" ? offered.map((t) => t.function.name) : undefined,
              compactTools: Boolean(session && session.mode !== "standard"),
              context,
              thinking: think,
              temperature: useIde.getState().llmTemperature,
              maxOut: useIde.getState().llmMaxOut,
              caps: cap,
            },
            signal: scope.signal,
          }),
          stop,
        );
        if (!r.ok || !r.choice) {
          const err = r.error || "Keine Antwort";
          const st = /HTTP (\d{3})/.exec(err);
          const learned = learnFromError(spec.id, model, st ? Number(st[1]) : 0, err, base);
          if (learned && attempt < tries) {
            last = new Error(learned.note || err);
            continue;
          }
          if (attempt < tries && (isContextError(err) || /500|502|503|timeout|unload/i.test(err))) {
            last = new Error(err);
            await new Promise((res) => setTimeout(res, 700 * attempt));
            continue;
          }
          void import("./app-log").then((m) => m.appLog("http", err.slice(0, 180)));
          throw new Error(err);
        }
        if (r.choice.reasoning) onDelta?.(r.choice.reasoning, "think");
        if (r.choice.content) onDelta?.(r.choice.content, "text");
        return r.choice;
      } catch (err) {
        last = err;
        if (err instanceof AgentAbortError) throw err;
        if (!scope.current()) {
          throw new AgentAbortError(explainAbort(err));
        }
        const msg = err instanceof Error ? err.message : String(err);
        const status = /^HTTP (\d{3})/.exec(msg);
        const learned = status ? learnFromError(spec.id, model, Number(status[1]), msg, base) : null;
        if (learned && attempt < tries) continue;
        const retry = /500|502|503|timeout|network|Failed to fetch/i.test(msg);
        if (!retry || attempt >= tries) throw err;
        await new Promise((res) => setTimeout(res, 800 * attempt));
      }
    }
    throw last instanceof Error ? last : new Error(String(last ?? "Keine Antwort"));
  };
}

export async function completeLocal(opts: {
  prompt: string;
  run?: AgentRun;
  provider: LlmProvider | string;
  baseUrl: string;
  model: string;
  apiKey: string;
  images?: string[];
  onUsage?: (usage: TokenUsage, request?: RequestTokens) => void;
}): Promise<string> {
  const epoch = useIde.getState().workspaceEpoch;
  const scope = opts.run ?? captureAgentRun(() => useIde.getState().workspaceEpoch === epoch);
  scope.assertCurrent();
  opts = bindAgentRun(scope, opts);
  const prompt = opts.prompt.startsWith(USER_REQUEST_MARK) ? opts.prompt : USER_REQUEST_MARK + opts.prompt;
  const spec = providerOf(opts.provider);
  const model = opts.model.trim() || spec.model;
  if (spec.id === "brain") {
    const { loadBrain, brainGenerate, brainReady, brainSystem } = await import("./brain");
    scope.assertCurrent();
    if (!brainReady()) await loadBrain();
    scope.assertCurrent();
    return scope.wait(brainGenerate({
      onUsage: opts.onUsage,
      signal: scope.signal,
      messages: [
        { role: "system", content: brainSystem("Short answer.") },
        { role: "user", content: opts.prompt },
      ],
    }));
  }
  const cli = cliKindFor(spec.id, useIde.getState().llmAuthMode);
  if (cli) {
    const content = opts.images?.length
      ? [{ type: "text", text: prompt }, ...opts.images.map(url => ({ type: "image_url", image_url: { url } }))]
      : prompt;
    const messages = [{ role: "user", content }];
    prepChatPayload({ messages, max_tokens: 1200 }, useIde.getState().llmContext || 32768);
    const choice = await scope.wait(completeViaCli(cli, model, messages, [], hardStopMs(useIde.getState().llmHardStopMin), undefined, "off", scope.signal));
    opts.onUsage?.(resolvedUsage(choice, messages));
    return choice.content?.trim() || "";
  }
  if (isBrowserTarget(spec, opts.baseUrl)) {
    const base = normalizeBaseUrl(opts.baseUrl || spec.baseUrl);
    if (!base || !model) throw new Error("URL und Modell setzen.");
    const pics = (opts.images ?? []).filter((u) => /^data:image\//i.test(u)).slice(0, 4);
    const userContent =
      pics.length > 0
        ? [
            { type: "text", text: prompt },
            ...pics.map((url) => ({ type: "image_url", image_url: { url } })),
          ]
        : prompt;
    const st = useIde.getState();
    const ctx = Math.max(2048, st.llmContext || 32768);
    const payload = applyLlmOptions(
      {
        model,
        messages: [{ role: "user", content: userContent }],
        stream: false,
      },
      { provider: spec.id, model, api: spec.api, context: ctx, thinking: "off", temperature: 0.2, maxOut: 1200 },
    );
    prepChatPayload(payload, ctx);
    const chatUrl = localChatUrl(spec.id, base);
    const res = await lanFetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.apiKey.trim() ? { Authorization: `Bearer ${opts.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify(sanitizeLocalPayload(spec.id, payload)),
      signal: scope.signal,
    }, spec.id === "custom" ? base : "");
    scope.assertCurrent();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (spec.id === "ollama") {
      const choice = await scope.wait(readSseChat(wrapOllamaResponse(chatUrl, res)));
      if (!choice.content?.trim()) throw new Error("Leere Antwort.");
      withRequestTokens(choice, payload, ctx);
      opts.onUsage?.(resolvedUsage(choice, payload.messages), choice.requestTokens);
      return choice.content.trim();
    }
    const json = (await scope.wait(res.json())) as { choices: { message: LlmChoice }[]; usage?: unknown };
    const text = json.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Leere Antwort.");
    const choice = withRequestTokens({ ...json.choices[0].message, usage: chatUsage(json.usage) }, payload, ctx);
    opts.onUsage?.(resolvedUsage(choice, payload.messages), choice.requestTokens);
    return text;
  }
  const r = await scope.wait(proxyLlm({
    data: {
      action: "chat",
      provider: spec.id,
      baseUrl: opts.baseUrl || spec.baseUrl,
      model,
      apiKey: opts.apiKey.trim(),
      messages: [{ role: "user", content: opts.images?.length
        ? [{ type: "text", text: prompt }, ...opts.images.filter(url => /^data:image\//i.test(url)).slice(0, 4).map(url => ({ type: "image_url", image_url: { url } }))]
        : prompt }],
      useTools: false, context: useIde.getState().llmContext || 32768, thinking: "off", temperature: 0.2, maxOut: 1200,
    },
    signal: scope.signal,
  }));
  if (!r.ok) throw new Error(r.error || "Keine Antwort");
  const text = r.choice?.content?.trim();
  if (!text) throw new Error("Leere Antwort.");
  opts.onUsage?.(resolvedUsage(r.choice!, [{ role: "user", content: opts.prompt }]), r.choice?.requestTokens);
  return text;
}
