import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { safeAgentPath,readAgentProjectFile } from './agent-project-runtime.mjs';
import {validFileProtection,observeFileChange} from './file-protection.mjs';
import { validateCliImages } from './cli-images.mjs';
import { planFileAction,applyFileChanges,diskMatches,safePath as filePath } from './agent-file-actions.mjs';
import { resolveCwd } from '../companion/git.mjs';
import { withLoadedSkill } from './skill-access.mjs';
import { validWorkflowSnapshot, workflowJournalPath, writeWorkflowJournal } from './workflow-journal.mjs';
import { interruptWorkflow } from './workflow-validation.mjs';
import { captureAgentFailure, modelFailureMessage, withModelFailureContext } from './agent-failure.mjs';
import { withoutLegacyAcceptancePrefix, withoutLegacyApprovalError } from './agent-output.mjs';
import { ReviewArtifactStore } from './review-artifacts.mjs';
import { ToolRejection } from './tool-rejection.mjs';

const TERMINAL = new Set(['done', 'failed', 'stopped', 'interrupted','waiting-user']);
const MAX_BYTES = 24 * 1024 * 1024;
const REQUEST_MAX_BYTES = 12 * 1024 * 1024;
const STEERING_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const safePath = safeAgentPath;
function steeringImages(images = []) {
  if(!Array.isArray(images)||images.length>4)throw Error('Eine Korrektur kann höchstens vier Bilder enthalten.');
  const urls=Array.from(images);
  try{validateCliImages(urls);}catch(error){throw Error(String(error.message).replaceAll('CLI-',''));}
  return urls;
}
function restoredSteeringImages(images) {
  try{return steeringImages(images);}catch{return [];}
}
function steeringPayload({id,text,createdAt,images}) {
  return {id,text,createdAt,...(images?.length?{images}:{})};
}
function sameImages(a=[],b=[]) {
  return a.length===b.length&&a.every((image,index)=>image===b[index]);
}
function imageCorrectionRecords(records) {
  return (Array.isArray(records)?records:[]).slice(-256).flatMap(record=>{
    if(typeof record?.text!=='string'||!record.text.trim()||record.text.length>8000)return [];
    const images=restoredSteeringImages(record.images);
    return images.length?[{text:record.text,images}]:[];
  });
}
function recoverImageCorrectionMessages(context,corrections) {
  const available=new Set(context.filter(message=>message.role==='user'&&message.images?.length));
  const unmatched=new Set(corrections);
  const bind=(record,matches)=>{
    for(const message of available){
      if(message.content.replace(/^(?:Korrektur|Correction):\s*/,'')!==record.text||!matches(message,record.images))continue;
      message.images=record.images;
      available.delete(message);
      unmatched.delete(record);
      break;
    }
  };
  for(const record of corrections)bind(record,(message,images)=>sameImages(message.images,images));
  // Chat persistence may retain only a prefix of the original image list.
  for(const record of unmatched)bind(record,(message,images)=>/^(?:Korrektur|Correction):\s*/.test(message.content)&&message.images.length<images.length&&message.images.every((image,index)=>image===images[index]));
  return [...unmatched].map(({text,images})=>({role:'user',content:text,images}));
}
function protectedFiles(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>64
    ||!Object.entries(value).every(([path,p])=>safePath(path)&&validFileProtection(p))
    ||Buffer.byteLength(JSON.stringify(value))>8*1024*1024)throw Error('Gesicherter Dateikonfliktschutz ist ungültig oder zu groß.');
  return structuredClone(value);
}
function lastAcknowledgedSource(job,path) {
  const last=job.steps.findLast(step=>step.path===path&&step.status==='ok'&&['write_file','edit_file','append_file','format_file'].includes(step.name));
  // Only an untruncated complete write is a usable legacy before-image.
  return last?.name==='write_file'&&typeof last.code==='string'&&last.code.length<12000?last.code:undefined;
}
const tokenNumber=value=>Number.isSafeInteger(value)&&value>=0;
const validRequestTokens=value=>value&&tokenNumber(value.prompt)&&tokenNumber(value.limit)&&value.limit>0&&typeof value.estimated==='boolean';
const PHASES=new Set(['preparing','waiting','thinking','answering','tool']);
function verificationResult(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||!['none','passed','failed','stale'].includes(value.state))return;
  const result={state:value.state,detail:typeof value.detail==='string'?value.detail.slice(0,16000):''};
  if(typeof value.tests==='boolean')result.tests=value.tests;
  if(['execution','tests','render','interaction'].includes(value.scope))result.scope=value.scope;
  if(Array.isArray(value.limitations))result.limitations=value.limitations.filter(item=>typeof item==='string'&&item.trim()).slice(0,8).map(item=>item.slice(0,2000));
  // This describes a completed observation task, never a successful program run.
  if(value.state==='failed'&&typeof value.observedFailure==='boolean')result.observedFailure=value.observedFailure;
  return result;
}
function stepDetails(message){
  const out={detail:String(message.detail||'').slice(0,4000)};
  for(const field of ['path','code','before'])if(typeof message[field]==='string')out[field]=message[field].slice(0,field==='path'?2000:12000);
  if(typeof message.image==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/.test(message.image)&&message.image.length<=1024*1024)out.image=message.image;
  return out;
}

