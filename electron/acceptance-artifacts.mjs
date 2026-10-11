import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { acceptanceMeasurements } from './task-acceptance.mjs';
import { safeAgentPath } from './agent-project-runtime.mjs';

/** Hash only regular files in the owning project; never follow a junction or read outside it. */
async function digestArtifact(project, artifact, signal, budget) {
  signal.throwIfAborted();
  if(!project||!isAbsolute(project)||typeof artifact!=='string'||artifact.length>512)throw Error('Artefakt benötigt eine gespeicherte Datei im zugehörigen Projekt.');
  const root=await realpath(project),full=resolve(root,artifact),rel=relative(root,full).replaceAll('\\','/');
  if(!safeAgentPath(rel))throw Error('Artefakt liegt außerhalb des freigegebenen Projektbereichs oder verwendet einen gesperrten Pfad.');
  let current=root;
  for(const part of rel.split('/')){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('Artefakt darf keine Verknüpfung oder Ordnerumleitung verwenden.');}
  const before=await stat(full);
  if(!before.isFile()||before.size>512*1024*1024)throw Error('Artefakt muss eine reguläre Datei mit höchstens 512 MB sein.');
  if(++budget.files>32||(budget.bytes+=before.size)>512*1024*1024)throw Error('Die Artefaktprüfung ist auf 32 Dateien und insgesamt 512 MB pro Werkzeugaufruf begrenzt.');
  signal.throwIfAborted();
  const digest=createHash('sha256');
  for await(const bytes of createReadStream(full,{signal}))digest.update(bytes);
  const after=await stat(full);
  const canonical=await realpath(full),samePath=process.platform==='win32'?canonical.toLowerCase()===full.toLowerCase():canonical===full;
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||!samePath)throw Error('Artefakt wurde während der Prüfung verändert.');
  signal.throwIfAborted();
  return digest.digest('hex');
}

/** Native provenance replaces any tool-supplied claim with host-computed file checks. */
export async function verifyAcceptanceArtifacts(result,project,signal) {
  if(!result||typeof result!=='object'||Array.isArray(result))return result;
  const timeout=AbortSignal.timeout(15000),bounded=signal?AbortSignal.any([signal,timeout]):timeout;
  const {rows}=acceptanceMeasurements(result),checks=[],seen=new Set(),cache=new Map(),budget={files:0,bytes:0};
  for(const row of rows){
    if(!row||typeof row!=='object'||typeof row.artifact!=='string'||typeof row.sha256!=='string')continue;
    const key=JSON.stringify([row.artifact,row.sha256]);if(seen.has(key))continue;seen.add(key);
    try{
      if(!cache.has(row.artifact)){
        try{cache.set(row.artifact,{sha256:await digestArtifact(project,row.artifact,bounded,budget)});}
        catch(error){cache.set(row.artifact,{error});}
      }
      const cached=cache.get(row.artifact);if(cached.error)throw cached.error;
      const {sha256}=cached;
      checks.push({artifact:row.artifact,sha256:row.sha256,ok:sha256===row.sha256,
        ...(sha256===row.sha256?{}:{reason:'Die angegebene Prüfsumme stimmt nicht mit der gespeicherten Datei überein.',reasonEn:'The reported digest does not match the saved file.'})});
    }catch(error){
      signal?.throwIfAborted();
      checks.push({artifact:row.artifact,sha256:row.sha256,ok:false,
        reason:bounded.aborted?'Die Datei-Prüfung hat ihr Zeitlimit erreicht. Der Messnachweis bleibt unbestätigt.':error.code==='ENOENT'?'Die angegebene Artefaktdatei wurde im Projekt nicht gefunden.':error.message,
        reasonEn:'The artifact could not be verified as a regular file in the owning project.'});
    }
  }
  return {...result,anvilArtifactChecks:checks};
}
