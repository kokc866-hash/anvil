import { isAbsolute, resolve } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { engineBinaries, detectDiskEngines, selectEngineCommand, runEngineCommand, findBinary } from '../companion/engine-runtime.mjs';
import { engineEnvironment } from '../companion/engine-config.mjs';
import { toolEnv } from '../companion/toolchain.mjs';

/** Engine processes belong to the job, including after editor/play reports ready. */
export class AgentEngines {
  constructor({ environment=()=>engineEnvironment(toolEnv()), run=runEngineCommand }={}) {
    this.environment=environment;this.run=run;this.jobs=new Set();this.last=null;
  }
  begin(request) {
    if(this.jobs.size)throw new Error('Vorherige Engine wird noch beendet. Kurz warten.');
    this.root='';this.last=null;
    if(isAbsolute(request.project||'')){
      try{if(lstatSync(request.project).isDirectory())this.root=realpathSync(resolve(request.project));}catch{}
    }
  }
  status() {
    const env=this.environment(),bins=engineBinaries(env);
    const found=this.root?detectDiskEngines(this.root):{engines:[],truncated:false};
    return {ok:true,engines:found.engines.map(hit=>({...hit,installed:Boolean(bins[hit.id==='unreal'?'UnrealEditor':hit.id]?.file || (['bevy','love'].includes(hit.id)&&findBinary(hit.id==='bevy'?'cargo':'love',env)))})),bins,lastRun:this.last,truncated:found.truncated};
  }
  async execute(op,{signal,verifyFiles}) {
    signal.throwIfAborted();
    if(op.action==='status')return this.status();
    if(op.action!=='run')throw new Error('Unbekannte Engine-Aktion.');
    if(!this.root)throw new Error('Für Engine-Aufträge zuerst einen lokalen Projektordner öffnen.');
    const args=op.args||{},action=String(args.action||'check');
    if(!['play','editor','check','test'].includes(action))throw new Error('Unbekannte Engine-Aktion.');
    if(args.cmd)throw new Error('Im Hintergrund die angebotenen Engine-Aktionen verwenden; freie Befehle benötigen den bisherigen Betrieb.');
    if(['play','editor'].includes(action)&&this.jobs.size)throw new Error('Eine Engine dieses Auftrags läuft bereits. Vor einem weiteren Start schließen.');
    const found=detectDiskEngines(this.root),cmd=selectEngineCommand(found,{...args,action});
    if(found.truncated)throw new Error('Engine-Suche unvollständig. Einen kleineren Projektordner öffnen.');
    verifyFiles(this.root);
    const controller=new AbortController();
    let complete,started=false;
    const job={controller,done:new Promise(r=>{complete=r;})};this.jobs.add(job);
    const ended=result=>{this.last=result;this.jobs.delete(job);complete();};
    try{
      const result=await this.run(this.root,cmd,Number(args.timeoutMs)||120000,{
        action,env:this.environment(),signal:AbortSignal.any([signal,controller.signal]),keepAbort:true,
        onStart(){started=true;},onExit:ended,
      });
      if(!started)ended(result);
      // A log-write failure can occur after spawn. Keep ownership until the
      // actual child exit, rather than losing a still-running engine.
      if(started&&!result.running&&this.jobs.has(job)){controller.abort();await job.done;}
      this.last=result;
      return {...result,action,...(result.running?{status:'Engine gestartet. Noch kein erfolgreicher Build oder Test nachgewiesen.'}:{})};
    }catch(error){controller.abort();if(!started)ended({ok:false,error:String(error)});throw error;}
  }
  async close(){const jobs=[...this.jobs];for(const job of jobs)job.controller.abort();await Promise.allSettled(jobs.map(job=>job.done));}
}
