import {useIde,type DebugState} from '../store/ide';
import {backgroundProject,useBackgroundAgent} from './background-agent';

export type BackgroundDebugState=Partial<DebugState>&{ok?:boolean;error?:string;breakpoints?:Record<string,number[]>;value?:string;eval?:string;stdout?:string;stderr?:string};

export function clearBackgroundDebug(){
  const state=useIde.getState();
  if(state.debug.backgroundJobId)state.setDebug({backgroundJobId:undefined,active:false,paused:false,path:null,line:0,reason:'',stack:[],locals:{},watchValues:{},lastEval:''});
}

/** A native session owns execution; the renderer only mirrors its current pause. */
export function applyBackgroundDebug(id:string,value:BackgroundDebugState){
  const state=useIde.getState(),old=state.debug;
  if(old.active&&!old.backgroundJobId)return;
  if(!value.active&&old.backgroundJobId!==id)return;
  const next={...old,backgroundJobId:id,mode:value.mode||'live',runCompleted:value.runCompleted===true,active:value.active===true,paused:value.paused===true,path:value.path||null,line:value.line||0,
    reason:value.reason||'',stack:value.stack||[],locals:value.locals||{},watches:value.watches||[],watchValues:value.watchValues||{},lastEval:value.lastEval??value.eval??(old.backgroundJobId===id?old.lastEval:'')};
  if(JSON.stringify(next)!==JSON.stringify(old))state.setDebug(next);
  if(value.breakpoints&&JSON.stringify(state.breakpoints)!==JSON.stringify(value.breakpoints))useIde.setState({breakpoints:value.breakpoints});
  if(next.paused&&next.path&&(!old.paused||old.path!==next.path||old.line!==next.line)&&Object.hasOwn(state.files,next.path)){
    state.openFile(next.path);state.revealOutput();window.dispatchEvent(new Event('anvil-debug-tab'));
  }
}

export function backgroundDebugCommand(action:string,args:Record<string,unknown>={}):Promise<BackgroundDebugState>|null{
  const initial=useIde.getState(),id=initial.debug.backgroundJobId;
  if(!id||!initial.debug.active)return null;
  const selected=useBackgroundAgent.getState(),job=selected.job,project=backgroundProject(),epoch=initial.workspaceEpoch,slot=selected.selectedJobId;
  if(job?.id!==id||job.project!==project)return Promise.resolve({ok:false,error:'Zuerst den Auftrag und sein Projekt für diese Debug-Sitzung auswählen.'});
  const current=()=>useIde.getState().workspaceEpoch===epoch&&backgroundProject()===project&&useIde.getState().debug.backgroundJobId===id&&useBackgroundAgent.getState().job?.id===id&&useBackgroundAgent.getState().selectedJobId===slot;
  const api=(window as unknown as {anvilNative?:{agentJob?:(action:string,payload:unknown)=>Promise<{error?:string;state?:{id:string;lastDebug?:BackgroundDebugState}}>}}).anvilNative?.agentJob;
  if(!api)return Promise.resolve({ok:false,error:'Hintergrund-Debugger nicht verbunden.'});
  return api('debug',{id,...(slot?{jobId:slot}:{}),action,args}).then(reply=>{
    if(!current())return {ok:false,error:'Projekt oder Debug-Auftrag wurde inzwischen gewechselt.'};
    if(reply.error)throw Error(reply.error);
    const debug=reply.state?.lastDebug;
    if(!debug)throw Error('Keine Debug-Antwort.');
    if(reply.state?.id===id)applyBackgroundDebug(id,debug);
    return debug;
  }).catch(error=>{const message=error instanceof Error?error.message:String(error);if(current())useIde.getState().setNotice(message);return{ok:false,error:message};});
}
