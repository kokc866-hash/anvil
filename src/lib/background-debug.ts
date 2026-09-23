import {useIde,type DebugState} from '../store/ide';

export type BackgroundDebugState=Partial<DebugState>&{ok?:boolean;error?:string;breakpoints?:Record<string,number[]>;value?:string;eval?:string;stdout?:string;stderr?:string};

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
  const id=useIde.getState().debug.backgroundJobId;
  if(!id||!useIde.getState().debug.active)return null;
  const api=(window as unknown as {anvilNative?:{agentJob?:(action:string,payload:unknown)=>Promise<{error?:string;state?:{id:string;lastDebug?:BackgroundDebugState}}>}}).anvilNative?.agentJob;
  if(!api)return Promise.resolve({ok:false,error:'Hintergrund-Debugger nicht verbunden.'});
  return api('debug',{id,action,args}).then(reply=>{
    if(reply.error)throw Error(reply.error);
    const debug=reply.state?.lastDebug;
    if(!debug)throw Error('Keine Debug-Antwort.');
    if(reply.state?.id===id)applyBackgroundDebug(id,debug);
    return debug;
  }).catch(error=>{const message=error instanceof Error?error.message:String(error);useIde.getState().setNotice(message);return{ok:false,error:message};});
}
