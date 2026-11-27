type Lease={leaseId:string;key:string;owner:string};
type Bridge={agentJob?:(action:string,payload?:unknown)=>Promise<unknown>};
const retained=new Map<string,{lease:Lease;release:()=>Promise<unknown>}>();
const bridge=()=>typeof window==='undefined'?undefined:(window as unknown as {anvilNative?:Bridge}).anvilNative;
/** The main process arbitrates real sessions; absence of a desktop bridge is a browser-only run. */
export async function withForegroundResource<T>(operation:()=>Promise<T>,keep?:(value:T)=>string|undefined,onError?:(error:unknown)=>string|undefined):Promise<T>{
  const native=bridge();
  if(!native?.agentJob)return operation();
  const send=native.agentJob.bind(native);
  const lease=await send('resource-acquire',{key:'external',owner:'renderer'}) as Lease;
  if(!lease?.leaseId)throw Error('Die Desktop-Version unterstützt noch keine gemeinsamen Ressourcensperren. Bitte Anvil aktualisieren.');
  let held=false;
  const release=()=>send('resource-release',{leaseId:lease.leaseId,owner:'renderer'});
  const retain=(key:string|undefined)=>{if(key&&!retained.has(key)){retained.set(key,{lease,release});held=true;}};
  try{const value=await operation();retain(keep?.(value));return value;}
  catch(error){retain(onError?.(error));throw error;}
  finally{if(!held)await release();}
}
export async function releaseForegroundResource(key:string):Promise<void>{
  const entry=retained.get(key);if(!entry)return;
  await entry.release();if(retained.get(key)===entry)retained.delete(key);
}