/** One job, owned by the app process; renderer connections never own its lifetime. */
export class AgentJobHost extends EventEmitter {
  constructor({ launch, snapshotPath, runtime, artifactRoot }) {
    super(); this.launch = launch; this.snapshotPath = snapshotPath; this.runtime = runtime;
    this.reviewArtifacts=new ReviewArtifactStore({storageRoot:artifactRoot||dirname(snapshotPath)});
    this.operation = null; this.controller = new AbortController(); this.lastOperation = null;
    this.child = null; this.state = null; this.base = {}; this.persistTimer = null; this.killTimer = null;
    this.manualOperation=null;
    if(this.runtime)this.runtime.onDebug=(debug,id)=>{
      if(this.state?.id!==id)return;
      this.state.lastDebug=debug;this.touch();
    };
    try {
      if (statSync(snapshotPath).size > MAX_BYTES) throw new Error('snapshot too large');
      const raw = readFileSync(snapshotPath, 'utf8');
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('snapshot too large');
      const state = JSON.parse(raw);
      if (state.schema !== 1 || typeof state.id !== 'string' || !state.drafts || !Array.isArray(state.steps)) throw new Error('invalid snapshot');
      if (typeof state.project !== 'string' || !Number.isSafeInteger(state.revision) ||
          !Object.entries(state.drafts).every(([p, draft]) => safePath(p) && draft && (draft.before === null || typeof draft.before === 'string') && (draft.after===null || typeof draft.after === 'string'))) throw new Error('invalid draft');
      state.fileProtections=protectedFiles(state.fileProtections);
      this.state = state;
      state.steering = Array.isArray(state.steering) ? state.steering.filter(m=>m&&/^[-\w:.]{1,120}$/.test(m.id)&&typeof m.text==='string'&&m.text.trim()&&m.text.length<=8000&&['queued','applied','rejected'].includes(m.status)).slice(-256).map(({images,...entry})=>{
        const valid=restoredSteeringImages(images);
        return valid.length?{...entry,images:valid}:entry;
      }) : [];
      if(Object.hasOwn(state,'resumedImageCorrections'))state.resumedImageCorrections=imageCorrectionRecords(state.resumedImageCorrections);
      if(Object.hasOwn(state,'verification')) {
        const verification=verificationResult(state.verification);
        if(verification)state.verification=verification;else delete state.verification;
      }
      if(!validWorkflowSnapshot(state.workflow))delete state.workflow;
      if (Object.hasOwn(state, 'acceptance')) {
        state.text = withoutLegacyAcceptancePrefix(state.text);
        state.error = withoutLegacyApprovalError(state.error);
      }
      delete state.acceptance;
      delete state.recoveryBlockedActions;
      delete state.blockedMutations;
      state.draftRevision = tokenNumber(state.draftRevision) ? state.draftRevision : 0;
      if(state.lastDebug?.active){state.lastDebug={...state.lastDebug,active:false,paused:false,reason:'Debug-Sitzung durch Programmende beendet.'};this.touch();this.persist();}
      if (!TERMINAL.has(state.status)) {
        if(state.workflow)state.workflow=interruptWorkflow(state.workflow);
        state.status = 'interrupted'; state.error = 'Anvil wurde beendet. Gesicherte Entwürfe bleiben erhalten; der Auftrag wurde nicht erneut ausgeführt.';
        state.finishedAt=Date.now();
        if (state.operation?.status === 'pending') {
          state.operation.status = 'interrupted';
          state.error += state.operation.kind==='mcp' ? ' Eine frühere Dienstaktion hat keine abschließende Rückmeldung. Beim Fortsetzen prüft der Agent den aktuellen Stand; alte Aufrufe werden nicht automatisch wiederholt.' : ' Der Abschluss der letzten Aktion ist unbestätigt. Beim Fortsetzen prüft der Agent den aktuellen Stand selbst.';
        }
        this.touch(); this.persist();
      }
    } catch (error) { if (error.code !== 'ENOENT') this.recoveryError = 'Gesicherter Hintergrundauftrag konnte nicht gelesen werden.'; }
  }
  busy() { return Boolean(this.operation || this.manualOperation || (this.child && !TERMINAL.has(this.state?.status))); }
  cleanRuntime(method = 'close') {
    const result=this.runtime?.[method]?.();
    if(!result?.then)return this.cleanup;
    const pending=Promise.allSettled([this.cleanup,result]);
    this.cleanup=pending;
    pending.finally(()=>{if(this.cleanup===pending)this.cleanup=null;});
    return pending;
  }
  async waitForCleanup() { while(this.cleanup)await this.cleanup; }
  touch(persist = true, draftsChanged = false) {
    if (draftsChanged) this.state.draftRevision = (this.state.draftRevision || 0) + 1;
    this.state.revision++; this.state.updatedAt = Date.now();
    this.emit('change');
    if (persist && !this.persistTimer) this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persist(); }, 500);
  }
  persist() {
    if (!this.state) return;
    try {
      const raw = JSON.stringify(this.state);
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('snapshot too large');
      mkdirSync(dirname(this.snapshotPath), { recursive: true });
      const fd = openSync(this.snapshotPath + '.tmp','w',0o600);
      try { writeFileSync(fd,raw);fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(this.snapshotPath + '.tmp', this.snapshotPath);
    } catch {
      this.state.persistenceError = 'Hintergrundauftrag konnte nicht gesichert werden. Anvil geöffnet lassen und Entwürfe übernehmen.';
      this.emit('change');
      if (this.busy() && !this.controller.signal.aborted) this.stop('Speicherung fehlgeschlagen. Auftrag angehalten.');
    }
  }
  snapshot(knownId, knownRevision, knownDraftRevision) {
    if (!this.state) return { state: null, error: this.recoveryError };
    const events=this.runtime?.knowledgeEvents?.()||[];
    if(JSON.stringify(events)!==JSON.stringify(this.state.knowledgeEvents||[])){
      this.state.knowledgeEvents=events;this.touch();
    }
    const sameJob = knownId === this.state.id;
    const sameDrafts = sameJob && tokenNumber(knownDraftRevision) && knownDraftRevision === this.state.draftRevision;
    // Two-argument callers retain the original whole-state revision protocol.
    // Omitting drafts requires the newer, explicit draft revision acknowledgement.
    if (sameJob && knownRevision === this.state.revision && (knownDraftRevision === undefined || sameDrafts)) return { unchanged: true };
    if (sameDrafts) {
      const { drafts: _drafts,fileProtections:_protected, ...state } = this.state;
      return { state: structuredClone(state), draftsUnchanged: true };
    }
    const {fileProtections:_protected,...visible}=this.state;
    return { state: structuredClone(visible) };
  }
  start(request, {resumedImageCorrections}={}) {
    if (this.busy()) throw new Error('Ein Hintergrundauftrag läuft bereits. Erst stoppen oder abschließen lassen.');
    if(this.cleanup)throw new Error('Der vorige Auftrag wird noch aufgeräumt. Bitte kurz warten.');
    if (!request?.model || !request.model.model || !Array.isArray(request.messages) || !request.messages.length || !request.files || typeof request.files !== 'object') throw new Error('Ungültiger Hintergrundauftrag.');
    if (Buffer.byteLength(JSON.stringify(request)) > REQUEST_MAX_BYTES) throw new Error('Für den Hintergrund-Test höchstens 12 MB Projekt und Verlauf auswählen.');
    for(const message of request.messages) {
      if(!message || !['user','assistant'].includes(message.role) || typeof message.content!=='string')throw new Error('Ungültiger Auftragsverlauf.');
      try{validateCliImages(message.images);}catch(error){throw new Error(String(error.message).replaceAll('CLI','Hintergrund'));}
    }
    const files = Object.fromEntries(Object.entries(request.files).filter(([p, c]) => safePath(p) && typeof c === 'string'));
    // Project workflow rules are data. Worker and host capabilities remain fixed.
    const id = randomUUID();
    if (request.execution && !this.runtime) throw new Error('Hintergrund-Ausführung fehlt.');
    if (request.writeThrough && !request.execution) throw new Error('Direktes Speichern benötigt die zweite Hintergrundstufe.');
    if (this.state && !this.state.dismissed) this.archiveJob(this.state);
    this.runtime?.begin({ ...request, files }, id);
    this.skillRecords=request.knowledge?.skills||[];
    this.controller = new AbortController(); this.lastOperation = null;
    this.base = files;
    this.dirs=new Set((request.dirs||[]).filter(filePath));
    for(const p of Object.keys(files)){const parts=p.split('/');while(parts.length>1){parts.pop();this.dirs.add(parts.join('/'));}}
    this.state = { schema: 1, id, revision: 0, draftRevision: 0, project: String(request.project || ''), execution: request.execution === true, writeThrough: request.writeThrough === true,
      prompt: String(request.userPrompt ?? request.messages.at(-1)?.content ?? ''), images: request.userImages ?? request.messages.at(-1)?.images ?? [], status: 'starting', startedAt: Date.now(),
      humanPrompt:String(request.humanPrompt??request.userPrompt??request.messages.at(-1)?.content??''),humanCorrections:(request.humanCorrections||[]).filter(text=>typeof text==='string'&&text.length<=8000).slice(-256),
      locale:request.locale==='en'?'en':'de',modelTarget:{provider:request.model.provider,model:request.model.model,baseUrl:request.model.baseUrl},effectiveSettings:request.effectiveSettings,
      toolLearningInitial:structuredClone(request.toolLearning||{rules:[]}),fileProtections:protectedFiles(request.fileProtections),
      skillSelection:structuredClone(request.skillSelection||[]),
      text: '', thinking: '', steering: [], steps: [], plan: request.resumePlan||request.plan||[], planLocked:request.planLocked===true, mutationLedger:[], directoryChanges:{}, drafts: {}, harness: '', error: '', dismissed: false,
      phase:{phase:'preparing',since:Date.now()},runAttempts:0,runMax:Math.max(1,Math.min(5,Number(request.automation?.loopTries)||3)),
      requestSequence:0,usageSequence:0,requestTokens:null,usage:{prompt:0,completion:0,estimated:false} };
    if(resumedImageCorrections?.length)this.state.resumedImageCorrections=resumedImageCorrections;
    if(validWorkflowSnapshot(request.workflow))this.state.workflow=structuredClone(request.workflow);
    this.state.connection = request.model.cliKind ? `${request.model.cliKind} CLI` : request.model.provider==='qwen' ? 'Qwen AI API' : request.model.provider==='deepseek' ? 'DeepSeek API' : 'Lokale API';
    this.state.services = (request.services||[]).map(s=>({id:s.id,name:s.name}));
    this.touch(); this.persist();
    if (this.state.persistenceError) { this.state.status = 'failed';this.state.finishedAt=Date.now(); this.touch(); return this.snapshot(); }
    try {
      const child = this.launch(); this.child = child;
      child.on('message', message => { if (this.child === child) this.message(message, request, files); });
      child.on('error', () => { if (this.child === child) this.finish('failed', 'Der Hintergrundprozess konnte nicht gestartet werden.'); });
      child.on('exit', () => {
        if (this.child !== child) return;
        this.child = null;
        if (!TERMINAL.has(this.state.status)) this.finish('interrupted', 'Der Hintergrundprozess wurde unerwartet beendet. Gesicherte Entwürfe bleiben erhalten.');
      });
      this.killTimer = setTimeout(() => {
        if (this.child === child && this.state.status === 'starting') this.finish('failed', 'Der Hintergrundprozess antwortet nicht.');
      }, 15000);
    } catch { this.finish('failed', 'Der Hintergrundprozess konnte nicht gestartet werden.'); }
    return this.snapshot();
  }
  message(message, request, files) {
    if (!message || TERMINAL.has(this.state.status)) return;
    if (message.type === 'operation') { this.perform(message); return; }
    if (message.type === 'review-report') {
      const review=message.review;
      if(!request.review||review?.id!==request.review.id||review?.project!==request.project||review?.createdAt!==request.review.createdAt||!Array.isArray(review.files)||!Number.isSafeInteger(review.revision)||Buffer.byteLength(JSON.stringify(review))>2*1024*1024)return;
      const basis=value=>JSON.stringify([value.basisLabel,value.baselineAvailable,value.files.map(file=>[file.path,file.change,file.baseline,file.current])]);
      if(review.revision<=(this.state.review?.revision??request.review.revision)||basis(review)!==basis(request.review))return;
      this.state.review=structuredClone(review);
      const job=this.state,artifactStore=this.reviewArtifacts;
      const fileStamps=Object.fromEntries(review.files.filter(file=>file.current).map(file=>[file.path,file.current.stamp]));
      void artifactStore.save({project:job.project,jobId:job.id,jobVersion:`review:${review.id}:${review.revision}`,kind:'review',mime:'application/json',observation:'review-reported',result:'unknown',origin:{tool:'review_submit',stepId:`review-${review.revision}`,evidenceId:review.files.flatMap(file=>file.evidence||[]).at(-1)?.evidenceId||`report-${review.revision}`},fileStamps,data:JSON.stringify(review)}).then(artifact=>{if(this.state===job){job.reviewArtifact=artifact;this.touch();this.persist();}}).catch(error=>{if(this.state===job){job.reviewArtifactError=String(error.message);this.touch();this.persist();}});
      this.touch();this.persist();return;
    }
    if (message.type === 'ready') {
      if (this.state.status !== 'starting') return;
      clearTimeout(this.killTimer); this.state.status = 'running';
      // Service credentials remain in the app process. The worker only needs IDs.
      const knowledge=request.knowledge&&!request.knowledge.skillBodies?{...request.knowledge,skills:(request.knowledge.skills||[]).map(({body,resourceContents,...skill})=>skill)}:request.knowledge;
      this.child.send({ type: 'start', request: { ...request, humanPrompt:this.state.humanPrompt,humanCorrections:this.state.humanCorrections,workflowId:this.state.id,knowledge,services:this.state.services, files, workspaceOutput:this.runtime?.workspaceOutput } });
      for(const correction of this.state.steering)if(correction.status==='queued')this.child.send({type:'steer',message:steeringPayload(correction)});
    } else if(message.type==='steering-applied') {
      if(!Array.isArray(message.ids))return;
      for(const correction of this.state.steering)if(correction.status==='queued'&&message.ids.includes(correction.id)){correction.status='applied';correction.appliedAt=Date.now();}
    } else if(message.type==='steering-rejected') {
      const correction=this.state.steering.find(item=>item.id===message.id&&item.status==='queued');
      if(!correction)return;
      correction.status='rejected';correction.error=String(message.error||'Korrektur nicht übernommen.').slice(0,1000);
    } else if (message.type === 'request-tokens') {
      if(!Number.isSafeInteger(message.sequence)||message.sequence<1||message.sequence<(this.state.requestSequence||0)||message.sequence<=(this.state.usageSequence||0)||!validRequestTokens(message.requestTokens))return;
      this.state.requestSequence=message.sequence;this.state.requestTokens=message.requestTokens;
      const contract=message.toolContract;
      if(contract&&['native','text'].includes(contract.transport)&&Array.isArray(contract.names)&&contract.names.length<=128&&contract.names.every(name=>typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_.:-]{0,119}$/.test(name))){
        const names=[...new Set(contract.names)],entry={sequence:message.sequence,transport:contract.transport,names,at:Date.now()};
        const previous=this.state.toolContracts?.at(-1);
        if(!previous||previous.sequence!==entry.sequence||previous.transport!==entry.transport||JSON.stringify(previous.names)!==JSON.stringify(names)){
          const history=[...(this.state.toolContracts||[]),entry];
          if(history.length>32)this.state.toolContractsOmitted=(this.state.toolContractsOmitted||0)+history.length-32;
          this.state.toolContracts=history.slice(-32);
        }
      }
    } else if (message.type === 'token-usage') {
      const u=message.usage;
      if(message.sequence!==this.state.requestSequence||message.sequence<=(this.state.usageSequence||0)||!u||!tokenNumber(u.prompt)||!tokenNumber(u.completion)||typeof u.estimated!=='boolean'||!validRequestTokens(message.requestTokens))return;
      if(u.prompt<(this.state.usage?.prompt||0)||u.completion<(this.state.usage?.completion||0))return;
      this.state.usageSequence=message.sequence;this.state.usage=u;this.state.requestTokens=message.requestTokens;
    } else if(message.type==='skill-loaded'){
      const skill=this.skillRecords?.find(skill=>skill.id===message.id);
      if(skill&&request.knowledge?.skillsEnabled&&request.knowledge?.skillBodies&&['skill_read','skill_run'].includes(message.tool))this.state.skillSelection=withLoadedSkill(this.state.skillSelection||[],skill,message.tool);
    } else if(message.type==='phase'){
      if(!PHASES.has(message.phase)||this.state.phase?.phase===message.phase)return;
      this.state.phase={phase:message.phase,since:Date.now()};
    } else if (message.type === 'delta') {
      const field = message.kind === 'think' ? 'thinking' : 'text';
      const value=this.state[field]+String(message.text||''),limit=field==='thinking'?32000:500000;
      if(value.length>limit)this.state[`${field}Truncated`]=true;
      this.state[field] = value.slice(-limit);
    } else if (message.type === 'file') {
      if (!safePath(message.path) || typeof message.content !== 'string') return this.finish('failed', 'Ungültiger Dateientwurf.');
      const old = this.state.drafts[message.path];
      this.state.drafts[message.path] = { before: old ? old.before : this.base[message.path] ?? null, after: message.content,version:this.state.revision+1,eventId:`${this.state.id}:change:${message.path}:${this.state.revision+1}` };
      if (Buffer.byteLength(JSON.stringify(this.state.drafts)) > 16 * 1024 * 1024) {
        if (old) this.state.drafts[message.path] = old; else delete this.state.drafts[message.path];
        return this.finish('failed', 'Speichergrenze der Entwürfe erreicht. Bisherige Entwürfe bleiben erhalten.');
      }
    } else if (message.type === 'tool-start') {
      this.state.steps.push({ id: randomUUID(), name: String(message.name), ...stepDetails(message), status: 'run',at:Date.now() });
      this.state.steps = this.state.steps.slice(-200);
    } else if (message.type === 'tool') {
      const step = this.state.steps.at(-1); if (step&&step.name===message.name&&step.status==='run') {
        Object.assign(step,stepDetails(message),{status:message.ok?'ok':'err',ms:Math.max(0,Date.now()-(step.at||Date.now()))});
        // Keep useful screenshots without allowing long runs to grow snapshots unbounded.
        let imageBytes=0;for(const item of [...this.state.steps].reverse())if(item.image){imageBytes+=item.image.length;if(imageBytes>2*1024*1024)delete item.image;}
      }
      if (Array.isArray(message.plan)) this.state.plan = message.plan;
    } else if(message.type==='diagnostics'){
      if(this.state.operation?.kind!=='verify'||this.state.operation.status!=='done'||typeof message.result?.ok!=='boolean')return;
      this.state.lastDiagnostics={...this.state.lastDiagnostics,ok:message.result.ok,detail:String(message.result.detail||'').slice(0,16000)};
    } else if (message.type === 'harness') this.state.harness = String(message.value);
    else if (message.type === 'result') {
      this.state.text = String(message.result?.reply || '').slice(-500000);
      this.state.textTruncated=String(message.result?.reply||'').length>500000;
      if (Array.isArray(message.result?.plan)) this.state.plan = message.result.plan;
      const result=message.result||{};
      const verification=verificationResult(result.verification);
      if(verification)this.state.verification=verification;
      if(['round-limit','no-progress','tool-limit'].includes(result.stopReason))this.state.stopReason=result.stopReason;
      this.state.compacted=result.compacted===true;
      this.state.tools=Array.isArray(result.tools)?result.tools.filter(v=>typeof v==='string').slice(-200):[];
      if(result.capabilities&&typeof result.capabilities==='object')this.state.capabilities=result.capabilities;
      if(result.toolLearning&&typeof result.toolLearning==='object')this.state.toolLearning=result.toolLearning;
      if(result.parked&&result.ask&&typeof result.ask.prompt==='string'&&Array.isArray(result.ask.choices)){
        this.state.ask=result.ask;this.state.parked=true;this.state.parkedAt=Date.now();
        return this.finish('waiting-user');
      }
      if (Object.hasOwn(result, 'acceptance')) this.state.text = withoutLegacyAcceptancePrefix(this.state.text);
      return this.finish(message.result?.ok ? 'done' : 'failed', String(message.result?.error || ''));
    } else if (message.type === 'failure') {
      this.state.failure=captureAgentFailure(message.failure?.error || new Error(String(message.error || 'Auftrag fehlgeschlagen.')), {
        phase:this.state.phase?.phase,requestSequence:this.state.requestSequence,jobId:this.state.id,
        transport:message.failure?.transport,secrets:[request.model.apiKey] });
      const failure = this.state.failure;
      const error = failure.transport ? withModelFailureContext(failure.error, failure.transport) : failure.error;
      return this.finish(message.stopped ? 'stopped' : 'failed', modelFailureMessage(error));
    }
    // Streaming text stays in the app process. Do not rewrite multi-MB file
    // drafts on every token during an hours-long model response.
    this.touch(message.type !== 'delta' && message.type !== 'harness', message.type === 'file');
    if (message.type === 'file') this.persist();
  }
  perform(message) {
    if(this.manualOperation){const child=this.child;void this.manualOperation.finally(()=>{if(child===this.child&&!this.controller.signal.aborted)this.perform(message);}).catch(()=>{});return;}
    const op = message.operation, id = message.id;
    if (!Number.isSafeInteger(id) || id < 1 || !op || op.kind!=='workflow'&&(!this.state.execution || !this.runtime)) return this.finish('failed', 'Ungültige Hintergrundaktion.');
    const fingerprint = createHash('sha256').update(JSON.stringify(op,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)).digest('hex');
    const mutation=/^(shell|git)$/.test(op.kind)&&op.action!=='status'||op.kind==='mcp'&&op.action==='call'||op.kind==='knowledge'&&['add','forget','write','patch','run','outcome'].includes(op.action)||op.kind==='debug'&&['start','continue','step','eval','watch'].includes(op.action);
    // Exit expectations change validation, not the command's external effects.
    const effectOp=op.kind==='shell'?Object.fromEntries(Object.entries(op).filter(([key])=>key!=='expectedExitCode')):op;
    const effectFingerprint=JSON.stringify(effectOp,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
    const digest=createHash('sha256').update(effectFingerprint).digest('hex');
    if (this.lastOperation?.id === id) {
      if (this.lastOperation.fingerprint !== fingerprint) return this.finish('failed', 'Aktions-ID wurde verändert.');
      if (this.lastOperation.reply) this.child?.send(this.lastOperation.reply);
      return; // Duplicate in-flight request joins the original result.
    }
    if (this.operation || id !== (this.lastOperation?.id || 0) + 1) return this.finish('failed', 'Hintergrundaktionen außerhalb der Reihenfolge.');
    this.lastOperation = { id, fingerprint };
    const child = this.child;
    if(op.kind==='workflow') {
      try {
        if(!validWorkflowSnapshot(op.snapshot))throw Error('Ungültiger Ablaufzustand.');
        const path=workflowJournalPath(join(dirname(this.snapshotPath),'workflows'),this.state.project,op.snapshot.id);
        writeWorkflowJournal(path,op.snapshot);
        this.state.workflow=op.snapshot;
        this.touch();this.persist();
        if(this.state.persistenceError)throw Error('Ablaufzustand konnte nicht gesichert werden.');
        const reply={type:'operation-result',id,result:{ok:true}};this.lastOperation.reply=reply;child.send(reply);
      }catch(error){this.finish('failed',error.message);}
      return;
    }
    const before = this.base[op.path] ?? null;
    let filePlan;
    if(['write','rename','delete','mkdir'].includes(op.kind)){
      try{filePlan=planFileAction(this.base,[...this.dirs],op);}catch(e){return this.finish('failed',e.message);}
    }
    if (op.kind === 'write') {
      if (!safeAgentPath(op.path) || typeof op.content !== 'string') return this.finish('failed', 'Ungültige Dateiänderung.');
      const draft = this.state.drafts[op.path];
      this.state.drafts[op.path] = { before: draft ? draft.before : before, after: op.content, applied: false,version:id,eventId:`${this.state.id}:change:${op.path}:${id}` };
      if (Buffer.byteLength(JSON.stringify(this.state.drafts)) > 16 * 1024 * 1024) {
        if (draft) this.state.drafts[op.path] = draft; else delete this.state.drafts[op.path];
        return this.finish('failed', 'Speichergrenze der Entwürfe erreicht.');
      }
    }
    if(filePlan&&op.kind!=='write'){
      const next={...this.state.drafts};
      for(const [p,c]of Object.entries(filePlan.changes))next[p]={before:next[p]?next[p].before:c.before,after:c.after,applied:false,version:id,eventId:`${this.state.id}:change:${p}:${id}`};
      if(Buffer.byteLength(JSON.stringify(next))>16*1024*1024)return this.finish('failed','Speichergrenze der Entwürfe erreicht.');
      this.state.drafts=next;
    }
    if(filePlan)for(const [paths,after]of [[filePlan.create,true],[filePlan.remove,false]])for(const p of paths){const old=this.state.directoryChanges[p];this.state.directoryChanges[p]={before:old?old.before:this.dirs.has(p),after,applied:false};}
    this.state.operation = { id, kind: op.kind, action:op.action, path: op.path, server:op.server, name:op.name, digest:mutation?digest:undefined, status: 'pending' };
    const execution=op.kind==='run'||op.kind==='shell'||op.kind==='engine'&&op.action==='run';
    if(execution)this.state.pendingRun={path:String(op.path||op.command||op.args?.action||'Engine'),attempt:++this.state.runAttempts,max:this.state.runMax,running:true,startedAt:Date.now()};
    if(mutation){this.state.mutationLedger.push(digest);if(this.state.mutationLedger.length>2048)return this.finish('failed','Zu viele externe Aktionen für eine sichere Wiederaufnahme.');}
    this.touch(true, Boolean(filePlan && Object.keys(filePlan.changes).length)); this.persist();
    if (this.controller.signal.aborted || this.state.persistenceError) return;
    // The pending record is durable before any external side effect. After an
    // app restart it remains interrupted and is never automatically replayed.
    const backupPath = join(dirname(this.snapshotPath), 'backups', this.state.id, (op.kind==='write'?createHash('sha256').update(String(op.path || '')).digest('hex'):`action-${id}`) + '.json');
    const job = this.state;
    this.operation = Promise.resolve().then(() => this.runtime.execute(op, { before, filePlan,fileProtections:this.state.fileProtections,operationId:`${this.state.id}:${id}`, changedPaths:Object.keys(this.state.drafts).filter(p=>this.state.drafts[p].applied&&this.state.drafts[p].before!==this.state.drafts[p].after), files: { ...this.base }, signal: this.controller.signal, backupPath,
      emit:text=>{if(this.child===child&&!this.controller.signal.aborted)child.send({type:'operation-delta',id,text:String(text)});},
    }))
      .catch(error => {
        if (!(error instanceof ToolRejection)) throw error;
        // Only a trusted local preflight can release this new replay entry.
        // A late response belongs to its original job, including after Stop.
        // Remote result fields and a later job may never alter this history.
        if(this.state===job&&job.operation?.id===id){
          const entry=job.mutationLedger.lastIndexOf(digest);
          if(mutation&&entry>=0)job.mutationLedger.splice(entry,1);
          job.operation.rejected=true;
          job.operation.definitelyNotExecuted=true;
        }
        return error.result();
      })
      .then(result => {
        if (this.child !== child || this.controller.signal.aborted) return;
        if(Buffer.byteLength(JSON.stringify(result) || '')>8*1024*1024)throw new Error('Hintergrundantwort zu groß. Aktion nicht automatisch wiederholen.');
        let draftsChanged = false;
        if(['read','write','rename','delete','mkdir'].includes(op.kind)){
          const path=result.fileConflict?.path||op.path;
          if(result.protectedFile){
            if(!safePath(path))throw Error('Ungültige Konfliktdatei.');
            this.state.fileProtections=protectedFiles({...this.state.fileProtections,[path]:result.protectedFile});
          }
          // Private protection snapshots are persisted locally, never repeated
          // in every renderer poll or model tool response.
          const {protectedFile:_private,...publicResult}=result;result=publicResult;
          if(result.fileConflict){
            if(!safePath(path)||!['changed','protected','deleted'].includes(result.fileConflict.kind)||result.ok!==false)throw Error('Ungültiges Dateikonfliktergebnis.');
            const draft=this.state.drafts[path];
            if(draft){draft.applied=false;draft.conflict={kind:result.fileConflict.kind,message:result.error};draftsChanged=true;}
          }else if(op.kind==='read'&&result.ok===true&&Object.hasOwn(result,'content')){
            const current=result.content;
            if(current!==null&&typeof current!=='string')throw Error('Ungültiger aktueller Dateiinhalt.');
            const changed=current!==(this.base[op.path]??null);
            if(current===null)delete this.base[op.path];else this.base[op.path]=current;
            const draft=this.state.drafts[op.path];
            if(changed&&draft){draft.applied=false;draft.conflict={kind:current===null?'deleted':'changed',message:'Inzwischen geänderter Dateistand wurde nachgeladen. Deine Änderungen bleiben geschützt.'};draftsChanged=true;}
          }
        }
        if (filePlan&&result.ok!==false&&!result.fileConflict) {
          const applied = result.applied === true;
          for(const [p,c]of Object.entries(filePlan.changes)){if(c.after===null)delete this.base[p];else this.base[p]=c.after;draftsChanged ||= this.state.drafts[p].applied !== applied;this.state.drafts[p].applied=applied;}
          // Directory changes travel in every metadata reply, independently of
          // the large draft contents and their revision.
          for(const p of filePlan.create){this.dirs.add(p);this.state.directoryChanges[p].applied=applied;}
          for(const p of filePlan.remove){this.dirs.delete(p);this.state.directoryChanges[p].applied=applied;}
        }
        if(execution){this.state.lastRun={...this.state.pendingRun,...result,id:String(result.id||result.stage?.id||id),eventId:`${this.state.id}:run:${id}`,image:undefined,running:result.running===true,finishedAt:Date.now()};delete this.state.pendingRun;}
        if(['see','play'].includes(op.kind))this.state.lastPreview={...result,image:undefined,action:op.kind,finishedAt:Date.now()};
        if(op.kind==='git')this.state.lastGit={...result,action:op.action,finishedAt:Date.now()};
        if(op.kind==='verify')this.state.lastDiagnostics={...result,paths:op.paths,finishedAt:Date.now()};
        if(op.kind==='debug')this.state.lastDebug={...result,finishedAt:Date.now()};
        if(op.kind==='knowledge'){
          this.state.knowledgeEvents=this.runtime.knowledgeEvents?.()||result.knowledgeEvents||[];
          if(['run','read'].includes(op.action)&&typeof result.body==='string'&&!result.error){
            const skill=(result.knowledgeEvents||[]).find(event=>event.collection==='skills'&&event.action==='run')?.after
              ||this.skillRecords?.find(skill=>skill.id===op.args?.name||skill.name===op.args?.name);
            this.state.skillSelection=withLoadedSkill(this.state.skillSelection||[],skill,`skill_${op.action}`);
          }
        }
        if (op.kind === 'engine') this.state.lastEngine = op.action==='status' ? result.lastRun : result;
        if (op.kind === 'mcp') {
          const serviceText = this.state.operation.definitelyNotExecuted ? result.error : result?.text;
          this.state.lastService = {
            server: op.server || '', name: op.name || 'Katalog',
            ok: result?.ok !== false && !result?.isError, text: String(serviceText || '').slice(0, 4000),
          };
        }
        if(op.kind==='shell'&&Number.isInteger(result.code)&&!result.running&&!result.aborted&&!result.timedOut&&!result.interrupted&&result.code!==0&&result.exitExpectationMatched!==true)this.state.mutationLedger=this.state.mutationLedger.filter(value=>value!==digest);
        this.state.operation.status = result.ok===false?'failed':'done';
        this.touch(true, draftsChanged); this.persist();
        if (this.controller.signal.aborted) return;
        const reply = { type: 'operation-result', id, result };
        this.lastOperation.reply = reply;
        child.send(reply);
      }).catch(error => {
        if (this.child === child && !this.controller.signal.aborted) {
          this.state.operation.status = 'failed';
          this.finish('failed', (error instanceof Error ? error.message : String(error)) + (op.kind==='mcp'&&op.action==='call' ? ' Die Aktion wurde beim Dienst möglicherweise bereits ausgeführt. Prüfe dort das Ergebnis, bevor du sie erneut startest.' : ''));
        }
      }).finally(() => {
        this.operation = null;
        if (this.state.status === 'stopping') { this.state.operation.status = 'stopped'; this.finish('stopped', this.state.error); }
      });
  }
  finish(status, error = '') {
    if (status !== 'done'&&status!=='waiting-user') { this.controller.abort(); this.cleanRuntime(); }
    else this.cleanRuntime('finish');
    if(status!=='done'&&this.state.operation?.kind==='mcp'&&this.state.operation.status==='pending')error+=' Die Aktion wurde beim Dienst möglicherweise bereits ausgeführt. Prüfe dort das Ergebnis, bevor du sie erneut startest.';
    clearTimeout(this.killTimer); this.killTimer = null;
    this.state.status = status === 'stopped' && this.operation ? 'stopping' : status; this.state.error = error;
    if(status!=='done'&&status!=='waiting-user'&&this.state.workflow)this.state.workflow=interruptWorkflow(this.state.workflow);
    if(status==='stopped')this.state.cancellation={local:this.operation?'requested':'complete',remote:'unconfirmed',at:Date.now()};
    if(TERMINAL.has(this.state.status)&&this.state.status!=='waiting-user')this.state.finishedAt=Date.now();
    for (const step of this.state.steps) if (step.status === 'run') {step.status='err';step.ms=Math.max(0,Date.now()-(step.at||Date.now()));}
    if(this.state.pendingRun)this.state.pendingRun={...this.state.pendingRun,running:false,interrupted:true};
    const child = this.child; this.child = null; try { child?.kill(); } catch { /* Already exited. */ } this.base = {};
    this.touch(); clearTimeout(this.persistTimer); this.persistTimer = null; this.persist();
  }
  stop(reason = 'Vom Nutzer gestoppt. Bisherige Entwürfe bleiben erhalten.') {
    if (!this.busy()) return this.snapshot();
    try { this.child.send({ type: 'stop' }); } catch { /* A dead worker still produces a final local Stop. */ }
    // Stop is final and does not depend on a cooperative model server.
    this.finish('stopped', reason); return this.snapshot();
  }
  steer(id,text,messageId=randomUUID(),images) {
    if(id!==this.state?.id||this.state.dismissed||!this.child||!['starting','running'].includes(this.state.status))throw Error('Kein passender laufender Auftrag. Dein Entwurf bleibt erhalten.');
    if(typeof text!=='string'||!text.trim()||text.length>8000||typeof messageId!=='string'||!/^[-\w:.]{1,120}$/.test(messageId))throw Error('Eine Korrektur benötigt Text mit höchstens 8000 Zeichen.');
    const attachments=steeringImages(images);
    const previous=this.state.steering.find(item=>item.id===messageId);
    if(previous){if(previous.text!==text.trim()||!sameImages(previous.images,attachments))throw Error('Die Kennung der Korrektur wurde bereits verwendet.');return this.snapshot();}
    if(this.state.steering.length>=256||this.state.steering.filter(item=>item.status==='queued').length>=16)throw Error('Zu viele Korrekturen. Warte auf die nächste Modellrunde.');
    const correction={id:messageId,text:text.trim(),createdAt:Date.now(),status:'queued',...(attachments.length?{images:attachments}:{})};
    if(attachments.length){
      const imageBytes=[...(this.state.resumedImageCorrections||[]),...this.state.steering,correction].reduce((total,item)=>total+(item.images||[]).reduce((sum,image)=>sum+image.length,0),0);
      // Persisting also updates the revision and timestamp.
      const snapshotBytes=Buffer.byteLength(JSON.stringify(this.state))+Buffer.byteLength(JSON.stringify(correction))+128;
      if(imageBytes>STEERING_IMAGE_MAX_BYTES||snapshotBytes>MAX_BYTES)throw Error('Die Bildanhänge der Korrekturen sind für diesen Auftrag zu groß.');
    }
    this.state.steering.push(correction);this.touch();this.persist();
    if(this.state.persistenceError)throw Error(this.state.persistenceError);
    if(this.state.status==='running'){
      try{this.child.send({type:'steer',message:steeringPayload(correction)});}
      catch{correction.status='rejected';correction.error='Der Hintergrundprozess ist nicht mehr erreichbar.';this.touch();this.persist();throw Error(correction.error);}
    }
    return this.snapshot();
  }
  async debug(id,action,args={}) {
    if(id!==this.state?.id||this.state.dismissed||!this.state.execution||!['running','starting'].includes(this.state.status))throw Error('Keine aktive Hintergrund-Debugsitzung.');
    if(!['continue','step','stop','breakpoint','eval','state','watch'].includes(action))throw Error('Unbekannter Debug-Befehl.');
    if(this.operation||this.manualOperation)throw Error('Ein Werkzeug wird gerade ausgeführt. Warte auf den Abschluss und wiederhole anschließend den Debug-Befehl.');
    const job=this.state,child=this.child,op={kind:'debug',action,args};
    const digest=createHash('sha256').update(JSON.stringify(op)).digest('hex');
    if(['continue','step','eval','watch'].includes(action)){
      if(job.mutationLedger.length>=2048)throw Error('Zu viele Aktionen für eine sichere Wiederaufnahme.');
      job.mutationLedger.push(digest);
    }
    job.operation={id:`ui-${job.revision}`,kind:'debug',digest:['continue','step','eval','watch'].includes(action)?digest:undefined,status:'pending'};
    this.touch();this.persist();
    if(this.controller.signal.aborted||job.persistenceError)throw Error('Auftrag angehalten.');
    this.manualOperation=Promise.resolve().then(()=>this.runtime.execute(op,{files:{...this.base},signal:this.controller.signal,operationId:`${job.id}:ui:${job.revision}`})).then(result=>{
      if(this.state!==job||this.child!==child||this.controller.signal.aborted)return;
      job.lastDebug=result;job.operation.status='done';this.touch();this.persist();
    }).catch(error=>{if(this.state===job){job.operation.status='failed';this.touch();this.persist();}throw error;}).finally(()=>{this.manualOperation=null;});
    await this.manualOperation;
    return this.snapshot();
  }
  dismiss(id) {
    if (id !== this.state?.id || this.busy()) throw new Error('Auftrag noch aktiv oder inzwischen geändert.');
    this.cleanRuntime(); this.state.dismissed = true; this.touch(); this.persist(); return this.snapshot();
  }
  changeFiles(id,action){
    if(this.busy()||id!==this.state?.id)throw Error('Auftrag noch aktiv oder inzwischen geändert.');
    if(!['apply','restore'].includes(action))throw Error('Unbekannte Dateiaktion.');
    const restore=action==='restore';if(restore&&this.state.restored)throw Error('Dateien bereits wiederhergestellt.');
    const changes={};for(const [p,d]of Object.entries(this.state.drafts)){
      if(!restore&&d.applied)continue;
      if(restore&&!d.applied&&!this.state.writeThrough)continue;
      changes[p]=restore?{before:d.after,after:d.before}:{before:d.before,after:d.after};
    }
    for(const path of Object.keys(changes))if(this.state.fileProtections?.[path]||this.state.drafts[path]?.conflict)
      throw Error(`Datei enthält inzwischen eigene Änderungen: ${path}. Diese Übernahme oder Wiederherstellung würde sie überschreiben und bleibt gesperrt.`);
    const create=[],remove=[];
    for(const [p,d]of Object.entries(this.state.directoryChanges||{})){
      if(restore&&!d.applied&&!this.state.writeThrough)continue;
      if(!restore&&d.applied)continue;
      const wanted=restore?d.before:d.after;if(wanted)create.push(p);else remove.push(p);
    }
    const root=resolveCwd(this.state.project);
    const changedOnDisk=new Set(Object.entries(changes).filter(([p,c])=>!diskMatches(root,p,c.after)).map(([p])=>p));
    applyFileChanges(root,{changes,create,remove},join(dirname(this.snapshotPath),'backups',this.state.id,`${action}-${this.state.revision}.json`),{recover:restore});
    for(const [p,c]of Object.entries(changes))this.state.drafts[p]={...this.state.drafts[p],...c,applied:true,...(changedOnDisk.has(p)?{version:this.state.revision+1,eventId:`${this.state.id}:${action}:${p}:${this.state.revision+1}`}:{})};
    for(const p of [...create,...remove]){const d=this.state.directoryChanges[p];this.state.directoryChanges[p]={before:restore?d.after:d.before,after:create.includes(p),applied:true};}
    if(restore)this.state.restored=true;
    this.touch(true, Boolean(Object.keys(changes).length));this.persist();return this.snapshot();
  }
  archiveJob(job) {
    const name = /^[a-zA-Z0-9_-]{1,100}$/.test(job.id) ? job.id : createHash('sha256').update(job.id).digest('hex');
    const archive = join(dirname(this.snapshotPath), 'history', name + '.json');
    mkdirSync(dirname(archive), { recursive: true });
    const fd = openSync(archive + '.tmp', 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(job)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(archive + '.tmp', archive);
  }
  continuationProtections(request){
    if(request.project!==this.state?.project)throw Error('Fortsetzen nur im ursprünglichen Projektordner.');
    const protections=protectedFiles(this.state.fileProtections);
    if(!this.state.writeThrough)return protections;
    for(const [path,draft]of Object.entries(this.state.drafts)){
      const expected=request.files[path]??null;
      const actual=readAgentProjectFile(this.state.project,path,Object.hasOwn(request.files,path)?expected:undefined);
      if(Object.hasOwn(request.files,path)&&expected!==actual)throw Error(`Projekt und Editor unterscheiden sich: ${path}. Zuerst speichern oder neu laden.`);
      const known=draft.applied?draft.after:lastAcknowledgedSource(this.state,path)??(draft.conflict?null:draft.before);
      const protection=observeFileChange(protections[path],known,actual);
      if(protection)protections[path]=protection;
    }
    return protectedFiles(protections);
  }
  resume(id,request){
    const previous=this.state;
    if(this.busy()||id!==previous?.id||previous.status==='done')throw Error('Nur angehaltene Aufträge können fortgesetzt werden.');
    if(previous.persistenceError)throw Error('Der Auftragsstand ist noch nicht zuverlässig gespeichert. Den Speicherfehler vor dem Fortsetzen beheben.');
    if(request.project!==previous.project)throw Error('Öffne zuerst das Projekt, zu dem dieser Auftrag gehört.');
    const workflow=validWorkflowSnapshot(previous.workflow)?structuredClone(previous.workflow):undefined;
    const uncertain=workflow?.operations.filter(op=>op.external&&['unclear','started'].includes(op.status))||[];
    for(const op of uncertain){op.status='unclear';delete op.recovery;}
    let answer='';
    if(previous.status==='waiting-user'){
      const reply=request.answer,ask=previous.ask;
      if(!ask||reply?.askId!==ask.id)throw Error('Die Rückfrage ist nicht mehr aktuell.');
      const choice=ask.choices.find(c=>c.id===reply.choiceId);
      const text=typeof reply.text==='string'?reply.text.trim().slice(0,2000):'';
      if(reply.choiceId&&!choice||!choice&&(!ask.allowText||!text))throw Error('Bitte eine angebotene Antwort wählen oder die Rückfrage beantworten.');
      answer=`\nAntwort auf: ${ask.prompt}\n${choice?`Wahl: ${choice.id}) ${choice.label}\n`:''}${text}`;
    }
    const files={...request.files},fileProtections=protectedFiles(previous.fileProtections),drafts=structuredClone(previous.drafts);
    for(const [p,d]of Object.entries(previous.drafts)){
      const now=files[p]??null;
      if(previous.writeThrough){
        const actual=readAgentProjectFile(previous.project,p,Object.hasOwn(files,p)?now:undefined);
        if(Object.hasOwn(files,p)&&now!==actual)throw Error(`Projekt und Editor unterscheiden sich: ${p}. Zuerst speichern oder neu laden.`);
        if(actual===null)delete files[p];else files[p]=actual;
        if(actual!==d.after){
          const known=d.applied?d.after:lastAcknowledgedSource(previous,p)??(d.conflict?null:d.before);
          const protection=observeFileChange(fileProtections[p],known,actual);
          if(protection){
            fileProtections[p]=protection;
            drafts[p]={...drafts[p],applied:false,conflict:{kind:actual===null?'deleted':'changed',message:'Aktueller Dateistand bleibt erhalten; nur unberührte Bereiche weiterbearbeiten.'}};
          }
        }
      }else if(now!==d.before&&now!==d.after){
        drafts[p]={...drafts[p],applied:false,conflict:{kind:now===null?'deleted':'changed',message:'Inzwischen geänderter Editorinhalt bleibt erhalten.'}};
      }else if(!d.conflict){if(d.after===null)delete files[p];else files[p]=d.after;}
    }
    const dirs=new Set(request.dirs||[]);for(const [p,d]of Object.entries(previous.directoryChanges||{})){if(d.after)dirs.add(p);else dirs.delete(p);}
    // Retain freshly prepared rules, selections and textual conversation context.
    // Old tool-call IDs are never redispatched. Further work uses new calls.
    const contextMessages=(Array.isArray(request.messages)?request.messages:[]).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content,...(Array.isArray(m.images)?{images:m.images}:{})}));
    const current=contextMessages.findLast(m=>m.role==='user');
    const images=[...new Set([...(previous.images||[]),...(current?.images||[])])].slice(0,4);
    if(current)delete current.images; // Current attachments accompany the final continuation prompt once.
    const recovery=uncertain.length?'\nBei früheren Dienstaktionen fehlt die Rückmeldung. Prüfe ihren aktuellen Zustand mit passenden Werkzeugen selbst. Spiele alte Aufrufe nicht erneut ab. Bearbeite die offenen Punkte mit neuen Werkzeugaufrufen weiter. Verlange keine Abnahme oder Bestätigung des früheren Ergebnisses vom Nutzer.':'';
    const acceptedCorrections=(previous.steering||[]).filter(m=>m.status!=='rejected');
    const resumedImageCorrections=[...(previous.resumedImageCorrections||[]),...acceptedCorrections.filter(m=>m.images?.length).map(({text,images})=>({text,images}))].slice(-256);
    const correctionMessages=recoverImageCorrectionMessages(contextMessages,resumedImageCorrections);
    const corrections=acceptedCorrections.map(m=>m.text).join('\n\n');
    const summary=`Setze den Auftrag fort. Prüfe den aktuellen Dateistand und erledige die offenen Punkte. Bereits abgeschlossene Arbeit nicht wiederholen.${recovery}\nUrsprünglicher Auftrag: ${previous.prompt}\nSpätere Nutzerkorrekturen (in dieser Reihenfolge beachten): ${corrections}\nBisherige Antwort: ${withoutLegacyAcceptancePrefix(previous.text).slice(-16000)}\nCheckliste: ${JSON.stringify(previous.plan)}\nLetzte Aktionen: ${JSON.stringify(previous.steps.slice(-30))}\nUnterbrechung: ${previous.error}${answer}`;
    this.archiveJob(previous);
    previous.dismissed=true;
    try{
      const result=this.start({...request,humanPrompt:previous.humanPrompt??previous.prompt,humanCorrections:[...(previous.humanCorrections||[]),...acceptedCorrections.map(m=>m.text)],workflow,fileProtections,knowledgeResumeFrom:previous.id,files,dirs:[...dirs],writeThrough:previous.writeThrough,resumePlan:previous.plan,planLocked:previous.planLocked,messages:[...contextMessages,...correctionMessages,{role:'user',content:summary,images}]},{resumedImageCorrections});
      this.state.resumedFrom=previous.id;
      this.state.prompt=previous.prompt;
      this.state.drafts=drafts;this.state.directoryChanges=structuredClone(previous.directoryChanges||{});
      for(const field of ['lastRun','lastDiagnostics','lastPreview','lastGit','lastEngine','runAttempts'])if(previous[field]!==undefined)this.state[field]=structuredClone(previous[field]);
      this.touch(true, true);this.persist();return this.snapshot();
    }catch(e){this.state=previous;previous.dismissed=false;this.persist();throw e;}
  }
  close() {
    if (this.busy()) this.stop('Anvil wurde geschlossen. Bisherige Entwürfe bleiben erhalten.');
    const closing=this.cleanRuntime();
    clearTimeout(this.persistTimer); clearTimeout(this.killTimer); this.persist();
    return Promise.allSettled([this.operation,this.manualOperation,closing]);
  }
}
