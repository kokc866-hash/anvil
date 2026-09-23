import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parsePyCompile } from '../companion/lint.mjs';
import { lspHome } from '../companion/lsp.mjs';
import { resolveBin, toolEnv } from '../companion/toolchain.mjs';
import { spawnRun } from '../companion/run-process.mjs';
import { createRunFolder, runEnvironment, saveRunRecord } from '../companion/run-storage.mjs';
import { withNodeEnv } from './node-cmd.mjs';
import { safePath } from './agent-file-actions.mjs';
import { contentVersion } from './content-version.mjs';

const require = createRequire(import.meta.url);
const parser = fileURLToPath(new URL('./agent-diagnostics-worker.mjs', import.meta.url));
function typescriptCompiler() {
  const installed = join(lspHome(), 'node_modules', 'typescript', 'lib', 'typescript.js');
  if (existsSync(installed)) return installed;
  try { return require.resolve('typescript'); } catch { return null; }
}
const available = (tools, name, find) => Object.hasOwn(tools, name) ? tools[name] : find();

/** Independent diagnostics of the acknowledged snapshot; no project execution/config/plugins. */
export async function verifyAgentSnapshot(files, paths, { signal, tools = {}, run = spawnRun, timeoutMs = 30000 } = {}) {
  signal?.throwIfAborted();
  if (!Array.isArray(paths) || paths.length > 128 || paths.some(p => !safePath(p))) throw Error('Ungültige Dateiauswahl für die Prüfung.');
  const selected = [...new Set(paths)], checked = [], unchecked = [], hits = [], typeChecked = [];
  const folders = createRunFolder('background-check');
  const environment = runEnvironment(folders, toolEnv());
  delete environment.NODE_OPTIONS; delete environment.NODE_PATH;
  const nodeEnv = withNodeEnv(environment, Boolean(process.versions.electron));
  const deadline = Date.now() + Math.min(120000, Math.max(100, timeoutMs));
  const texts = []; let bytes = 0;
  for (const path of selected) {
    const content = files[path];
    if (typeof content !== 'string' || /^data:[^,]*;base64,/.test(content)) { unchecked.push({path, reason:'Keine Textdatei im aktuellen Dateistand.'}); continue; }
    bytes += Buffer.byteLength(content);
    if (content.length > 1000000 || bytes > 16000000) { unchecked.push({path,reason:'Datei oder Dateiauswahl überschreitet das Prüflimit.'}); continue; }
    const full = join(folders.work, path);
    mkdirSync(dirname(full), {recursive:true});writeFileSync(full, content);
    texts.push({path,content});
  }
  const execute = async (file,args,env=environment) => {
    signal?.throwIfAborted();
    const remaining = deadline-Date.now();
    if (remaining <= 0) return {ok:false,stderr:'Zeitbudget der Prüfung erreicht.',timedOut:true};
    const result=await run(file,args,folders.work,remaining,env,{signal});
    signal?.throwIfAborted();
    return result;
  };
  const incomplete = (path,result) => unchecked.push({path,reason:String(result.stderr||'Prüfwerkzeug konnte nicht abgeschlossen werden.').slice(-500)});
  const tsFiles=[];
  for (const entry of texts) {
    const {path,content}=entry;
    if (/\.(?:ts|tsx|mts|cts|jsx)$/i.test(path)) {tsFiles.push(entry);continue;}
    if (/\.json$/i.test(path)) {
      try { JSON.parse(content); } catch(error) {hits.push({path,line:1,col:1,severity:'error',message:error.message.slice(0,500),source:'json-syntax'});}
      checked.push(path);continue;
    }
    if (/\.[cm]?js$/i.test(path)) {
      const result=await execute(process.execPath,['--check',join(folders.work,path)],nodeEnv);
      if(result.ok){checked.push(path);continue;}
      const error=result.stderr.match(/SyntaxError:\s*([^\n]+)/);
      if(!error || result.timedOut || result.aborted){incomplete(path,result);continue;}
      const line=result.stderr.match(/:(\d+)\s*\r?\n/);
      hits.push({path,line:Number(line?.[1])||1,col:1,severity:'error',message:error[0].slice(0,500),source:'node-syntax'});checked.push(path);continue;
    }
    if (/\.py$/i.test(path)) {
      const python=available(tools,'python',()=>resolveBin('python'));
      if(!python){unchecked.push({path,reason:'Python ist nicht eingerichtet; Syntax nicht geprüft.'});continue;}
      const args=[...(/(?:^|[\\/])py(?:\.exe)?$/i.test(python)?['-3']:[]),'-I','-S','-m','py_compile',path];
      const result=await execute(python,args);
      const found=parsePyCompile(result.stderr+'\n'+result.stdout).map(hit=>({...hit,path}));
      if(result.ok || (found.length && !result.timedOut && !result.aborted)){checked.push(path);hits.push(...found);}else incomplete(path,result);
      continue;
    }
    unchecked.push({path,reason:'Für diesen Dateityp ist hier keine unabhängige Syntaxprüfung angebunden.'});
  }
  if(tsFiles.length){
    const compiler=available(tools,'typescript',typescriptCompiler);
    if(!compiler)for(const {path}of tsFiles)unchecked.push({path,reason:'TypeScript-Prüfer ist nicht eingerichtet; Syntax nicht geprüft.'});
    else{
      const sourceMap=new Map(tsFiles.map(entry=>[entry.path,entry]));
      let snapshotBytes=tsFiles.reduce((total,entry)=>total+Buffer.byteLength(entry.content),0);
      for(const [path,content]of Object.entries(files)){
        if(sourceMap.has(path)||!safePath(path)||typeof content!=='string'||content.length>1000000||! /\.(?:[cm]?[jt]sx?|json)$/i.test(path))continue;
        const size=Buffer.byteLength(content);
        if(sourceMap.size>=128||snapshotBytes+size>16000000)continue;
        sourceMap.set(path,{path,content});snapshotBytes+=size;
      }
      const snapshot=[...sourceMap.values()];
      const manifest=join(folders.out,'syntax-input.json');writeFileSync(manifest,JSON.stringify({files:snapshot,roots:tsFiles.map(x=>x.path)}));
      const result=await execute(process.execPath,[parser,compiler,manifest],nodeEnv);
      let report;try{report=JSON.parse(result.stdout);}catch{}
      if(result.ok&&Array.isArray(report?.hits)){
        const allowed=new Set(snapshot.map(x=>x.path));
        hits.push(...report.hits.filter(hit=>allowed.has(hit.path)&&['error','warning'].includes(hit.severity)));
        checked.push(...tsFiles.map(x=>x.path));
        typeChecked.push(...tsFiles.map(x=>x.path));
      }else for(const {path}of tsFiles)incomplete(path,result);
    }
  }
  signal?.throwIfAborted();
  const errors=hits.filter(hit=>hit.severity==='error').length,warnings=hits.length-errors;
  const detail=[`Unabhängige Prüfung: ${checked.length}/${selected.length} Dateien, ${errors} Fehler, ${warnings} Warnungen. JS/JSON/Python: Syntax; TS/TSX/JSX: Syntax und Typen mit isolierten Standardoptionen und bekannten Dateien. Keine Ausführung, keine Python-Typprüfung und kein Funktionstest.`,
    ...hits.slice(0,100).map(hit=>`${hit.path}:${hit.line}:${hit.col} ${hit.severity}: ${hit.message}`),
    ...unchecked.map(item=>`${item.path}: Nicht geprüft: ${item.reason}`)].join('\n');
  const versions=Object.fromEntries([...new Set([...checked,...hits.map(h=>h.path)])].filter(p=>typeof files[p]==='string').map(p=>[p,contentVersion(files[p])]));
  const result={ok:errors===0&&unchecked.length===0&&checked.length>0,detail,hits:hits.slice(0,100),checked,unchecked,versions,scopes:{syntax:checked,types:typeChecked}};
  saveRunRecord(folders,{...result,stdout:detail,stderr:''});
  return result;
}
