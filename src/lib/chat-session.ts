import { isExecutablePath } from "./run-target";
import { chatWithProvider } from "@/lib/agent-client";
import { completeText } from "@/lib/complete";
import { toolCode, toolDetail } from "@/lib/llm-options";
import { runFile } from "@/lib/run-client";
import { estimateTokens } from "@/lib/tokens";
import { emitPlugin } from "@/lib/plugins/events";
import { anvilHandle } from "@/lib/anvil";
import {
  packRefContext,
  isSecretPath,
  isRefPath,
  isRefImage,
  imageStub,
  modelSeesImages,
  REF_DIR,
} from "@/lib/ref";
import { snapshotDiff } from "@/lib/diff";

import { shouldTestAfterRound, testAfterRound } from "@/lib/test-loop";
import { workspaceRules } from "@/lib/rules";
import {
  applySetPlan,
  guessPlan,
  normalizePlanWho,
  planAgentMayReplace,
  planFinish,
  planFromAsk,
  planFromTool,
  planHelperNow,
  planSeedNow,
  planStart,
} from "@/lib/plan";

import { resetLoopFails } from "@/lib/run-loop";
import { agentGen, beginAgent, explainAbort, explainLlmError, isAbortLike } from "@/lib/abort";
import { idleCompanion } from "@/lib/companion-life";
import { askCorrection, formatAskAnswer, isAskAnswer, newJob } from "@/lib/agent-ask";
import { appLog, logHost } from "@/lib/app-log";
import {
  brainAsk,
  brainChatTitle,
  brainDistill,
  brainFollowups,
  brainPlanText,
  brainReady,
  brainReview,
  brainSecretWarn,
  brainStopNote,
  lanePrompt,
  routeKind,
  scrubSecrets,
  useBrain,
} from "@/lib/brain";

import { learnPrompt, markSkills, reflectUtterance, skillOutcome, useLearn } from "@/lib/learn";
import {
  beginJournal,
  extractJournal,
  mergeJournal,
  packChatHistory,
  pruneSession,
} from "@/lib/session";
import type { WorkspaceEvent } from "@/lib/agent-core";

import { useIde } from "@/store/ide";

import { t } from "@/lib/i18n";

import { isFixPrompt } from "@/lib/agent-parse";

import { resetLiveWrite } from "@/lib/live-write";

import { attachmentHints } from "@/lib/attachment-hints";
import { selectFileKeys } from "@/lib/workspace-index";
import { requestPhase } from "@/lib/request-state";

export async function applyWorkspace(ev: WorkspaceEvent) {
  const s = useIde.getState();
  if (ev.op === "write") {
    if (s.autoAcceptDiffs) s.writeFile(ev.path, ev.content, { quiet: true });
    else s.patchFiles({ [ev.path]: ev.content }, { quiet: true });
  } else if (ev.op === "delete") s.deleteFile(ev.path);
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
}

