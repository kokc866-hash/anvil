import { existsSync, lstatSync, realpathSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync,openSync,closeSync,fstatSync,readSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute, extname } from 'node:path';
import { hasAsciiControl } from './text-controls.mjs';
import { compileLang } from '../companion/compile-run.mjs';
import { fileBytes, fileContent, sameBytes } from '../scripts/file-content.mjs';
import {observeFileChange,checkProtectedWrite,MAX_PROTECTED_CONTENT_BYTES} from './file-protection.mjs';
import {isSecretPath} from './agent-secret-path.mjs';
import { applyFileChanges,FileActionConflict } from './agent-file-actions.mjs';
import { AgentCommands } from './agent-commands.mjs';
import { verifyAgentSnapshot } from './agent-diagnostics.mjs';
import { readAgentWeb } from './agent-web.mjs';
import { AgentDebugger } from './agent-debugger.mjs';
import { formatAgentFile } from './agent-format.mjs';
import { scanBoundWorkspaceResults } from './native-workspace.mjs';
import { WORKSPACE_RESULT_FOLDER } from '../scripts/workspace-results.mjs';
import { verifyWorkspaceFile } from './workspace-file-proof.mjs';

export const safeAgentPath = p => typeof p === 'string' && p.length > 0 && p.length < 512 &&
  !/[\\:]/.test(p) && !hasAsciiControl(p) && !p.split('/').some(x => !x || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(x)) &&
  !/(^|\/)(?:\.git|\.env(?:\..*)?|secrets?)(\/|$)/i.test(p);

