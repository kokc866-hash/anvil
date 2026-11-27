import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'vite';
import path from 'node:path';
import {knowledgeVersion} from '../electron/agent-knowledge-state.mjs';

const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Knowledge hydration fixture timed out');};

for(const status of ['running','done'])test(`monitor defers ${status} native knowledge until durable hydration, requests a full snapshot and applies exactly once`,async t=>{
 const values=new Map(),oldFetch=globalThis.fetch;
 globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 globalThis.window=Object.assign(new EventTarget(),{localStorage,setTimeout,clearTimeout});
 globalThis.document=Object.assign(new EventTarget(),{documentElement:{lang:'de'}});
 const network=[];globalThis.fetch=async(...args)=>{network.push(String(args[0]));throw Error('Network forbidden in hydration fixture');};
 const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':path.resolve('src')}},optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
 let stop=()=>{};
 t.after(async()=>{
  stop();
  try{const {flushPersistence}=await server.ssrLoadModule('/src/lib/persist-storage.ts');await flushPersistence();}
  finally{await server.close();globalThis.fetch=oldFetch;delete globalThis.window;delete globalThis.document;delete globalThis.localStorage;}
  assert.deepEqual(network,[]);
 });
 const {useIde}=await server.ssrLoadModule('/src/store/ide.ts');
 const {useLearn,LEARN_DEFAULTS}=await server.ssrLoadModule('/src/lib/learn.ts');
 const {useIntern}=await server.ssrLoadModule('/src/lib/intern.ts');useIntern.getState().setPrefs({on:false,autoHeal:false});
 const {useBrain}=await server.ssrLoadModule('/src/lib/brain/store.ts');useBrain.setState({on:false,autoLoad:false,autoUpdate:false,autonomy:'off',jobs:Object.fromEntries(Object.keys(useBrain.getState().jobs).map(key=>[key,false]))});
 const bg=await server.ssrLoadModule('/src/lib/background-agent.ts');
 await until(()=>useLearn.persist.hasHydrated());
 useIde.setState({workspaceCwd:'I:/hydration-qa',workspaceEpoch:1,files:{},dirs:[],openPaths:[],recentPaths:[],activePath:null,attached:[],dirty:{},pendingDiffs:[],agentRules:'',pendingAsk:null,chat:[],agentBusy:false,agentJob:null,agentInbox:null,agentQueue:[],output:[],backgroundAgent:true,locale:'de',mcpServers:[],activeSurfaceId:'anvil',surfaceMode:'bridge',autoSaveDisk:false,autoPreview:false,sessionTokens:{prompt:0,completion:0,estimated:false},lastRequestTokens:null});
 const fact={id:'saved-one',kind:'user',scope:'user',text:'Persisted user preference',conf:.85,hits:1,at:1};
 const other={...fact,id:'saved-two',text:'Unrelated durable preference'};
 const created={...fact,id:'new-background',text:'New background preference'};
 const event={id:'knowledge:update',jobId:'hydration-job',project:'I:/hydration-qa',workspace:'v2:path:i:/hydration-qa',collection:'facts',recordId:fact.id,before:fact,beforeVersion:knowledgeVersion(fact),after:{...fact,hits:2},action:'add',at:2};
 const added={...event,id:'knowledge:create',recordId:created.id,before:null,beforeVersion:null,after:created};
 const state={id:'hydration-job',revision:7,project:'I:/hydration-qa',prompt:'Synthetic request',status,startedAt:1000,text:'',thinking:'',steps:[],plan:[],drafts:{},harness:'',error:'',dismissed:false,knowledgeEvents:[event,added]};
 let release;const persisted=[];
 useLearn.persist.setOptions({storage:{getItem:()=>new Promise(resolve=>{release=resolve;}),setItem:(_name,value)=>persisted.push(structuredClone(value)),removeItem:()=>{}}});
 const hydrating=useLearn.persist.rehydrate();await until(()=>release);assert.equal(useLearn.persist.hasHydrated(),false);
 const calls=[];let initialStatus=true,statusPaused=false,releaseStatus;
 window.anvilNative={agentJob:async(action,payload)=>{
  calls.push({action,payload});
  if(action==='jobs')return {jobs:[{jobId:'slot-hydration',id:state.id,project:state.project,busy:status==='running',services:[]}],selectedJobId:'slot-hydration'};
  if(action==='permissions')return {state};
  if(action==='status'){
   if(initialStatus){initialStatus=false;return {available:true,state};}
   if(!statusPaused&&payload?.revision===state.revision){statusPaused=true;return new Promise(resolve=>{releaseStatus=()=>resolve({unchanged:true});});}
   return payload?.revision===state.revision?{unchanged:true}:{available:true,state};
  }
  return {unchanged:true};
 }};
 bg.useBackgroundAgent.setState({available:true,job:null,error:''});stop=bg.startBackgroundAgentMonitor();
 await until(()=>bg.useBackgroundAgent.getState().job?.id===state.id);
 assert.deepEqual(useLearn.getState().facts,[],'native preimages must not merge against unhydrated defaults');
 assert.deepEqual(useLearn.getState().backgroundKnowledgeEvents,[],'early events must remain replayable');
 assert.equal(calls.filter(call=>call.action==='permissions').length,0,'default permissions must not revoke a running task before hydration');
 assert.equal(persisted.length,0,'incoming native events must not overwrite durable storage before it has loaded');
 await until(()=>calls.filter(call=>call.action==='status').length>=2);
 assert.equal(calls.filter(call=>call.action==='status')[1].payload.revision,state.revision,'normal polling acknowledges the early snapshot while knowledge remains unhydrated');
 release({state:{on:true,prefs:{...LEARN_DEFAULTS},facts:[fact,other],skills:[],forgotten:[],forgottenFacts:[],backgroundKnowledgeEvents:[],events:[],eventCount:0},version:0});
 await hydrating;releaseStatus();await until(()=>useLearn.getState().backgroundKnowledgeEvents.length===2);
 await until(()=>calls.filter(call=>call.action==='status').slice(2).some(call=>call.payload.revision===undefined));
 const full=calls.filter(call=>call.action==='status').slice(2).find(call=>call.payload.revision===undefined);
 assert.deepEqual(full.payload,{jobId:'slot-hydration'},'durable hydration replays knowledge from a full status snapshot, even without an active job');
 assert.equal(useLearn.getState().facts.length,3);assert.equal(useLearn.getState().facts.find(item=>item.id===fact.id).hits,2);assert.deepEqual(useLearn.getState().facts.find(item=>item.id===other.id),other);
 const permissions=calls.find(call=>call.action==='permissions');
 if(status==='running'){
  assert.ok(permissions);assert.equal(permissions.payload.id,state.id);assert.equal(permissions.payload.jobId,'slot-hydration');assert.equal(permissions.payload.revision,undefined,'permissions remain uncursored and address the exact active job');
 }else assert.equal(permissions,undefined,'a finished job needs no permission mutation to recover its durable events');
 useLearn.getState().setPref('person',false);
 if(status==='running')await until(()=>calls.filter(call=>call.action==='permissions').length===2);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(useLearn.getState().facts.length,3);assert.equal(useLearn.getState().facts.find(item=>item.id===fact.id).hits,2);
 assert.deepEqual(useLearn.getState().backgroundKnowledgeEvents,[event.id,added.id]);
 assert.ok(persisted.some(value=>value.state.backgroundKnowledgeEvents?.length===2));
});
