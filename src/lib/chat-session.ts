import type { TokenUsage, RequestTokens } from "./token-usage";
import { isExecutablePath } from "./run-target";
import { automaticRunVerification, verifiedReply, toolResultFailed, toolResultPending } from "./agent-evidence";
import { finishedHarness } from "./chat-finalize";
import { connectionCapabilities, imageAttachmentError, historyForConnection } from "./connection-capabilities";
import { chatWithProvider } from "@/lib/agent-client";
import { persistAgentWorkflow } from "@/lib/workflow-storage";
import { captureAgentRun, type AgentRun } from "./agent-run";
import { packAgentHistory } from "./agent-context";
import { toolCode, toolDetail } from "@/lib/llm-options";
import { runFile } from "@/lib/run-client";
import { emitPlugin } from "@/lib/plugins/events";
import { anvilHandle } from "@/lib/anvil";
import {
  packRefContext,
  isSecretPath,
  isRefPath,
  isRefImage,
  modelSeesImages,
  REF_DIR,
} from "@/lib/ref";
import { snapshotDiff } from "@/lib/diff";

import { shouldTestAfterRound, testAfterRound } from "@/lib/test-loop";
import { workspaceRules } from "@/lib/rules";
import {
  applySetPlan,
  initialAgentPlan,
  requestPlanContext,
  normalizePlanWho,
  planAgentMayReplace,
  planFinish,
  planFromAsk,
  planFromTool,
  planHelperNow,
  planStart,
} from "@/lib/plan";

import { resetLoopFails } from "@/lib/run-loop";
import { beginAgent, explainAbort, explainLlmError, isAbortLike } from "@/lib/abort";
import { idleCompanion } from "@/lib/companion-life";
import { askCorrection, askAnswerHumanText, formatAskAnswer, isAskAnswer, newJob, newJobHumanContext, resumeJobHumanContext, extendJobHumanContext, type AgentJob, type JobHumanContext } from "@/lib/agent-ask";
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

import { learnPrompt, markSkills, reflectUtterance, useLearn, visibleSkills } from "@/lib/learn";
import { withLoadedSkill } from "../../electron/skill-access.mjs";
import { taskHandoff } from "@/lib/task-handoff";
import {
  beginJournal,
  extractJournal,
  mergeJournal,

  pruneSession,
} from "@/lib/session";
import type { WorkspaceEvent } from "@/lib/agent-core";

import { useIde } from "@/store/ide";

import { t } from "@/lib/i18n";

import { isFixPrompt } from "@/lib/agent-parse";

import { resetLiveWrite } from "@/lib/live-write";

import { attachmentHints } from "@/lib/attachment-hints";
import { selectFileKeys } from "@/lib/workspace-index";
import { requestPhase, useRequestState } from "@/lib/request-state";
import { beginProjectCheckpoint, sealProjectCheckpoint } from "./project-checkpoints";
import { trySendBackground, steerBackground, backgroundRunning, backgroundProject, useBackgroundAgent, acquireForegroundWorkspace } from "./background-agent";
import {openForegroundSteering,steerForeground,steeringProject} from './agent-steering';
import {beginPlanning,finishPlanning,interruptPlanning,expandPlanExecution} from './task-plan-store';
import {reviewForPrompt,saveTaskReview} from './task-review-store';
import { refreshWorkspaceResults } from './workspace-results';
import { WorkspaceConflictError } from './workspace-conflict';

