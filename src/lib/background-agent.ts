import { create } from "zustand";
import { useIde, type AgentStep, type PlanStep } from "../store/ide";
import { providerOf } from "./providers";
import { normalizeBaseUrl } from "./connection";
import { isSecretPath } from "./ref";
import { scrubSecrets } from "./brain";
import { beginAgent, registerAgentStopHandler } from "./abort";
import { useRequestState } from "./request-state";
import { toolTargetKey, toolCompatibility } from "./tool-compat";
import { noteDiskFile, flushDiskSync } from "./disk-sync";
import { cliKindFor } from "./cli-protocol";
import { backgroundMcpServers } from "./mcp";
import { tokenCount, type TokenUsage, type RequestTokens } from './token-usage';
import { prepareBackgroundContext } from './background-context';
import { imageAttachmentError } from './connection-capabilities';
import { getCap, setCap, type ModelCap } from './model-caps';
import { snapshotDiff, diffPreview } from './diff';
import { finishedHarness } from './chat-finalize';
import { emitPlugin } from './plugins/events';
import { mergeJournal, extractJournal } from './session';
import { brainDistill, brainReview, brainFollowups, useBrain } from './brain';
import { parseTests } from './test-parse';
import { contentVersion } from '../../electron/content-version.mjs';
import {applyBackgroundDebug,type BackgroundDebugState} from './background-debug';
import {applyBackgroundKnowledge,type BackgroundKnowledgeEvent} from './background-knowledge';
import {useLearn,foregroundKnowledgePermissions} from './learn';
import {appLog} from './app-log';

export type BackgroundJob = {
  acceptance?: import('../../electron/task-acceptance.mjs').AcceptanceResult;
  workflow?: import('./agent-workflow').WorkflowSnapshot;
  id: string;
  resumedFrom?: string;
  recoveryBlockedActions?: string[];
  revision: number;
  draftRevision?: number;
  project: string;
  prompt: string;
  skillSelection?:import('./skill-library').SkillSelection[];
  images?: string[];
  status: string;
  cancellation?: { local: 'requested' | 'complete'; remote: 'unconfirmed'; at: number };
  startedAt: number;
  text: string;
  thinking: string;
  steps: AgentStep[];
  plan: PlanStep[];
  drafts: Record<string, { before: string | null; after: string | null; applied?: boolean; version?:number; eventId?:string }>;
  directoryChanges?: Record<string,{before:boolean;after:boolean;applied?:boolean}>;
  restored?: boolean;
  harness: string;
  execution?: boolean;
  writeThrough?: boolean;
  operation?: {
    id: number;
    kind: string;
    path?: string;
    server?: string;
    name?: string;
    status: string;
    digest?: string;
  };
  lastRun?: { id?:string; eventId?:string; path?:string; attempt?:number; max?:number; running?:boolean; duration?:number; ok?: boolean; stdout?: string; stderr?: string; note?: string; code?: number };
  pendingRun?: BackgroundJob['lastRun'];
  lastPreview?: {ok?:boolean;stdout?:string;stderr?:string;image?:string};
  lastGit?: unknown;
  lastDebug?: BackgroundDebugState;
  knowledgeEvents?:BackgroundKnowledgeEvent[];
  lastDiagnostics?: {ok:boolean;detail:string;hits?:import('./lsp').LspHit[];checked?:string[];versions?:Record<string,string>};
  phase?: {phase:import('./request-state').RequestPhase;since:number};
  finishedAt?:number;
  verification?:import('./agent-evidence').Verification;
  stopReason?:string;
  compacted?:boolean;
  tools?:string[];
  capabilities?:ModelCap;
  toolLearning?:import('./tool-learning').ToolLearning;
  toolLearningInitial?:import('./tool-learning').ToolLearning;
  ask?:import('./agent-ask').JobAsk;
  parkedAt?:number;
  textTruncated?:boolean;
  thinkingTruncated?:boolean;
  modelTarget?:{provider:string;model:string;baseUrl:string};
  effectiveSettings?:{thinking:string;compact:string;retries:number;runLoop:boolean;graphLoop:boolean};
  lastEngine?: { ok?: boolean; running?: boolean; stdout?: string; stderr?: string; error?: string; code?: number; status?: string };
  connection?: string;
  services?: { id: string; name: string }[];
  lastService?: { server: string; name: string; ok: boolean; text: string };
  error: string;
  failure?: import('../../electron/agent-failure.mjs').AgentFailure;
  persistenceError?: string;
  dismissed: boolean;
  requestSequence?: number;
  requestTokens?: RequestTokens | null;
  usage?: TokenUsage;
};
type Reply = {
  available?: boolean;
  state?: (Omit<BackgroundJob, 'drafts'> & { drafts?: BackgroundJob['drafts'] }) | null;
  draftsUnchanged?: boolean;
  unchanged?: boolean;
  error?: string;
};
type Native = { agentJob?: (action: string, payload?: unknown) => Promise<Reply> };
const native = () =>
  typeof window !== "undefined"
    ? (window as unknown as { anvilNative?: Native }).anvilNative
    : undefined;
