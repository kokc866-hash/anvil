import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'vite';
import path from 'node:path';
import {knowledgeVersion} from '../electron/agent-knowledge-state.mjs';

const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Knowledge hydration fixture timed out');};

test('monitor defers native knowledge until durable hydration, requests a full snapshot and applies exactly once',async t=>{
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
 const state={id:'hydration-job',revision:7,project:'I:/hydration-qa',prompt:'Synthetic request',status:'running',startedAt:1000,text:'',thinking:'',steps:[],plan:[],drafts:{},harness:'',error:'',dismissed:false,knowledgeEvents:[event,added]};
 let release;const persisted=[];
 useLearn.persist.setOptions({storage:{getItem:()=>new Promise(resolve=>{release=resolve;}),setItem:(_name,value)=>persisted.push(structuredClone(value)),removeItem:()=>{}}});
 const hydrating=useLearn.persist.rehydrate();await until(()=>release);assert.equal(useLearn.persist.hasHydrated(),false);
 const calls=[];let initialStatus=true;
 window.anvilNative={agentJob:async(action,payload)=>{
  calls.push({action,payload});
  if(action==='permissions')return {state}; // IPC permissions must supply uncursored full state.
  if(action==='status'&&initialStatus){initialStatus=false;return {available:true,state};}
  return {unchanged:true};
 }};
 bg.useBackgroundAgent.setState({available:true,job:null,error:''});stop=bg.startBackgroundAgentMonitor();
 await until(()=>bg.useBackgroundAgent.getState().job?.id===state.id);
 assert.deepEqual(useLearn.getState().facts,[],'native preimages must not merge against unhydrated defaults');
 assert.deepEqual(useLearn.getState().backgroundKnowledgeEvents,[],'early events must remain replayable');
 assert.equal(calls.filter(call=>call.action==='permissions').length,0,'default permissions must not revoke a running task before hydration');
 assert.equal(persisted.length,0,'incoming native events must not overwrite durable storage before it has loaded');
 release({state:{on:true,prefs:{...LEARN_DEFAULTS},facts:[fact,other],skills:[],forgotten:[],forgottenFacts:[],backgroundKnowledgeEvents:[],events:[],eventCount:0},version:0});
 await hydrating;await until(()=>useLearn.getState().backgroundKnowledgeEvents.length===2);
 assert.equal(useLearn.getState().facts.length,3);assert.equal(useLearn.getState().facts.find(item=>item.id===fact.id).hits,2);assert.deepEqual(useLearn.getState().facts.find(item=>item.id===other.id),other);
 const permissions=calls.find(call=>call.action==='permissions');assert.ok(permissions);assert.equal(permissions.payload.id,undefined);assert.equal(permissions.payload.revision,undefined,'hydration must not get an unchanged reply for the early snapshot revision');
 useLearn.getState().setPref('person',false);
 await until(()=>calls.filter(call=>call.action==='permissions').length===2);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(useLearn.getState().facts.length,3);assert.equal(useLearn.getState().facts.find(item=>item.id===fact.id).hits,2);
 assert.deepEqual(useLearn.getState().backgroundKnowledgeEvents,[event.id,added.id]);
 assert.ok(persisted.some(value=>value.state.backgroundKnowledgeEvents?.length===2));
});