type SendInput = {
  preset?: string;
  draft: string;
  images: string[];
  title: string;
  setTitle: (value: string) => void;
  setDraft: (value: string) => void;
  setImages: (value: string[]) => void;
  setMention: (value: string | null) => void;
};
export async function sendChat(
  { preset, draft, images, title, setTitle, setDraft, setImages, setMention }: SendInput,
  opts?: { queued?: boolean; choiceId?: string },
) {
  const {
    addChat,
    startAssistant,
    appendAssistant,
    appendThinking,
    addAgentStep,
    addSessionTokens,
    finalizeAssistant,
    setAgentBusy,
    patchFiles,
    writeFile,
    pushOutput,
    setRunning,
    togglePanel,
    setAgentMode,
  } = useIde.getState();
  const pending = useIde.getState().pendingAsk;
  const jobNow = useIde.getState().agentJob;
  const asking = jobNow?.status === "ask" && Boolean(jobNow.ask);
  const typed = (preset ?? draft).trim();
  let text = typed;
  if (asking && jobNow?.ask) {
    if (!text && !opts?.choiceId) return;
    text = isAskAnswer(typed) ? typed : formatAskAnswer(jobNow.ask, opts?.choiceId, typed);
  } else {
    if (pending && !text) text = "Erkläre die Auswahl.";
    if (!text) return;
  }
  let holdUi = false;
  let parked = false;
  if (!asking && useIde.getState().agentBusy && !opts?.queued) {
    useIde.getState().pushAgent(text);
    setDraft("");
    setImages([]);
    return;
  }
  const scrub = scrubSecrets(text);
  let work = scrub.text;
  if (pending && !asking) {
    work = `Auswahl in ${pending.path}:\n\`\`\`\n${pending.text.slice(0, 4000)}\n\`\`\`\n\n${work}`;
    useIde.getState().setPendingAsk(null);
  }
  const forceAsk = Boolean(pending) && (!typed || useIde.getState().agentMode === "ask");
  if (scrub.n) useIde.getState().setNotice(t("secretsN", { n: scrub.n }));
  else
    void brainSecretWarn(text).then((w) => {
      if (w) useIde.getState().setNotice(w);
    });
  const my = beginAgent();
  setAgentBusy(true);
  await import("@/lib/model-context").then((m) => m.applyCloudContext()).catch(() => null);
  if (my !== agentGen()) return;
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
  if (!title)
    void brainChatTitle(work)
      .then((value) => {
        if (my === agentGen()) setTitle(value);
      })
      .catch(() => undefined);
  emitPlugin("agent", work);
  reflectUtterance(work, "ask");
  try {
    const routed = await anvilHandle(work);
    if (my !== agentGen()) return;
    if (routed.hand === "app" && routed.reply) {
      finalizeAssistant(routed.reply);
      return;
    }
    const ck = asking
      ? [...useIde.getState().chat].reverse().find((m) => m.checkpointId)?.checkpointId ||
        useIde.getState().pushCheckpoint(work.slice(0, 60))
      : useIde.getState().pushCheckpoint(work.slice(0, 60));
    resetLoopFails();
    let s = useIde.getState();
    let extraFiles = [
      ...new Set([...(s.attached ?? []), s.activePath].filter(Boolean)),
    ] as string[];
    if (useBrain.getState().jobs.attach) {
      extraFiles = [...new Set([...extraFiles, ...attachmentHints(work, selectFileKeys(s))])];
    }
    if (my !== agentGen()) return;
    s = useIde.getState();
    const prefer = [
      ...new Set(
        [...(s.attached ?? []), s.activePath, ...s.openPaths, ...s.recentPaths.slice(0, 8)].filter(
          Boolean,
        ),
      ),
    ] as string[];
    const rules = workspaceRules(s.files, s.agentRules);
    const { internPrompt } = await import("@/lib/intern");
    const { hydrateLearnFromFiles } = await import("@/lib/learn");
    hydrateLearnFromFiles(s.files);
    const memory = [learnPrompt(work), internPrompt()].filter(Boolean).join("\n\n");
    const helperNotes = lanePrompt();
    const vision = modelSeesImages(s.llmProvider, s.llmModel);
    const refs = packRefContext(
      s.files,
      work,
      extraFiles.filter(isRefPath).concat(s.openPaths.filter(isRefPath)),
      { vision },
    );
    const pinBlock = (await import("@/lib/fix-agent")).pinContext(work);
    const context = extraFiles
      .filter(
        (p) =>
          p !== REF_DIR &&
          s.files[p] &&
          !isSecretPath(p) &&
          !isRefPath(p) &&
          !isRefImage(s.files[p] ?? ""),
      )
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
        helperNotes,
        refs.text,
        pinBlock,
        context ? `Angehängte Dateien:\n${context}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    ).text;
    const user = asking
      ? prefix
        ? `${prefix}\n\n${work}`
        : work
      : prefix
        ? `${prefix}\n\nAuftrag:\n${work}`
        : work;
    const history = packChatHistory(
      s.chat.map((m) => ({ role: m.role, content: m.content, images: m.images })),
      { content: user, images: vision ? [...pics, ...refs.images].slice(0, 4) : pics.slice(0, 4) },
    );
    if (isFixPrompt(work) && s.agentMode !== "agent") useIde.getState().setAgentMode("agent");
    const fileList = Object.entries(s.files)
      .filter(([path]) => !isSecretPath(path))
      .map(([path, content]) => ({
        path,
        content: isRefImage(content) ? imageStub(path, content) : content,
      }));
    const promptTok = estimateTokens(user) + estimateTokens(JSON.stringify(Object.keys(s.files)));

    if (!asking && !isFixPrompt(work) && (s.agentMode === "ask" || forceAsk)) {
      const helperAsk =
        s.agentMode === "ask" &&
        !forceAsk &&
        brainReady() &&
        useBrain.getState().jobs.ask &&
        routeKind(work) === "ask-local";
      let reply: string;
      if (helperAsk) {
        requestPhase(my, "waiting");
        try {
          reply = await brainAsk([memory, user].filter(Boolean).join("\n\n"), (chunk) => {
            if (my !== agentGen()) return;
            requestPhase(my, "answering");
            appendAssistant(chunk);
          });
        } catch {
          if (my !== agentGen()) return;
          requestPhase(my, "waiting");
          reply = await completeText({
            prompt: `You are Anvil in Ask mode. Do not change files. Explain briefly in the user's language.\n\n${memory ? `${memory}\n\n` : ""}${user}`,
            provider: s.llmProvider,
            baseUrl: s.llmBaseUrl,
            model: s.llmModel,
            apiKey: s.llmApiKey,
            images: vision ? [...pics, ...refs.images].slice(0, 4) : undefined,
          });
        }
      } else {
        useIde.getState().setAgentJob(newJob(work));
        if (my !== agentGen()) return;
        const asked = await chatWithProvider({
          provider: s.llmProvider,
          baseUrl: s.llmBaseUrl,
          model: s.llmModel,
          apiKey: s.llmApiKey,
          messages: history,
          files: fileList,
          dirs: s.dirs,
          context: s.llmContext,
          thinking: s.llmThinking,
          compact: s.llmCompact,
          journal: s.sessionJournal,
          memory,
          prefer,
          locale: s.locale,
          observeOnly: true,
          maxRounds: 8,
          loopTries: 1,
          runLoop: false,
          graphLoop: false,
          onDelta: (chunk, kind) => {
            if (my !== agentGen()) return;
            if (kind === "think") appendThinking(chunk);
            else appendAssistant(chunk);
          },
          onToolStart: ({ name, args }) => {
            if (my !== agentGen()) return;
            addAgentStep({
              name,
              detail: toolDetail(name, args),
              status: "run",
              ...toolCode(name, args),
            });
          },
          onTool: ({ name, args, result: out }) => {
            if (my !== agentGen()) return;
            const err = out && typeof out === "object" && "error" in out;
            addAgentStep({
              name,
              detail: toolDetail(name, args, out),
              status: err ? "err" : "ok",
              ...toolCode(name, args),
            });
          },
        });
        if (!asked.ok) requestPhase(my, "error");
        reply = asked.reply;
        if (asked.parked && asked.ask) {
          parked = true;
          const cur = useIde.getState().agentJob;
          if (cur) useIde.getState().setAgentJob({ ...cur, status: "ask", ask: asked.ask });
        }
      }
      if (my !== agentGen()) return;
      finalizeAssistant(reply);
      addSessionTokens(promptTok, estimateTokens(reply));
      void brainDistill(work, reply);
      {
        const st = useIde.getState();
        st.setSessionJournal(
          mergeJournal(st.sessionJournal, extractJournal(st.chat, st.sessionJournal)),
        );
      }
      void pruneSession();
      return;
    }

    useIde.setState((st) => {
      const chat = [...st.chat];
      const last = chat[chat.length - 1];
      const who = normalizePlanWho(st.planWho);
      if (last?.role === "assistant") {
        const locked = who === "anvil" || (who === "auto" && planFromAsk(work));
        chat[chat.length - 1] = {
          ...last,
          checkpointId: ck,
          plan: planSeedNow(who) ? guessPlan(work, st.locale) : last.plan,
          planLocked: locked,
        };
      }
      return { chat };
    });
    void brainPlanText(work).then((steps) => {
      if (my !== agentGen()) return;
      const st = useIde.getState();
      const last = st.chat.at(-1);
      const who = normalizePlanWho(st.planWho);
      if (!last?.role || !planHelperNow(who, Boolean(last.plan?.length), Boolean(last.planLocked)))
        return;
      if (who !== "helper" && last.plan?.length) return;
      if (steps.length >= 3)
        useIde.getState().setChatPlan(steps.map((text) => ({ text, status: "todo" as const })));
    });
    if (asking && jobNow) {
      useIde
        .getState()
        .setAgentJob({ ...jobNow, status: "run", ask: null, rounds: jobNow.rounds + 1 });
      if (jobNow.ask) {
        const stj = useIde.getState();
        stj.setSessionJournal(
          mergeJournal(stj.sessionJournal, {
            corrections: [askCorrection(jobNow.ask, opts?.choiceId, typed)],
          }),
        );
      }
    } else {
      useIde.getState().setAgentJob(newJob(work));
      const stj = useIde.getState();
      stj.setSessionJournal(beginJournal(work, stj.sessionJournal));
    }
    if (my !== agentGen()) return;
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
      memory,
      prefer,
      locale: s.locale,
      runLoop: s.runLoop,
      graphLoop: s.graphLoop,
      testLoop: s.testLoop,
      engineLoop: s.engineLoop,
      loopTries: s.loopTries,
      afterWrite: s.harnessAfterWrite,
      maxRounds: s.harnessMaxRounds,
      graphSees: s.graphSees,
      onHarness: (bar) => {
        if (my !== agentGen()) return;
        useIde.getState().setChatHarness(bar);
      },
      onDelta: (chunk, kind) => {
        if (my !== agentGen()) return;
        if (kind === "think") appendThinking(chunk);
        else appendAssistant(chunk);
      },
      onWorkspace: (event) => {
        if (my === agentGen()) return applyWorkspace(event);
      },
      onToolStart: ({ name, args }) => {
        if (my !== agentGen()) return;
        const started = planStart(name, useIde.getState().chat.at(-1)?.plan);
        if (started) useIde.getState().setChatPlan(started);
        addAgentStep({
          name,
          detail: toolDetail(name, args),
          status: "run",
          ...toolCode(name, args),
        });
        void import("@/lib/run-window").then((m) => m.agentToolUi(name, String(args.path ?? "")));
        if (
          name === "run_file" ||
          name === "engine_run" ||
          name === "shell" ||
          name === "mcp_call"
        ) {
          const max = useIde.getState().loopTries;
          const prev = useIde.getState().chat.at(-1)?.lastRun;
          const n = (prev?.attempt ?? 0) + (prev?.running ? 0 : 1);
          useIde.getState().setChatLastRun({
            ok: false,
            path: String(
              args.path ??
                args.cmd ??
                args.action ??
                args.command ??
                `${args.server ?? ""}.${args.name ?? ""}`,
            ),
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
          Boolean(
            out && typeof out === "object" && "ok" in out && (out as { ok?: boolean }).ok === false,
          );
        if (name === "skill_run") markSkills([String(args.name ?? "")]);
        if (name === "set_plan" && out && typeof out === "object" && "steps" in out) {
          const st = useIde.getState();
          const last = st.chat.at(-1);
          const who = normalizePlanWho(st.planWho);
          const steps = (out as { steps?: string[] }).steps ?? [];
          const next = applySetPlan(
            last?.plan,
            steps,
            !planAgentMayReplace(who, Boolean(last?.planLocked)),
          );
          if (next) useIde.getState().setChatPlan(next);
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
        if (
          (name === "run_file" ||
            name === "engine_run" ||
            name === "shell" ||
            name === "mcp_call") &&
          out &&
          typeof out === "object"
        ) {
          const o = out as {
            ok?: boolean;
            isError?: boolean;
            stdout?: string;
            stderr?: string;
            tries_left?: number;
            stage?: { kind?: string; id?: string };
            graphical?: boolean;
            cmd?: string;
            error?: string;
            text?: string;
          };
          const max = useIde.getState().loopTries;
          const left = typeof o.tries_left === "number" ? o.tries_left : max;
          useIde.getState().setChatLastRun({
            id: o.stage?.id,
            ok: !err && o.ok !== false && !o.isError,
            path: String(
              args.path ??
                args.cmd ??
                args.action ??
                args.command ??
                `${args.server ?? ""}.${args.name ?? ""}`,
            ),
            stdout: String(o.stdout ?? o.text ?? ""),
            stderr: String(o.stderr ?? o.error ?? ""),
            attempt: Math.max(1, max - left + (o.ok ? 0 : 1)),
            max,
            graphical: Boolean(o.graphical),
            running: o.stage?.kind === "window",
          });
        }
      },
    });
    if (my !== agentGen()) return;
    if (!result.ok) requestPhase(my, "error");
    if (result.parked && result.ask) {
      parked = true;
      const cur = useIde.getState().agentJob;
      if (cur) useIde.getState().setAgentJob({ ...cur, status: "ask", ask: result.ask });
    }
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
      if (!parked && shouldTestAfterRound(changes, st.files, st.chat.at(-1)?.steps)) {
        await testAfterRound();
      }
    }
    addSessionTokens(
      result.usage?.prompt || promptTok,
      result.usage?.completion || estimateTokens(result.reply),
    );
    void brainDistill(work, result.reply);
    {
      const st = useIde.getState();
      const fromChat = extractJournal(st.chat, st.sessionJournal);
      const fromFiles = result.files?.length
        ? {
            ...fromChat,
            files: [...new Set([...fromChat.files, ...result.files.map((f) => f.path)])],
          }
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
        if (st.autoAcceptDiffs || isFixPrompt(work)) {
          for (const [p, c] of Object.entries(map)) st.writeFile(p, c, { quiet: true });
        } else patchFiles(map);
      }
      void brainReview(result.files.map((f) => f.path)).then((t) => {
        if (t && my === agentGen()) addAgentStep({ name: "review", detail: t, status: "ok" });
      });
    }
    if (!parked) void brainFollowups(work, result.reply);
    if (!parked && result.runPaths?.length) {
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
              for (const p of result.runPaths!.filter(isExecutablePath)) {
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
    requestPhase(my, isAbortLike(err) ? "stopped" : "error");
    finalizeAssistant(isAbortLike(err) ? explainAbort(err) : explainLlmError(err));
    if (isAbortLike(err)) {
      const last = useIde.getState().chat.at(-1);
      void brainStopNote(last?.steps ?? []).then((note) => {
        if (my !== agentGen()) return;
        const cur = useIde.getState().chat.at(-1);
        if (!cur || cur.role !== "assistant") return;
        const body = (cur.content || "").trim();
        if (note && !body.includes(note.slice(0, 24)))
          finalizeAssistant(body ? `${body}\n${note}` : note);
      });
    }
  } finally {
    const live = my === agentGen();
    const busy = useIde.getState().agentBusy;
    if (live) {
      if (!parked) {
        useIde.getState().setAgentJob(null);
        const last = useIde.getState().chat.at(-1);
        const failed = /^(HTTP \d{3}|Gestoppt|Abgebrochen|Unterbrochen)/i.test(
          (last?.content || "").trim(),
        );
        const proved = Boolean(
          last?.tools?.some((n) => /^(run_file|see_run|play|engine_run|shell)$/.test(n)),
        );
        const fin = planFinish(last?.plan, failed, proved && !failed);
        if (fin) useIde.getState().setChatPlan(fin);
      }
      void idleCompanion().catch(() => undefined);
      requestPhase(my, "done");
      setAgentBusy(false);
      appLog("agent", parked ? "frage" : "ende");
      if (!parked) useIde.getState().setRunning(false);
      if (!parked && !holdUi) void import("@/lib/run-window").then((m) => m.releaseAgentUi());
      else if (!parked) {
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
