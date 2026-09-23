import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { safeAgentPath } from './agent-project-runtime.mjs';
import { validateCliImages } from './cli-images.mjs';
import { planFileAction,applyFileChanges,diskMatches,safePath as filePath } from './agent-file-actions.mjs';
import { resolveCwd } from '../companion/git.mjs';

const TERMINAL = new Set(['done', 'failed', 'stopped', 'interrupted','waiting-user']);
const MAX_BYTES = 24 * 1024 * 1024;
const safePath = safeAgentPath;
const tokenNumber=value=>Number.isSafeInteger(value)&&value>=0;
const validRequestTokens=value=>value&&tokenNumber(value.prompt)&&tokenNumber(value.limit)&&value.limit>0&&typeof value.estimated==='boolean';
const PHASES=new Set(['preparing','waiting','thinking','answering','tool']);
function stepDetails(message){
  const out={detail:String(message.detail||'').slice(0,4000)};
  for(const field of ['path','code','before'])if(typeof message[field]==='string')out[field]=message[field].slice(0,field==='path'?2000:12000);
  if(typeof message.image==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/.test(message.image)&&message.image.length<=1024*1024)out.image=message.image;
  return out;
}

/** One job, owned by the app process; renderer connections never own its lifetime. */
export class AgentJobHost extends EventEmitter {
  constructor({ launch, snapshotPath, runtime }) {
    super(); this.launch = launch; this.snapshotPath = snapshotPath; this.runtime = runtime;
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
      this.state = state;
      if(state.lastDebug?.active){state.lastDebug={...state.lastDebug,active:false,paused:false,reason:'Debug-Sitzung durch Programmende beendet.'};this.touch();this.persist();}
      if (!TERMINAL.has(state.status)) {
        state.status = 'interrupted'; state.error = 'Anvil wurde beendet. Gesicherte Entwürfe bleiben erhalten; der Auftrag wurde nicht erneut ausgeführt.';
        state.finishedAt=Date.now();
        if (state.operation?.status === 'pending') {
          state.operation.status = 'interrupted';
          state.error += state.operation.kind==='mcp' ? ' Die Aktion wurde beim Dienst möglicherweise bereits ausgeführt. Prüfe dort das Ergebnis, bevor du sie erneut startest.' : ' Der Abschluss der letzten Aktion ist unbestätigt. Projektdateien und Run-Protokoll vor dem Fortsetzen prüfen.';
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
  touch(persist = true) {
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
      writeFileSync(this.snapshotPath + '.tmp', raw, { mode: 0o600 });
      renameSync(this.snapshotPath + '.tmp', this.snapshotPath);
    } catch {
      this.state.persistenceError = 'Hintergrundauftrag konnte nicht gesichert werden. Anvil geöffnet lassen und Entwürfe übernehmen.';
      this.emit('change');
      if (this.busy() && !this.controller.signal.aborted) this.stop('Speicherung fehlgeschlagen. Auftrag angehalten.');
    }
  }
  snapshot(knownId, knownRevision) {
    if (!this.state) return { state: null, error: this.recoveryError };
    const events=this.runtime?.knowledgeEvents?.()||[];
    if(JSON.stringify(events)!==JSON.stringify(this.state.knowledgeEvents||[])){
      this.state.knowledgeEvents=events;this.touch();
    }
    if (knownId === this.state.id && knownRevision === this.state.revision) return { unchanged: true };
    return { state: structuredClone(this.state) };
  }
  start(request) {
    if (this.busy()) throw new Error('Ein Hintergrundauftrag läuft bereits. Erst stoppen oder abschließen lassen.');
    if(this.cleanup)throw new Error('Der vorige Auftrag wird noch aufgeräumt. Bitte kurz warten.');
    if (this.state && !this.state.dismissed) throw new Error('Den bisherigen Hintergrundauftrag zuerst prüfen und abschließen.');
    if (!request?.model || !request.model.model || !Array.isArray(request.messages) || !request.messages.length || !request.files || typeof request.files !== 'object') throw new Error('Ungültiger Hintergrundauftrag.');
    if (Buffer.byteLength(JSON.stringify(request)) > 12 * 1024 * 1024) throw new Error('Für den Hintergrund-Test höchstens 12 MB Projekt und Verlauf auswählen.');
    for(const message of request.messages) {
      if(!message || !['user','assistant'].includes(message.role) || typeof message.content!=='string')throw new Error('Ungültiger Auftragsverlauf.');
      try{validateCliImages(message.images);}catch(error){throw new Error(String(error.message).replaceAll('CLI','Hintergrund'));}
    }
    const files = Object.fromEntries(Object.entries(request.files).filter(([p, c]) => safePath(p) && typeof c === 'string'));
    // Project harness may enable UI tools; this test lane has a fixed capability set.
    delete files['.anvil/harness.json']; delete files['.anvil/graph.json'];
    const id = randomUUID();
    if (request.execution && !this.runtime) throw new Error('Hintergrund-Ausführung fehlt.');
    if (request.writeThrough && !request.execution) throw new Error('Direktes Speichern benötigt die zweite Hintergrundstufe.');
    this.runtime?.begin({ ...request, files }, id);
    this.controller = new AbortController(); this.lastOperation = null;
    this.base = files;
    this.dirs=new Set((request.dirs||[]).filter(filePath));
    for(const p of Object.keys(files)){const parts=p.split('/');while(parts.length>1){parts.pop();this.dirs.add(parts.join('/'));}}
    this.state = { schema: 1, id, revision: 0, project: String(request.project || ''), execution: request.execution === true, writeThrough: request.writeThrough === true,
      prompt: String(request.userPrompt ?? request.messages.at(-1)?.content ?? ''), images: request.userImages ?? request.messages.at(-1)?.images ?? [], status: 'starting', startedAt: Date.now(),
      locale:request.locale==='en'?'en':'de',modelTarget:{provider:request.model.provider,model:request.model.model,baseUrl:request.model.baseUrl},effectiveSettings:request.effectiveSettings,
      toolLearningInitial:structuredClone(request.toolLearning||{rules:[]}),
      text: '', thinking: '', steps: [], plan: request.resumePlan||request.plan||[], planLocked:request.planLocked===true, blockedMutations:request.blockedMutations||[], mutationLedger:[], directoryChanges:{}, drafts: {}, harness: '', error: '', dismissed: false,
      phase:{phase:'preparing',since:Date.now()},runAttempts:0,runMax:Math.max(1,Math.min(5,Number(request.automation?.loopTries)||3)),
      requestSequence:0,usageSequence:0,requestTokens:null,usage:{prompt:0,completion:0,estimated:false} };
    this.state.connection = request.model.cliKind ? `${request.model.cliKind} CLI` : 'Lokale API';
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
    if (message.type === 'ready') {
      if (this.state.status !== 'starting') return;
      clearTimeout(this.killTimer); this.state.status = 'running';
      // Service credentials remain in the app process. The worker only needs IDs.
      const knowledge=request.knowledge&&!request.knowledge.skillBodies?{...request.knowledge,skills:(request.knowledge.skills||[]).map(({body,...skill})=>skill)}:request.knowledge;
      this.child.send({ type: 'start', request: { ...request, knowledge,services:this.state.services, files } });
    } else if (message.type === 'request-tokens') {
      if(!Number.isSafeInteger(message.sequence)||message.sequence<1||message.sequence<(this.state.requestSequence||0)||message.sequence<=(this.state.usageSequence||0)||!validRequestTokens(message.requestTokens))return;
      this.state.requestSequence=message.sequence;this.state.requestTokens=message.requestTokens;
    } else if (message.type === 'token-usage') {
      const u=message.usage;
      if(message.sequence!==this.state.requestSequence||message.sequence<=(this.state.usageSequence||0)||!u||!tokenNumber(u.prompt)||!tokenNumber(u.completion)||typeof u.estimated!=='boolean'||!validRequestTokens(message.requestTokens))return;
      if(u.prompt<(this.state.usage?.prompt||0)||u.completion<(this.state.usage?.completion||0))return;
      this.state.usageSequence=message.sequence;this.state.usage=u;this.state.requestTokens=message.requestTokens;
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
      if(result.verification&&['none','passed','failed','stale'].includes(result.verification.state))this.state.verification={state:result.verification.state,detail:String(result.verification.detail||'').slice(0,16000)};
      if(['round-limit','no-progress','tool-limit'].includes(result.stopReason))this.state.stopReason=result.stopReason;
      this.state.compacted=result.compacted===true;
      this.state.tools=Array.isArray(result.tools)?result.tools.filter(v=>typeof v==='string').slice(-200):[];
      if(result.capabilities&&typeof result.capabilities==='object')this.state.capabilities=result.capabilities;
      if(result.toolLearning&&typeof result.toolLearning==='object')this.state.toolLearning=result.toolLearning;
      if(result.parked&&result.ask&&typeof result.ask.prompt==='string'&&Array.isArray(result.ask.choices)){
        this.state.ask=result.ask;this.state.parked=true;this.state.parkedAt=Date.now();
        return this.finish('waiting-user');
      }
      return this.finish(message.result?.ok ? 'done' : 'failed', String(message.result?.error || ''));
    } else if (message.type === 'failure') return this.finish(message.stopped ? 'stopped' : 'failed', String(message.error || 'Auftrag fehlgeschlagen.'));
    // Streaming text stays in the app process. Do not rewrite multi-MB file
    // drafts on every token during an hours-long model response.
    this.touch(message.type !== 'delta' && message.type !== 'harness');
    if (message.type === 'file') this.persist();
  }
  perform(message) {
    if(this.manualOperation){const child=this.child;void this.manualOperation.finally(()=>{if(child===this.child&&!this.controller.signal.aborted)this.perform(message);}).catch(()=>{});return;}
    const op = message.operation, id = message.id;
    if (!Number.isSafeInteger(id) || id < 1 || !op || !this.state.execution || !this.runtime) return this.finish('failed', 'Ungültige Hintergrundaktion.');
    const fingerprint = JSON.stringify(op,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
    const mutation=/^(shell|git)$/.test(op.kind)&&op.action!=='status'||op.kind==='mcp'&&op.action==='call'||op.kind==='knowledge'&&['add','forget','write','patch','run','outcome'].includes(op.action)||op.kind==='debug'&&['start','continue','step','eval','watch'].includes(op.action);
    // Exit expectations change validation, not the command's external effects.
    const effectOp=op.kind==='shell'?Object.fromEntries(Object.entries(op).filter(([key])=>key!=='expectedExitCode')):op;
    const effectFingerprint=JSON.stringify(effectOp,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
    const digest=createHash('sha256').update(effectFingerprint).digest('hex');
    if(mutation&&(this.state.blockedMutations?.includes(digest)||this.state.blockedMutations?.includes(createHash('sha256').update(JSON.stringify(op)).digest('hex'))))return this.finish('failed','Diese Aktion wurde vor der Wiederaufnahme bereits gestartet. Prüfe zunächst ihr Ergebnis. Sie wird nicht automatisch wiederholt.');
    if (this.lastOperation?.id === id) {
      if (this.lastOperation.fingerprint !== fingerprint) return this.finish('failed', 'Aktions-ID wurde verändert.');
      if (this.lastOperation.reply) this.child?.send(this.lastOperation.reply);
      return; // Duplicate in-flight request joins the original result.
    }
    if (this.operation || id !== (this.lastOperation?.id || 0) + 1) return this.finish('failed', 'Hintergrundaktionen außerhalb der Reihenfolge.');
    this.lastOperation = { id, fingerprint };
    const child = this.child;
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
    this.state.operation = { id, kind: op.kind, path: op.path, server:op.server, name:op.name, digest:mutation?digest:undefined, status: 'pending' };
    const execution=op.kind==='run'||op.kind==='shell'||op.kind==='engine'&&op.action==='run';
    if(execution)this.state.pendingRun={path:String(op.path||op.command||op.args?.action||'Engine'),attempt:++this.state.runAttempts,max:this.state.runMax,running:true,startedAt:Date.now()};
    if(mutation){this.state.mutationLedger.push(digest);if(this.state.mutationLedger.length>2048)return this.finish('failed','Zu viele externe Aktionen für eine sichere Wiederaufnahme.');}
    this.touch(); this.persist();
    if (this.controller.signal.aborted || this.state.persistenceError) return;
    // The pending record is durable before any external side effect. After an
    // app restart it remains interrupted and is never automatically replayed.
    const backupPath = join(dirname(this.snapshotPath), 'backups', this.state.id, (op.kind==='write'?createHash('sha256').update(String(op.path || '')).digest('hex'):`action-${id}`) + '.json');
    this.operation = Promise.resolve().then(() => this.runtime.execute(op, { before, filePlan,operationId:`${this.state.id}:${id}`, changedPaths:Object.keys(this.state.drafts).filter(p=>this.state.drafts[p].applied&&this.state.drafts[p].before!==this.state.drafts[p].after), files: { ...this.base }, signal: this.controller.signal, backupPath,
      emit:text=>{if(this.child===child&&!this.controller.signal.aborted)child.send({type:'operation-delta',id,text:String(text)});},
    }))
      .then(result => {
        if (this.child !== child || this.controller.signal.aborted) return;
        if(Buffer.byteLength(JSON.stringify(result) || '')>8*1024*1024)throw new Error('Hintergrundantwort zu groß. Aktion nicht automatisch wiederholen.');
        if (filePlan) {
          for(const [p,c]of Object.entries(filePlan.changes)){if(c.after===null)delete this.base[p];else this.base[p]=c.after;this.state.drafts[p].applied=result.applied===true;}
          for(const p of filePlan.create){this.dirs.add(p);this.state.directoryChanges[p].applied=result.applied===true;}
          for(const p of filePlan.remove){this.dirs.delete(p);this.state.directoryChanges[p].applied=result.applied===true;}
        }
        if(execution){this.state.lastRun={...this.state.pendingRun,...result,id:String(result.id||result.stage?.id||id),eventId:`${this.state.id}:run:${id}`,image:undefined,running:result.running===true,finishedAt:Date.now()};delete this.state.pendingRun;}
        if(['see','play'].includes(op.kind))this.state.lastPreview={...result,image:undefined,action:op.kind,finishedAt:Date.now()};
        if(op.kind==='git')this.state.lastGit={...result,action:op.action,finishedAt:Date.now()};
        if(op.kind==='verify')this.state.lastDiagnostics={...result,paths:op.paths,finishedAt:Date.now()};
        if(op.kind==='debug')this.state.lastDebug={...result,finishedAt:Date.now()};
        if(op.kind==='knowledge')this.state.knowledgeEvents=this.runtime.knowledgeEvents?.()||result.knowledgeEvents||[];
        if (op.kind === 'engine') this.state.lastEngine = op.action==='status' ? result.lastRun : result;
        if(op.kind==='mcp')this.state.lastService={server:op.server||'',name:op.name||'Katalog',ok:!result?.isError,text:String(result?.text||'').slice(0,4000)};
        this.state.operation.status = 'done';
        this.touch(); this.persist();
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
    this.touch();this.persist();return this.snapshot();
  }
  resume(id,request,reviewed=false){
    const previous=this.state;
    if(this.busy()||id!==previous?.id||previous.status==='done')throw Error('Nur angehaltene Aufträge können fortgesetzt werden.');
    if(request.project!==previous.project)throw Error('Öffne zuerst das Projekt, zu dem dieser Auftrag gehört.');
    if(previous.operation?.digest&&previous.operation.status!=='done'&&!reviewed)throw Error('Prüfe und bestätige zuerst das Ergebnis der noch unbestätigten Aktion.');
    let answer='';
    if(previous.status==='waiting-user'){
      const reply=request.answer,ask=previous.ask;
      if(!ask||reply?.askId!==ask.id)throw Error('Die Rückfrage ist nicht mehr aktuell.');
      const choice=ask.choices.find(c=>c.id===reply.choiceId);
      const text=typeof reply.text==='string'?reply.text.trim().slice(0,2000):'';
      if(reply.choiceId&&!choice||!choice&&(!ask.allowText||!text))throw Error('Bitte eine angebotene Antwort wählen oder die Rückfrage beantworten.');
      answer=`\nAntwort auf: ${ask.prompt}\n${choice?`Wahl: ${choice.id}) ${choice.label}\n`:''}${text}`;
    }
    const files={...request.files};
    for(const [p,d]of Object.entries(previous.drafts)){
      const now=files[p]??null;
      if(now!==d.before&&now!==d.after)throw Error(`Datei seit dem Auftrag verändert: ${p}. Erst abgleichen.`);
      if(d.after===null)delete files[p];else files[p]=d.after;
    }
    const dirs=new Set(request.dirs||[]);for(const [p,d]of Object.entries(previous.directoryChanges||{})){if(d.after)dirs.add(p);else dirs.delete(p);}
    // Retain freshly prepared rules, selections and textual conversation context.
    // Never restore tool protocol records/call IDs: effects remain governed by the ledger.
    const contextMessages=(Array.isArray(request.messages)?request.messages:[]).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content,...(Array.isArray(m.images)?{images:m.images}:{})}));
    const current=contextMessages.findLast(m=>m.role==='user');
    const images=[...new Set([...(previous.images||[]),...(current?.images||[])])].slice(0,4);
    if(current)delete current.images; // Current attachments accompany the final continuation prompt once.
    const summary=`Kontrollierte Wiederaufnahme. Bisherige Aktionen nicht wiederholen. Prüfe den aktuellen Dateistand und erledige nur offene Punkte. Externe Aktionen können bereits ausgeführt worden sein.\nUrsprünglicher Auftrag: ${previous.prompt}\nBisherige Antwort: ${previous.text.slice(-16000)}\nCheckliste: ${JSON.stringify(previous.plan)}\nLetzte Aktionen: ${JSON.stringify(previous.steps.slice(-30))}\nUnterbrechung: ${previous.error}${answer}`;
    const archive=join(dirname(this.snapshotPath),'history',previous.id+'.json');mkdirSync(dirname(archive),{recursive:true});writeFileSync(archive,JSON.stringify(previous),{mode:0o600});
    previous.dismissed=true;
    try{
      const result=this.start({...request,knowledgeResumeFrom:previous.id,files,dirs:[...dirs],writeThrough:previous.writeThrough,resumePlan:previous.plan,planLocked:previous.planLocked,blockedMutations:[...new Set([...(previous.blockedMutations||[]),...(previous.mutationLedger||[])])],messages:[...contextMessages,{role:'user',content:summary,images}]});
      this.state.resumedFrom=previous.id;
      this.state.prompt=previous.prompt;
      this.state.drafts=structuredClone(previous.drafts);this.state.directoryChanges=structuredClone(previous.directoryChanges||{});
      for(const field of ['lastRun','lastDiagnostics','lastPreview','lastGit','lastEngine','runAttempts'])if(previous[field]!==undefined)this.state[field]=structuredClone(previous[field]);
      this.touch();this.persist();return this.snapshot();
    }catch(e){this.state=previous;previous.dismissed=false;this.persist();throw e;}
  }
  close() {
    if (this.busy()) this.stop('Anvil wurde geschlossen. Bisherige Entwürfe bleiben erhalten.');
    const closing=this.cleanRuntime();
    clearTimeout(this.persistTimer); clearTimeout(this.killTimer); this.persist();
    return Promise.allSettled([this.operation,this.manualOperation,closing]);
  }
}
