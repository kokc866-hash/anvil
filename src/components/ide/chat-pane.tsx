import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ImagePlus, Plus, Send, Square, X } from "lucide-react";
import { CopyMini } from "@/components/ui/copy-btn";
import { Button } from "@/components/ui/button";
import { chatWithProvider, providerOf } from "@/lib/agent-client";
import { completeText } from "@/lib/complete";
import { syncMkdir, syncRemove, syncWrite } from "@/lib/disk-sync";
import { toolCode, toolDetail } from "@/lib/llm-options";
import { runFile } from "@/lib/run-client";
import { estimateTokens, formatContext, formatTokens } from "@/lib/tokens";
import { emitPlugin } from "@/lib/plugins/events";
import { anvilHandle } from "@/lib/anvil";
import { packRefContext, refFiles, isSecretPath, isRefPath, REF_DIR } from "@/lib/ref";
import { snapshotDiff, lineDiff } from "@/lib/diff";
import { testsPrompt } from "@/lib/test-parse";
import { shouldTestAfterRound, testAfterRound } from "@/lib/test-loop";
import { workspaceRules } from "@/lib/rules";
import { guessPlan, planFinish, planFromTool, planStart } from "@/lib/plan";
import { resetLoopFails } from "@/lib/run-loop";
import { agentGen, beginAgent, explainAbort, explainLlmError, isAbortLike, stopAgent } from "@/lib/abort";
import { appLog, logHost } from "@/lib/app-log";
import { brainAsk, brainAttach, brainChatTitle, brainDistill, brainFollowups, brainMentionRank, brainModelOf, brainPlanText, brainReady, brainReview, brainSecretWarn, brainStopNote, lanePrompt, routeKind, scrubSecrets, useBrain } from "@/lib/brain";
import { heuristicMention } from "@/lib/brain/extra-heur";
import { learnPrompt, markSkills, reflectUtterance, skillOutcome, useLearn } from "@/lib/learn";
import { extractJournal, mergeJournal, packChatHistory, pruneSession } from "@/lib/session";
import type { WorkspaceEvent } from "@/lib/agent-core";
import { cn } from "@/lib/cn";
import { CodeBlock } from "@/lib/syntax";
import { nativeHelper } from "@/lib/helper-local";
import { useIde, type AgentMode, type AgentStep, type ChatMsg } from "@/store/ide";
import { SurfaceSwitch } from "./surface-switch";
import { HelperPrompts } from "./helper-prompts";
import { t, useT } from "@/lib/i18n";
import { getDrag, hasOsFiles, importDropped, uniqueDest } from "@/lib/dnd";
import { CtxMenu, type CtxItem } from "./ctx-menu";
import { Tip } from "@/components/ui/tooltip";
import { isFixPrompt } from "@/lib/agent-parse";
import { formatElapsed, useElapsed } from "@/lib/elapsed";
import { AgentPulse } from "./agent-pulse";
import { resetLiveWrite } from "@/lib/live-write";

function parseBlocks(text: string) {
  return text.split(/(```[\s\S]*?```)/g).map((part) => {
    if (!part.startsWith("```")) return { code: false as const, text: part };
    const m = part.match(/^```([^\n]*)\n?([\s\S]*?)\n?```$/);
    const meta = (m?.[1] ?? "").trim();
    const body = m?.[2] ?? "";
    const path = meta.includes(".") && !meta.includes(" ") ? meta : "";
    return { code: true as const, text: body, path, lang: meta };
  });
}