function target(root, rel) {
  if (!safeAgentPath(rel)) throw new Error('Ungültiger Projektpfad.');
  let full = root;
  for (const part of rel.split('/')) {
    full = join(full, part);
    try { if (lstatSync(full).isSymbolicLink()) throw new Error('Verknüpfungen im Hintergrund nicht beschreiben.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}
const read = full => existsSync(full) ? readFileSync(full) : null;
const matches = (actual, expected) => actual === null ? expected === null : expected !== null && sameBytes(actual, fileBytes(expected));
class SourceReadLimit extends Error {}
export function readAgentProjectFile(project,path,representation,maxBytes) {
  if(!safeAgentPath(path)||isSecretPath(path))throw Error('Diese Projektdatei darf nicht nachgeladen werden.');
  if(!isAbsolute(project||'')||lstatSync(project).isSymbolicLink())throw Error('Nachladen benötigt einen unverknüpften Projektordner.');
  const root=realpathSync(resolve(project));
  if(!lstatSync(root).isDirectory())throw Error('Projektordner fehlt.');
  const full=target(root,path);
  let bytes=null;
  if(existsSync(full)){
    if(!lstatSync(full).isFile())throw new FileActionConflict(path,`Dateipfad ist inzwischen ein Ordner oder keine reguläre Datei: ${path}. Inhalt bleibt erhalten.`);
    if(maxBytes===undefined)bytes=read(full);
    else{
      const fd=openSync(full,'r');
      try{
        const info=fstatSync(fd);
        if(!info.isFile())throw new FileActionConflict(path,`Dateipfad ist keine reguläre Datei: ${path}.`);
        if(info.size>maxBytes)throw new SourceReadLimit('Datei zum gezielten Nachladen größer als 2 MiB. Andere Dateien können weiter bearbeitet werden.');
        // A growing file is still bounded: never readFileSync first and check later.
        const buffer=Buffer.allocUnsafe(maxBytes+1);let length=0;
        while(length<buffer.length){const n=readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}
        if(length>maxBytes)throw new SourceReadLimit('Datei zum gezielten Nachladen größer als 2 MiB. Andere Dateien können weiter bearbeitet werden.');
        bytes=buffer.subarray(0,length);
      }finally{closeSync(fd);}
    }
  }
  target(root,path);
  return bytes===null?null:representation!==undefined&&matches(bytes,representation)?representation:fileContent(bytes);
}
function fileConflict(path,kind,protection,message) {
  return {ok:false,error:message||`Datei inzwischen geändert: ${path}. Deine Änderungen bleiben erhalten. Mit read_file den aktuellen Stand nachladen und nur unberührte Bereiche mit edit_file bearbeiten.`,
    definitelyNotExecuted:true,fileConflict:{path,kind},...(protection?{protectedFile:protection}:{})};
}
function observe(path,previous,expected,current) {
  try{return {protection:observeFileChange(previous,expected,current)};}
  catch(error){return {conflict:fileConflict(path,current===null?'deleted':'changed',undefined,error.message)};}
}
const LANG = { '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.go': 'go', '.rs': 'rust', '.java': 'java', '.cs': 'csharp', '.php': 'php', '.rb': 'ruby' };

/** Main-process project ownership. No renderer callback is needed to finish an action. */
export class AgentProjectRuntime {
  constructor({ preview, connections, engines, knowledge, debugger: debuggerRuntime } = {}) {
    this.preview = preview; this.connections = connections; this.engines=engines;this.knowledge=knowledge;this.commands=new AgentCommands();
    this.debugger=debuggerRuntime||new AgentDebugger({onState:state=>this.onDebug?.(state,this.id)});
  }
  begin(request, id) {
    this.id = id; this.root = ''; this.rootIdentity = '';
    this.surface=request.surface;
    this.connections?.begin(request);
    this.engines?.begin(request);
    this.commands.begin(request);
    this.debugger.begin(request,id);
    this.knowledge?.begin(request,id);
    this.vision=request.model?.vision===true;
    this.inputMap=request.inputMap;
    if (!request.writeThrough) return;
    if (!isAbsolute(request.project || '') || !lstatSync(request.project).isDirectory()) throw new Error('Direktes Speichern benötigt einen geöffneten Projektordner.');
    this.root = realpathSync(resolve(request.project));
    const rootStat = lstatSync(this.root, { bigint: true });
    this.rootIdentity = `${rootStat.dev}:${rootStat.ino}`;
    for (const [p, content] of Object.entries(request.files)) {
      if (!matches(read(target(this.root, p)), content)) throw new Error(`Projekt und Editor unterscheiden sich: ${p}. Zuerst speichern oder neu laden.`);
    }
  }
  get workspaceOutput() { return this.root ? join(this.root, WORKSPACE_RESULT_FOLDER) : undefined; }
  resultRoot() {
    if (!this.root) return undefined;
    const stat = lstatSync(this.root, { bigint: true });
    if (!stat.isDirectory() || `${stat.dev}:${stat.ino}` !== this.rootIdentity || realpathSync(this.root) !== this.root) {
      throw new Error('Der Projektordner wurde seit dem Auftragsstart ausgetauscht.');
    }
    return this.root;
  }
  async execute(op, { files, signal, before, backupPath, emit, filePlan, changedPaths, operationId, fileProtections={} }) {
    signal.throwIfAborted();
    if(op.kind==='mcp'||op.kind==='cli'){
      if(!this.connections)throw new Error('Hintergrund-Verbindungen nicht verfügbar.');
      return await this.connections.execute(op,{signal,emit,workspaceRoot:this.root ? () => this.resultRoot() : undefined});
    }
    if(op.kind==='knowledge'){
      if(!this.knowledge)throw new Error('Dauerhaftes Hintergrundgedächtnis fehlt.');
      if(this.surface?.id&&this.surface.id!=='anvil'&&this.surface.mode!=='bridge'&&!['list','state','skills','read','run','debug','outcome'].includes(op.action))throw new Error('Schreibende Anvil-Wissenswerkzeuge sind nur im Modus Brücke verfügbar.');
      return this.knowledge.execute(op,{files,signal,operationId});
    }
    if(this.surface?.id && this.surface.id!=='anvil' && this.surface.mode!=='bridge')throw new Error('Anvil-Dateien und Run sind nur im Modus Brücke verfügbar.');
    if(op.kind==='verify-file'){
      const root=this.resultRoot();
      if(!root)return {ok:false,error:'Die Dateiprüfung benötigt einen geöffneten lokalen Projektordner.'};
      return await verifyWorkspaceFile(root,this.rootIdentity,op,signal);
    }
    if(op.kind==='workspace-results'){
      if (!this.root) return { ok: false, error: 'Kein lokaler Projektordner für die Ergebnisdateien geöffnet.' };
      return await scanBoundWorkspaceResults(this.root, this.rootIdentity);
    }
    if(op.kind==='debug')return this.debugger.execute(op,{files,signal});
    if(op.kind==='format'){
      if(!safeAgentPath(op.path)||!Object.hasOwn(files,op.path))throw new Error('Formatierdatei fehlt.');
      return formatAgentFile({path:op.path,content:files[op.path],options:op.options},{signal});
    }
    if(op.kind==='verify')return verifyAgentSnapshot(files,op.paths,{signal});
    if(op.kind==='fetch')return readAgentWeb(op.url,{signal});
    if(op.kind==='shell'||op.kind==='git')return this.commands.execute(op,{signal,files,changedPaths,verifyFiles:root=>{for(const [p,c]of Object.entries(files))if(!matches(read(target(root,p)),c))throw Error(`Datei vor Git-Aktion zuerst speichern: ${p}`);for(const p of changedPaths||[])if(!(p in files)&&existsSync(target(root,p)))throw Error(`Gelöschte Datei ist wieder vorhanden: ${p}`);}});
    if(op.kind==='read'){
      if(!safeAgentPath(op.path))throw Error('Ungültiger Lesepfad.');
      if(!this.root)return {ok:true,content:files[op.path]??null,path:op.path};
      let current;
      try{current=readAgentProjectFile(this.root,op.path,before,MAX_PROTECTED_CONTENT_BYTES);}
      catch(error){if(error instanceof SourceReadLimit||error instanceof FileActionConflict)return {ok:false,error:error.message,definitelyNotExecuted:true};throw error;}
      const previous=fileProtections[op.path];
      const observed=observe(op.path,previous,before,current);
      if(observed.conflict)return observed.conflict;
      return {ok:true,path:op.path,content:current,...(observed.protection?{protectedFile:observed.protection,user_changes_protected:true}:{})};
    }
    if(['delete','rename','mkdir'].includes(op.kind)){
      if(!this.root)return {ok:true,applied:false};
      // Preflight the complete action before any mutation. A protected source
      // cannot be erased or renamed out of the protection by another tool.
      try{for(const [path,change]of Object.entries(filePlan.changes)){
        const current=readAgentProjectFile(this.root,path),previous=fileProtections[path];
        if(current!==change.before||previous){
          const observed=observe(path,previous,change.before,current);
          if(observed.conflict)return observed.conflict;
          return fileConflict(path,current===null?'deleted':current!==change.before?'changed':'protected',observed.protection);
        }
      }
      return applyFileChanges(this.root,filePlan,backupPath);}
      catch(error){
        if(!(error instanceof FileActionConflict))throw error;
        return fileConflict(safeAgentPath(error.path)?error.path:op.path||op.from,'changed',undefined,error.message);
      }
    }
    if(op.kind==='engine'){
      if(!this.engines)throw new Error('Engine-Ausführung nicht verfügbar.');
      return await this.engines.execute(op,{signal,verifyFiles:root=>{
        for(const [p,content] of Object.entries(files)){
          if(!matches(read(target(root,p)),content))throw new Error(`Engine benötigt gespeicherte Dateien: ${p}. Entwürfe zuerst übernehmen oder direktes Speichern einschalten.`);
        }
      }});
    }
    if (op.kind === 'write') {
      if (!this.root) return { ok: true, applied: false };
      const full = target(this.root, op.path);
      if(existsSync(full)&&!lstatSync(full).isFile())return fileConflict(op.path,'changed',undefined,`Dateipfad ist inzwischen ein Ordner oder keine reguläre Datei: ${op.path}. Inhalt bleibt erhalten.`);
      const actual = read(full);
      const previous=fileProtections[op.path];
      if(!matches(actual,before)||previous&&previous.content!==before){
        const current=actual===null?null:fileContent(actual),observed=observe(op.path,previous,before,current);
        if(observed.conflict)return observed.conflict;
        return fileConflict(op.path,current===null?'deleted':'changed',observed.protection);
      }
      const checked=previous?checkProtectedWrite(previous,before,op.content):{ok:true};
      if(!checked.ok)return fileConflict(op.path,previous?.content===null?'deleted':'protected',previous,checked.error);
      // Durable before-image precedes the first project mutation. A later job
      // cannot replace this backup, unlike the latest progress snapshot.
      mkdirSync(dirname(backupPath), { recursive: true });
      if (!existsSync(backupPath)) writeFileSync(backupPath, JSON.stringify({ project: this.root, path: op.path, before }), { flag: 'wx', mode: 0o600 });
      mkdirSync(dirname(full), { recursive: true });
      target(this.root, op.path);
      if (!matches(read(full), before)) {
        const current=readAgentProjectFile(this.root,op.path),observed=observe(op.path,previous,before,current);
        return observed.conflict||fileConflict(op.path,current===null?'deleted':'changed',observed.protection);
      }
      // Synchronous compare/write prevents other host actions interleaving.
      const temporary = full + `.anvil-${this.id}.tmp`;
      writeFileSync(temporary, fileBytes(op.content), { flag: 'wx' });
      try {
        target(this.root, op.path);
        if (!matches(read(full), before)) {
          const current=readAgentProjectFile(this.root,op.path),observed=observe(op.path,previous,before,current);
          return observed.conflict||fileConflict(op.path,current===null?'deleted':'changed',observed.protection);
        }
        renameSync(temporary, full);
      } finally { if (existsSync(temporary)) rmSync(temporary); }
      return { ok: true, applied: true,...(checked.protection?{protectedFile:checked.protection}:{}) };
    }
    if (op.kind === 'run') {
      if (!safeAgentPath(op.path) || !Object.hasOwn(files, op.path)) throw new Error('Startdatei fehlt.');
      if(op.asTest===true){const {prepared}=await import('../agent-build/service-contract.mjs');signal.throwIfAborted();files=prepared(files,op.path);}
      if (/\.html?$/i.test(op.path)) {
        if (!this.preview) throw new Error('HTML-Vorschau nicht verfügbar.');
        return await this.preview.run(op.path, files, signal, this.vision, this.inputMap);
      }
      const lang = LANG[extname(op.path).toLowerCase()];
      if (!lang) throw new Error('Diese Startdatei wird im Hintergrund noch nicht unterstützt.');
      // Compiler and program get the exact acknowledged snapshot, never the
      // concurrently edited project as working directory. No detached children.
      return await compileLang({ lang, entry: op.path, files: Object.entries(files).map(([path, content]) => ({ path, content })), headless: true, timeoutMs: 120000 }, { signal });
    }
    if (op.kind === 'see') return await this.preview?.see(this.vision) || { ok: false, error: 'Keine HTML-Vorschau geöffnet.' };
    if (op.kind === 'play') return await this.preview?.play(op.keys, op.hold, signal, op.actions) || { ok: false, error: 'Keine HTML-Vorschau geöffnet.' };
    throw new Error('Unbekannte Hintergrundaktion.');
  }
  knowledgeEvents(){return this.knowledge?.events()||[];}
  finish() { return Promise.allSettled([this.connections?.close(),this.debugger.close()]); }
  close() { this.preview?.close(); return Promise.allSettled([this.connections?.close(),this.engines?.close(),this.debugger.close(),this.knowledge?.close()]); }
}