export const useBackgroundAgent = create<{
  job: BackgroundJob | null;
  available: boolean;
  error: string;
  startFailure: {project:string;message:string;at:number} | null;
}>(() => ({ job: null, available: false, error: "", startFailure:null }));
export const backgroundRunning = (job = useBackgroundAgent.getState().job) =>
  Boolean(job && ["starting", "running", "stopping"].includes(job.status));
export const backgroundProject = () =>
  useIde.getState().workspaceCwd || useIde.getState().memoryWorkspace;
let ownsBusy = false,
  starting = false;
let startGeneration=0;
let syncedJob = "",
  synced: Record<string, string | null> = {};
const backgroundSurface = () => ({
  id: useIde.getState().activeSurfaceId || "anvil",
  mode: useIde.getState().surfaceMode,
});

function accept(reply: Reply, requestedJobId?: string | null) {
  const currentJob = useBackgroundAgent.getState().job;
  const currentJobId = currentJob?.id ?? null;
  // A late status/permission reply cannot replace a job accepted while that
  // request was in flight. The next poll obtains an authoritative full state.
  if (requestedJobId !== undefined && requestedJobId !== currentJobId &&
      reply.state !== undefined && (reply.state?.id ?? null) !== currentJobId)
    return false;
  if (
    reply.state &&
    currentJob?.id === reply.state.id &&
    reply.state.revision < currentJob.revision
  )
    return true;
  let job: BackgroundJob | null | undefined;
  if (reply.state) {
    if (reply.state.drafts) job = reply.state as BackgroundJob;
    else {
      const draftRevision = reply.state.draftRevision;
      if (reply.draftsUnchanged !== true || !currentJob || currentJob.id !== reply.state.id ||
          typeof draftRevision !== 'number' || !Number.isSafeInteger(draftRevision) || draftRevision < 0 || currentJob.draftRevision !== draftRevision)
        return false;
      job = { ...reply.state, drafts: currentJob.drafts };
    }
  } else job = reply.state;
  if (reply.unchanged) {
    useBackgroundAgent.setState({ error: "" });
    return true;
  }
  useBackgroundAgent.setState({
    ...(reply.available !== undefined ? { available: reply.available } : {}),
    ...(job !== undefined ? { job } : {}),
    error: reply.error || "",
  });
  const live = Boolean(job&&!job.dismissed&&backgroundRunning(job));
  const wasOwned=ownsBusy;
  if (live || ownsBusy) {
    useIde.getState().setAgentBusy(live);
    ownsBusy = live;
  }
  if (!job) return true;
  // Hydration must load the user's durable records before merging native events.
  // onFinishHydration requests a full snapshot below, so early events are replayed.
  if(job.knowledgeEvents&&useLearn.persist.hasHydrated())applyBackgroundKnowledge(job.knowledgeEvents);
  if(job.dismissed)return true;
  if (job.project !== backgroundProject()) return true;
  if(job.lastDebug)applyBackgroundDebug(job.id,job.lastDebug);
  const assistantId=`background-${job.id}`;
  const previousMessage=useIde.getState().chat.find(m=>m.id===assistantId);
  const emitted=new Set(useIde.getState().chat.flatMap(m=>m.backgroundEvents||[]));
  const events:{name:'change'|'run';key:string;payload:unknown}[]=[];
  const tokenState=useIde.getState(), total=tokenState.sessionTokens, cursor=total.background;
  const requestTokens=job.requestTokens;
  if(requestTokens&&tokenCount(requestTokens.prompt)!==undefined&&tokenCount(requestTokens.limit)!==undefined&&requestTokens.limit>0){
    const requestKey=JSON.stringify([job.id,job.requestSequence,requestTokens]);
    const prompt=tokenCount(job.usage?.prompt)??0, completion=tokenCount(job.usage?.completion)??0;
    const previous=cursor?.id===job.id?cursor:undefined;
    const promptDelta=Math.max(0,prompt-(previous?.prompt??0)), completionDelta=Math.max(0,completion-(previous?.completion??0));
    if(cursor?.requestKey!==requestKey||promptDelta||completionDelta||!tokenState.lastRequestTokens){
      useIde.setState({
        ...(cursor?.requestKey!==requestKey||!tokenState.lastRequestTokens?{lastRequestTokens:requestTokens}:{}),
        sessionTokens:{...total,prompt:total.prompt+promptDelta,completion:total.completion+completionDelta,
          estimated:(total.estimated??(total.prompt+total.completion>0))||Boolean((promptDelta||completionDelta)&&job.usage?.estimated),
          background:{id:job.id,prompt:Math.max(prompt,previous?.prompt??0),completion:Math.max(completion,previous?.completion??0),requestKey}},
      });
    }
  }
  if (syncedJob !== job.id) {
    syncedJob = job.id;
    synced = {};
  }
  const current = useIde.getState(),
    updates: Record<string, string | null> = {};
  let followPath: string | undefined;
  for (const [path, draft] of Object.entries(job.drafts)) {
    if (!draft.applied || current.dirty[path] || current.pendingDiffs.some((d) => d.path === path))
      continue;
    const value = current.files[path] ?? null;
    if (value === draft.after && synced[path] === draft.after) continue;
    if (value === draft.after || value === draft.before || value === synced[path]) {
      if (value !== draft.after) updates[path] = draft.after;
      if (!job.restored && draft.after !== null && draft.after !== draft.before)
        followPath = path;
      synced[path] = draft.after;
      noteDiskFile(path, draft.after);
      if(draft.version!==undefined){const key=`${draft.eventId||`${job.id}:file:${path}:${draft.version}`}:${job.restored?'restored':'applied'}`;if(!emitted.has(key)){emitted.add(key);events.push({name:'change',key,payload:path});}}
    }
  }
  const nextFiles={...current.files};for(const [p,v]of Object.entries(updates)){if(v===null)delete nextFiles[p];else nextFiles[p]=v;}
  const nextDirs=new Set(current.dirs);for(const [p,d]of Object.entries(job.directoryChanges||{}))if(d.applied){if(d.after)nextDirs.add(p);else nextDirs.delete(p);}
  const dirsChanged=nextDirs.size!==current.dirs.length||current.dirs.some(p=>!nextDirs.has(p));
  if (Object.keys(updates).length||dirsChanged) {
    const openPaths=current.openPaths.filter(p=>Object.hasOwn(nextFiles,p));
    const activePath=current.activePath&&!Object.hasOwn(nextFiles,current.activePath)?openPaths.at(-1)||null:current.activePath;
    useIde.setState({ files: nextFiles,dirs:[...nextDirs],openPaths,activePath });
  }
  // Follow a newly adopted write, including one already loaded by the disk
  // watcher. Repeated snapshots and reads must not reclaim the selected tab.
  if (followPath) useIde.getState().openFile(followPath);
  const state = useIde.getState();
  const found = state.chat.some((message) => message.id === assistantId);
  const cancellationNote=job.cancellation?.remote==='unconfirmed' ? (state.locale==='en'?"Local task stopped. The model server's internal cancellation is unconfirmed.":"Der Auftrag wurde lokal gestoppt. Ob der Modellserver seine Berechnung beendet hat, ist unbestätigt.") : "";
  const suffix = [job.error,cancellationNote].filter(Boolean).map(text=>`\n\n${text}`).join("");
  const en=state.locale==='en',waiting=job.status==='waiting-user';
  const statusNote = live||waiting
    ? ""
    : job.execution
      ? en?'\n\nChanges and actual verification results are listed below.':"\n\nDateiänderungen und tatsächliche Prüfergebnisse stehen unten."
      : en?'\n\nDrafts can be reviewed and applied below. Execution and services have not been tested.':"\n\nDateientwürfe können unten geprüft und übernommen werden. Ausführung und Dienste wurden nicht getestet.";
  const run=job.pendingRun||job.lastRun;
  const lastRun=run?{id:run.id,ok:run.ok===true,path:run.path||'',stdout:run.stdout||'',stderr:run.stderr||'',attempt:run.attempt||1,max:run.max||1,running:run.running===true}:undefined;
  const before:Record<string,string>={},after:Record<string,string>={};
  for(const [p,d]of Object.entries(job.drafts)){if(d.before!==null)before[p]=d.before;if(d.after!==null)after[p]=d.after;}
  const draftStamp=JSON.stringify([job.restored,Object.entries(job.drafts).map(([p,d])=>[p,d.version??contentVersion(`${d.before}\0${d.after}`)])]);
  const sameDrafts=previousMessage?.backgroundDraftStamp===draftStamp;
  const changes=sameDrafts?previousMessage.changes:snapshotDiff(before,after);
  let budget=64000;
  const backgroundDiffs=sameDrafts?previousMessage.backgroundDiffs:Object.fromEntries((changes||[]).slice(0,32).map(c=>{
    const rows=diffPreview(before[c.path]||'',after[c.path]||'',2,80).flatMap(row=>{if(budget<=0)return[];const text=row.text.slice(0,Math.min(1500,budget));budget-=text.length;return[{...row,text}];});
    return[c.path,rows];
  }));
  const reasons:Record<string,string>={'no-progress':en?'No further progress':'Kein weiterer Fortschritt','round-limit':en?'Round limit reached':'Rundenlimit erreicht','tool-limit':en?'Tool limit reached':'Werkzeuglimit erreicht'};
  const incompleteReason=job.stopReason?(reasons[job.stopReason]||job.stopReason):(job.status==='failed'?en?'Failed':'Fehlgeschlagen':job.status==='interrupted'?en?'Interrupted':'Unterbrochen':undefined);
  const assistant = {
    ...previousMessage,
    id: assistantId,
    backgroundJobId:job.id,
    backgroundWaiting:Boolean(waiting),
    role: "assistant" as const,
    at: job.startedAt,
    content: `${job.text || (live ? en?'Background task running…':"Hintergrundauftrag läuft …" : waiting?en?'Your answer is needed.':'Deine Antwort wird benötigt.':en?'Background task ended.':"Hintergrundauftrag beendet.")}${suffix}${statusNote}`,
    thinking: job.thinking,
    workflow: job.workflow,
    acceptance: job.acceptance,
    skillSelection: job.skillSelection || previousMessage?.skillSelection,
    steps: [...job.steps,...(previousMessage?.steps||[]).filter(s=>s.id.startsWith('background-helper-'))],
    plan: job.plan,
    ms:live||waiting?undefined:Math.max(0,(job.finishedAt||job.startedAt)-job.startedAt),
    tools:job.tools,
    lastRun,
    changes,backgroundDraftStamp:draftStamp,backgroundDiffs,
    incompleteReason,
    harness:waiting?en?'Waiting for your answer':'Wartet auf deine Antwort':live?job.harness:finishedHarness(job.harness,job.plan,job.status==='stopped',state.locale,incompleteReason),
    backgroundFinalized:previousMessage?.backgroundFinalized||(!live&&job.status!=='waiting-user'),
    backgroundEvents:[...emitted].slice(-1000),
  };
  const completedRun=job.lastRun;
  const runKey=completedRun?.eventId||(completedRun?.id?`${job.id}:run:${completedRun.id}`:undefined);
  if(completedRun&&runKey&&!emitted.has(runKey)){
    emitted.add(runKey);assistant.backgroundEvents=[...emitted].slice(-1000);
    state.pushOutput({ok:completedRun.ok===true,stdout:completedRun.stdout||'',stderr:completedRun.stderr||'',duration:(completedRun.duration||0)/1000,label:completedRun.path||'Background'});
    events.push({name:'run',key:runKey,payload:completedRun});
    const hits=parseTests(completedRun.stdout||'',completedRun.stderr||'',{...state.files,...after});
    if(hits.length){state.mergeTestResults(hits);const ran=hits.filter(h=>!h.skip);assistant.lastTests={ok:completedRun.ok===true&&ran.every(h=>h.ok),pass:ran.filter(h=>h.ok).length,fail:ran.filter(h=>!h.ok).length};}
  }
  const previousChat=state.chat.map(message=>job.resumedFrom&&message.backgroundJobId===job.resumedFrom
    ? {...message,backgroundWaiting:false,backgroundContinued:true,backgroundFinalized:true}
    : message);
  useIde.setState({
    chat: found
      ? previousChat.map((message) => (message.id === assistantId ? assistant : message))
      : [
          ...previousChat,
          { id: `background-user-${job.id}`, role: "user", content: job.prompt, images: job.images, at: job.startedAt },
          assistant,
        ],
  });
  for(const event of events)emitPlugin(event.name,event.payload);
  if(job.lastDiagnostics?.hits&&job.lastDiagnostics.versions){
    const diagnostics=job.lastDiagnostics,latest=useIde.getState();
    const valid=new Set(Object.entries(diagnostics.versions!).filter(([p,v])=>typeof latest.files[p]==='string'&&contentVersion(latest.files[p])===v&&!latest.dirty[p]).map(([p])=>p));
    const retained=latest.compileProblems.filter(h=>!valid.has(h.path)||!h.source?.startsWith('background:'));
    const next=[...retained,...diagnostics.hits!.filter(h=>valid.has(h.path)).map(h=>({...h,source:`background:${h.source||'check'}`}))];
    if(JSON.stringify(next)!==JSON.stringify(latest.compileProblems))latest.setCompileProblems(next);
  }
  if(!live&&!previousMessage?.backgroundFinalized){
    if(job.capabilities&&job.modelTarget)setCap(job.modelTarget.provider,job.modelTarget.model,job.capabilities,job.modelTarget.baseUrl);
    const final=useIde.getState();
    if(job.toolLearning&&job.modelTarget){
      const key=toolTargetKey(job.modelTarget.provider,job.modelTarget.model,job.modelTarget.baseUrl);
      const initial=job.toolLearningInitial||{rules:[]};
      final.updateToolLearning(key,current=>({...current,rules:[...current.rules.map(rule=>{
        const before=initial.rules.find(r=>r.id===rule.id),next=job.toolLearning?.rules.find(r=>r.id===rule.id);
        return before&&next&&JSON.stringify(before)===JSON.stringify(rule)?next:rule;
      }),...job.toolLearning!.rules.filter(rule=>!initial.rules.some(r=>r.id===rule.id)&&!current.rules.some(r=>r.id===rule.id))]}));
    }
    if(!waiting){
    useIde.setState({sessionJournal:mergeJournal(final.sessionJournal,extractJournal(final.chat,final.sessionJournal))});
    const epoch=final.workspaceEpoch;
    void brainDistill(job.prompt,job.text);
    void brainFollowups(job.prompt,job.text);
    void brainReview(Object.entries(job.drafts).map(([path,d])=>({path,before:d.before||'',after:d.after||''}))).then(note=>{
      if(!note||epoch!==useIde.getState().workspaceEpoch)return;
      useIde.setState(s=>({chat:s.chat.map(m=>m.id===assistantId?{...m,steps:[...(m.steps||[]),{id:`background-helper-${job.id}`,name:'Helfer-Hinweis',detail:note,status:'ok' as const}]}:m)}));
    }).catch(()=>{});
    }
  }
  if(live||wasOwned||!useIde.getState().agentBusy)useRequestState.setState({
    phase: live
      ? job.phase?.phase || (job.steps.at(-1)?.status === "run" ? "tool" : "waiting")
      : job.status === 'waiting-user' ? 'waiting' : job.status === "done"
        ? "done"
        : job.status === "stopped"
          ? "stopped"
          : "error",
    detail: live ? "Hintergrund-Test" : "",
    at: job.phase?.since||job.finishedAt||job.startedAt,
  });
  return true;
}

