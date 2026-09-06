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
import { agentLearn, useLearn } from "./learn";
import { stripZipRoot, unzipFiles } from "./archive";
import { formatCode } from "./format";
import { cloneGithub, pushGithub } from "./github";
import { applyLlmOptions, patchResponses400, responsesBody, toResponsesTools, usesResponsesApi, type ThinkingMode } from "./llm-options";
import { parseResponsesSse } from "./responses-parse";
import { fitMessages, isContextError, isVramError, prepChatPayload, shrinkLocalCtx, type CompactMode } from "./compact";
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
import { throwIfAborted, AgentAbortError, withAgentTimeout, agentAborted, agentGen, isAbortLike, explainAbort, raceAbort, hardStopMs, cloudStopMs, shouldRetryLocalLlm } from "./abort";
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
    return `${spec.label} nicht erreichbar. Anvil holt das Modell selbst (kein CORS). URL prüfen, z. B. http://192.168.178.41:11434/v1 — Anbieter Ollama.`;
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
    return result.ids;
  }
  const r = await proxyLlm({ data: { action: "models", provider: spec.id, baseUrl: opts.baseUrl || spec.baseUrl, model: "", apiKey: opts.apiKey }, signal: opts.signal });
  opts.signal?.throwIfAborted();
  if (!r.ok) throw new Error(r.error || "Modelle fehlgeschlagen");
  return r.models ?? [];
}