export function ChatPane() {
  const t = useT();
  const chat = useIde((s) => s.chat);
  const agentBusy = useIde((s) => s.agentBusy);
  const trailInline = useIde((s) => s.trailInChat || !s.panels.trail);
  const trailOpen = useIde((s) => s.panels.trail);
  const addChat = useIde((s) => s.addChat);
  const startAssistant = useIde((s) => s.startAssistant);
  const appendAssistant = useIde((s) => s.appendAssistant);
  const appendThinking = useIde((s) => s.appendThinking);
  const addAgentStep = useIde((s) => s.addAgentStep);
  const addSessionTokens = useIde((s) => s.addSessionTokens);
  const finalizeAssistant = useIde((s) => s.finalizeAssistant);
  const setAgentBusy = useIde((s) => s.setAgentBusy);
  const patchFiles = useIde((s) => s.patchFiles);
  const applyFiles = useIde((s) => s.applyFiles);
  const writeFile = useIde((s) => s.writeFile);
  const pushOutput = useIde((s) => s.pushOutput);
  const setRunning = useIde((s) => s.setRunning);
  const togglePanel = useIde((s) => s.togglePanel);
  const clearChat = useIde((s) => s.clearChat);
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const [title, setTitle] = useState("");
  const llmProvider = useIde((s) => s.llmProvider);
  const llmModel = useIde((s) => s.llmModel);
  const helperId = useBrain((s) => s.customId.trim() || s.modelId);
  const helperLabel = brainModelOf(helperId)?.label ?? helperId;
  const agentMode = useIde((s) => s.agentMode);
  const graphLoop = useIde((s) => s.graphLoop);
  const setAgentMode = useIde((s) => s.setAgentMode);
  const attached = useIde((s) => s.attached);
  const setAttached = useIde((s) => s.setAttached);
  const fileKeys = useIde((s) => Object.keys(s.files).sort().join("\n"));
  const activePath = useIde((s) => s.activePath);
  const draft = useIde((s) => s.agentDraft);
  const setDraft = useIde((s) => s.setAgentDraft);
  const [mention, setMention] = useState<string | null>(null);
  const [mentionRank, setMentionRank] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [dropOn, setDropOn] = useState(false);
  const [menu, setMenu] = useState<ChatMenu | null>(null);
  const pendingAsk = useIde((s) => s.pendingAsk);
  const agentQueue = useIde((s) => s.agentQueue);
  const scroller = useRef<HTMLDivElement>(null);
  const pin = useRef(true);
  const [away, setAway] = useState(false);
  const agentStartedAt = useIde((s) => s.agentStartedAt);
  const busyMs = useElapsed(agentStartedAt || undefined, agentBusy);

  useEffect(() => {
    if (!pin.current) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, agentBusy]);

  async function applyWorkspace(ev: WorkspaceEvent) {
    const s = useIde.getState();
    if (ev.op === "write") s.writeFile(ev.path, ev.content);
    else if (ev.op === "delete") s.deleteFile(ev.path);
    else if (ev.op === "mkdir") s.createFolder(ev.path);
    else if (ev.op === "rename") s.movePath(ev.from, ev.to);
    else if (ev.op === "commit") s.commit(ev.message);
    else if (ev.op === "preview") {
      s.openFile(ev.path);
      s.setRunPath(ev.path);
      s.setPreviewOpen(true);
      if (/\.html?$/i.test(ev.path) || s.runInWindow) {
        void import("@/lib/run-window").then((m) => m.openRunWindow({ agent: true }));
      } else {
        s.revealOutput();
        void import("@/lib/run-window").then((m) => m.agentOpenedPreview());
      }
    } else if (ev.op === "board") {
      s.setHarnessBoardOpen(ev.open !== false);
      if (ev.open === false) {
        s.setPanels({ ...s.panels, code: true, files: true });
      }
    }
    if (ev.op === "commit" || ev.op === "preview" || ev.op === "board") return;
    if (!s.diskName && s.storageMode !== "disk" && !s.workspaceCwd) return;
    try {
      if (ev.op === "write") await syncWrite(ev.path, ev.content);
      else if (ev.op === "delete") await syncRemove(ev.path);
      else if (ev.op === "mkdir") await syncMkdir(ev.path);
      else if (ev.op === "rename") {
        await syncRemove(ev.from);
        const files = useIde.getState().files;
        if (files[ev.to] != null) await syncWrite(ev.to, files[ev.to]);
        else {
          for (const [p, c] of Object.entries(files)) {
            if (p === ev.to || p.startsWith(`${ev.to}/`)) await syncWrite(p, c);
          }
        }
      }
    } catch {
      /* no disk permission */
    }
  }

  const mentionList = useMemo(() => {
    if (mention == null) return [];
    const q = mention.toLowerCase();
    const names = fileKeys.split("\n").filter(Boolean);
    const st = useIde.getState();
    const ranked = mentionRank.length
      ? mentionRank.filter((p) => names.includes(p) || p === "run" || p === "debug" || p === "problems" || p === "tests" || p === "git")
      : heuristicMention(q, names, { dirty: Object.keys(st.dirty), recent: st.recentPaths, active: st.activePath });
    const pins = [
      st.output.some((r) => !r.ok) || q.startsWith("r") ? "run" : "",
      st.debug.paused || q.startsWith("d") ? "debug" : "",
      st.lspProblems.length || q.startsWith("p") ? "problems" : "",
      Object.values(st.testResults).length || q.startsWith("t") ? "tests" : "",
      Object.keys(st.dirty).length || q.startsWith("g") ? "git" : "",
    ].filter((id) => id && (!q || id.startsWith(q) || q === "@"));
    const refs = names.filter((p) => p === "ref" || p.startsWith("ref/"));
    const wantRef = q === "ref" || q.startsWith("ref/") || q === "";
    const pool = wantRef && q.startsWith("ref") ? refs : ranked.length ? ranked : names;
    const needle = q.replace(/^ref\/?/, "");
    const hits = pool.filter((p) => {
      const n = p.toLowerCase();
      return !needle || n.includes(q) || n.includes(needle) || p.slice(p.lastIndexOf("/") + 1).toLowerCase().includes(needle);
    });
    const out = [...pins, ...hits].slice(0, 10);
    if (q === "ref" || q === "") out.unshift(`${REF_DIR}/`);
    return [...new Set(out)].slice(0, 10);
  }, [fileKeys, mention, mentionRank]);

  useEffect(() => {
    if (mention == null) {
      setMentionRank([]);
      return;
    }
    const names = fileKeys.split("\n").filter(Boolean);
    let live = true;
    void brainMentionRank(mention, names).then((r) => {
      if (live) setMentionRank(r);
    });
    return () => {
      live = false;
    };
  }, [mention, fileKeys]);

  const agentInbox = useIde((s) => s.agentInbox);
  const clearAgentInbox = useIde((s) => s.clearAgentInbox);

  useEffect(() => {
    if (!agentInbox || agentBusy) return;
    const text = agentInbox;
    clearAgentInbox();
    void send(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentInbox]);

  useEffect(() => {
    if (agentBusy) return;
    if (useIde.getState().agentInbox) return;
    const q = useIde.getState().agentQueue;
    if (!q.length) return;
    useIde.setState({ agentQueue: q.slice(1) });
    void send(q[0], { queued: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentBusy, agentQueue.length]);

  function stop() {
    stopAgent("Gestoppt");
    setAgentBusy(false);
    useIde.getState().failRunningSteps();
    const last = useIde.getState().chat.at(-1);
    if (last?.role === "assistant") {
      void brainStopNote(last.steps ?? []).then((note) => {
        const cur = useIde.getState().chat.at(-1);
        if (cur?.id !== last.id) return;
        const body = (cur.content || "").trim();
        finalizeAssistant(body ? `${body}\n${note}` : `Gestoppt.\n${note}`);
      });
    }
    reflectUtterance(draft, "abort");
  }

  async function send(preset?: string, opts?: { queued?: boolean }) {
    const pending = useIde.getState().pendingAsk;
    let text = (preset ?? draft).trim();
    if (pending && !text) text = "Erkläre die Auswahl.";
    if (!text) return;
    let holdUi = false;
    if (useIde.getState().agentBusy && !opts?.queued) {
      useIde.getState().pushAgent(text);
      setDraft("");
      setImages([]);
      return;
    }
    const scrub = scrubSecrets(text);
    let work = scrub.text;
    if (pending) {
      work = `Auswahl in ${pending.path}:\n\`\`\`\n${pending.text.slice(0, 4000)}\n\`\`\`\n\n${work}`;
      useIde.getState().setPendingAsk(null);
    }
    const forceAsk = Boolean(pending);
    if (scrub.n) useIde.getState().setNotice(t("secretsN", { n: scrub.n }));
    else void brainSecretWarn(text).then((w) => { if (w) useIde.getState().setNotice(w); });
    const my = beginAgent();
    setAgentBusy(true);
    await import("@/lib/model-context").then((m) => m.applyCloudContext()).catch(() => null);
    appLog(
      "agent",
      `start ${useIde.getState().llmProvider} ${useIde.getState().llmModel || "-"} host=${logHost(useIde.getState().llmBaseUrl)} ctx=${useIde.getState().llmContext} think=${useIde.getState().llmThinking}`,
    );
    useBrain.getState().setFollowups([]);
    setDraft("");
    setMention(null);
    const pics = images.slice(0, 4);
    setImages([]);
    addChat({ role: "user", content: work, images: pics.length ? pics : undefined });
    startAssistant();
    const asstId = useIde.getState().chat.at(-1)?.id;
    resetLiveWrite();
    if (!title) void brainChatTitle(work).then(setTitle);
    emitPlugin("agent", work);
    reflectUtterance(work, "ask");
    try {
      const routed = await anvilHandle(work);
      if (my !== agentGen()) return;
      if (routed.hand === "app" && routed.reply) {
        finalizeAssistant(routed.reply);
        return;
      }
      const ck = useIde.getState().pushCheckpoint(work.slice(0, 60));
      resetLoopFails();
      const s = useIde.getState();
      const extraFiles = [...new Set([...(s.attached ?? []), s.activePath].filter(Boolean))] as string[];
      const prefer = [...new Set([...(s.attached ?? []), s.activePath, ...s.openPaths, ...s.recentPaths.slice(0, 8)].filter(Boolean))] as string[];
      if (useBrain.getState().jobs.attach && brainReady()) {
        void brainAttach(work, Object.keys(s.files)).then((more) => {
          if (more.length && my === agentGen()) s.setAttached([...new Set([...extraFiles, ...more])]);
        });
      }
      const rules = workspaceRules(s.files, s.agentRules);
      const memory = learnPrompt(work);
      const helperNotes = lanePrompt();
      const refs = packRefContext(s.files, work, extraFiles.filter(isRefPath));
      const pinBlock = (await import("@/lib/fix-agent")).pinContext(work);
      const context = extraFiles
        .filter((p) => s.files[p] && !isSecretPath(p))
        .slice(0, 8)
        .map((p) => {
          const src = s.files[p];
          const lines = src.split("\n").length;
          if (src.length > 8000) return `[${p}] ${lines} Zeilen — mit read_file lesen, nicht raten.`;
          return `[${p}]\n\`\`\`\n${scrubSecrets(src.slice(0, 8000)).text}\n\`\`\``;
        })
        .join("\n\n");
      const prefix = scrubSecrets(
        [
          rules ? `Projektregeln:\n${rules}` : "",
          memory,
          helperNotes,
          refs.text,
          pinBlock,
          context ? `Angehängte Dateien:\n${context}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      ).text;
      const user = prefix ? `${prefix}\n\nAuftrag:\n${work}` : work;
      const history = packChatHistory(
        s.chat.map((m) => ({ role: m.role, content: m.content, images: m.images })),
        { content: user, images: [...pics, ...refs.images].slice(0, 4) },
      );
      if (isFixPrompt(work) && s.agentMode !== "agent") useIde.getState().setAgentMode("agent");
      const fileList = Object.entries(s.files)
        .filter(([path]) => !isSecretPath(path))
        .map(([path, content]) => ({ path, content }));
      const promptTok = estimateTokens(user) + estimateTokens(JSON.stringify(Object.keys(s.files)));

      if (!isFixPrompt(work) && (s.agentMode === "ask" || forceAsk)) {
        const helperAsk =
          s.agentMode === "ask" &&
          !forceAsk &&
          brainReady() &&
          useBrain.getState().jobs.ask &&
          routeKind(work) === "ask-local";
        let reply: string;
        if (helperAsk) {
          try {
            reply = await brainAsk(user, (chunk) => {
              if (my !== agentGen()) return;
              appendAssistant(chunk);
            });
          } catch {
            reply = await completeText({
              prompt: `You are Anvil in Ask mode. Do not change files. Explain briefly in the user's language.\n\n${user}`,
              provider: s.llmProvider,
              baseUrl: s.llmBaseUrl,
              model: s.llmModel,
              apiKey: s.llmApiKey,
            });
          }
        } else {
          reply = await completeText({
            prompt: `You are Anvil in Ask mode. Do not change files. Explain briefly in the user's language.\n\n${user}`,
            provider: s.llmProvider,
            baseUrl: s.llmBaseUrl,
            model: s.llmModel,
            apiKey: s.llmApiKey,
          });
        }
        if (my !== agentGen()) return;
        finalizeAssistant(reply);
        addSessionTokens(promptTok, estimateTokens(reply));
        void brainDistill(work, reply);
        {
          const st = useIde.getState();
          st.setSessionJournal(mergeJournal(st.sessionJournal, extractJournal(st.chat, st.sessionJournal)));
        }
        void pruneSession();
        return;
      }

      useIde.setState((st) => {
        const chat = [...st.chat];
        const last = chat[chat.length - 1];
        if (last?.role === "assistant") chat[chat.length - 1] = { ...last, checkpointId: ck, plan: guessPlan(work) };
        return { chat };
      });
      void brainPlanText(work).then((steps) => {
        if (my !== agentGen()) return;
        const last = useIde.getState().chat.at(-1);
        if (!last?.plan?.length || last.plan.some((s) => s.status !== "todo")) return;
        if (steps.length >= 3) useIde.getState().setChatPlan(steps.map((text) => ({ text, status: "todo" as const })));
      });
      const result = await chatWithProvider({
        provider: s.llmProvider,
        baseUrl: s.llmBaseUrl,
        model: s.llmModel,
        apiKey: s.llmApiKey,
        messages: history,
        files: fileList,
        dirs: s.dirs,
        git: {
          repo: s.githubRepo,
          hasToken: Boolean(s.githubToken.trim()),
          dirty: Object.keys(s.dirty).filter(Boolean),
          commits: s.commits.map((c) => ({ message: c.message, at: c.at })),
        },
        githubToken: s.githubToken,
        context: s.llmContext,
        thinking: s.llmThinking,
        compact: s.llmCompact,
        journal: s.sessionJournal,
        prefer,
        onHarness: (bar) => {
          if (my !== agentGen()) return;
          if (!useIde.getState().graphLoop && !useIde.getState().runLoop) return;
          useIde.getState().setChatHarness(bar);
        },
        onDelta: (chunk, kind) => {
          if (my !== agentGen()) return;
          if (kind === "think") appendThinking(chunk);
          else appendAssistant(chunk);
        },
        onWorkspace: applyWorkspace,
        onToolStart: ({ name, args }) => {
          if (my !== agentGen()) return;
          const started = planStart(name, useIde.getState().chat.at(-1)?.plan);
          if (started) useIde.getState().setChatPlan(started);
          addAgentStep({ name, detail: toolDetail(name, args), status: "run", ...toolCode(name, args) });
          void import("@/lib/run-window").then((m) => m.agentToolUi(name, String(args.path ?? "")));
          if (name === "run_file" || name === "engine_run") {
            const max = useIde.getState().loopTries;
            const prev = useIde.getState().chat.at(-1)?.lastRun;
            const n = (prev?.attempt ?? 0) + (prev?.running ? 0 : 1);
            useIde.getState().setChatLastRun({
              ok: false,
              path: String(args.path ?? args.cmd ?? args.action ?? ""),
              stdout: "",
              stderr: "",
              attempt: Math.max(1, n || 1),
              max,
              running: true,
            });
          }
        },
        onTool: ({ name, args, result: out }) => {
          if (my !== agentGen()) return;
          const err = out && typeof out === "object" && "error" in out;
          const failed =
            Boolean(err) ||
            Boolean(out && typeof out === "object" && "ok" in out && (out as { ok?: boolean }).ok === false);
          if (name === "skill_run") markSkills([String(args.name ?? "")]);
          if (name === "set_plan" && out && typeof out === "object" && "steps" in out) {
            const steps = (out as { steps?: string[] }).steps ?? [];
            useIde.getState().setChatPlan(steps.map((text) => ({ text, status: "todo" as const })));
          } else {
            const bumped = planFromTool(name, useIde.getState().chat.at(-1)?.plan, failed);
            if (bumped) useIde.getState().setChatPlan(bumped);
          }
          addAgentStep({
            name,
            detail: toolDetail(name, args, out),
            status: failed ? "err" : "ok",
            image:
              out && typeof out === "object"
                ? typeof (out as { image?: unknown }).image === "string"
                  ? (out as { image: string }).image
                  : typeof (out as { frame?: unknown }).frame === "string"
                    ? (out as { frame: string }).frame
                    : undefined
                : undefined,
            ...toolCode(name, args),
          });
          if ((name === "run_file" || name === "engine_run") && out && typeof out === "object") {
            const o = out as { ok?: boolean; stdout?: string; stderr?: string; tries_left?: number; graphical?: boolean; cmd?: string; error?: string };
            const max = useIde.getState().loopTries;
            const left = typeof o.tries_left === "number" ? o.tries_left : max;
            useIde.getState().setChatLastRun({
              ok: Boolean(o.ok) && !err,
              path: String(args.path ?? args.cmd ?? args.action ?? ""),
              stdout: String(o.stdout ?? ""),
              stderr: String(o.stderr ?? o.error ?? ""),
              attempt: Math.max(1, max - left + (o.ok ? 0 : 1)),
              max,
              graphical: Boolean(o.graphical),
              running: false,
            });
          }
        },
      });
      if (my !== agentGen()) return;
      finalizeAssistant(result.reply, result.tools);
      if (result.ok) {
        void import("@/lib/intern").then((m) => m.resolveKind("agent"));
        void import("@/lib/problems").then((m) => m.refreshProblems());
      }
      const snap = useIde.getState().checkpoints.find((c) => c.id === ck);
      if (snap && Object.keys(snap.files).length) {
        const changes = snapshotDiff(snap.files, useIde.getState().files);
        useIde.getState().setChatChanges(changes);
        const st = useIde.getState();
        if (shouldTestAfterRound(changes, st.files, st.chat.at(-1)?.steps)) {
          void testAfterRound();
        }
      }
      addSessionTokens(result.usage?.prompt || promptTok, result.usage?.completion || estimateTokens(result.reply));
      void brainDistill(work, result.reply);
      {
        const st = useIde.getState();
        const fromChat = extractJournal(st.chat, st.sessionJournal);
        const fromFiles = result.files?.length
          ? { ...fromChat, files: [...new Set([...fromChat.files, ...result.files.map((f) => f.path)])] }
          : fromChat;
        st.setSessionJournal(mergeJournal(st.sessionJournal, fromFiles));
      }
      if (result.compacted) {
        const n = useIde.getState().sessionJournal.files.length;
        addAgentStep({
          name: "compact",
          detail: n ? `Sitzung gemerkt · ${n} Dateien` : "Verlauf gekürzt (Context)",
          status: "ok",
        });
      }
      void pruneSession();
      if (result.files?.length) {
        const cur = useIde.getState().files;
        const map: Record<string, string> = {};
        for (const f of result.files) {
          if ((cur[f.path] ?? "") !== f.content) map[f.path] = f.content;
        }
        if (Object.keys(map).length) {
          const st = useIde.getState();
          if (st.autoAcceptDiffs || isFixPrompt(work)) applyFiles({ ...cur, ...map });
          else patchFiles(map);
        }
        void brainReview(result.files.map((f) => f.path)).then((t) => {
          if (t && my === agentGen()) addAgentStep({ name: "review", detail: t, status: "ok" });
        });
      }
      void brainFollowups(work, result.reply);
      if (result.runPaths?.length) {
        const st = useIde.getState();
        const already = result.tools?.includes("run_file");
        if (st.autoRunAgent && !already) {
          holdUi = true;
          queueMicrotask(() => {
            void (async () => {
              if (my !== agentGen()) return;
              const html = result.runPaths!.some((p) => /\.html?$/i.test(p));
              const cur = useIde.getState();
              if (html || cur.runInWindow) {
                void import("@/lib/run-window").then((m) => m.openRunWindow({ agent: true }));
                cur.setPreviewOpen(false);
              } else {
                if (cur.openOutputOnRun) cur.revealOutput();
                cur.setPreviewOpen(true);
                void import("@/lib/run-window").then((m) => m.agentOpenedPreview());
              }
              setRunning(true);
              try {
                const latest = useIde.getState().files;
                let ok = true;
                for (const p of result.runPaths!) {
                  useIde.getState().setRunPath(p);
                  const r = await runFile(p, latest);
                  if (my !== agentGen()) return;
                  pushOutput(r);
                  if (!r.ok) ok = false;
                }
                skillOutcome(ok ? "ok" : "fail");
                if (!ok) useLearn.getState().track("fail", result.runPaths![0]);
              } finally {
                setRunning(false);
                void import("@/lib/run-window").then((m) => m.releaseAgentUi());
              }
            })();
          });
        }
      }
    } catch (err) {
      if (my !== agentGen()) {
        const last = useIde.getState().chat.at(-1);
        if (last && last.id === asstId && last.role === "assistant" && !(last.content || "").trim()) {
          finalizeAssistant("Unterbrochen — nochmal senden setzt hier an.");
        }
        return;
      }
      finalizeAssistant(isAbortLike(err) ? explainAbort(err) : explainLlmError(err));
      if (isAbortLike(err)) {
        const last = useIde.getState().chat.at(-1);
        void brainStopNote(last?.steps ?? []).then((note) => {
          if (my !== agentGen()) return;
          const cur = useIde.getState().chat.at(-1);
          if (!cur || cur.role !== "assistant") return;
          const body = (cur.content || "").trim();
          if (note && !body.includes(note.slice(0, 24))) finalizeAssistant(body ? `${body}\n${note}` : note);
        });
      }
    } finally {
      const live = my === agentGen();
      const busy = useIde.getState().agentBusy;
      if (live) {
        const last = useIde.getState().chat.at(-1);
        const failed = /^(HTTP \d{3}|Gestoppt|Abgebrochen|Unterbrochen)/i.test((last?.content || "").trim());
        const fin = planFinish(last?.plan, failed);
        if (fin) useIde.getState().setChatPlan(fin);
        setAgentBusy(false);
        appLog("agent", "ende");
        useIde.getState().setRunning(false);
        if (!holdUi) void import("@/lib/run-window").then((m) => m.releaseAgentUi());
        else {
          window.setTimeout(() => {
            if (useIde.getState().agentBusy) return;
            void import("@/lib/run-window").then((m) => m.releaseAgentUi());
          }, 8000);
        }
        queueMicrotask(() => document.getElementById("anvil-chat")?.focus());
      } else if (!busy) {
        useIde.getState().setRunning(false);
        void import("@/lib/run-window").then((m) => m.releaseAgentUi());
      }
    }
  }

  function onDraft(v: string) {
    setDraft(v);
    const at = v.match(/@([^\s@]*)$/);
    setMention(at ? at[1] : null);
  }

  function pickMention(path: string) {
    const next = draft.replace(/@([^\s@]*)$/, `@${path} `);
    setDraft(next);
    setMention(null);
    if (path === `${REF_DIR}/` || path === REF_DIR) {
      const all = refFiles(useIde.getState().files);
      setAttached([...new Set([...attached, ...all])]);
      return;
    }
    if (/^(run|debug|problems|tests|git)$/.test(path)) return;
    if (!attached.includes(path)) setAttached([...attached, path]);
  }

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col bg-surface", dropOn ? "ring-1 ring-inset ring-accent/40" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropOn(true);
      }}
      onDragLeave={() => setDropOn(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropOn(false);
        const files = [...e.dataTransfer.files];
        if (files.length) {
          for (const f of files) {
            if (f.type.startsWith("image/")) {
              const r = new FileReader();
              r.onload = () => {
                const url = String(r.result || "");
                if (url) setImages((prev) => [...prev, url].slice(0, 4));
              };
              r.readAsDataURL(f);
            }
          }
          const rest = files.filter((f) => !f.type.startsWith("image/"));
          if (rest.length) {
            void importDropped(rest, "").then((n) => {
              if (n) useIde.getState().setNotice(t("droppedN", { n }));
            });
          }
          return;
        }
        const drag = getDrag(e.dataTransfer);
        if (drag?.path) {
          if (!attached.includes(drag.path)) setAttached([...attached, drag.path]);
          const d = useIde.getState().agentDraft;
          setDraft(d.includes(`@${drag.path}`) ? d : `${d}${d && !d.endsWith(" ") ? " " : ""}@${drag.path} `);
        }
      }}
    >
        <div
          className="flex h-10 items-center gap-1 border-b border-border px-2"
          onContextMenu={(e) => {
            e.preventDefault();
            const cur = useIde.getState().agentDraft;
            chatSel.a = cur.length;
            chatSel.b = cur.length;
            setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
          }}
        >
        <div className="flex rounded-[10px] bg-bg p-0.5">
          {(["agent", "ask"] as AgentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={cn(
                "h-7 rounded-[8px] px-2.5 text-xs font-medium",
                agentMode === m ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => setAgentMode(m)}
            >
              {m === "agent" ? t("agent") : t("ask")}
            </button>
          ))}
        </div>
        <SurfaceSwitch compact />
        <button
          type="button"
          className="min-w-0 flex-1 truncate px-2 text-left text-xs text-subtle hover:text-fg"
          onClick={() => setSettingsOpen(true)}
          title={t("pickModel")}
        >
          {title ? `${title} · ` : ""}
          {providerOf(llmProvider).label}
          {llmModel ? ` · ${llmModel}` : ""}
        </button>
        <Button
          variant="quiet"
          className="h-8 w-8 p-0"
          title={t("newChat")}
          aria-label={t("newChat")}
          onClick={() => {
            clearChat();
            setTitle("");
            setDraft("");
          }}
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          variant="quiet"
          className="h-8 w-8 p-0"
          title={t("closeAgent")}
          aria-label={t("closeAgent")}
          onClick={() => togglePanel("agent")}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div
        ref={scroller}
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("[data-chat-msg]")) return;
          e.preventDefault();
          const cur = useIde.getState().agentDraft;
          chatSel.a = cur.length;
          chatSel.b = cur.length;
          setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
        }}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          const at = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          pin.current = at;
          setAway(!at);
        }}
      >
        {chat.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg p-3">
            <p className="text-sm text-fg">
              {agentMode === "ask" ? t("emptyAsk") : t("emptyAgent")}
            </p>
            <div className="mt-2 flex flex-col gap-1">
              {[
                t("hintNew"),
                t("hintWrite"),
                t("hintTests"),
              ].map((hint) => (
                <button
                  key={hint}
                  type="button"
                  className="rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg"
                  onClick={() => {
                    if (hint === t("hintNew")) {
                      window.dispatchEvent(new Event("anvil-starter"));
                      return;
                    }
                    setDraft(hint);
                  }}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-8 pt-8">
            {chat.map((m, i) => {
              const liveThink = agentBusy && m.role === "assistant" && i === chat.length - 1;
              const lastUser = m.role === "user" && chat.filter((x) => x.role === "user").at(-1)?.id === m.id;
              const lastAsst = m.role === "assistant" && i === chat.length - 1 && !agentBusy;
              const hollow =
                m.role === "assistant" &&
                !liveThink &&
                !(m.content || "").trim() &&
                !(m.thinking || "").trim() &&
                !(m.steps?.length) &&
                !(m.plan?.length) &&
                !m.lastRun &&
                !m.lastTests;
              if (hollow) return null;
              return (
              <div
                key={m.id}
                data-chat-msg
                className={cn(
                  "group relative min-w-0 max-w-[92%] break-words",
                  m.role === "user" ? "self-end" : "self-start",
                )}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ kind: "msg", x: e.clientX, y: e.clientY, id: m.id });
                }}
              >
                {m.role !== "user" ? (
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium justify-start text-muted">
                  {m.voice === "helper" ? (
                    <>
                      <span className="flex size-5 items-center justify-center rounded-full border border-ok/40 bg-surface text-[10px] font-semibold text-ok">
                        H
                      </span>
                      <span className="text-ok">{t("helper")}</span>
                      {helperLabel ? <span className="truncate text-subtle">· {helperLabel}</span> : null}
                      {m.ms ? <span className="font-mono tabular-nums text-subtle">· {formatElapsed(m.ms)}</span> : null}
                    </>
                  ) : (
                    <>
                      <span className="flex size-5 items-center justify-center rounded-full border border-border bg-surface text-[10px] font-semibold text-fg">
                        A
                      </span>
                      <span className="text-fg">{t("agent")}</span>
                      {liveThink ? <AgentPulse className="ml-0.5 shrink-0" /> : null}
                      {liveThink || m.ms ? (
                        <span className="shrink-0 font-mono tabular-nums text-subtle">
                          · {formatElapsed(liveThink ? busyMs : m.ms || 0)}
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
                ) : null}
                <div
                  className={cn(
                    "absolute -top-7 z-10 hidden items-center rounded-md border border-border bg-surface p-0.5 shadow-sm group-hover:flex",
                    m.role === "user" ? "right-0" : "left-0",
                  )}
                >
                  <CopyMini text={m.content} />
                  {lastUser || lastAsst ? (
                    <button
                      type="button"
                      className="h-6 rounded-sm px-2 text-[11px] text-muted hover:bg-hover hover:text-fg"
                      onClick={() => {
                        if (m.role === "user") useIde.getState().pushAgent(m.content);
                        else {
                          const prev = [...chat].reverse().find((x) => x.role === "user");
                          if (prev) useIde.getState().pushAgent(prev.content);
                        }
                      }}
                    >
                      {t("again")}
                    </button>
                  ) : null}
                  {lastUser ? (
                    <button
                      type="button"
                      className="h-6 rounded-sm px-2 text-[11px] text-muted hover:bg-hover hover:text-fg"
                      onClick={() => setDraft(m.content)}
                    >
                      {t("chatEdit")}
                    </button>
                  ) : null}
                </div>
                <div
                  className={cn(
                    "chat-in min-w-0 max-w-full overflow-hidden rounded-lg px-3.5 py-2.5 text-sm leading-relaxed break-words text-fg [overflow-wrap:anywhere]",
                    m.role === "user"
                      ? "rounded-br-sm bg-hover"
                      : m.voice === "helper"
                        ? "rounded-tl-sm bg-bg"
                        : "rounded-tl-sm bg-bg",
                  )}
                >
                {trailInline && m.role === "assistant" && m.thinking ? <ThinkBlock text={m.thinking} live={liveThink} since={m.at} /> : null}
                {trailInline &&
                m.role === "assistant" &&
                (m.plan?.length ||
                  m.steps?.length ||
                  m.changes?.length ||
                  m.checkpointId ||
                  m.lastRun ||
                  m.lastTests ||
                  (m.harness && graphLoop)) ? (
                  <Trail m={m} live={false} liveTools={false} />
                ) : null}
                {m.role === "user" && m.images?.length ? (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {m.images.map((src, n) => (
                      <img key={n} src={src} alt="" className="max-h-24 rounded-md" />
                    ))}
                  </div>
                ) : null}
                {parseBlocks(m.content).map((part, i) =>
                  part.code ? (
                    <div
                      key={i}
                      className="my-2 overflow-hidden rounded-md bg-surface"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenu({
                          kind: "code",
                          x: e.clientX,
                          y: e.clientY,
                          path: part.path,
                          lang: part.lang,
                          text: part.text,
                        });
                      }}
                    >
                      <div className="flex items-center justify-between px-2 py-1 text-xs text-muted">
                        <span className="font-mono">{part.path || part.lang || "code"}</span>
                        {part.path ? (
                          <button
                            type="button"
                            className="text-fg hover:underline"
                            onClick={() => writeFile(part.path, part.text)}
                          >
                            Übernehmen
                          </button>
                        ) : null}
                      </div>
                      <CodeBlock code={part.text} lang={part.lang} path={part.path} />
                    </div>
                  ) : (
                    <span key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  ),
                )}
                </div>
              </div>
              );
            })}
            {agentBusy && !chat.at(-1)?.steps?.length && !chat.at(-1)?.plan?.length ? (
              <p className="px-1 text-xs text-muted">
                {agentQueue.length ? t("queued", { n: agentQueue.length }) : null}
              </p>
            ) : null}
            {agentQueue.length ? (
              <div className="mt-1 rounded-md border border-border bg-surface px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted">Warteschlange {agentQueue.length}</p>
                  <button
                    type="button"
                    className="text-[11px] text-danger hover:underline"
                    onClick={() => useIde.setState({ agentQueue: [] })}
                  >
                    Leeren
                  </button>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {agentQueue.map((q, i) => (
                    <li key={`${i}-${q.slice(0, 24)}`} className="flex items-center gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-fg">{q}</span>
                      <button
                        type="button"
                        className="shrink-0 text-subtle hover:text-fg"
                        aria-label="entfernen"
                        onClick={() =>
                          useIde.setState((s) => ({ agentQueue: s.agentQueue.filter((_, n) => n !== i) }))
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agentBusy && !trailOpen && chat.at(-1)?.steps?.some((s) => s.status === "run") ? (
              <button
                type="button"
                className="px-1 text-left text-[11px] text-muted hover:text-fg"
                onClick={() => togglePanel("trail")}
              >
                Tool läuft · Spur öffnen
              </button>
            ) : null}
            {agentBusy && busyMs >= 180_000 ? (
              <button type="button" className="px-1 text-left text-[11px] text-subtle hover:text-fg" onClick={stop}>
                {t("stuckHint")}
              </button>
            ) : null}
            {away ? (
              <button
                type="button"
                className="sticky bottom-0 mx-auto block rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted"
                onClick={() => {
                  pin.current = true;
                  setAway(false);
                  const el = scroller.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
              >
                Nach unten
              </button>
            ) : null}
          </div>
        )}
      </div>
      {menu ? (
        <CtxMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={chatMenu(menu, {
            addImages: (urls) => setImages((prev) => [...prev, ...urls].slice(0, 4)),
          })}
        />
      ) : null}

      {trailInline ? <AgentTodo /> : null}

      <div className="relative z-10 shrink-0 border-t border-border p-2">
        {pendingAsk ? (
          <div className="mb-1.5 flex items-start justify-between gap-2 rounded-md border border-border bg-bg px-2 py-1">
            <p className="min-w-0 font-mono text-[11px] text-muted">
              Ask · {pendingAsk.path} · {pendingAsk.text.slice(0, 80)}
            </p>
            <button type="button" className="text-subtle hover:text-fg" onClick={() => useIde.getState().setPendingAsk(null)}>
              ×
            </button>
          </div>
        ) : null}
        {images.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {images.map((src, i) => (
              <button key={i} type="button" className="relative" onClick={() => setImages(images.filter((_, n) => n !== i))}>
                <img src={src} alt="" className="h-12 w-12 rounded-md object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        {attached.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {attached.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-md bg-bg px-1.5 py-0.5 font-mono text-[11px] text-muted">
                @{p.split("/").pop()}
                <button
                  type="button"
                  className="text-subtle hover:text-fg"
                  onClick={() => setAttached(attached.filter((x) => x !== p))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="relative">
            {mentionList.length > 0 ? (
              <ul className="absolute inset-x-0 bottom-full mb-1 overflow-hidden rounded-md border border-border bg-surface">
                {mentionList.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className="flex h-8 w-full items-center px-2 font-mono text-xs text-fg hover:bg-hover"
                      onClick={() => pickMention(p)}
                    >
                      {p === "run"
                        ? `@run · ${t("pinRun")}`
                        : p === "debug"
                          ? `@debug · ${t("pinDebug")}`
                          : p === "problems"
                            ? `@problems · ${t("pinProblems")}`
                            : p === "tests"
                              ? `@tests · ${t("pinTests")}`
                              : p === "git"
                                ? `@git · ${t("pinGit")}`
                                : p}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-end gap-2">
              <Tip label={t("attachImage")} side="top">
                <label className="flex h-11 w-9 cursor-pointer items-center justify-center rounded-md text-muted hover:text-fg">
                <ImagePlus className="size-4" />
                <input
                  id="anvil-chat-img"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = () => {
                      const url = String(r.result || "");
                      if (url) setImages((prev) => [...prev, url].slice(0, 4));
                    };
                    r.readAsDataURL(f);
                  }}
                />
              </label>
              </Tip>
              <textarea
                id="anvil-chat"
                value={draft}
                rows={2}
                placeholder={pendingAsk ? t("chatAskSel") : agentMode === "ask" ? t("chatAsk") : t("chatAgent")}
                className="min-h-11 flex-1 resize-none rounded-[10px] border border-border bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-subtle focus:border-fg/30 focus:ring-0"
                onPointerDown={(e) => e.currentTarget.focus()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.currentTarget;
                  chatSel.a = t.selectionStart;
                  chatSel.b = t.selectionEnd;
                  setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
                }}
                onChange={(e) => onDraft(e.target.value)}
                onPaste={(e) => {
                  const files = [...e.clipboardData.items]
                    .filter((x) => x.type.startsWith("image/"))
                    .map((x) => x.getAsFile())
                    .filter((f): f is File => Boolean(f));
                  if (!files.length) return;
                  e.preventDefault();
                  for (const f of files) {
                    const r = new FileReader();
                    r.onload = () => {
                      const url = String(r.result || "");
                      if (url) setImages((prev) => [...prev, url].slice(0, 4));
                    };
                    r.readAsDataURL(f);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {agentBusy ? (
                <Button type="button" variant="danger" className="h-11 w-11 p-0" onClick={stop} aria-label={t("stop")} title={t("stop")}>
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  className="h-11 w-11 p-0"
                  disabled={!draft.trim() && !images.length && !pendingAsk}
                  aria-label={t("send")}
                  title={t("send")}
                  kbd="Enter"
                  type="submit"
                >
                  <Send className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
        <div className="mt-1 flex items-center justify-between gap-2 px-1">
          <HelperPrompts where="chat" />
        </div>
        <FollowupChips />
        <ContextBar />
      </div>
    </div>
  );
}

function FollowupChips() {
  const items = useBrain((s) => s.followups);
  if (!items.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 px-1">
      {items.map((p) => (
        <button
          key={p}
          type="button"
          title={p}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:border-fg/40 hover:text-fg"
          onClick={() => useIde.getState().pushAgent(p)}
        >
          {p.length > 42 ? `${p.slice(0, 40)}…` : p}
        </button>
      ))}
    </div>
  );
}

export function ThinkBlock({
  text,
  live,
  fill,
  height,
  onResize,
  onOpen,
  hideResize,
  opened,
}: {
  text: string;
  live?: boolean;
  fill?: boolean;
  height?: number;
  onResize?: (h: number) => void;
  onOpen?: (open: boolean) => void;
  hideResize?: boolean;
  opened?: boolean;
  since?: number;
}) {
  const [open, setOpen] = useState(Boolean(live));
  const [pinned, setPinned] = useState(false);
  const [h, setH] = useState(180);
  const preRef = useRef<HTMLPreElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const wasLive = useRef(Boolean(live));
  const cap = () => Math.round(window.innerHeight * 0.8);
  const size = fill ? (height ?? 180) : h;
  const shown = opened ?? open;

  function setOpenBoth(v: boolean) {
    setOpen(v);
    onOpen?.(v);
  }

  useEffect(() => {
    if (live && !pinned) setOpenBoth(true);
    if (wasLive.current && !live && !pinned) {
      const t = window.setTimeout(() => setOpenBoth(false), 380);
      wasLive.current = false;
      return () => window.clearTimeout(t);
    }
    wasLive.current = Boolean(live);
  }, [live, pinned]);

  useEffect(() => {
    if (shown && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [text, open, shown]);

  useEffect(() => {
    function move(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const next = Math.max(72, Math.min(cap(), d.h + (e.clientY - d.y)));
      if (onResize) onResize(next);
      else setH(next);
    }
    function up() {
      drag.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onResize]);

  if (!live && !text.trim()) return null;
  const view = live && text.length > 16_000 ? text.slice(-16_000) : text;
  return (
    <div className={cn("min-w-0 max-w-full overflow-hidden rounded-lg bg-bg", fill && shown ? "flex h-full min-h-0 flex-col" : fill ? "shrink-0" : "mb-2")}>
      <div className="flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] text-muted">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-fg"
          onClick={() => {
            setPinned(true);
            setOpenBoth(!shown);
          }}
        >
          <ChevronRight className={cn("size-3 shrink-0 transition-transform duration-300", shown ? "rotate-90" : "")} />
          <span className={cn("shrink-0", live ? "think-live text-fg" : "")}>{live ? "Denkt…" : "Denken"}</span>
        </button>
        {live ? <AgentPulse className="shrink-0" tip={false} /> : null}
        {text.trim() ? (
          <span className="shrink-0 font-mono text-[10px] text-subtle">{formatTokens(estimateTokens(text))}</span>
        ) : null}
      </div>
      {fill ? (
        shown ? (
          <>
            <pre
              ref={preRef}
              className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-1 font-mono text-[11px] leading-4 break-words text-muted whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {view}
              {live ? <span className="think-caret" /> : null}
            </pre>
            {hideResize ? null : (
            <div
              role="separator"
              title="Ziehen: höher oder niedriger"
              className="flex h-2 shrink-0 cursor-ns-resize items-center justify-center hover:bg-hover"
              onPointerDown={(e) => {
                e.preventDefault();
                drag.current = { y: e.clientY, h: size };
              }}
            >
              <span className="block h-0.5 w-8 rounded-full bg-border" />
            </div>
            )}
          </>
        ) : null
      ) : (
        <div className={cn("think-body", shown && "open")}>
          <div className="think-clip">
            <pre
              ref={preRef}
              className="max-w-full min-w-0 overflow-auto px-2 pb-1 font-mono text-[11px] leading-4 break-words text-muted whitespace-pre-wrap [overflow-wrap:anywhere]"
              style={{ height: h }}
            >
              {view}
              {live ? <span className="think-caret" /> : null}
            </pre>
            <div
              role="separator"
              title="Ziehen: höher oder niedriger"
              className="flex h-2 cursor-ns-resize items-center justify-center hover:bg-hover"
              onPointerDown={(e) => {
                e.preventDefault();
                drag.current = { y: e.clientY, h };
              }}
            >
              <span className="block h-0.5 w-8 rounded-full bg-border" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ChatMenu =
  | { kind: "msg"; x: number; y: number; id: string }
  | { kind: "pane"; x: number; y: number }
  | { kind: "code"; x: number; y: number; path: string; lang: string; text: string };

function trailText(m: ChatMsg): string {
  const steps = (m.steps ?? []).map((s) => `${s.status} ${s.name} ${s.detail}`.trim()).join("\n");
  const run = m.lastRun
    ? `run ${m.lastRun.ok ? "ok" : "fail"} ${m.lastRun.path}\n${m.lastRun.stdout}\n${m.lastRun.stderr}`
    : "";
  return [steps, run].filter(Boolean).join("\n\n");
}

function applyCodeBlocks(text: string): number {
  const st = useIde.getState();
  let n = 0;
  for (const p of parseBlocks(text)) {
    if (!p.code || !p.text.trim()) continue;
    const path =
      p.path ||
      uniqueDest(
        st.files,
        "",
        /\bpy/.test(p.lang) ? "snippet.py" : /\bts/.test(p.lang) ? "snippet.ts" : "snippet.js",
      );
    st.writeFile(path, p.text);
    n += 1;
  }
  st.setNotice(n ? `${n} Dateien` : t("roundNone"));
  return n;
}

function saveRef(name: string, content: string) {
  const st = useIde.getState();
  const path = uniqueDest(st.files, REF_DIR, name);
  st.writeFile(path, content.endsWith("\n") ? content : `${content}\n`);
  st.setNotice(path);
}

function transcript(): string {
  return useIde
    .getState()
    .chat.map((m) => `## ${m.role}\n\n${m.content.trim()}`)
    .join("\n\n");
}

const chatSel = { a: 0, b: 0 };

function insertDraft(text: string) {
  const st = useIde.getState();
  const cur = st.agentDraft;
  const el = document.getElementById("anvil-chat") as HTMLTextAreaElement | null;
  const a = Math.min(chatSel.a, cur.length);
  const b = Math.min(chatSel.b, cur.length);
  const next = `${cur.slice(0, a)}${text}${cur.slice(b)}`;
  st.setAgentDraft(next);
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    const n = a + text.length;
    el.setSelectionRange(n, n);
    chatSel.a = n;
    chatSel.b = n;
  });
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("lesen"));
    r.readAsDataURL(blob);
  });
}

async function readChatClipboard(): Promise<{ text: string; images: string[] }> {
  const native = nativeHelper();
  if (native?.clipboardRead) {
    const r = await native.clipboardRead();
    return { text: r.text || "", images: r.image ? [r.image] : [] };
  }
  const images: string[] = [];
  let text = "";
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) images.push(await blobDataUrl(await item.getType(type)));
          else if (type === "text/plain" && !text) text = await (await item.getType(type)).text();
        }
      }
    }
  } catch {
    /* */
  }
  if (!text) {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      /* */
    }
  }
  return { text, images: images.filter(Boolean).slice(0, 4) };
}

async function pasteIntoChat(addImages: (urls: string[]) => void) {
  const st = useIde.getState();
  try {
    const { text, images } = await readChatClipboard();
    if (images.length) addImages(images);
    if (text) insertDraft(text);
    if (!text && !images.length) st.setNotice("Ablage leer");
  } catch {
    st.setNotice("Ablage nicht lesbar");
  }
}

function chatMenu(menu: ChatMenu, extra?: { addImages: (urls: string[]) => void }): CtxItem[] {
  const st = useIde.getState();
  if (menu.kind === "pane") {
    const items: CtxItem[] = [
      { label: t("newChat"), onClick: () => st.clearChat() },
      { label: t("ask"), onClick: () => st.setAgentMode("ask") },
      { label: t("agent"), onClick: () => st.setAgentMode("agent") },
      { sep: true, label: "" },
      { label: t("chatPaste"), onClick: () => void pasteIntoChat(extra?.addImages ?? (() => {})) },
      { label: t("attachImage"), onClick: () => document.getElementById("anvil-chat-img")?.click() },
      { sep: true, label: "" },
      { label: t("chatTranscript"), onClick: () => void navigator.clipboard.writeText(transcript()) },
      { label: t("chatExport"), onClick: () => saveRef("chat.md", transcript()) },
    ];
    if (st.agentBusy) {
      items.push({
        label: t("stop"),
        danger: true,
        onClick: () => stopAgent("Gestoppt"),
      });
    }
    return items;
  }
  if (menu.kind === "code") {
    const path = menu.path;
    const guess =
      path ||
      uniqueDest(st.files, "", /\bpy/.test(menu.lang) ? "snippet.py" : /\bts/.test(menu.lang) ? "snippet.ts" : "snippet.js");
    return [
      { label: t("copy"), onClick: () => void navigator.clipboard.writeText(menu.text) },
      {
        label: path || t("chatSaveAs"),
        onClick: () => {
          st.writeFile(guess, menu.text);
          st.openFile(guess);
        },
      },
      {
        label: t("chatInsertAt"),
        disabled: !st.activePath,
        onClick: () => {
          const p = st.activePath;
          if (!p) return;
          const cur = st.files[p] ?? "";
          st.setContent(p, cur ? `${cur.replace(/\s*$/, "")}\n\n${menu.text}\n` : `${menu.text}\n`);
        },
      },
      {
        label: t("chatRunCode"),
        onClick: () => {
          const p = path && path in st.files ? path : guess;
          if (!(p in useIde.getState().files) || path !== p) useIde.getState().writeFile(p, menu.text);
          useIde.getState().setRunPath(p);
          void runFile(p, useIde.getState().files).then((r) => {
            useIde.getState().pushOutput(r);
            useIde.getState().revealOutput();
          });
        },
      },
      { sep: true, label: "" },
      {
        label: t("chatAskCode"),
        onClick: () => {
          st.setAgentMode("ask");
          st.pushAgent(`Erkläre diesen Code${path ? ` (${path})` : ""}:\n\`\`\`\n${menu.text.slice(0, 4000)}\n\`\`\``);
        },
      },
      {
        label: t("chatFixCode"),
        onClick: () => {
          st.setAgentMode("agent");
          st.pushAgent(
            `Diesen Code nachbessern, lauffähig machen${path ? `, Datei ${path}` : ""}:\n\`\`\`\n${menu.text.slice(0, 4000)}\n\`\`\``,
          );
        },
      },
    ];
  }
  const m = st.chat.find((x) => x.id === menu.id);
  if (!m) return [];
  const items: CtxItem[] = [
    { label: t("copy"), onClick: () => void navigator.clipboard.writeText(m.content) },
    { label: t("chatCopyMd"), onClick: () => void navigator.clipboard.writeText(`## ${m.role}\n\n${m.content}`) },
  ];
  if (m.thinking) {
    items.push({ label: t("chatCopyThink"), onClick: () => void navigator.clipboard.writeText(m.thinking ?? "") });
  }
  if (m.steps?.length || m.lastRun) {
    items.push({ label: t("chatCopyTrail"), onClick: () => void navigator.clipboard.writeText(trailText(m)) });
  }
  items.push({ sep: true, label: "" });
  if (m.role === "user") {
    items.push(
      { label: t("chatEdit"), onClick: () => st.setAgentDraft(m.content) },
      { label: t("chatQuote"), onClick: () => st.setAgentDraft(`> ${m.content.slice(0, 800)}\n\n${st.agentDraft}`) },
      { label: t("again"), onClick: () => st.pushAgent(m.content) },
      { label: t("chatAskThis"), onClick: () => { st.setAgentMode("ask"); st.pushAgent(m.content); } },
      { label: t("chatAgentThis"), onClick: () => { st.setAgentMode("agent"); st.pushAgent(m.content); } },
    );
  } else {
    const prev = [...st.chat].reverse().find((x) => x.role === "user" && st.chat.indexOf(x) < st.chat.indexOf(m));
    items.push(
      { label: t("again"), disabled: !prev, onClick: () => prev && st.pushAgent(prev.content) },
      { label: t("chatContinue"), onClick: () => st.pushAgent("Weiter. Setze genau hier an, ohne von vorn zu beginnen.") },
      {
        label: t("chatRevise"),
        onClick: () =>
          st.pushAgent("Die letzte Antwort nachbessern: vollständig, lauffähig, danach ausführen."),
      },
      { label: t("chatApplyCode"), onClick: () => applyCodeBlocks(m.content) },
    );
  }
  items.push(
    { sep: true, label: "" },
    { label: t("chatSaveRef"), onClick: () => saveRef(`${m.role}-${m.id.slice(0, 6)}.md`, m.content) },
  );
  if (m.checkpointId) {
    items.push({
      label: t("restoreRound"),
      onClick: () => {
        const ok = st.restoreCheckpoint(m.checkpointId!);
        st.setNotice(ok ? t("restored") : t("noSnapshot"));
      },
    });
  }
  items.push({ label: t("chatDel"), danger: true, onClick: () => st.removeChat(m.id) });
  return items;
}

export function HelperLaneBits() {
  const notes = useBrain((s) => s.lane);
  if (!notes.length) return null;
  return (
    <ul className="mb-1 space-y-0.5">
      {notes.slice(-4).map((n) => (
        <li key={`${n.t}-${n.kind}`} className="min-w-0 truncate font-mono text-[11px] text-muted" title={n.text}>
          <span className="text-ok">Helfer</span> · {n.text}
        </li>
      ))}
    </ul>
  );
}

export function Trail({
  m,
  live,
  liveTools = true,
  fill,
}: {
  m: ChatMsg;
  live: boolean;
  liveTools?: boolean;
  fill?: boolean;
}) {
  const t = useT();
  const loopTries = useIde((s) => s.loopTries);
  const run = m.lastRun;
  const attempt = run?.attempt ?? 0;
  const max = run?.max ?? loopTries;
  const raw = liveTools ? (m.steps ?? []) : (m.steps ?? []).filter((s) => s.status !== "run");
  const steps = filterTrailSteps(raw);
  const frames = (m.steps ?? []).filter((s) => s.image).slice(-8);
  const work = [...steps].reverse().find((s) => s.status === "run");
  const clip = (s: string) => s.trim().split("\n").slice(-8).join("\n").slice(0, 800);
  const hasRound = Boolean(m.changes?.length);
  const hasRun = Boolean(run?.path || run?.running || run?.stdout || run?.stderr);
  if (!steps.length && !hasRun && !frames.length && !m.lastTests && !hasRound && !m.harness && !live) {
    if (fill) return <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-bg px-2.5 py-2"><HelperLaneBits /></div>;
    return <HelperLaneBits />;
  }

  const body = (
    <>
      <HelperLaneBits />
      <div className="mb-1 flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium tracking-wide text-subtle uppercase">Spur</p>
          <p
            className={cn(
              "mt-0.5 truncate text-[11px] tabular-nums",
              run?.running || work || live ? "text-fg" : run && !run.ok ? "text-danger" : run?.ok ? "text-ok" : "text-muted",
            )}
          >
            {m.harness ? `${m.harness} · ` : ""}
            {run?.running
              ? `Run ${Math.min(attempt, max)}/${max}${run.path ? ` · ${run.path}` : ""}`
              : hasRun
                ? `Versuch ${Math.min(attempt, max)}/${max}${run?.ok ? "" : " · Fehler"}${run?.path ? ` · ${run.path}` : ""}${run?.graphical ? " · Bild" : ""}`
                : work
                  ? `${STEP_LABEL[work.name] ?? work.name}${work.detail ? ` · ${work.detail}` : ""}`
                  : live
                    ? t("working")
                    : ""}
          </p>
        </div>
        {run?.path && !live && !run.running ? (
          <button
            type="button"
            className="h-6 shrink-0 rounded-sm px-1.5 text-[10px] text-fg hover:bg-hover"
            onClick={() => {
              const p = run.path;
              if (!p) return;
              useIde.getState().pushAgent(`Führe ${p} nochmal aus. Bei Fehler patchen.`, true);
            }}
          >
            Nochmal
          </button>
        ) : null}
      </div>
      {frames.length ? (
        <div className="mb-1 flex gap-1 overflow-x-auto py-0.5">
          {frames.map((s) => (
            <button
              key={s.id}
              type="button"
              className="shrink-0"
              title={s.detail || s.name}
              onClick={() => {
                if (s.path) useIde.getState().openFile(s.path);
              }}
            >
              <img src={s.image} alt="" className="h-16 w-auto rounded-sm border border-border" />
            </button>
          ))}
        </div>
      ) : null}
      {steps.length ? <StepList steps={steps} /> : live ? (
        <p className="mt-1 text-[11px] text-muted think-live">
          {work
            ? `${STEP_LABEL[work.name] ?? work.name}${work.detail ? ` · ${work.detail}` : ""}`
            : "Denkt…"}
        </p>
      ) : null}
      {run && (run.stdout || run.stderr) ? (
        <pre className={cn("mt-1 max-h-32 overflow-auto font-mono text-[10px] leading-4", run.ok ? "text-muted" : "text-danger")}>
          {clip(run.stderr || run.stdout) || run.path}
        </pre>
      ) : run?.running ? (
        <p className="mt-1 text-[10px] text-muted think-live">Ausgabe kommt…</p>
      ) : null}
      {m.lastTests ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
          {m.lastTests.running ? (
            <span className="think-live text-fg">{t("running")}</span>
          ) : (
            <button
              type="button"
              className={m.lastTests.fail ? "text-danger hover:underline" : "text-ok hover:underline"}
              onClick={() => useIde.getState().setSidebar("tests")}
            >
              {t("tests")} {m.lastTests.pass}/{m.lastTests.pass + m.lastTests.fail}
              {m.lastTests.fail ? ` · ${m.lastTests.fail} ${t("fail")}` : ""}
            </button>
          )}
          {!live && (m.lastTests.fail ?? 0) > 0 ? (
            <button
              type="button"
              className="text-fg hover:underline"
              onClick={() => useIde.getState().pushAgent(testsPrompt(Object.values(useIde.getState().testResults)))}
            >
              {t("fixFails")}
            </button>
          ) : null}
        </div>
      ) : null}
      {hasRound ? <RoundFiles m={m} live={live} /> : null}
    </>
  );

  if (!fill) {
    return <div className="mb-2 overflow-hidden rounded-lg bg-bg px-2.5 py-2">{body}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-bg">
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-2">{body}</div>
    </div>
  );
}

function RoundFiles({ m, live }: { m: ChatMsg; live: boolean }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const ck = useIde((s) => s.checkpoints.find((c) => c.id === m.checkpointId) ?? null);
  const now = useIde((s) => s.files);
  const changes = m.changes ?? [];
  const plus = changes.reduce((n, c) => n + (c.add || 0), 0);
  const minus = changes.reduce((n, c) => n + (c.del || 0), 0);
  const hasSnap = Boolean(ck && Object.keys(ck.files).length);

  function restore() {
    if (!m.checkpointId) return;
    const ok = useIde.getState().restoreCheckpoint(m.checkpointId);
    useIde.getState().setNotice(ok ? t("restored") : t("noSnapshot"));
    setAsk(false);
  }

  return (
    <div className="mt-1.5 border-t border-border pt-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
        <span className="text-fg">{t("roundDiff")}</span>
        {changes.length ? (
          <span>
            {t("roundFiles", { n: changes.length })}
            {plus || minus ? ` · +${plus} −${minus}` : ""}
          </span>
        ) : live ? null : (
          <span>{t("roundNone")}</span>
        )}
        {!live && hasSnap ? (
          ask ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-fg">{t("restoreAsk")}</span>
              <button type="button" className="text-danger hover:underline" onClick={restore}>
                {t("restoreRound")}
              </button>
              <button type="button" className="hover:underline" onClick={() => setAsk(false)}>
                {t("roundKeep")}
              </button>
            </span>
          ) : (
            <button type="button" className="ml-auto text-fg hover:underline" onClick={() => setAsk(true)}>
              {t("restoreRound")}
            </button>
          )
        ) : null}
      </div>
      {changes.slice(0, 16).map((c) => {
        const shown = open === c.path;
        const before = ck?.files[c.path] ?? "";
        const after = c.kind === "del" ? "" : (now[c.path] ?? "");
        return (
          <div key={c.path} className="mt-0.5">
            <button
              type="button"
              className="flex w-full items-baseline gap-2 text-left font-mono text-[11px] text-fg hover:underline"
              onClick={() => setOpen(shown ? null : c.path)}
            >
              <span className={c.kind === "add" ? "text-ok" : c.kind === "del" ? "text-danger" : "text-muted"}>
                {c.kind === "add" ? "+" : c.kind === "del" ? "−" : "~"}
              </span>
              <span className="min-w-0 truncate">{c.path}</span>
              {c.add || c.del ? (
                <span className="ml-auto shrink-0 text-[10px] text-subtle">
                  {c.add ? `+${c.add}` : ""}
                  {c.add && c.del ? " " : ""}
                  {c.del ? `−${c.del}` : ""}
                </span>
              ) : null}
            </button>
            {shown ? (
              <div className="mt-0.5 pl-4">
                {c.kind === "del" ? (
                  <p className="text-[10px] text-danger">gelöscht</p>
                ) : (
                  <MiniDiff before={before} after={after} />
                )}
                <button
                  type="button"
                  className="mt-0.5 text-[10px] text-muted hover:text-fg"
                  onClick={() => useIde.getState().openRoundDiff(c.path, m.checkpointId)}
                >
                  {t("inEditor")}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MiniDiff({ before, after }: { before: string; after: string }) {
  const rows = lineDiff(before, after)
    .filter((r) => r.type !== "eq")
    .slice(0, 32);
  if (!rows.length) return <p className="text-[10px] text-subtle">—</p>;
  return (
    <pre className="max-h-40 overflow-auto font-mono text-[10px] leading-4">
      {rows.map((r, i) => (
        <div key={i} className={r.type === "add" ? "text-ok" : "text-danger"}>
          {r.type === "add" ? "+" : "−"} {r.text || " "}
        </div>
      ))}
    </pre>
  );
}

export function AgentTodo() {
  const plan = useIde((s) => {
    for (let i = s.chat.length - 1; i >= 0; i--) {
      const m = s.chat[i];
      if (m.role === "assistant" && m.plan?.length) return m.plan;
    }
    return undefined;
  });
  const busy = useIde((s) => s.agentBusy);
  const [open, setOpen] = useState(true);
  const seen = useRef("");

  useEffect(() => {
    const key = plan?.map((s) => s.text).join("|") ?? "";
    if (key && key !== seen.current) {
      seen.current = key;
      setOpen(true);
    }
  }, [plan]);

  if (!plan?.length) return null;
  const done = plan.filter((s) => s.status === "ok").length;
  const run = plan.find((s) => s.status === "run");

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs text-muted hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="font-medium text-fg">To-do</span>
        <span className="tabular-nums">
          {done}/{plan.length}
        </span>
        {!open && run ? <span className="min-w-0 truncate think-live text-fg">{run.text}</span> : null}
        {!open && !run && busy ? <span className="think-live">…</span> : null}
      </button>
      {open ? (
        <div className="max-h-40 overflow-auto px-3 pb-2">
          <PlanList steps={plan} />
        </div>
      ) : null}
    </div>
  );
}

function PlanList({ steps }: { steps: { text: string; status: "todo" | "run" | "ok" | "err" }[] }) {
  return (
    <ol className="space-y-0.5">
      {steps.map((s, i) => (
        <li key={i} className="flex items-baseline gap-2 text-[11px] leading-4">
          <span className={s.status === "ok" ? "text-ok" : s.status === "err" ? "text-danger" : s.status === "run" ? "think-live text-fg" : "text-muted"}>
            {s.status === "ok" ? "☑" : s.status === "err" ? "✕" : s.status === "run" ? "…" : "☐"}
          </span>
          <span className={s.status === "ok" ? "text-muted line-through" : "text-fg"}>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

const STEP_LABEL: Record<string, string> = {
  write_file: "Schreiben",
  edit_file: "Ändern",
  delete_file: "Löschen",
  rename: "Umbenennen",
  mkdir: "Ordner",
  run_file: "Run",
  engine_run: "Engine",
  engine_detect: "Engine",
  engine_status: "Engine",
  mcp_call: "MCP",
  git_commit: "Commit",
  git_push: "Push",
  shell: "Shell",
  format_file: "Format",
  grep: "Suche",
  read_file: "Lesen",
  list_files: "Dateien",
  skill_run: "Skill",
  skill_write: "Skill",
  skill_debug: "Skill-Debug",
  skill_patch: "Skill",
  append_file: "Anhängen",
  harness_write: "Harness",
  harness_read: "Harness",
  graph_write: "Graph",
  see_run: "Bild",
};

const STEP_HIDE = /^(set_plan|memory_|debug_state|skill_list|mcp_list)$/;
const STEP_FOLD = /^(grep|read_file|list_files)$/;

function filterTrailSteps(steps: AgentStep[]): AgentStep[] {
  const raw = steps.filter((s) => s.status === "run" || !STEP_HIDE.test(s.name)).slice(-24);
  const out: AgentStep[] = [];
  let pack: AgentStep[] = [];
  const flush = () => {
    if (!pack.length) return;
    const last = pack[pack.length - 1];
    const q = shortTrail(pack[0].detail);
    out.push({
      ...last,
      detail: pack.length === 1 ? q : `${pack.length}× ${q}`,
    });
    pack = [];
  };
  for (const s of raw) {
    if (STEP_FOLD.test(s.name) && s.status !== "run") {
      if (pack.length && pack[0].name !== s.name) flush();
      pack.push(s);
    } else {
      flush();
      out.push({ ...s, detail: shortTrail(s.detail) });
    }
  }
  flush();
  return out;
}

function shortTrail(d?: string) {
  const t = (d ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= 42) return t;
  return `${t.slice(0, 40)}…`;
}

function StepList({ steps }: { steps: AgentStep[] }) {
  const live = steps.some((s) => s.status === "run");
  const now = useElapsed(live ? steps.find((s) => s.status === "run")?.at : undefined, live);
  return (
    <ol className="mt-1 space-y-1">
      {steps.map((s) => {
        const ms = s.status === "run" && s.at ? now : s.ms;
        return (
        <li key={s.id} className="flex min-w-0 items-start gap-2 font-mono text-[11px] leading-4">
          <span className={cn("mt-0.5 shrink-0", s.status === "err" ? "text-danger" : s.status === "run" ? "think-live text-fg" : "text-ok")}>
            {s.status === "err" ? "✕" : s.status === "run" ? "…" : "✓"}
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-fg">{STEP_LABEL[s.name] ?? s.name}</span>
              {s.detail ? (
                <span className="min-w-0 truncate text-muted" title={s.detail}>
                  {s.detail}
                </span>
              ) : null}
              {ms ? (
                <span className={cn("ml-auto shrink-0 tabular-nums text-subtle", s.status === "run" && "think-live")}>
                  {formatElapsed(ms)}
                </span>
              ) : null}
            </p>
            {s.code ? <WriteBlock path={s.path} code={s.code} before={s.before} live={s.status === "run"} /> : null}
            {s.image ? (
              <img src={s.image} alt="" className="mt-1 max-h-28 rounded-md border border-border" />
            ) : null}
          </div>
        </li>
        );
      })}
    </ol>
  );
}

export function LiveTools({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;
  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border bg-hover px-2 py-1.5">
      <p className="mb-0.5 flex items-center gap-2 text-[10px] font-medium tracking-wide text-muted uppercase">
        <span className="think-live text-fg">Läuft</span>
      </p>
      <StepList steps={steps} />
    </div>
  );
}

function WriteBlock({ path, code, before, live }: { path?: string; code: string; before?: string; live?: boolean }) {
  const [open, setOpen] = useState(Boolean(live));
  const wasLive = useRef(Boolean(live));
  useEffect(() => {
    if (live) setOpen(true);
    if (wasLive.current && !live) {
      const t = window.setTimeout(() => setOpen(false), 600);
      wasLive.current = false;
      return () => window.clearTimeout(t);
    }
    wasLive.current = Boolean(live);
  }, [live]);
  const lines = code.split("\n").length;
  return (
    <div className="mt-1 overflow-hidden rounded-md border border-border bg-bg">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-2 px-2 text-left text-[11px] text-muted hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <span className={cn("font-mono", live ? "think-live text-fg" : "text-fg")}>
          {live ? "schreibt" : before ? "Patch" : "Datei"}
        </span>
        <span className="min-w-0 truncate font-mono">{path || "code"}</span>
        <span className="ml-auto tabular-nums text-subtle">{lines} Z.</span>
      </button>
      {open ? (
        <div className="border-t border-border">
          {before ? (
            <MiniDiff before={before} after={code} />
          ) : (
            <div className="max-h-56 overflow-auto">
              <CodeBlock code={code} lang="" path={path} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title?: string;
  tone?: "ok" | "warn" | "live";
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-sm bg-bg px-1.5 text-[10px] leading-none whitespace-nowrap tabular-nums text-subtle",
        tone === "live" && "border-fg/35 text-muted",
        tone === "warn" && "border-danger/40 text-danger",
        tone === "ok" && "border-ok/40 text-ok",
      )}
    >
      {children}
    </span>
  );
}

function ContextBar() {
  const t = useT();
  const chat = useIde((s) => s.chat);
  const fileN = useIde((s) => Object.keys(s.files).length);
  const llmContext = useIde((s) => s.llmContext);
  const sessionTokens = useIde((s) => s.sessionTokens);
  const llmThinking = useIde((s) => s.llmThinking);
  const llmCompact = useIde((s) => s.llmCompact);
  const agentBusy = useIde((s) => s.agentBusy);
  const runLoop = useIde((s) => s.runLoop);
  const graphLoop = useIde((s) => s.graphLoop);
  const llmRetries = useIde((s) => s.llmRetries);
  const agentQueue = useIde((s) => s.agentQueue.length);
  const ctxUsed = useMemo(() => {
    let n = 0;
    for (const m of chat) n += estimateTokens(m.content) + estimateTokens(m.thinking ?? "");
    n += fileN * 4;
    return n;
  }, [chat, fileN]);
  const pct = Math.min(100, Math.round((ctxUsed / Math.max(1, llmContext)) * 100));
  const session = sessionTokens.prompt + sessionTokens.completion;
  const think = llmThinking === "auto" ? "auto" : llmThinking === "medium" ? "mid" : llmThinking;
  const items: { id: string; title?: string; tone?: "ok" | "warn" | "live"; node: ReactNode }[] = [
    {
      id: "ctx",
      title: t("context"),
      tone: pct > 85 ? "warn" : undefined,
      node: (
        <>
          <span>{t("context")}</span>
          <span>
            {formatTokens(ctxUsed)}/{formatContext(llmContext)}
          </span>
          <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-border">
            <span
              className={cn("block h-full", pct > 85 ? "bg-danger" : pct > 60 ? "bg-fg/50" : "bg-ok")}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span>{pct}%</span>
        </>
      ),
    },
  ];
  if (session > 0) {
    items.push({
      id: "session",
      title: t("session"),
      node: (
        <>
          {t("session")} {formatTokens(session)}
          {sessionTokens.completion ? ` · ${formatTokens(sessionTokens.completion)}` : ""}
        </>
      ),
    });
  }
  if (llmThinking !== "off" && llmThinking !== "auto") {
    items.push({ id: "think", title: t("think"), node: <>{t("think")} {think}</> });
  }
  if (llmCompact === "aggressive") {
    items.push({ id: "compact", title: t("compact"), node: <>{t("compact")} max</> });
  }
  if (runLoop) items.push({ id: "run", title: t("runLoop"), node: "Run" });
  if (graphLoop) items.push({ id: "graph", title: t("graph"), node: "Graph" });
  if (llmRetries > 1) items.push({ id: "retry", title: t("retries", { n: llmRetries }), node: `×${llmRetries}` });
  if (agentQueue) items.push({ id: "queue", title: t("queued", { n: agentQueue }), node: t("queued", { n: agentQueue }) });

  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
      {items.map((c) => (
        <Chip key={c.id} title={c.title} tone={c.tone}>
          {c.node}
        </Chip>
      ))}
    </div>
  );
}
