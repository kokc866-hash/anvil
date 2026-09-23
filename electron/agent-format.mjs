import { existsSync, lstatSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { resolveBin, findInKind, toolEnv } from '../companion/toolchain.mjs';
import { spawnRun } from '../companion/run-process.mjs';
import { createRunFolder, runEnvironment, runRoot } from '../companion/run-storage.mjs';
import { safePath } from './agent-file-actions.mjs';

const nativeExtensions = new Set(['.py','.pyi','.go','.rs','.c','.cc','.cpp','.cxx','.h','.hpp','.hh','.hxx']);
const maxBytes = 2_000_000;
const executable = value => typeof value === 'string' && isAbsolute(value) && !/\.(?:bat|cmd|ps1)$/i.test(value) ? value : null;
function formatter(name, kind) {
  const direct=executable(resolveBin(name));
  if(direct)return direct;
  // Compiler packages include formatters beside their compiler, even when they
  // are not separately represented in Anvil's downloadable toolchain catalog.
  if(kind){
    const compiler=resolveBin(({go:'go',rust:'rustc'})[kind]||name);
    const sibling=compiler&&join(dirname(compiler),name+(process.platform==='win32'?'.exe':''));
    if(sibling&&existsSync(sibling))return executable(sibling);
    return executable(findInKind(kind,[name]));
  }
  return null;
}

/** Formats only a disposable copy. The caller owns the normal draft/write transaction. */
export async function formatAgentFile(input, {signal,tools={},run=spawnRun,timeoutMs=20000}={}) {
  signal?.throwIfAborted();
  const content=typeof input?.content==='string'?input.content:'';
  const fail=(error,via='none')=>({ok:false,content,via,error});
  if(!safePath(input?.path)||typeof input?.content!=='string')return fail('Ungültige Formatierdatei.');
  const ext=extname(input.path).toLowerCase();
  if(!nativeExtensions.has(ext))return fail('Kein nativer Formatter für diesen Dateityp.');
  if(Buffer.byteLength(content)>maxBytes)return fail('Datei für die native Formatierung zu groß.');
  const folders=createRunFolder('background-format');
  const full=join(folders.work,'source'+ext), config=join(folders.work,'formatter.toml');
  const env=runEnvironment(folders,toolEnv());
  // No inherited Python/Node hooks, rustup downloads, user configuration, or
  // project cwd. Formatters receive explicit config rather than discovering it.
  for(const name of ['NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP'])delete env[name];
  Object.assign(env,{RUSTUP_AUTO_INSTALL:'0',GOTOOLCHAIN:'local',PYTHONNOUSERSITE:'1',BLACK_CACHE_DIR:folders.temporary});
  const deadline=Date.now()+Math.max(100,Math.min(60000,Number(timeoutMs)||20000));
  const get=(name,kind)=>Object.hasOwn(tools,name)?executable(tools[name]):formatter(name,kind);
  const execute=async(file,args)=>{
    signal?.throwIfAborted();
    const remaining=deadline-Date.now();
    if(remaining<=0)return {ok:false,stderr:'Zeitlimit der Formatierung erreicht.'};
    const result=await run(file,args,folders.work,remaining,env,{signal});
    signal?.throwIfAborted();
    return result;
  };
  let via='none';
  try{
    writeFileSync(full,content,'utf8');writeFileSync(config,'','utf8');
    let bin,args;
    const width=Math.max(1,Math.min(16,Math.trunc(Number(input.options?.tabSize)||2)));
    if(ext==='.go'){
      bin=get('gofmt','go');args=['-w',full];via='gofmt';
    }else if(ext==='.rs'){
      bin=get('rustfmt','rust');via='rustfmt';
      // No neighbouring modules exist in the scratch folder. The explicit
      // config prevents parent/user rustfmt.toml discovery.
      writeFileSync(config,`tab_spaces = ${width}\nhard_tabs = ${input.options?.insertSpaces===false}\n`);
      const edition=['2015','2018','2021','2024'].includes(String(input.options?.edition))?String(input.options.edition):'2021';
      args=['--config-path',config,'--edition',edition,full];
    }else if(ext==='.py'||ext==='.pyi'){
      bin=get('ruff');via='ruff';
      if(bin)args=['format','--isolated','--no-cache',full];
      else{
        bin=get('black');via='black';
        if(bin)args=['--config',config,'--quiet',full];
        else{
          bin=get('python');
          if(bin){
            const prefix=[...(/(?:^|[\\/])py(?:\.exe)?$/i.test(bin)?['-3']:[]),'-I'];
            const probe=await execute(bin,[...prefix,'-c',"import importlib.util,json; print(json.dumps({m:bool(importlib.util.find_spec(m)) for m in ['ruff','black']}))"]);
            let available;try{available=JSON.parse(probe.stdout);}catch{}
            if(!probe.ok)return fail(String(probe.stderr||'Python-Formatter konnte nicht geprüft werden.').slice(-2000),'python');
            if(available?.ruff){via='ruff';args=[...prefix,'-m','ruff','format','--isolated','--no-cache',full];}
            else if(available?.black){via='black';args=[...prefix,'-m','black','--config',config,'--quiet',full];}
            else bin=null;
          }
        }
      }
    }else{
      bin=get('clang-format','clang');via='clang-format';
      const style=`{BasedOnStyle: LLVM, IndentWidth: ${width}, TabWidth: ${width}, UseTab: ${input.options?.insertSpaces===false?'Always':'Never'}}`;
      args=['-i','--style='+style,'--fallback-style=none','--fail-on-incomplete-format',full];
    }
    if(!bin)return fail(`Kein installierter Formatter verfügbar (${ext==='.py'||ext==='.pyi'?'Ruff oder Black':via}). Es wurde nichts heruntergeladen.`);
    const result=await execute(bin,args);
    if(!result.ok)return fail(String(result.stderr||'Formatter fehlgeschlagen.').slice(-2000),via);
    const stat=lstatSync(full);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)return fail('Formatter hat keine gültige Textdatei zurückgegeben.',via);
    const output=readFileSync(full,'utf8');
    if(output.includes('\0'))return fail('Formatter hat ungültige Textdaten zurückgegeben.',via);
    return {ok:true,content:output,via};
  }catch(error){
    if(signal?.aborted)throw signal.reason;
    return fail(error instanceof Error?error.message:String(error),via);
  }finally{
    // Only the newly created private run directory may be removed.
    const rel=relative(resolve(runRoot()),resolve(folders.dir));
    if(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/')))
      rmSync(folders.dir,{recursive:true,force:true,maxRetries:4,retryDelay:75});
  }
}