export async function chatWithProvider(opts: {
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
  onHarness?: (bar: string) => void;
  runLoop?: boolean;
  graphLoop?: boolean;
  testLoop?: boolean;
  engineLoop?: boolean;
  loopTries?: number;
  engineOk?: boolean;
  afterWrite?: "run" | "engine" | "preview" | "none";
  maxRounds?: number;
  graphSees?: number;
  journal?: SessionJournal;
  memory?: string;
  prefer?: string[];
  locale?: "de" | "en";
  observeOnly?: boolean;
}): Promise<AgentResult> {
  const run = agentGen();
  const original = opts;
  opts = {
    ...original,
    onDelta: (chunk, kind) => {
      requestPhase(run, kind === "think" ? "thinking" : "answering");
      original.onDelta?.(chunk, kind);
    },
    onToolStart: (info) => { requestPhase(run, "tool", info.name); original.onToolStart?.(info); },
    onTool: (info) => { original.onTool?.(info); requestPhase(run, "preparing"); },
  };
  const spec = providerOf(opts.provider);
  const surface = await surfaceNote();
  throwIfAborted();
  if (run !== agentGen()) throw new AgentAbortError("Anfrage ersetzt");
  const mcpCatalog = surface.text;
  if (spec.id === "grok") {
    const complete = async (
      messages: Record<string, unknown>[],
      useTools: boolean | "required",
      onDelta?: (s: string, kind?: "text" | "think") => void,
    ): Promise<LlmChoice> => {
      throwIfAborted();
      requestPhase(run, "waiting");
      const stop = cloudStopMs(useIde.getState().llmHardStopMin);
      const key = (opts.apiKey || keyForProvider("xai")).trim();
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
          const res = await lanFetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${key}` },
            body: JSON.stringify(payload),
            signal: withAgentTimeout(stop),
          });
          if (res.ok) {
            if (payload.stream) return readSseChat(res, onDelta);
            const json = (await res.json()) as { choices: { message: LlmChoice }[] };
            const choice = json.choices[0]?.message;
            if (!choice) throw new Error("Leere Antwort vom Modell");
            if (choice.reasoning) onDelta?.(choice.reasoning, "think");
            if (choice.content) onDelta?.(choice.content, "text");
            return choice;
          }
        } catch (err) {
          if (err instanceof AgentAbortError) throw err;
          if (agentAborted()) throw new AgentAbortError(explainAbort(err));
        }
      }
      const r = await raceAbort(grokRound({ data: { messages, useTools: Boolean(useTools) } }), stop);
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
      },
      complete,
      { ...clientTools(opts), onHarness: opts.onHarness },
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
  const cliKind = cliKindFor(spec.id, useIde.getState().llmAuthMode);
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
    ? (messages: Record<string, unknown>[], useTools: boolean | "required", onDelta?: (s: string, kind?: "text" | "think") => void) => completeViaCli(cliKind, model, messages, useTools ? toolsForCall(opts.observeOnly) : [], hardStopMs(useIde.getState().llmHardStopMin), onDelta)
    : isBrowserTarget(spec, opts.baseUrl)
    ? makeLocalComplete(spec, opts.baseUrl, model, opts.apiKey, opts.context, opts.thinking, opts.observeOnly, toolSession)
    : makeProxyComplete(spec, opts.baseUrl, model, opts.apiKey, opts.context, opts.thinking, opts.observeOnly, toolSession);

  let modelRound = 0;
  const complete: typeof transport = async (messages, tools, onDelta) => {
    throwIfAborted();
    requestPhase(run, "waiting");
    const round = ++modelRound;
    const choice = await transport(messages, tools, onDelta);
    const { appLog } = await import("./app-log");
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
      },
      complete,
      { ...clientTools(opts), onHarness: opts.onHarness,
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
}) {
  const tools = {
    onDelta: opts.onDelta,
    onWorkspace: opts.onWorkspace,
    onTool: opts.onTool,
    onToolStart: opts.onToolStart,
    fetchUrl: async (url: string) => {
      const r = await fetchWeb({ data: { url } });
      if (!r.ok) throw new Error(r.text);
      return r.text;
    },
    formatFile: (path: string, content: string) => formatCode(path, content),
    gitStatus: async () => {
      const { useIde } = await import("@/store/ide");
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
      const live = await companionGit("status", { cwd });
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
      const st = useIde.getState();
      const cwd = st.workspaceCwd?.trim();
      if (!cwd) return { ok: false, error: "Kein Projektordner. Commit wäre nur Sitzung — Companion koppeln." };
      const { flushDiskSync } = await import("./disk-sync");
      await flushDiskSync();
      const { companionGit } = await import("./companion");
      return companionGit("commit", { cwd, message });
    },
    gitClone: async (url: string) => {
      const r = await cloneGithub({ data: { url, token: opts.githubToken } });
      const raw = atob(r.zipB64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      const pack = stripZipRoot(await unzipFiles(buf.buffer));
      return Object.entries(pack).map(([path, content]) => ({ path, content }));
    },
    gitPush: async (message: string, files: Record<string, string>) => {
      const { useIde } = await import("@/store/ide");
      const cwd = useIde.getState().workspaceCwd?.trim();
      if (cwd) {
        const { flushDiskSync } = await import("./disk-sync");
        await flushDiskSync();
        const { companionGit } = await import("./companion");
        const c = await companionGit("commit", { cwd, message });
        const p = await companionGit("push", { cwd });
        if (p.ok) return { sha: "git", repo: cwd, via: "companion" as const };
        if (c.ok === false && /nothing to commit|nichts zu/i.test(String(c.error || c.stdout || ""))) {
          const p2 = await companionGit("push", { cwd });
          if (p2.ok) return { sha: "git", repo: cwd, via: "companion" as const };
        }
        if (!opts.githubToken) return { sha: "", repo: cwd, error: p.error || c.error || "git push fehlgeschlagen" };
      }
      const repo = opts.git?.repo?.trim();
      const token = opts.githubToken?.trim() ?? "";
      if (!repo || !token) throw new Error("GitHub-Repo und Token unter Einstellungen eintragen — oder Projektordner koppeln.");
      const { isSecretPath } = await import("./ref");
      const safe: Record<string, string> = {};
      for (const [p, c] of Object.entries(files)) if (!isSecretPath(p)) safe[p] = c;
      return pushGithub({ data: { repo, token, message, files: safe } });
    },
    shell: (command: string, files: Record<string, string>) => runAgentShell(command, files),
    debug: (action: string, args: Record<string, unknown>) => agentDebug(action, args),
    learn: (action: string, args: Record<string, unknown>) => agentLearn(action, args),
    summarize: async (blob: string) => {
      const { brainCompact, brainReady } = await import("./brain");
      const cut = blob.slice(0, 8000);
      if (!brainReady()) return cut;
      try {
        return await Promise.race([
          brainCompact(blob),
          new Promise<string>((res) => setTimeout(() => res(cut), 2500)),
        ]);
      } catch {
        return cut;
      }
    },
    mcp: async (action: "list" | "call", server?: string, name?: string, args?: unknown) => {
      const { mcpList, mcpCall, mcpListError, mcpSnapshot } = await import("./mcp");
      const { useIde } = await import("@/store/ide");
      const st = useIde.getState();
      const servers = (st.mcpServers ?? []).filter((s) => st.surfaceMode === "bridge" || !st.activeSurfaceId || st.activeSurfaceId === ANVIL_SURFACE || s.id === st.activeSurfaceId);
      const active = st.activeSurfaceId;
      const want = server?.trim() || (active !== ANVIL_SURFACE ? active : "");
      if (action === "list") {
        await mcpList(servers);
        const snapshot = mcpSnapshot(servers);
        return {
          tools: snapshot.tools,
          resources: snapshot.resources,
          servers: servers.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name, ready: snapshot.ready.has(s.id), error: mcpListError(s.id) || undefined })),
          hint: servers.some((s) => s.enabled) ? "Call mcp_call with server=id and the exact tool name. Native Anvil tools are separate." : "No enabled MCP server is configured. Native Anvil tools are available independently.",
        };
      }
      const t0 = Date.now();
      try {
        const r = await mcpCall(
          servers,
          want,
          name ?? "",
          args,
          st.mcpStream
          ? (chunk) => {
              const sid = servers.find((s) => s.id === want || s.name === want)?.id || want;
              const prev = useIde.getState().mcpView[sid]?.text ?? "";
              useIde.getState().setMcpView(sid, { text: (prev + chunk).slice(-8000), at: Date.now() });
              void import("./live-write").then((m) => m.applyMcpLive(sid, name ?? "", args, chunk));
            }
          : undefined,
          { cwd: st.workspaceCwd || undefined },
        );
        const rec = r && typeof r === "object" ? (r as { text?: string; image?: string; isError?: boolean }) : null;
        const text = rec?.text || (typeof r === "string" ? r : JSON.stringify(r).slice(0, 800));
        const image = rec?.image;
        const sid = servers.find((s) => s.id === want || s.name === want)?.id || want;
        st.pushMcpLog({
          at: t0,
          server: sid,
          name: name ?? "",
          ok: !rec?.isError,
          detail: String(text).slice(0, 400),
          image,
        });
        if (text || image) st.setMcpView(sid, { text: String(text).slice(0, 2000), image, at: Date.now() });
        return r;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const sid = servers.find((s) => s.id === want || s.name === want)?.id || want;
        st.pushMcpLog({ at: t0, server: sid, name: name ?? "", ok: false, detail: msg.slice(0, 400) });
        throw err;
      }
    },
    engine: async (action: "status" | "run", args?: Record<string, unknown>) => {
      const { companionPing, companionRun } = await import("./companion");
      const { detectEngines, primaryEngine } = await import("./engines");
      const { useIde } = await import("@/store/ide");
      const st = useIde.getState();
      const url = st.companionUrl || "http://127.0.0.1:7845";
      const hits = detectEngines(st.files, st.dirs);
      const hit = primaryEngine(st.files, st.dirs);
      if (args?.detect || action === "status") {
        const ping = await companionPing(url);
        st.setEngineLink(hit ? { label: hit.label, ok: ping.ok } : null);
        if (args?.detect) return { engines: hits, companion: ping };
        return ping;
      }
      const cmd = String(args?.cmd || hit?.cmds[String(args?.action || "check")] || hit?.cmds.play || hit?.cmds.check || "");
      if (!cmd) return { ok: false, error: "Keine Engine oder kein Befehl. Godot-/Unity-Ordner öffnen." };
      const job = await companionRun({ cmd, cwd: st.workspaceCwd || undefined, timeoutMs: Number(args?.timeoutMs) || 90000 }, url);
      return { ...job, engine: hit?.label };
    },
    runFile: async (path: string, files: Record<string, string>) => {
      const { runLoopFile } = await import("./run-loop");
      const { useIde } = await import("@/store/ide");
      const st = useIde.getState();
      st.setRunPath(path);
      const r = await runLoopFile(path, files, { graph: st.graphLoop, tries: st.runLoop ? st.loopTries : 1 });
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
      const st = useIde.getState();
      if (!st.runHtml) return { ok: false, error: "HTML-Run aus (Einstellungen → Ausgabe)." };
      if (!st.graphLoop) return { ok: false, error: "Graph-Schleife aus" };
      const shot = await playLoop(keys, hold);
      return { ok: shot.ok === true, error: shot.error, state: shot.state, keys, logs: shot.logs, size: shot.w ? `${shot.w}×${shot.h}` : undefined, image: shot.image };
    },
    see: async () => {
      const { shotLoop } = await import("./run-loop");
      const { useIde } = await import("@/store/ide");
      const { previewFor } = await import("./preview-doc");
      const { openRunWindow, keepAgentRun } = await import("./run-window");
      const st = useIde.getState();
      keepAgentRun();
      const last = [...st.output].reverse().find((o) => o.stdout || o.stderr || o.html);
      if (last?.stage?.id && last.stage.kind !== "html") {
        st.revealOutput();
        const { companionRunStatus } = await import("./companion");
        const current = await companionRunStatus(last.stage.id, st.companionUrl || undefined);
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
        agentOpenedPreview();
      }
      const path = htmlPath;
      const src = path ? st.files[path] : "";
      let html = src;
      if (path && src) {
        const view = await previewFor(path, src, st.files, st.output.at(-1), st.inputMap, st.runHtml);
        if (view.kind === "iframe") html = view.srcDoc;
      }
      const shot = await shotLoop(html || undefined);
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
  return {
    ...tools,
    gitStatus: () => withCompanion(tools.gitStatus),
    gitCommit: (...args: Parameters<typeof tools.gitCommit>) => withCompanion(() => tools.gitCommit(...args)),
    gitPush: (...args: Parameters<typeof tools.gitPush>) => withCompanion(() => tools.gitPush(...args)),
    engine: (...args: Parameters<typeof tools.engine>) => withCompanion(() => tools.engine(...args)),
  };
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
  const allowed = picked.filter((t) => toolsAllowed(st.activeSurfaceId, st.surfaceMode, t.function.name));
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
) {
  const base = normalizeBaseUrl(baseUrl || spec.baseUrl);
  const chatUrl = localChatUrl(spec.id, base);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
  };
  const localFetch = (url: string, init: RequestInit) => lanFetch(url, init, spec.id === "custom" ? normalizeBaseUrl(baseUrl || spec.baseUrl) : "");
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
    let current = model;
    const tries = Math.min(8, Math.max(1, useIde.getState().llmRetries || 3));
    const gen = agentGen();
    for (let attempt = 1; attempt <= tries; attempt++) {
      throwIfAborted();
      if (agentGen() !== gen) throw new AgentAbortError("replaced");
      try {
        payload.model = current;
        prepChatPayload(payload, wireCtx);
        const wirePayload = sanitizeLocalPayload(spec.id, payload);
        const res = await localFetch(chatUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(wirePayload),
          signal: withAgentTimeout(hardStopMs(useIde.getState().llmHardStopMin)),
        });
        if (!res.ok) {
          const body = await res.text();
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
          if (!choice.content && !choice.reasoning && !choice.tool_calls?.length) {
            throw new StreamStallError("Leere Antwort");
          }
          return choice;
        }
        const json = (await res.json()) as {
          choices: { message: LlmChoice }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const choice = json.choices[0]?.message;
        if (!choice) throw new Error("Leere Antwort vom Modell.");
        if (json.usage) {
          choice.usage = { prompt: json.usage.prompt_tokens ?? 0, completion: json.usage.completion_tokens ?? 0 };
        }
        const think = (choice as LlmChoice & { reasoning_content?: string }).reasoning_content;
        if (think && onDelta) onDelta(think, "think");
        if (choice.content && onDelta) onDelta(choice.content, "text");
        return choice;
      } catch (err) {
        last = err;
        if (err instanceof AgentAbortError) throw err;
        if (agentAborted() || agentGen() !== gen) {
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
) {
  return async (messages: Record<string, unknown>[], useTools: boolean | "required", onDelta?: (s: string, kind?: "text" | "think") => void): Promise<LlmChoice> => {
    const key = apiKey.trim();
    const nativeHttp = hasLlmTransport();
    const tries = Math.min(8, Math.max(1, useIde.getState().llmRetries || 3));
    let last: unknown;
    const gen = agentGen();
    const stop = cloudStopMs(useIde.getState().llmHardStopMin);
    const base = normalizeBaseUrl(baseUrl || spec.baseUrl);
    for (let attempt = 1; attempt <= tries; attempt++) {
      throwIfAborted();
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
          const fitted = { messages: [...wireMessages] };
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
          body.stream = true;
          if (wantTools) {
            body.tools = offered.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters ?? { type: "object", properties: {} },
            }));
          }
          const sendAnt = () =>
            lanFetch(`${base}/messages`, {
              method: "POST",
              headers: anthropicHeaders(key),
              body: JSON.stringify(body),
              signal: withAgentTimeout(stop),
            });
          let res = await sendAnt();
          if (!res.ok && res.status === 400) {
            const errText = await res.text();
            const learned = learnFromError(spec.id, model, res.status, errText, base);
            if (learned && attempt < tries) { last = new Error(learned.note); continue; }
            const think = body.thinking as Record<string, unknown> | undefined;
            if (think?.type === "adaptive" && /adaptive|thinking/i.test(errText)) {
              const maxTok = Number(body.max_tokens) || 8192;
              body.thinking = {
                type: "enabled",
                budget_tokens: Math.min(8192, Math.max(1024, maxTok - 1024)),
                display: "summarized",
              };
              res = await sendAnt();
            } else if (think && "display" in think && /display/i.test(errText)) {
              delete think.display;
              res = await sendAnt();
            } else {
              last = new Error(`HTTP ${res.status}: ${errText.slice(0, 180)}`);
            }
          }
          if (res.ok) return await readSseAnthropic(res, onDelta);
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
            prepChatPayload(chatPayload, context);
            const body = responsesBody(chatPayload, "azure");
            body.stream = true;
            if (wantTools) {
              body.tools = toResponsesTools(offered);
              body.tool_choice = "auto";
            }
            const res = await lanFetch(`${host.origin}/openai/v1/responses`, {
              method: "POST",
              headers: { ...hdrs, Accept: "text/event-stream" },
              body: JSON.stringify(body),
              signal: withAgentTimeout(stop),
            });
            if (res.ok) return await readSseResponses(res, onDelta);
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
          const res = await lanFetch(
            `${host.origin}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=2024-10-21`,
            {
              method: "POST",
              headers: hdrs,
              body: JSON.stringify(payload),
              signal: withAgentTimeout(stop),
            },
          );
          if (res.ok) return await readSseChat(res, onDelta);
          last = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
        }
        if (pipeOk && needResponses) {
          const st = useIde.getState();
          const chatPayload: Record<string, unknown> = applyLlmOptions(
            { model, temperature: st.llmTemperature, messages: wireMessages },
            { provider: spec.id, model, api: spec.api, context, thinking: think, temperature: st.llmTemperature, maxOut: st.llmMaxOut },
            { tools: wantTools },
          );
          prepChatPayload(chatPayload, context);
          const body = responsesBody(chatPayload, spec.id);
          body.stream = true;
          if (wantTools) {
            body.tools = toResponsesTools(offered);
            body.tool_choice = useTools === "required" && (!session || session.mode === "standard") && !cap.noRequired ? "required" : "auto";
          }
          let res = await lanFetch(`${base}/responses`, {
            method: "POST",
            headers: { ...hdrs, Accept: "text/event-stream" },
            body: JSON.stringify(body),
            signal: withAgentTimeout(stop),
          });
          if (!res.ok) {
            let errText = await res.text();
            if (res.status === 400 && patchResponses400(body, errText)) {
              res = await lanFetch(`${base}/responses`, {
                method: "POST",
                headers: { ...hdrs, Accept: "text/event-stream" },
                body: JSON.stringify(body),
                signal: withAgentTimeout(stop),
              });
              if (!res.ok) errText = await res.text();
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
            if (/event-stream|text\/plain/i.test(ct) || body.stream) return await readSseResponses(res, onDelta);
            const raw = await res.text();
            const choice = parseResponsesSse(raw);
            if (choice.reasoning) onDelta?.(choice.reasoning, "think");
            if (choice.content) onDelta?.(choice.content, "text");
            return choice;
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
          const res = await lanFetch(`${base}/chat/completions`, {
            method: "POST",
            headers: hdrs,
            body: JSON.stringify(payload),
            signal: withAgentTimeout(stop),
          });
          if (res.ok) {
            if (payload.stream) return await readSseChat(res, onDelta);
            const json = (await res.json()) as { choices: { message: LlmChoice }[] };
            const choice = json.choices[0]?.message;
            if (!choice) throw new Error("Leere Antwort vom Modell.");
            if (choice.reasoning) onDelta?.(choice.reasoning, "think");
            if (choice.content) onDelta?.(choice.content, "text");
            return choice;
          }
          const body = await res.text();
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
        const r = await raceAbort(
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
        if (agentAborted() || agentGen() !== gen) {
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
  provider: LlmProvider | string;
  baseUrl: string;
  model: string;
  apiKey: string;
  images?: string[];
}): Promise<string> {
  const spec = providerOf(opts.provider);
  const model = opts.model.trim() || spec.model;
  if (spec.id === "brain") {
    const { loadBrain, brainGenerate, brainReady, brainSystem } = await import("./brain");
    if (!brainReady()) await loadBrain();
    return brainGenerate({
      messages: [
        { role: "system", content: brainSystem("Short answer.") },
        { role: "user", content: opts.prompt },
      ],
    });
  }
  const cli = cliKindFor(spec.id, useIde.getState().llmAuthMode);
  if (cli) {
    if (opts.images?.length) throw new Error("Bilder werden über die Abo-CLI noch nicht übertragen.");
    const choice = await completeViaCli(cli, model, [{ role: "user", content: opts.prompt }], [], hardStopMs(useIde.getState().llmHardStopMin));
    return choice.content?.trim() || "";
  }
  if (isBrowserTarget(spec, opts.baseUrl)) {
    const base = normalizeBaseUrl(opts.baseUrl || spec.baseUrl);
    if (!base || !model) throw new Error("URL und Modell setzen.");
    const pics = (opts.images ?? []).filter((u) => /^data:image\//i.test(u)).slice(0, 4);
    const userContent =
      pics.length > 0
        ? [
            { type: "text", text: opts.prompt.slice(0, 12000) },
            ...pics.map((url) => ({ type: "image_url", image_url: { url } })),
          ]
        : opts.prompt.slice(0, 12000);
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
    const chatUrl = localChatUrl(spec.id, base);
    const res = await lanFetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.apiKey.trim() ? { Authorization: `Bearer ${opts.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify(sanitizeLocalPayload(spec.id, payload)),
      signal: withAgentTimeout(0),
    }, spec.id === "custom" ? base : "");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (spec.id === "ollama") {
      const choice = await readSseChat(wrapOllamaResponse(chatUrl, res));
      if (!choice.content?.trim()) throw new Error("Leere Antwort.");
      return choice.content.trim();
    }
    const json = (await res.json()) as { choices: { message: { content?: string } }[] };
    const text = json.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Leere Antwort.");
    return text;
  }
  const r = await proxyLlm({
    data: {
      action: "complete",
      provider: spec.id,
      baseUrl: opts.baseUrl || spec.baseUrl,
      model,
      apiKey: opts.apiKey.trim(),
      prompt: opts.prompt,
    },
  });
  if (!r.ok) throw new Error(r.error || "Keine Antwort");
  const text = r.choice?.content?.trim();
  if (!text) throw new Error("Leere Antwort.");
  return text;
}
