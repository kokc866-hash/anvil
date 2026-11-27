import { createServer } from 'vite';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

// Keep the production loop and stores real; replace only model and execution boundaries.
export async function agentLoopFixture(t) {
  const root=path.resolve('artifacts/loop-graph-implementation-2026-10-06/fixtures');mkdirSync(root,{recursive:true});
  const cacheDir=mkdtempSync(path.join(root,'vite-'));
  const keys=['window','document','localStorage','indexedDB','IDBKeyRange','fetch'];
  const previous=keys.map(key=>[key,Object.hasOwn(globalThis,key),globalThis[key]]);
  const values=new Map(),timers=new Set();
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
  globalThis.window=Object.assign(new EventTarget(),{localStorage,setTimeout:(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clearTimeout:id=>{timers.delete(id);clearTimeout(id);}});
  globalThis.document=Object.assign(new EventTarget(),{documentElement:{lang:'de'},getElementById:()=>null});
  globalThis.fetch=async()=>{throw Error('External network is unavailable in the workflow fixture');};
  const server=await createServer({configFile:false,root:process.cwd(),cacheDir,resolve:{alias:{'@':path.resolve('src')}},
    ssr:{external:['react','react/jsx-runtime','react-dom','zustand','zustand/vanilla','zustand/middleware','js-yaml','fake-indexeddb']},
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
  t.after(async()=>{
    try{const {flushPersistence}=await server.ssrLoadModule('/src/lib/persist-storage.ts');await flushPersistence();}
    finally{for(const timer of timers)clearTimeout(timer);await server.close();if(cacheDir.startsWith(root+path.sep))rmSync(cacheDir,{recursive:true,force:true});for(const [key,exists,value]of previous){if(exists)globalThis[key]=value;else delete globalThis[key];}}
  });
  const {useIde}=await server.ssrLoadModule('/src/store/ide.ts');await useIde.persist.rehydrate();
  const {useIntern}=await server.ssrLoadModule('/src/lib/intern.ts');useIntern.getState().setPrefs({on:false,autoHeal:false});
  const {useBrain}=await server.ssrLoadModule('/src/lib/brain/store.ts');useBrain.setState({on:false,autoLoad:false,autoUpdate:false,autonomy:'off',jobs:Object.fromEntries(Object.keys(useBrain.getState().jobs).map(key=>[key,false]))});
  const {useLearn}=await server.ssrLoadModule('/src/lib/learn.ts');await useLearn.persist.rehydrate();useLearn.setState({on:false});
  useIde.setState({workspaceCwd:'',workspaceEpoch:1,files:{},dirty:{},chat:[],autoSaveDisk:false,autoRunAgent:false,autoPreview:false,testLoop:false,runLoop:false,graphLoop:false,agentJob:null,agentBusy:false,mcpServers:[],activeSurfaceId:'anvil',surfaceMode:'bridge'});
  return {server,useIde,...await server.ssrLoadModule('/src/lib/agent-core.ts'),...await server.ssrLoadModule('/src/lib/agent-abort.ts')};
}

export const tool=(name,args)=>({content:'',tool_calls:[{id:`fixture-${name}-${crypto.randomUUID()}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