export async function applyWorkspace(ev: WorkspaceEvent, run?: AgentRun) {
  run?.assertCurrent();
  const s = useIde.getState();
  if (ev.op === "write") {
    if (ev.expectedEditor !== undefined && ev.expectedEditor !== (s.files[ev.path] ?? null)) {
      throw new WorkspaceConflictError(`${ev.path} wurde inzwischen geändert. Lies die aktuelle Fassung vor dem Bearbeiten.`,
        { path: ev.path, kind: s.files[ev.path] === undefined ? 'deleted' : 'changed' });
    }
    if (s.autoAcceptDiffs) s.writeFile(ev.path, ev.content, { quiet: true });
    else s.patchFiles({ [ev.path]: ev.content }, { quiet: true });
    const current = useIde.getState();
    if (s.files[ev.path] !== ev.content && current.files[ev.path] === ev.content) current.openFile(ev.path);
  } else if (ev.op === "delete") {
    if(s.dirs.includes(ev.path)||Object.keys(s.files).some(p=>p.startsWith(ev.path+'/')))s.deleteDir(ev.path);
    else s.deleteFile(ev.path);
  }
  else if (ev.op === "mkdir") s.createFolder(ev.path);
  else if (ev.op === "rename") await s.relocatePath(ev.from, ev.to);
  else if (ev.op === "commit") s.commit(ev.message);
  else if (ev.op === "preview") {
    s.setRunPath(ev.path);
    s.setPreviewOpen(true);
    if (/\.html?$/i.test(ev.path) || s.runInWindow) {
      void import("@/lib/run-window").then((m) => { if (!run || run.current()) m.openRunWindow({ agent: true }); });
    } else {
      s.revealOutput();
      void import("@/lib/run-window").then((m) => { if (!run || run.current()) m.agentOpenedPreview(); });
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
const resumeRequest=/^(?:weiter(?:machen)?|fortsetzen|mach weiter|continue|resume)[.!]?$/i;
export async function sendChat(
  { preset, draft, images, title, setTitle, setDraft, setImages, setMention }: SendInput,
  opts?: { queued?: boolean; choiceId?: string; mode?: "ask" | "agent" | "plan"; delivery?:'queue'|'steer'; onAccepted?: () => void },
) {
  const atEntry=useIde.getState();
  if(opts?.delivery==='steer'&&!opts.queued){
    const note = scrubSecrets((preset ?? draft).trim()).text;
    if (!note && !images.length) return;
    const text = note || (atEntry.locale === 'en'
      ? 'Use the attached images as reference for the current task.'
      : 'Berücksichtige die angehängten Bilder bei der laufenden Aufgabe.');
    const id = crypto.randomUUID();
    const background=useBackgroundAgent.getState().job;
    let result:{ok:boolean;error?:string};
    if(backgroundRunning(background)&&background?.project===backgroundProject())result=await steerBackground(text,id,images);
    else{
      const job=atEntry.agentJob;
      let human:JobHumanContext|undefined;
      try{if(job?.status==='run'&&job.human)human=extendJobHumanContext(job.human,text,id);}
      catch(error){atEntry.setNotice(error instanceof Error?error.message:String(error));return;}
      result=steerForeground(steeringProject(atEntry),text,id,images);
      // Persist accepted human input without waiting for the model's next boundary.
      if(result.ok&&human&&useIde.getState().agentJob?.id===job?.id)useIde.getState().setAgentJob({...job!,human});
    }
    if(!result.ok){useIde.getState().setNotice(result.error||'Korrektur nicht übernommen. Dein Entwurf bleibt erhalten.');return;}
    if(steeringProject(atEntry)!==steeringProject(useIde.getState()))return;
    // Keep the streaming assistant last: its deltas and tool progress remain attached.
    useIde.setState(st => {
      const chat = [...st.chat];
      const label = atEntry.locale === 'en' ? 'Correction' : 'Korrektur';
      const correction = { id, role: 'user' as const, content: `${label}: ${text}`, images: images.length ? [...images] : undefined, at: Date.now() };
      chat.splice(chat.at(-1)?.role === 'assistant' ? chat.length - 1 : chat.length, 0, correction);
      return { chat };
    });
    if (useIde.getState().agentDraft === atEntry.agentDraft) { setDraft(''); setMention(null); }
    setImages([]);
    opts.onAccepted?.();
    return;
  }
  const planning=opts?.mode==='plan';
  try{preset=expandPlanExecution(preset??draft,atEntry.workspaceCwd||atEntry.memoryWorkspace);}catch(error){atEntry.setNotice(String(error));return;}
  const foregroundContinuation=atEntry.agentJob?.status==='ask'||atEntry.agentJob?.status==='paused'&&Boolean(atEntry.agentJob.workflow)&&resumeRequest.test((preset??draft).trim());
  // Foreground routing must not yield before it claims agentBusy. Otherwise
  // the queue consumer can remove and start the next request first.
  const background = planning||foregroundContinuation?false:trySendBackground({ preset, draft, images, setDraft, setImages, setMention, onAccepted: opts?.onAccepted }, opts?.mode);
  if (typeof background === "boolean" ? background : await background) return;
  const initial = useIde.getState();
  const connection = Object.freeze({ provider: initial.llmProvider, authMode: initial.llmAuthMode, baseUrl: initial.llmBaseUrl, model: initial.llmModel, apiKey: initial.llmApiKey });
  if (initial.pathOperation) {
    initial.setNotice(initial.locale === "en" ? "Project files are being updated. Wait until this finishes. Your draft is kept." : "Die Projektdateien werden gerade geändert. Warte, bis der Vorgang abgeschlossen ist. Dein Entwurf bleibt erhalten.");
    return;
  }
  const connectionError = imageAttachmentError(connection, images.length, initial.locale);
  if (connectionError) { initial.setNotice(connectionError); return; }
  if (images.length && initial.agentBusy && initial.agentJob?.status !== "ask") {
    initial.setNotice(initial.locale === "en" ? "Wait for this round to finish before sending images. Your draft is kept." : "Warte vor dem Senden von Bildern auf das Ende dieser Runde. Dein Entwurf bleibt erhalten.");
    return;
  }
  const {
    addChat,
    startAssistant,
    appendAssistant,
    appendThinking,
    addAgentStep,
    addSessionTokens,
    finalizeAssistant,
    setAgentBusy,
    writeFile,
    pushOutput,
    setRunning,
    togglePanel,
    setAgentMode,
  } = useIde.getState();
  const pending = useIde.getState().pendingAsk;
  const jobNow = useIde.getState().agentJob;
  const selectedMode = opts?.mode==='plan'?'ask':opts?.mode ?? initial.agentMode;
  const asking = jobNow?.status === "ask" && Boolean(jobNow.ask);
  const typed = (preset ?? draft).trim();
  let text = typed;
  if (asking && jobNow?.ask) {
    if (!text && !opts?.choiceId) return;
    text = isAskAnswer(typed) ? typed : formatAskAnswer(jobNow.ask, opts?.choiceId, typed);
  } else {
    if (pending && !text) text = "Erkläre die Auswahl.";
    if (!text && images.length) text = initial.locale === "en" ? "Describe the attached image." : "Beschreibe das angehängte Bild.";
    if (!text) return;
  }
  const holdUi = false;
  let parked = false;
  if (!asking && useIde.getState().agentBusy) {
    useIde.getState().pushAgent(text, false, planning?'plan':selectedMode);
    setDraft("");
    setImages([]);
    return;
  }
  const scrub = scrubSecrets(text);
  const work = scrub.text;
  let selectionContext = "";
  if (pending && !asking) {
    selectionContext = `Auswahl in ${pending.path}:\n\`\`\`\n${pending.text.slice(0, 4000)}\n\`\`\``;
    useIde.getState().setPendingAsk(null);
  }
  const forceAsk = Boolean(pending) && (!typed || useIde.getState().agentMode === "ask");
  // The selected mode is a user decision, not a guess based on request wording.
  const observeRequest = asking ? (jobNow?.mode ?? selectedMode) === "ask" : selectedMode === "ask" || forceAsk;
  const continuing = !observeRequest && jobNow?.status === "paused" && Boolean(jobNow.workflow)
    && resumeRequest.test(typed);
  const project=initial.workspaceCwd||initial.memoryWorkspace;
  let human:JobHumanContext;
  try{
    const correction=asking&&jobNow?.ask?askAnswerHumanText(jobNow.ask,typed):work;
    human=(asking||continuing)&&jobNow
      ?resumeJobHumanContext(jobNow,project,scrubSecrets(correction).text)
      :newJobHumanContext(project,work);
  }catch(error){initial.setNotice(error instanceof Error?error.message:String(error));return;}
  if (scrub.n) useIde.getState().setNotice(t("secretsN", { n: scrub.n }));
  else {
    const warningEpoch = useIde.getState().workspaceEpoch;
    void brainSecretWarn(text).then((w) => {
      if (w && warningEpoch === useIde.getState().workspaceEpoch) useIde.getState().setNotice(w);
    });
  }
  const my = beginAgent();
  const workspaceEpoch = useIde.getState().workspaceEpoch;
  const run = captureAgentRun(() => useIde.getState().workspaceEpoch === workspaceEpoch);
  const steering=openForegroundSteering(steeringProject(initial),String(my),()=>run.current()&&useIde.getState().agentBusy,imageAttachmentError(connection,1,initial.locale));
  let humanJobId:string|undefined;
  const withHuman=(job:AgentJob):AgentJob=>{humanJobId=job.id;return {...job,human};};
  const steeringOptions={
    humanRequest:human.request,humanCorrections:human.corrections.map(correction=>correction.text),
    takeSteering:()=>{
      run.assertCurrent();
      const incoming=steering.inbox.drain(),job=useIde.getState().agentJob;
      if(job?.id===humanJobId&&job?.human)human=job.human;
      for(const correction of incoming)human=extendJobHumanContext(human,correction.text,correction.id);
      if(incoming.length&&job?.id===humanJobId)useIde.getState().setAgentJob({...job!,human});
      return incoming;
    },
  };
  let planningState:import('./task-plan').TaskPlan|undefined;
  try{planningState=planning?beginPlanning(initial.workspaceCwd||initial.memoryWorkspace,work):undefined;}
  catch(error){steering.close();initial.setNotice(error instanceof Error?error.message:String(error));return;}
  const review=reviewForPrompt(work,initial.workspaceCwd||initial.memoryWorkspace);
  const reviewOptions={review,onReviewReport:async(report:import('./task-review').ReviewRequest)=>{const {refreshReviewRequest}=await import('./task-review');run.assertCurrent();const refreshed=await refreshReviewRequest(report,useIde.getState().files);run.assertCurrent();saveTaskReview(refreshed);}};
  let roundVerification: import("./agent-evidence").Verification | undefined;
  let roundStopReason: import("./agent-core").AgentResult["stopReason"];
  let roundStopLabel: string | undefined;
  let diskCheckpointId: string | undefined;
  let releaseWorkspace:(()=>Promise<void>)|undefined;
  let accepted=false;
  let asstId:string|undefined;
  const pics = images.slice(0, 4);
  setAgentBusy(true);
  try {
    if(!observeRequest)releaseWorkspace=await acquireForegroundWorkspace(initial.workspaceCwd,run);
    run.assertCurrent();
    accepted=true;
    opts?.onAccepted?.();
    await import("@/lib/model-context").then((m) => m.applyCloudContext()).catch(() => null);
    if (!run.current()) return;
    appLog(
      "agent",
      `R${my} start ${useIde.getState().llmProvider} ${useIde.getState().llmModel || "-"} host=${logHost(useIde.getState().llmBaseUrl)} ctx=${useIde.getState().llmContext} think=${useIde.getState().llmThinking}`,
    );
    useBrain.getState().setFollowups([]);
    setDraft("");
    setMention(null);
    setImages([]);
    addChat({ role: "user", content: work, images: pics.length ? pics : undefined });
    startAssistant();
    asstId = useIde.getState().chat.at(-1)?.id;
    resetLiveWrite();
    if (!title)
      void brainChatTitle(work)
        .then((value) => {
          if (run.current()) setTitle(value);
        })
        .catch(() => undefined);
    reflectUtterance(work, "ask");
    const routed = observeRequest ? { hand: "model" as const } : await anvilHandle(work, { hasImages: pics.length > 0 });
    if (!run.current()) return;
    if (routed.hand === "app" && routed.reply) {
      finalizeAssistant(routed.reply);
      return;
    }
    if (initial.workspaceCwd) await refreshWorkspaceResults(initial).catch(() => undefined);
    run.assertCurrent();
    const ck = useIde.getState().pushCheckpoint(work.slice(0, 60));
    if (!observeRequest) {
      diskCheckpointId = ck;
      useIde.setState((state) => ({ chat: state.chat.map((m) => m.id === asstId ? { ...m, checkpointId: ck } : m) }));
      await beginProjectCheckpoint(ck, run);
      if (!run.current()) return;
    }
    emitPlugin("agent", work);
    resetLoopFails();
    let s = useIde.getState();
    let extraFiles = [
      ...new Set([...(s.attached ?? []), s.activePath].filter(Boolean)),
    ] as string[];
    if (useBrain.getState().jobs.attach) {
      extraFiles = [...new Set([...extraFiles, ...attachmentHints(work, selectFileKeys(s))])];
    }
    if (!run.current()) return;
    s = useIde.getState();
    const prefer = [
      ...new Set(
        [...(s.attached ?? []), s.activePath, ...s.openPaths, ...s.recentPaths.slice(0, 8)].filter(
          Boolean,
        ),
      ),
    ] as string[];
    const rules = workspaceRules(s.files, s.agentRules,prefer);
    const { internPrompt } = await import("@/lib/intern");
    const { hydrateLearnFromFiles } = await import("@/lib/learn");
    run.assertCurrent();
    hydrateLearnFromFiles(s.files);
    const memory = [learnPrompt(work), internPrompt()].filter(Boolean).join("\n\n");
    useIde.setState(state => ({ chat: state.chat.map(message => message.id === asstId ? { ...message, skillSelection: useLearn.getState().skillSelection } : message) }));
    const recordSkillLoad = (name: string, args: Record<string, unknown>, out: unknown) => {
      if (!['skill_run', 'skill_read'].includes(name) || !out || typeof out !== 'object' || !('body' in out) || 'error' in out) return;
      const skill = visibleSkills().find(skill => skill.id === args.name || skill.name === args.name);
      if(skill)markSkills([...new Set([...useLearn.getState().activeSkills,skill.id])]);
      useIde.setState(state => ({ chat: state.chat.map(message => message.id === asstId ? { ...message, skillSelection: withLoadedSkill(message.skillSelection || [], skill, name) } : message) }));
    };
    const helperNotes = lanePrompt();
    const vision = connectionCapabilities(connection).images !== "unsupported" && modelSeesImages(connection.provider, connection.model, connection.baseUrl);
    const refs = packRefContext(
      s.files,
      work,
      extraFiles.filter(isRefPath).concat(s.openPaths.filter(isRefPath)),
      { vision },
    );
    const pinBlock = (await import("@/lib/fix-agent")).pinContext(work);
    run.assertCurrent();
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
        taskHandoff(s.chat),
        selectionContext,
        planning?'Planning mode: Inspect the project and produce a concrete implementation plan with affected files, risks, and functional checks. Do not implement, change files, or run mutating tools. This plan is an editable draft; implementation happens only when the user chooses its version.':'',
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
    const history = packAgentHistory(
      historyForConnection(s.chat.map((m) => ({ role: m.role, content: m.content, images: m.images })), connection),
      { content: work, images: vision ? [...pics, ...refs.images].slice(0, 4) : pics.slice(0, 4) },
      prefix,
    );
    const fileList = Object.entries(s.files)
      .filter(([path]) => !isSecretPath(path))
      .map(([path, content]) => ({
        path,
        // This is the execution snapshot, not model prose. read_file creates
        // binary placeholders at the model boundary; originals must survive the round.
        content,
      }));
    const onUsage = (usage: TokenUsage, request?: RequestTokens) => {
      if (!run.current()) return;
      addSessionTokens(usage.prompt, usage.completion, usage.estimated);
      useIde.setState({ lastRequestTokens: request ?? null });
    };

    if (observeRequest) {
      const helperAsk =
        !planning && !review &&
        pics.length === 0 && refs.images.length === 0 &&
        !asking &&
        s.agentMode === "ask" &&
        !forceAsk &&
        brainReady() &&
        useBrain.getState().jobs.ask &&
        routeKind(work) === "ask-local" && user.length <= 8000;
      let reply: string;
      if (helperAsk) {
        requestPhase(my, "waiting");
        try {
          reply = await brainAsk(user, (chunk) => {
            if (!run.current()) return;
            requestPhase(my, "answering");
            appendAssistant(chunk);
          }, memory, onUsage, run.signal);
        } catch {
          if (!run.current()) return;
          requestPhase(my, "waiting");
          const fallback = await chatWithProvider({
            ...steeringOptions,...reviewOptions,
            run,
            onUsage, ...connection, messages: history, files: fileList,
            context: s.llmContext, thinking: s.llmThinking, compact: s.llmCompact,
            memory, locale: s.locale, observeOnly: true, maxRounds: 8,
            autoContinueRounds: false, loopTries: 1, runLoop: false, graphLoop: false,
          });
          if (!run.current()) return;
          reply = fallback.reply;
        }
      } else {
        useIde.getState().setAgentJob(withHuman(asking && jobNow
          ? { ...jobNow, mode: "ask", status: "run", ask: null, rounds: jobNow.rounds + 1 }
          : newJob(work, "ask")));
        if (!run.current()) return;
        const asked = await chatWithProvider({
          ...steeringOptions,...reviewOptions,
          run,
          onUsage,
          ...connection,
          messages: history,
          files: fileList,
          dirs: s.dirs,
          context: s.llmContext,
          thinking: s.llmThinking,
          compact: s.llmCompact,
          journal: useIde.getState().sessionJournal,
          memory,
          prefer,
          locale: s.locale,
          observeOnly: true,
          maxRounds: 8,
          autoContinueRounds: false,
          loopTries: 1,
          runLoop: false,
          graphLoop: false,
          onDelta: (chunk, kind) => {
            if (!run.current()) return;
            if (kind === "think") appendThinking(chunk);
            else appendAssistant(chunk);
          },
          onToolStart: ({ name, args }) => {
            if (!run.current()) return;
            addAgentStep({
              name,
              detail: toolDetail(name, args),
              status: "run",
              ...toolCode(name, args),
            });
          },
          onTool: ({ name, args, result: out }) => {
            if (!run.current()) return;
            const err = Boolean(out && typeof out === "object" && ((out as { error?: unknown }).error || (out as { isError?: boolean }).isError));
            if (!err) recordSkillLoad(name, args, out);
            addAgentStep({
              name,
              detail: toolDetail(name, args, out),
              status: err ? "err" : "ok",
              ...toolCode(name, args),
            });
          },
        });
        if (!run.current()) return;
        if (!asked.ok) requestPhase(my, "error");
        reply = asked.reply;
        if (asked.parked && asked.ask) {
          parked = true;
          const cur = useIde.getState().agentJob;
          if (cur) useIde.getState().setAgentJob({ ...cur, status: "ask", ask: asked.ask });
        }
      }
      if (!run.current()) return;
      finalizeAssistant(reply, undefined, { replace: useRequestState.getState().phase === "error" });
      if(planningState&&!parked&&useRequestState.getState().phase!=='error')finishPlanning(planningState.id,planningState.generation,reply);
      void brainDistill(work, reply);
      {
        const st = useIde.getState();
        // Ask keeps its journal in the profile without modifying the project.
        useIde.setState({ sessionJournal: mergeJournal(st.sessionJournal, extractJournal(st.chat, st.sessionJournal)) });
      }
      void pruneSession({ persistJournal: false });
      return;
    }

    const requestedPlanContext = requestPlanContext(work, useIde.getState().chat);
    if (requestedPlanContext.continued && !asking && !continuing) {
      human = newJobHumanContext(project, scrubSecrets(requestedPlanContext.humanPrompt??requestedPlanContext.text).text);
      for(const correction of requestedPlanContext.humanCorrections||[])human=extendJobHumanContext(human,scrubSecrets(correction).text);
    }
    useIde.setState((st) => {
      const chat = [...st.chat];
      const last = chat[chat.length - 1];
      const who = normalizePlanWho(st.planWho);
      if (last?.role === "assistant") {
        const locked = who === "anvil" || requestedPlanContext.locked || planFromAsk(requestedPlanContext.text) || last.planLocked === true;
        const currentPlan = last.plan?.length ? last.plan : requestedPlanContext.plan;
        chat[chat.length - 1] = {
          ...last,
          checkpointId: ck,
          plan: (last.planLocked || requestedPlanContext.locked) && currentPlan?.length ? currentPlan.map(step => ({ ...step })) : initialAgentPlan(requestedPlanContext.text, currentPlan, who, st.locale),
          planLocked: locked,
        };
      }
      return { chat };
    });
    const planMessageId = useIde.getState().chat.at(-1)?.id;
    const planState = useIde.getState();
    if (!(requestedPlanContext.continued && requestedPlanContext.plan?.length) && planHelperNow(normalizePlanWho(planState.planWho), Boolean(planState.chat.at(-1)?.plan?.length), Boolean(planState.chat.at(-1)?.planLocked))) void brainPlanText(requestedPlanContext.text).then((steps) => {
      if (!run.current()) return;
      const st = useIde.getState();
      const last = st.chat.at(-1);
      // A delayed helper must not install a fresh 0/N list after work has ended
      // or replace the progress of the active assistant message.
      if (!st.agentBusy || last?.id !== planMessageId || last?.plan?.some(step => step.status !== "todo") || last?.steps?.some(step => step.status === "ok")) return;
      const who = normalizePlanWho(st.planWho);
      if (!last?.role || !planHelperNow(who, Boolean(last.plan?.length), Boolean(last.planLocked)))
        return;
      if (who !== "helper" && last.plan?.length) return;
      if (steps.length >= 3)
        useIde.getState().setChatPlan(steps.map((text) => ({ text, status: "todo" as const })));
      else if (!last.plan?.length)
        useIde.getState().setChatPlan(initialAgentPlan(requestedPlanContext.text, requestedPlanContext.plan, "auto", st.locale));
    });
    if ((asking || continuing) && jobNow) {
      useIde
        .getState()
        .setAgentJob(withHuman({ ...jobNow, status: "run", ask: null, rounds: jobNow.rounds + 1 }));
      if (jobNow.ask) {
        const stj = useIde.getState();
        stj.setSessionJournal(
          mergeJournal(stj.sessionJournal, {
            corrections: [askCorrection(jobNow.ask, opts?.choiceId, typed)],
          }),
        );
      }
    } else {
      useIde.getState().setAgentJob(withHuman(newJob(work)));
      const stj = useIde.getState();
      stj.setSessionJournal(beginJournal(requestedPlanContext.text, stj.sessionJournal));
    }
    if (!run.current()) return;
    const result = await chatWithProvider({
      ...steeringOptions,...reviewOptions,
      run,
      onUsage,
      workflow: asking || continuing ? jobNow?.workflow : undefined,
      workflowId: useIde.getState().agentJob?.id,
      onWorkflow: async (workflow) => {
        run.assertCurrent();
        await persistAgentWorkflow(s.workspaceCwd || "", workflow);
        run.assertCurrent();
        const st = useIde.getState(), currentJob = st.agentJob, last = st.chat.at(-1);
        if (currentJob) st.setAgentJob({ ...currentJob, workflow });
        if (last?.role === "assistant") useIde.setState({ chat: st.chat.map(m => m.id === last.id ? { ...m, workflow } : m) });
      },
      ...connection,
      messages: requestedPlanContext.continued ? history.map((m, i) => i === history.map(row => row.role).lastIndexOf('user') ? { ...m, content: `${requestedPlanContext.text}\n\nAktuelle Folgeanweisung: ${work}` } : m) : history,
      humanRequest: requestedPlanContext.continued && !asking && !continuing ? human.request : steeringOptions.humanRequest,
      humanCorrections: requestedPlanContext.continued && !asking && !continuing ? human.corrections.map(correction=>correction.text) : steeringOptions.humanCorrections,
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
      journal: useIde.getState().sessionJournal,
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
      autoContinueRounds: s.harnessAutoContinue,
      graphSees: s.graphSees,
      onHarness: (bar) => {
        if (!run.current()) return;
        useIde.getState().setChatHarness(bar);
      },
      onDelta: (chunk, kind) => {
        if (!run.current()) return;
        if (kind === "think") appendThinking(chunk);
        else appendAssistant(chunk);
      },
      onWorkspace: (event) => {
        if (run.current() && useIde.getState().workspaceEpoch === workspaceEpoch) return applyWorkspace(event, run);
      },
      onToolStart: ({ name, args }) => {
        if (!run.current()) return;
        const started = planStart(name, useIde.getState().chat.at(-1)?.plan, args);
        if (started) useIde.getState().setChatPlan(started);
        addAgentStep({
          name,
          detail: toolDetail(name, args),
          status: "run",
          ...toolCode(name, args),
        });
        void import("@/lib/run-window").then((m) => { if (run.current()) m.agentToolUi(name, String(args.path ?? "")); });
        if (
          name === "run_file" ||
          name === "engine_run" ||
          name === "shell"
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
      getPlan: () => run.current() ? useIde.getState().chat.at(-1)?.plan : undefined,
      canReplacePlan: () => {
        const st = useIde.getState();
        return run.current() && planAgentMayReplace(normalizePlanWho(st.planWho), Boolean(st.chat.at(-1)?.planLocked));
      },
      onTool: ({ name, args, result: out }) => {
        if (!run.current()) return;
        const failed = Boolean(out && typeof out === "object" && toolResultFailed(out as Record<string,unknown>));
        if (name === "skill_run" && !failed) markSkills([String(args.name ?? "")]);
        if (!failed) recordSkillLoad(name, args, out);
        if (name === "set_plan" && !failed && out && typeof out === "object" && "plan" in out && Array.isArray(out.plan)) {
          // Validated by the loop against this request's actual tool results.
          useIde.getState().setChatPlan(out.plan);
        } else if (name === "set_plan" && !failed && out && typeof out === "object" && "steps" in out) {
          const st = useIde.getState();
          const last = st.chat.at(-1);
          const who = normalizePlanWho(st.planWho);
          const steps = (out as { steps?: string[] }).steps ?? [];
          const next = applySetPlan(
            last?.plan,
            steps,
            !planAgentMayReplace(who, Boolean(last?.planLocked)),
            (out as { kinds?: unknown[] }).kinds,
          );
          if (next) useIde.getState().setChatPlan(next);
        } else {
          const bumped = planFromTool(name, useIde.getState().chat.at(-1)?.plan, failed, args, out);
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
            name === "shell") &&
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
            ok: !failed && o.ok === true && !toolResultPending(out as Record<string, unknown>),
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
            running: toolResultPending(out as Record<string, unknown>) || o.stage?.kind === "window",
          });
        }
      },
    });
    if (!run.current()) return;
    roundVerification = result.verification;
    roundStopReason = result.stopReason;
    roundStopLabel = roundStopReason === "round-limit" ? (s.locale === "en" ? "Round limit" : "Rundenlimit") : roundStopReason === "no-progress" ? (s.locale === "en" ? "No progress" : "Kein Fortschritt") : roundStopReason === "tool-limit" ? (s.locale === "en" ? "Tool limit" : "Werkzeuglimit") : undefined;
    if (!result.ok) requestPhase(my, "error");
    if (result.parked && result.ask) {
      parked = true;
      const cur = useIde.getState().agentJob;
      if (cur) useIde.getState().setAgentJob({ ...cur, status: "ask", ask: result.ask });
    }
    finalizeAssistant(result.reply, result.tools, { replace: !result.ok || Boolean(result.plan?.length), incompleteReason: roundStopLabel });
    if (result.ok) {
      void import("@/lib/intern").then((m) => { if (run.current()) m.resolveKind("agent"); });
      void import("@/lib/problems").then((m) => { if (run.current()) return m.refreshProblems(); });
    }
    const snap = useIde.getState().checkpoints.find((c) => c.id === ck);
    if (snap) {
      const changes = snapshotDiff(snap.files, useIde.getState().files);
      useIde.getState().setChatChanges(changes);
      const st = useIde.getState();
      if (!parked && shouldTestAfterRound(changes, st.files, st.chat.at(-1)?.steps, result.verification)) {
        await testAfterRound(run);
        run.assertCurrent();
      }
    }

    run.assertCurrent();
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
      for (const f of result.applied ? [] : result.files) {
        if ((cur[f.path] ?? "") !== f.content) map[f.path] = f.content;
      }
      if (Object.keys(map).length) {
        const st = useIde.getState();
        if (st.autoAcceptDiffs || isFixPrompt(work)) {
          for (const [p, c] of Object.entries(map)) st.writeFile(p, c, { quiet: true });
        } else st.patchFiles(map, { quiet: true });
        const current = useIde.getState();
        const lastWritten = Object.keys(map).reverse().find((p) => current.files[p] === map[p]);
        if (lastWritten) current.openFile(lastWritten);
      }
      void brainReview(result.files.map((f) => ({ path: f.path, before: s.files[f.path] ?? "", after: f.content }))).then((t) => {
        if (t && run.current()) addAgentStep({ name: "Helfer-Hinweis", detail: t, status: "ok" });
      });
    }
    if (!parked) void brainFollowups(work, result.reply);
    if (!parked && result.runPaths?.length) {
      const st = useIde.getState();
      const already = result.tools?.includes("run_file") && result.verification?.state !== "stale";
      if (st.autoRunAgent && !already && !result.workflow && !result.verification?.observedFailure) {
        await (async () => {
            if (!run.current()) return;
            const html = result.runPaths!.some((p) => /\.html?$/i.test(p));
            const cur = useIde.getState();
            if (html || cur.runInWindow) {
              void import("@/lib/run-window").then((m) => { if (!run || run.current()) m.openRunWindow({ agent: true }); });
              cur.setPreviewOpen(false);
            } else {
              if (cur.openOutputOnRun) cur.revealOutput();
              cur.setPreviewOpen(true);
              void import("@/lib/run-window").then((m) => { if (!run || run.current()) m.agentOpenedPreview(); });
            }
            setRunning(true);
            try {
              const latest = useIde.getState().files;
              let ok = true;
              const executable = result.runPaths!.filter(isExecutablePath);
              for (const p of executable) {
                const started = planStart("run_file", useIde.getState().chat.at(-1)?.plan, { path: p });
                if (started) useIde.getState().setChatPlan(started);
                useIde.getState().setRunPath(p);
                const r = await runFile(p, latest, { run });
                if (!run.current()) return;
                pushOutput(r);
                if (!r.ok) ok = false;
                const finished = planFromTool("run_file", useIde.getState().chat.at(-1)?.plan, !r.ok, { path: p }, r);
                if (finished) useIde.getState().setChatPlan(finished);
                addAgentStep({ name: "run_file", detail: p, status: r.ok ? "ok" : "err" });
                useIde.getState().setChatLastRun({ ok: r.ok, path: p, stdout: r.stdout, stderr: r.stderr, attempt: 1, max: 1, running: false });
              }
              if (executable.length) {
                roundVerification = automaticRunVerification(roundVerification, ok, latest === useIde.getState().files);
                if (!ok) requestPhase(my, "error");
                const reply=verifiedReply(result.modelReply ?? result.reply, roundVerification, !roundStopReason);
                finalizeAssistant(reply, result.tools, { replace: true, incompleteReason: roundStopLabel });
              }
              if (!ok) useLearn.getState().track("fail", result.runPaths![0]);
            } finally {
              if (run.current()) setRunning(false);
              void import("@/lib/run-window").then((m) => { if (run.current()) m.releaseAgentUi(); });
            }
        })();
      }
    }
  } catch (err) {
    if(!accepted){if(run.current())useIde.getState().setNotice(err instanceof Error?err.message:String(err));return;}
    if (!run.current()) {
      const last = useIde.getState().chat.at(-1);
      if (!useIde.getState().agentBusy && useIde.getState().workspaceEpoch === workspaceEpoch && last && last.id === asstId && last.role === "assistant" && !(last.content || "").trim()) {
        finalizeAssistant("Der Auftrag wurde unterbrochen. Sende eine weitere Nachricht, um ihn fortzusetzen.");
      }
      return;
    }
    requestPhase(my, isAbortLike(err) ? "stopped" : "error");
    finalizeAssistant(isAbortLike(err) ? explainAbort(err) : explainLlmError(err), undefined, { replace: !isAbortLike(err) });
    if (isAbortLike(err)) {
      const last = useIde.getState().chat.at(-1);
      void brainStopNote(last?.steps ?? []).then((note) => {
        if (!run.current()) return;
        const cur = useIde.getState().chat.at(-1);
        if (!cur || cur.role !== "assistant" || cur.id !== last?.id) return;
        const body = (cur.content || "").trim();
        if (note && !body.includes(note.slice(0, 24))) {
          // The request is already stopped and finalized. Append the helper's
          // note without finalizing a second time or resurrecting stale output.
          useIde.setState((state) => ({ chat: state.chat.map((message) => message.id === cur.id
            ? { ...message, content: body ? `${body}\n${note}` : note } : message) }));
        }
      });
    }
  } finally {
    steering.close();
    if(planningState)interruptPlanning(planningState.id,planningState.generation);
    if (diskCheckpointId) {
      try { await sealProjectCheckpoint(diskCheckpointId, run); }
      catch (error) { if (run.current()) useIde.getState().setNotice(`Projektsicherung nicht abgeschlossen: ${String(error)}`); }
    }
    try{await releaseWorkspace?.();}
    catch(error){if(run.current())useIde.getState().setNotice(`Projektbindung konnte nicht freigegeben werden: ${String(error)}`);}
    const live = run.current();
    const busy = useIde.getState().agentBusy;
    if(live&&!accepted)setAgentBusy(false);
    else if (live) {
      resetLiveWrite();
      if (!parked) {
        const last = useIde.getState().chat.at(-1);
        const failed = Boolean(roundStopReason) || ["error", "stopped"].includes(useRequestState.getState().phase) || /^(HTTP \d{3}|Gestoppt|Abgebrochen|Unterbrochen)/i.test(
          (last?.content || "").trim(),
        );
        const proved = roundVerification?.state === "passed";
        const currentJob = useIde.getState().agentJob;
        useIde.getState().setAgentJob(failed && currentJob?.workflow ? { ...currentJob, status: "paused", ask: null } : null);
        const fin = planFinish(last?.plan, failed, proved && !failed, Boolean(last?.content?.trim()));
        if (fin) useIde.getState().setChatPlan(fin);
        const final = useIde.getState();
        const message = final.chat.at(-1);
        const bar = finishedHarness(message?.harness, message?.plan, failed, final.locale, roundStopLabel);
        if (bar) final.setChatHarness(bar);
      }
      void idleCompanion().catch(() => undefined);
      if (!["error", "stopped"].includes(useRequestState.getState().phase)) requestPhase(my, "done");
      setAgentBusy(false);
      const phase = useRequestState.getState().phase;
      appLog("agent", `R${my} ${parked ? "wartet auf Rückfrage" : phase === "error" ? "fehlgeschlagen" : phase === "stopped" ? "gestoppt" : "abgeschlossen"}`);
      if (!parked) useIde.getState().setRunning(false);
      if (!parked && !holdUi) void import("@/lib/run-window").then((m) => { if (run.current()) m.releaseAgentUi(); });
      else if (!parked) {
        window.setTimeout(() => {
          if (!run.current() || useIde.getState().agentBusy) return;
          void import("@/lib/run-window").then((m) => { if (run.current()) m.releaseAgentUi(); });
        }, 8000);
      }
      queueMicrotask(() => { if (run.current()) document.getElementById("anvil-chat")?.focus(); });
    } else if (!busy && useIde.getState().workspaceEpoch === workspaceEpoch && useIde.getState().chat.at(-1)?.id === asstId) {
      useIde.getState().setRunning(false);
      void import("@/lib/run-window").then((m) => { if (run.current()) m.releaseAgentUi(); });
    }
  }
}