export function startBackgroundAgentMonitor() {
  if (!native()?.agentJob) return () => {};
  const unregisterStop = registerAgentStopHandler(() => {
    if (!backgroundRunning()&&!starting) return false;
    void stopBackgroundAgent();
    return true;
  });
  let closed = false,
    timer: ReturnType<typeof setTimeout>;
  // The first poll of each connection and every recovery request a full state,
  // even when this renderer still holds a previous connection's cached job.
  let fullSnapshotNeeded = true;
  const syncPermissions = () => {
    if(!useLearn.persist.hasHydrated())return;
    const requestedJobId = useBackgroundAgent.getState().job?.id ?? null;
    try {
      void native()!.agentJob!("permissions", {
        services: backgroundMcpServers(),
        surface: backgroundSurface(),
        knowledge:foregroundKnowledgePermissions(),
      })
        .then((reply) => {
          if (!closed && !accept(reply, requestedJobId)) fullSnapshotNeeded = true;
        })
        .catch(() => {});
    } catch {
      void native()!.agentJob!("stop")
        .then((reply) => {
          if (!closed && !accept(reply, requestedJobId)) fullSnapshotNeeded = true;
        })
        .catch(() => {});
    }
  };
  const offSettings = useIde.subscribe((s, prev) => {
    if(s.workspaceCwd!==prev.workspaceCwd||s.memoryWorkspace!==prev.memoryWorkspace||s.workspaceEpoch!==prev.workspaceEpoch){
      queueMicrotask(()=>{if(!closed)accept({state:useBackgroundAgent.getState().job});});
    }
    if (
      s.mcpServers !== prev.mcpServers ||
      s.activeSurfaceId !== prev.activeSurfaceId ||
      s.surfaceMode !== prev.surfaceMode
    )
      syncPermissions();
  });
  window.addEventListener("anvil-secret-status", syncPermissions);
  const offLearn=useLearn.subscribe((state,previous)=>{if(state.on!==previous.on||state.prefs!==previous.prefs||state.disabledSkills!==previous.disabledSkills)syncPermissions();});
  const offHydrate=useLearn.persist.onFinishHydration(()=>syncPermissions());
  const poll = async () => {
    try {
      const job = useBackgroundAgent.getState().job;
      const known = fullSnapshotNeeded ? {} : { id: job?.id, revision: job?.revision, draftRevision: job?.draftRevision };
      const reply = await native()!.agentJob!("status", known);
      if (!closed) fullSnapshotNeeded = !accept(reply, job?.id ?? null);
    } catch {
      fullSnapshotNeeded = true;
      if (!closed)
        useBackgroundAgent.setState({
          error:
            "Verbindung zum Hintergrundauftrag unterbrochen. Erneute Verbindung wird versucht.",
        });
    }
    if (!closed) timer = setTimeout(poll, 500);
  };
  void poll();
  syncPermissions();
  return () => {
    closed = true;
    clearTimeout(timer);
    unregisterStop();
    offSettings();
    offLearn();offHydrate();
    window.removeEventListener("anvil-secret-status", syncPermissions);
  };
}

