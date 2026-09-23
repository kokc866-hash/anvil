import { existsSync, lstatSync, realpathSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute, extname } from 'node:path';
import { compileLang } from '../companion/compile-run.mjs';
import { fileBytes, sameBytes } from '../scripts/file-content.mjs';
import { applyFileChanges } from './agent-file-actions.mjs';
import { AgentCommands } from './agent-commands.mjs';
import { verifyAgentSnapshot } from './agent-diagnostics.mjs';
import { readAgentWeb } from './agent-web.mjs';
import { AgentDebugger } from './agent-debugger.mjs';
import { formatAgentFile } from './agent-format.mjs';

export const safeAgentPath = p => typeof p === 'string' && p.length > 0 && p.length < 512 &&
  !/[\\:\x00-\x1f]/.test(p) && !p.split('/').some(x => !x || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(x)) &&
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
const LANG = { '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.go': 'go', '.rs': 'rust', '.java': 'java', '.cs': 'csharp', '.php': 'php', '.rb': 'ruby' };

/** Main-process project ownership. No renderer callback is needed to finish an action. */
export class AgentProjectRuntime {
  constructor({ preview, connections, engines, knowledge, debugger: debuggerRuntime } = {}) {
    this.preview = preview; this.connections = connections; this.engines=engines;this.knowledge=knowledge;this.commands=new AgentCommands();
    this.debugger=debuggerRuntime||new AgentDebugger({onState:state=>this.onDebug?.(state,this.id)});
  }
  begin(request, id) {
    this.id = id; this.root = '';
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
    for (const [p, content] of Object.entries(request.files)) {
      if (!matches(read(target(this.root, p)), content)) throw new Error(`Projekt und Editor unterscheiden sich: ${p}. Zuerst speichern oder neu laden.`);
    }
  }
  async execute(op, { files, signal, before, backupPath, emit, filePlan, changedPaths, operationId }) {
    signal.throwIfAborted();
    if(op.kind==='mcp'||op.kind==='cli'){
      if(!this.connections)throw new Error('Hintergrund-Verbindungen nicht verfügbar.');
      return await this.connections.execute(op,{signal,emit});
    }
    if(this.surface?.id && this.surface.id!=='anvil' && this.surface.mode!=='bridge')throw new Error('Anvil-Dateien und Run sind nur im Modus Brücke verfügbar.');
    if(op.kind==='debug')return this.debugger.execute(op,{files,signal});
    if(op.kind==='format'){
      if(!safeAgentPath(op.path)||!Object.hasOwn(files,op.path))throw new Error('Formatierdatei fehlt.');
      return formatAgentFile({path:op.path,content:files[op.path],options:op.options},{signal});
    }
    if(op.kind==='knowledge'){
      if(!this.knowledge)throw new Error('Dauerhaftes Hintergrundgedächtnis fehlt.');
      return this.knowledge.execute(op,{files,signal,operationId});
    }
    if(op.kind==='verify')return verifyAgentSnapshot(files,op.paths,{signal});
    if(op.kind==='fetch')return readAgentWeb(op.url,{signal});
    if(op.kind==='shell'||op.kind==='git')return this.commands.execute(op,{signal,files,changedPaths,verifyFiles:root=>{for(const [p,c]of Object.entries(files))if(!matches(read(target(root,p)),c))throw Error(`Datei vor Git-Aktion zuerst speichern: ${p}`);for(const p of changedPaths||[])if(!(p in files)&&existsSync(target(root,p)))throw Error(`Gelöschte Datei ist wieder vorhanden: ${p}`);}});
    if(['delete','rename','mkdir'].includes(op.kind))return this.root?applyFileChanges(this.root,filePlan,backupPath):{ok:true,applied:false};
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
      const actual = read(full);
      if (!matches(actual, before)) throw new Error(`Datei inzwischen geändert: ${op.path}. Entwurf bleibt erhalten.`);
      // Durable before-image precedes the first project mutation. A later job
      // cannot replace this backup, unlike the latest progress snapshot.
      mkdirSync(dirname(backupPath), { recursive: true });
      if (!existsSync(backupPath)) writeFileSync(backupPath, JSON.stringify({ project: this.root, path: op.path, before }), { flag: 'wx', mode: 0o600 });
      mkdirSync(dirname(full), { recursive: true });
      target(this.root, op.path);
      if (!matches(read(full), before)) throw new Error(`Datei inzwischen geändert: ${op.path}.`);
      // Synchronous compare/write prevents other host actions interleaving.
      const temporary = full + `.anvil-${this.id}.tmp`;
      writeFileSync(temporary, fileBytes(op.content), { flag: 'wx' });
      try {
        target(this.root, op.path);
        if (!matches(read(full), before)) throw new Error(`Datei während der Speicherung geändert: ${op.path}.`);
        renameSync(temporary, full);
      } finally { if (existsSync(temporary)) rmSync(temporary); }
      return { ok: true, applied: true };
    }
    if (op.kind === 'run') {
      if (!safeAgentPath(op.path) || !Object.hasOwn(files, op.path)) throw new Error('Startdatei fehlt.');
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
    if (op.kind === 'play') return await this.preview?.play(op.keys, op.hold, signal) || { ok: false, error: 'Keine HTML-Vorschau geöffnet.' };
    throw new Error('Unbekannte Hintergrundaktion.');
  }
  knowledgeEvents(){return this.knowledge?.events()||[];}
  finish() { return Promise.allSettled([this.connections?.close(),this.debugger.close()]); }
  close() { this.preview?.close(); return Promise.allSettled([this.connections?.close(),this.engines?.close(),this.debugger.close(),this.knowledge?.close()]); }
}