export function trySendBackground(
  input: {
    preset?: string;
    draft: string;
    images: string[];
    setDraft: (s: string) => void;
    setImages: (s: string[]) => void;
    setMention: (s: string | null) => void;
    onAccepted?:()=>void;
  },
  mode?: string,
  resume?: {id:string;reviewed:boolean;skipUnconfirmed?:boolean;answer?:{askId:string;choiceId?:string;text?:string}},
): boolean | Promise<boolean> {
  let st = useIde.getState();
  if (st.pathOperation) {
    st.setNotice(st.locale === "en" ? "Project files are being updated. Wait until this finishes. Your draft is kept." : "Die Projektdateien werden gerade geändert. Warte, bis der Vorgang abgeschlossen ist. Dein Entwurf bleibt erhalten.");
    return true;
  }
  if (!st.backgroundAgent && !backgroundRunning() && !starting && !resume) return false;
  if (backgroundRunning() || starting) {
    if(!input.onAccepted&&!input.images.length&&(input.preset??input.draft).trim()){
      st.pushAgent((input.preset??input.draft).trim(),false,mode==='ask'?'ask':'agent');
      input.setDraft('');input.setMention(null);return true;
    }
    st.setNotice(
      "Ein Hintergrundauftrag läuft bereits. Warte auf den Abschluss oder stoppe ihn. Deine Eingabe bleibt erhalten.",
    );
    return true;
  }
  if (mode === "ask" || (!mode && st.agentMode === "ask")) return false;
  if (st.agentBusy) {
    st.setNotice("Warte auf den Abschluss des laufenden Auftrags oder stoppe ihn.");
    return true;
  }
  const prompt = (input.preset ?? input.draft).trim() || (input.images.length ? st.locale==='en'?'Describe the attached image.':'Beschreibe das angehängte Bild.':'');
  if (!prompt) return true;
  const imageError=imageAttachmentError({provider:st.llmProvider,authMode:st.llmAuthMode,baseUrl:st.llmBaseUrl,model:st.llmModel},input.images.length,st.locale);
  if(imageError){st.setNotice(imageError);return true;}
  const { job, available } = useBackgroundAgent.getState();
  if (job && !job.dismissed && !resume) {
    st.setNotice(
      "Vor dem nächsten Hintergrundauftrag die bisherigen Entwürfe prüfen und „Abschließen“ wählen.",
    );
    return true;
  }
  if (!available || !native()?.agentJob) {
    st.setNotice(
      "Der Hintergrundbetrieb ist in dieser Version noch nicht verfügbar. Starte die aktuelle Desktop-Version von Anvil.",
    );
    return true;
  }
  let cliKind = cliKindFor(st.llmProvider, st.llmAuthMode);
  if (
    (!cliKind &&
      (st.llmAuthMode !== "key" ||
        !["ollama", "lmstudio", "llamacpp", "vllm", "localai", "custom", "qwen", "deepseek"].includes(st.llmProvider)))
  ) {
    st.setNotice(
      "Wähle für den Hintergrundbetrieb eine lokale API, Qwen AI, DeepSeek oder eine CLI-Verbindung.",
    );
    return true;
  }
  starting = true;
  const project = backgroundProject();
  const generation=++startGeneration;
  const assertActive=()=>{if(generation!==startGeneration)throw new Error(st.locale==='en'?'Start cancelled. Input retained.':'Start abgebrochen. Eingabe bleibt erhalten.');};
  st.setAgentBusy(true);
  return (async () => {
  try {
    // Persist the project identity and the user's input files before the job can
    // outlive this renderer. Reconnection must never attach to a fresh RAM ID.
    await flushDiskSync();
    assertActive();
    const writeThrough =
      st.backgroundWriteThrough &&
      (st.activeSurfaceId === "anvil" || !st.activeSurfaceId || st.surfaceMode === "bridge");
    if (
      writeThrough &&
      (!st.workspaceCwd ||
        Object.values(useIde.getState().dirty).some(Boolean) ||
        useIde.getState().pendingDiffs.length)
    )
      throw new Error(
        "Öffne zum direkten Speichern einen Projektordner. Prüfe und speichere zuerst die offenen Änderungen.",
      );
    await (await import("./persist-storage")).flushPersistence();
    assertActive();
    if (project !== backgroundProject())
      throw new Error("Projekt inzwischen gewechselt. Auftrag erneut senden.");
    st = useIde.getState();
    const context=await prepareBackgroundContext(prompt,input.images);
    assertActive();
    if(project!==backgroundProject())throw new Error('Projekt inzwischen gewechselt.');
    cliKind = cliKindFor(st.llmProvider, st.llmAuthMode);
    if (
      !cliKind &&
      (st.llmAuthMode !== "key" ||
        !["ollama", "lmstudio", "llamacpp", "vllm", "localai", "custom", "qwen", "deepseek"].includes(st.llmProvider))
    )
      throw new Error("Modellverbindung inzwischen geändert. Auftrag erneut senden.");
    const reply = await native()!.agentJob!(resume?'resume':"start", {
      resumeId:resume?.id,reviewed:resume?.reviewed,skipUnconfirmed:resume?.skipUnconfirmed,answer:resume?.answer,
      services: backgroundMcpServers(true),
      surface: backgroundSurface(),
      project,
      userPrompt:scrubSecrets(prompt).text,userImages:input.images.slice(0,4),
      ...context,
      inputMap:st.inputMap,
      format:{tabSize:st.tabSize,insertSpaces:st.insertSpaces},
      debug:{breakpoints:st.breakpoints,watches:st.debug.watches},
      toolLearning:st.llmToolLearning[toolTargetKey(st.llmProvider,st.llmModel,normalizeBaseUrl(st.llmBaseUrl||providerOf(st.llmProvider).baseUrl))]||{rules:[]},
      automation:{runLoop:st.runLoop,graphLoop:st.graphLoop,testLoop:st.testLoop,engineLoop:st.engineLoop,loopTries:st.loopTries,afterWrite:st.harnessAfterWrite,graphSees:st.graphSees,autoRunAgent:st.autoRunAgent},
      effectiveSettings:{thinking:st.llmThinking,compact:st.llmCompact,retries:st.llmRetries,runLoop:st.runLoop,graphLoop:st.graphLoop},
      execution: true,
      writeThrough,
      locale: st.locale,
      maxRounds: st.harnessMaxRounds,
      autoContinue: st.harnessAutoContinue,
      files: Object.fromEntries(Object.entries(st.files).filter(([path]) => !isSecretPath(path))),
      dirs:st.dirs,
      model: {
        vision: context.vision,
        retries:st.llmRetries,
        capabilities:getCap(st.llmProvider,st.llmModel,normalizeBaseUrl(st.llmBaseUrl||providerOf(st.llmProvider).baseUrl)),
        cliKind,
        provider: st.llmProvider,
        baseUrl: normalizeBaseUrl(st.llmBaseUrl || providerOf(st.llmProvider).baseUrl),
        model: st.llmModel || providerOf(st.llmProvider).model,
        apiKey: cliKind ? "" : st.llmApiKey,
        context: st.llmContext,
        thinking: st.llmThinking,
        temperature: st.llmTemperature,
        maxOut: st.llmMaxOut,
        hardStopMin: st.llmHardStopMin,
        toolMode: toolCompatibility(
          st.llmToolModes[
            toolTargetKey(
              st.llmProvider,
              st.llmModel,
              st.llmBaseUrl || providerOf(st.llmProvider).baseUrl,
            )
          ],
        ),
      },
    });
    if(reply.error||!reply.state)throw new Error(reply.error||'Hintergrundauftrag wurde nicht angenommen.');
    useBackgroundAgent.setState({startFailure:null});
    if(generation!==startGeneration){accept(reply);accept(await native()!.agentJob!('stop'));assertActive();}
    beginAgent();
    accept(reply);
    input.onAccepted?.();
    st.setPendingAsk(null);
    useBrain.getState().setFollowups([]);
    emitPlugin('agent',prompt);
    input.setDraft("");
    input.setImages([]);
    input.setMention(null);
  } catch (error) {
    const message=scrubSecrets(error instanceof Error ? error.message : String(error)).text;
    if(generation===startGeneration){
      useBackgroundAgent.setState({startFailure:{project,message,at:Date.now()}});
      appLog('agent-start',message);
    }
    st.setNotice(message);
  } finally {
    starting = false;
    if(!backgroundRunning())useIde.getState().setAgentBusy(false);
  }
  return true;
  })();
}

export async function reviewBackgroundOperation(operationId:string,outcome:'confirmed'|'not-executed',note:string){
  const job=useBackgroundAgent.getState().job,project=backgroundProject();
  if(!job||backgroundRunning(job)||job.project!==project)return;
  try{accept(await native()!.agentJob!('operation-review',{id:job.id,project,operationId,outcome,note}),job.id);}
  catch(error){useBackgroundAgent.setState({error:scrubSecrets(error instanceof Error?error.message:String(error)).text});}
}

export async function resumeBackgroundJob(reviewed=false,answer?:{askId:string;choiceId?:string;text?:string}){
  const job=useBackgroundAgent.getState().job,st=useIde.getState();if(!job||backgroundRunning(job))return;
  if(Object.values(st.dirty).some(Boolean)||st.pendingDiffs.length){st.setNotice('Offene Änderungen zuerst speichern oder verwerfen.');return;}
  await trySendBackground({draft:job.prompt,images:job.images||[],setDraft:()=>{},setImages:()=>{},setMention:()=>{}},'agent',{id:job.id,reviewed,skipUnconfirmed:true,answer});
}

export async function stopBackgroundAgent() {
  if(starting){startGeneration++;useIde.getState().setAgentBusy(false);useRequestState.setState({phase:'stopped',detail:'',at:Date.now()});if(!backgroundRunning())return true;}
  if (!backgroundRunning()) return false;
  try {
    accept(await native()!.agentJob!("stop"));
  } catch {
    useIde.getState().setNotice("Anvil konnte nicht bestätigen, dass der Auftrag gestoppt wurde. Versuche es erneut.");
  }
  return true;
}

export async function applyBackgroundDrafts() {
  const job = useBackgroundAgent.getState().job,
    st = useIde.getState();
  if (!job || backgroundRunning(job)) return;
  if (job.project !== backgroundProject()) {
    st.setNotice("Zuerst das Projekt dieses Hintergrundauftrags öffnen.");
    return;
  }
  const changes: Record<string, string> = {},
    conflicts: string[] = [];
  for (const [path, draft] of Object.entries(job.drafts)) {
    if (draft.applied) continue;
    if (st.files[path] === draft.after) continue;
    if (
      (st.files[path] ?? null) !== draft.before ||
      st.pendingDiffs.some((diff) => diff.path === path)
    )
      conflicts.push(path);
    else if(draft.after!==null) changes[path] = draft.after;
  }
  if (conflicts.length) {
    st.setNotice(
      `Entwürfe nicht übernommen: inzwischen geänderte Dateien (${conflicts.join(", ")}). Deine Änderungen bleiben erhalten.`,
    );
    return;
  }
  if(Object.values(job.drafts).some(d=>d.after===null)||Object.keys(job.directoryChanges||{}).length){
    if(Object.values(st.dirty).some(Boolean)||st.pendingDiffs.length){st.setNotice('Offene Änderungen zuerst speichern oder verwerfen.');return;}
    try{accept(await native()!.agentJob!('apply',{id:job.id}));st.setNotice('Geprüfte Datei- und Ordneränderungen übernommen. Wiederherstellung bleibt verfügbar.');}catch(e){st.setNotice(String(e));}
  }else {if (Object.keys(changes).length) st.patchFiles(changes);st.setNotice("Entwürfe zur Prüfung im Editor geöffnet. Änderungen annehmen oder verwerfen.");}
}

export async function restoreBackgroundFiles(){
  const job=useBackgroundAgent.getState().job,st=useIde.getState();if(!job||backgroundRunning(job))return;
  if(job.project!==backgroundProject()||Object.values(st.dirty).some(Boolean)||st.pendingDiffs.length){st.setNotice('Projekt öffnen und offene Änderungen zuerst speichern oder verwerfen.');return;}
  try{accept(await native()!.agentJob!('restore',{id:job.id}));st.setNotice('Dateistand vor dem Auftrag wiederhergestellt. Externe Aktionen und Git-Commits bleiben bestehen.');}catch(e){st.setNotice(String(e));}
}

export async function dismissBackgroundJob() {
  const job = useBackgroundAgent.getState().job;
  if (!job || backgroundRunning(job)) return;
  try {
    accept(await native()!.agentJob!("dismiss", { id: job.id }));
  } catch (error) {
    useIde.getState().setNotice(String(error));
  }
}
