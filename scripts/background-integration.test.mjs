import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'vite';
import path from 'node:path';
import {contentVersion} from '../electron/content-version.mjs';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';

const until=async fn=>{for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Background integration timed out');};
let sequence=0;
const job=(changes={})=>({id:`integration-${++sequence}`,revision:1,project:'integration-project',prompt:'Synthetic request',status:'running',startedAt:1000,text:'',thinking:'',steps:[],plan:[],drafts:{},harness:'',error:'',dismissed:false,...changes});
async function setup(t){
 const keys=['fetch','window','document','localStorage','indexedDB','IDBKeyRange'];
 const previous=keys.map(key=>[key,Object.hasOwn(globalThis,key),globalThis[key]]);
 const values=new Map(),timers=new Set();
 globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;
 globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 globalThis.window=Object.assign(new EventTarget(),{localStorage,setTimeout:(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clearTimeout:id=>{timers.delete(id);clearTimeout(id);}});
 globalThis.document=Object.assign(new EventTarget(),{documentElement:{lang:'de'}});
 const network=[];globalThis.fetch=async(...args)=>{network.push(String(args[0]));throw Error('No model/network allowed in integration fixture');};
 const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':path.resolve('src')}},ssr:{external:['react','react-dom','react/jsx-runtime','zustand','zustand/vanilla','zustand/middleware','js-yaml','fake-indexeddb','lucide-react','@tanstack/react-start','@tanstack/react-router']},optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
 const {useIde}=await server.ssrLoadModule('/src/store/ide.ts');
 await useIde.persist.rehydrate();
 const {useIntern}=await server.ssrLoadModule('/src/lib/intern.ts');useIntern.getState().setPrefs({on:false,autoHeal:false});
 const {useBrain}=await server.ssrLoadModule('/src/lib/brain/store.ts');useBrain.setState({on:false,autoLoad:false,autoUpdate:false,autonomy:'off',jobs:Object.fromEntries(Object.keys(useBrain.getState().jobs).map(k=>[k,false]))});
 const {useLearn}=await server.ssrLoadModule('/src/lib/learn.ts');await useLearn.persist.rehydrate();useLearn.setState({on:false});
 const bg=await server.ssrLoadModule('/src/lib/background-agent.ts');
 const {sendChat}=await server.ssrLoadModule('/src/lib/chat-session.ts');
 const {onPlugin,clearPluginHooks}=await server.ssrLoadModule('/src/lib/plugins/events.ts');
 const {useRequestState}=await server.ssrLoadModule('/src/lib/request-state.ts');
 const stops=[];
 t.after(async()=>{
  stops.forEach(stop=>stop());clearPluginHooks();
  try{const {flushPersistence}=await server.ssrLoadModule('/src/lib/persist-storage.ts');await flushPersistence();const {flushSecrets}=await server.ssrLoadModule('/src/lib/secrets.ts');await flushSecrets();await new Promise(r=>setTimeout(r,30));}
  finally{for(const timer of timers)clearTimeout(timer);await server.close();for(const[key,exists,value]of previous){if(exists)globalThis[key]=value;else delete globalThis[key];}}
  assert.deepEqual(network,[],'helper/model network must remain disabled');
 });
 useIde.setState({workspaceCwd:'',memoryWorkspace:'integration-project',workspaceEpoch:1,files:{'notes.txt':'Synthetic note'},dirs:[],openPaths:[],recentPaths:[],activePath:null,attached:[],dirty:{},pendingDiffs:[],agentRules:'',pendingAsk:null,chat:[],agentBusy:false,agentJob:null,agentInbox:null,agentQueue:[],agentDraft:'',output:[],backgroundAgent:true,backgroundWriteThrough:false,agentMode:'agent',locale:'de',llmProvider:'ollama',llmModel:'qwen3-vl',llmAuthMode:'key',llmBaseUrl:'http://127.0.0.1:1',llmApiKey:'',llmRetries:4,llmToolModes:{},llmCompact:'auto',planWho:'agent',mcpServers:[],activeSurfaceId:'anvil',surfaceMode:'bridge',autoSaveDisk:false,autoPreview:false,sessionTokens:{prompt:0,completion:0,estimated:false},lastRequestTokens:null});
 bg.useBackgroundAgent.setState({available:true,job:null,error:''});
 const monitor=()=>{const stop=bg.startBackgroundAgentMonitor();stops.push(stop);return stop;};
 const deliver=async state=>{
  window.anvilNative={agentJob:async action=>action==='status'?{available:true,state}:{unchanged:true}};
  const stop=monitor();try{await until(()=>bg.useBackgroundAgent.getState().job?.id===state.id&&bg.useBackgroundAgent.getState().job?.revision===state.revision);}finally{stop();}
 };
 return{server,useIde,useRequestState,...bg,sendChat,onPlugin,deliver,monitor};
}
function input(draft='Synthetic request',images=[]){
 const state={draft,images,mention:'notes.txt',cleared:0};
 return{state,props:{draft,images,title:'Fixture',setTitle:()=>{},setDraft:v=>{state.draft=v;state.cleared++;},setImages:v=>state.images=v,setMention:v=>state.mention=v}};
}

test('terminal background messages point only to visible drafts, saved changes or completed runs',async t=>{
 const f=await setup(t);
 const answer=async fields=>{
  const current=job({status:'done',execution:true,text:'Fixture answer.',...fields});
  await f.deliver(current);
  return f.useIde.getState().chat.find(message=>message.backgroundJobId===current.id).content;
 };
 const lastRun={path:'test.cjs',ok:false,stderr:'Assertion failed',code:1};
 const saved={'notes.txt':{before:'Synthetic note',after:'Updated note',applied:true}};
 const drafts={'notes.txt':{before:'Updated note',after:'Proposed note',applied:false}};
 assert.equal(await answer({steps:[{id:'read',name:'read_file',status:'ok'}]}),'Fixture answer.');
 assert.equal(await answer({status:'failed',error:'Wiederholungsschleife',pendingRun:{path:'test.cjs',running:true}}),'Fixture answer.\n\nWiederholungsschleife');
 assert.equal(await answer({resumedFrom:'older',lastRun:{...lastRun,eventId:'older:run:5'}}),'Fixture answer.');
 assert.equal(await answer({lastRun:{path:'test.cjs',ok:false,definitelyNotExecuted:true}}),'Fixture answer.');
 assert.equal(await answer({drafts:{'notes.txt':{before:'Synthetic note',after:'Synthetic note',applied:true}}}),'Fixture answer.');
 assert.match(await answer({drafts:saved}),/In der Spur findest du gespeicherte Dateiänderungen\.$/);
 assert.match(await answer({execution:false,drafts}),/In der Spur findest du Dateientwürfe\.$/);
 assert.match(await answer({lastRun}),/In der Spur findest du das Laufergebnis\.$/);
 assert.match(await answer({drafts:saved,lastRun}),/In der Spur findest du gespeicherte Dateiänderungen und das Laufergebnis\.$/);
 f.useIde.setState({locale:'en'});
 assert.match(await answer({lastRun}),/See the trace for the run result\.$/);
});

test('Qwen and DeepSeek API choices reach the independent background owner without model aliases',async t=>{
 for(const provider of ['qwen','deepseek'])await t.test(provider,async t=>{
  const f=await setup(t),sent=[];
  f.useIde.setState({llmProvider:provider,llmModel:'future-model-fixture',llmBaseUrl:'http://127.0.0.1:1/v1',llmApiKey:'synthetic-key'});
  window.anvilNative={agentJob:async(action,payload)=>{if(action==='start'){sent.push(payload);return{state:job({project:payload.project,prompt:payload.userPrompt})};}return{unchanged:true};}};
  await f.sendChat(input('Explain the artificial fixture.').props);
  assert.equal(sent.length,1,f.useIde.getState().notice);
  assert.equal(sent[0].model.provider,provider);
  assert.equal(sent[0].model.model,'future-model-fixture');
  assert.equal(sent[0].model.apiKey,'synthetic-key');
 });
});

test('agent-owned initial checklist reaches chat UI and retains background progress on reattachment',async t=>{
 const f=await setup(t),sent=[];
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const {AgentTodo}=await f.server.ssrLoadModule('/src/components/ide/chat-trail.tsx');
 const {visibleAgentPlan}=await f.server.ssrLoadModule('/src/lib/plan.ts');
 const renderTodo=()=>renderToStaticMarkup(createElement(AgentTodo,{plan:visibleAgentPlan(f.useIde.getState().chat)}));
 window.anvilNative={agentJob:async(action,payload)=>{if(action==='start'){sent.push(payload);return{state:job({project:payload.project,prompt:payload.userPrompt,plan:payload.plan})};}return{unchanged:true};}};
 await f.sendChat(input('Verbessere das Spiel und ergänze ein erreichbares Ziel.').props);
 assert.ok(sent[0].plan.length>=3,'agent owner needs an initial plan if the model omits set_plan');
 assert.ok(sent[0].plan.every(step=>step.status==='todo'));
 let html=renderTodo();
 assert.match(html,/To-do/);assert.match(html,/prüfen/i);
 const state=f.useBackgroundAgent.getState().job;
 const progress=state.plan.map((step,i)=>({...step,status:i===0?'ok':i===1?'run':'todo'}));
 await f.deliver({...state,revision:2,plan:progress});
 assert.deepEqual(f.useIde.getState().chat.find(m=>m.backgroundJobId===state.id).plan,progress);
 html=renderTodo();assert.match(html,/1\/3/);
 const saved=structuredClone(f.useIde.getState().chat);f.useIde.setState({chat:[]});
 await f.deliver({...state,revision:3,status:'interrupted',plan:progress});
 assert.deepEqual(f.useIde.getState().chat.find(m=>m.backgroundJobId===state.id).plan,progress,'reattaching must retain actual progress');
 f.useIde.setState({chat:[...saved,{id:'new-answer',role:'assistant',content:'No checklist for this answer',plan:[]}]});
 assert.equal(renderTodo(),'','do not resurrect the prior task checklist');
});

test('reattaching a stopped old job reopens an unproved UI step without losing confirmed modules',async t=>{
 const f=await setup(t);
 const {PlanProgress}=await f.server.ssrLoadModule('/src/lib/plan-progress.ts');
 const {AgentWorkflow}=await f.server.ssrLoadModule('/src/lib/agent-workflow.ts');
 const files={'model.js':'export const data = [];','store.js':'export const store = {};'};
 const plan=[{text:'Implement model.js and store.js',kind:'edit',status:'ok'},{text:'Implement index.html and ui.js',kind:'edit',status:'ok'}];
 const progress=new PlanProgress();progress.record('write_file',{path:'model.js'},{ok:true},true);progress.record('write_file',{path:'store.js'},{ok:true},true);
 const snapshot=progress.snapshot();snapshot.plan=structuredClone(plan);
 const id='recovered-todo-fixture';
 const workflow=new AgentWorkflow(files,{},[],undefined,id);await workflow.update(files,{},[]);
 const checkpoint=workflow.checkpoint({planProgress:snapshot});
 const original=job({id,status:'failed',plan:structuredClone(plan),workflow:checkpoint,error:'reasoning_repetition'});
 await f.deliver(original);
 assert.deepEqual(f.useBackgroundAgent.getState().job.plan.map(step=>step.status),['ok','todo']);
 assert.deepEqual(f.useIde.getState().chat.find(message=>message.backgroundJobId===id).plan.map(step=>step.status),['ok','todo']);
 assert.deepEqual(original.plan.map(step=>step.status),['ok','ok'],'presentation does not overwrite the incoming saved checkpoint');
 assert.equal(f.useBackgroundAgent.getState().job.status,'failed','revalidation neither restarts nor completes the job');
 await f.deliver({...original,revision:2,status:'running'});
 assert.deepEqual(f.useBackgroundAgent.getState().job.plan.map(step=>step.status),['ok','ok'],'do not overwrite live progress with an older checkpoint');
 await f.deliver({...original,revision:3,workflow:{...checkpoint,id:'another-job'}});
 assert.deepEqual(f.useBackgroundAgent.getState().job.plan.map(step=>step.status),['ok','ok'],'never borrow a foreign checkpoint');
 await f.deliver({...original,revision:4,workflow:{...checkpoint,planProgress:'{invalid-json'}});
 assert.deepEqual(f.useBackgroundAgent.getState().job.plan.map(step=>step.status),['ok','ok'],'a malformed legacy checkpoint must not break reattachment');
});

test('each checklist owner preserves a user list and helper unavailability leaves a visible fallback',async t=>{
 const f=await setup(t),sent=[];
 window.anvilNative={agentJob:async(action,payload)=>{if(action==='start'){sent.push(payload);return{state:job({status:'done',project:payload.project,prompt:payload.userPrompt,plan:payload.plan})};}return{unchanged:true};}};
 for(const owner of ['auto','agent','anvil','helper']){
  f.useIde.setState({planWho:owner});
  await f.sendChat(input('1. Gegner ergänzen\n2. Levelabschluss prüfen').props);
  const payload=sent.at(-1);assert.ok(payload.planLocked,owner);
  assert.deepEqual(payload.plan.map(step=>step.text),['Gegner ergänzen','Levelabschluss prüfen'],owner);
 }
 f.useIde.setState({planWho:'helper'});
 await f.sendChat(input('Verbessere das Spiel und ergänze ein Ziel.').props);
 assert.ok(sent.at(-1).plan.length>=3);assert.equal(sent.at(-1).planLocked,true);
 assert.ok(sent.at(-1).plan.every(step=>step.status==='todo'));
});

test('helper-owned observation and negative runs receive a safe checklist through the real preparation adapter',async t=>{
 const f=await setup(t),sent=[];
 f.useIde.setState({planWho:'helper'});
 window.anvilNative={agentJob:async(action,payload)=>{if(action==='start'){sent.push(payload);return{state:job({status:'done',project:payload.project,prompt:payload.userPrompt,plan:payload.plan})};}return{unchanged:true};}};
 await f.sendChat(input('Observe the intentional negative test in FreeCAD. Do not repair, edit or change anything.').props);
 assert.deepEqual(sent.at(-1).plan.map(step=>step.kind),['read','report']);
 assert.ok(sent.at(-1).plan.every(step=>step.status==='todo'));
 await f.sendChat(input('Run negative.cjs once as an intentional negative test. Do not repair or change anything.').props);
 assert.deepEqual(sent.at(-1).plan.map(step=>step.kind),['run','report']);
 assert.ok(sent.at(-1).plan.every(step=>step.status==='todo'));
});

test('real background start freezes project instructions, selection, references and configured controls',async t=>{
 const f=await setup(t),sent=[];
 const controls={...f.useIde.getState().inputMap,fire:{keys:['z'],pad:[2]}};
 f.useIde.setState({files:{'AGENTS.md':'Keep the synthetic API stable.','main.ts':'const synthetic = 42;','ref/spec.md':'The synthetic reference needs a blue square.','.env':'SHOULD_NEVER_BE_INCLUDED'},agentRules:'Use clear fixture names.',activePath:'main.ts',openPaths:['main.ts','ref/spec.md'],attached:['ref/spec.md'],pendingAsk:{path:'main.ts',text:'const selectedFixture = 7;'},planWho:'anvil',llmCompact:'aggressive',llmRetries:7,inputMap:controls,runLoop:true,graphLoop:true,testLoop:true,engineLoop:false,loopTries:5,harnessAfterWrite:'run',graphSees:3,autoRunAgent:true});
 window.anvilNative={agentJob:async(action,payload)=>{if(action==='start'){sent.push(payload);return{state:job({project:payload.project,prompt:payload.userPrompt})};}return{unchanged:true};}};
 const entered=input('1. Read existing files\n2. Implement the blue square\n3. Verify the result');let accepted=0;
 await f.sendChat(entered.props,{onAccepted:()=>accepted++});
 assert.equal(sent.length,1);assert.equal(accepted,1);
 const payload=sent[0],context=JSON.stringify(payload.messages);
 for(const value of['Keep the synthetic API stable.','Use clear fixture names.','const selectedFixture = 7;','The synthetic reference needs a blue square.','const synthetic = 42;'])assert.ok(context.includes(value),value);
 assert.equal(payload.files['.env'],undefined);assert.equal(context.includes('SHOULD_NEVER_BE_INCLUDED'),false);
 assert.equal(payload.compact,'aggressive');assert.equal(payload.model.retries,7);assert.equal(payload.effectiveSettings.retries,7);
 assert.equal(payload.planLocked,true);assert.equal(payload.plan.length,3);assert.deepEqual(payload.plan.map(s=>s.text),['Read existing files','Implement the blue square','Verify the result']);
 assert.deepEqual(payload.inputMap.fire,{keys:['z'],pad:[2]});assert.equal(payload.automation.loopTries,5);assert.equal(payload.automation.testLoop,true);
 assert.equal(f.useIde.getState().pendingAsk,null);assert.equal(entered.state.draft,'');assert.deepEqual(entered.state.images,[]);
});

test('follow-up preserves evidence and context display while preparing a smaller request',async t=>{
 const f=await setup(t), previous={prompt:51000,limit:256000,estimated:false};
 f.useIde.setState({lastRequestTokens:previous,chat:[{id:'u1',role:'user',content:'Build a counter'},{id:'a1',role:'assistant',content:'Counter added',changes:[{path:'counter.ts',kind:'add',add:10,del:0}],lastTests:{ok:false,pass:3,fail:1},plan:[{text:'Fix reset',status:'todo'}]}]});
 f.useBackgroundAgent.setState({available:true,job:job({status:'done',dismissed:true})});
 let sent;const next=job({requestTokens:null,requestSequence:0});
 window.anvilNative={agentJob:async(action,payload)=>{if(action==='start'){sent=payload;return{state:next};}return{unchanged:true};}};
 await f.sendChat(input('Now fix the remaining failure').props);
 assert.deepEqual(f.useIde.getState().lastRequestTokens,previous);
 assert.ok(sent.messages.some(m=>m.content==='Build a counter'));
 assert.ok(sent.messages.some(m=>m.content==='Counter added'));
 const handoff=sent.messages.map(m=>m.content).join('\n');
 assert.match(handoff,/counter.ts/);assert.match(handoff,/3 passed, 1 failed/);assert.match(handoff,/Fix reset/);assert.match(handoff,/historical/);
 await f.deliver({...next,revision:2,requestSequence:1,requestTokens:{prompt:10000,limit:256000,estimated:true}});
 assert.equal(f.useIde.getState().lastRequestTokens.prompt,10000);
});

test('image-only sends a descriptive request and image through the actual background route',async t=>{
 const f=await setup(t),sent=[];
 window.anvilNative={agentJob:async(action,payload)=>{if(action==='start'){sent.push(payload);return{state:job({images:payload.userImages,prompt:payload.userPrompt})};}return{unchanged:true};}};
 const image='data:image/png;base64,c3ludGhldGlj',entered=input('',[image]);let accepted=0;
 await f.sendChat(entered.props,{onAccepted:()=>accepted++});
 assert.equal(accepted,1);assert.equal(sent.length,1);assert.equal(sent[0].userPrompt,'Beschreibe das angehängte Bild.');assert.deepEqual(sent[0].userImages,[image]);
 assert.ok(JSON.stringify(sent[0].messages).includes(image));assert.deepEqual(entered.state.images,[]);
 assert.equal(f.useIde.getState().chat.find(m=>m.role==='user').images[0],image);
});

test('refused start preserves draft, attachments, selection and inbox until a later acceptance',async t=>{
 const f=await setup(t),entered=input('Queued synthetic request',['data:image/png;base64,c3ludGhldGlj']);
 const entry={text:entered.props.draft,mode:'agent'},selection={path:'notes.txt',text:'keep selection'};
 f.useIde.setState({agentInbox:entry,pendingAsk:selection});let accepted=0,starts=0,allow=false;
 const onAccepted=()=>{accepted++;f.useIde.setState({agentInbox:null});};
 window.anvilNative={agentJob:async action=>{if(action==='start'){starts++;return allow?{state:job()}:{error:'Fixture start refused'};}return{unchanged:true};}};
 await f.sendChat(entered.props,{onAccepted});
 assert.equal(starts,1);assert.equal(accepted,0);assert.equal(entered.state.cleared,0);assert.equal(entered.state.draft,entry.text);assert.equal(entered.state.images.length,1);assert.deepEqual(f.useIde.getState().pendingAsk,selection);assert.equal(f.useIde.getState().agentInbox,entry);assert.equal(f.useIde.getState().agentBusy,false);
 allow=true;await f.sendChat(entered.props,{onAccepted});
 assert.equal(starts,2);assert.equal(accepted,1);assert.equal(f.useIde.getState().agentInbox,null);assert.equal(entered.state.draft,'');
});

test('busy and simultaneous queued sends are retained until the corresponding native start is accepted',async t=>{
 const f=await setup(t);let release,starts=0;
 const entries=[{text:'First synthetic order',mode:'agent'},{text:'Second synthetic order',mode:'agent'}];f.useIde.setState({agentQueue:entries});
 window.anvilNative={agentJob:async action=>{if(action==='start'){starts++;return new Promise(resolve=>release=()=>resolve({state:job({prompt:entries[0].text})}));}return{unchanged:true};}};
 let first=0,second=0;
 const waiting=f.sendChat(input(entries[0].text).props,{queued:true,onAccepted:()=>{first++;f.useIde.setState({agentQueue:[entries[1]]});}});
 await until(()=>release);
 await f.sendChat(input(entries[1].text).props,{queued:true,onAccepted:()=>second++});
 assert.equal(starts,1);assert.equal(first,0);assert.equal(second,0);assert.deepEqual(f.useIde.getState().agentQueue,entries);
 release();await waiting;assert.equal(first,1);assert.equal(second,0);assert.deepEqual(f.useIde.getState().agentQueue,[entries[1]]);
 await f.sendChat(input(entries[1].text).props,{queued:true,onAccepted:()=>second++});assert.equal(starts,1);assert.equal(second,0);assert.deepEqual(f.useIde.getState().agentQueue,[entries[1]]);
});

test('live monitor reattaches when returning to the project without token replay or duplicate chat',async t=>{
 const f=await setup(t),state=job({requestSequence:1,requestTokens:{prompt:456,limit:32768,estimated:false},usage:{prompt:456,completion:12,estimated:false}});let calls=0;
 window.anvilNative={agentJob:async action=>action==='status'?(++calls===1?{state}:{unchanged:true}):{unchanged:true}};
 f.monitor();await until(()=>f.useIde.getState().chat.some(m=>m.id===`background-${state.id}`));
 const saved=structuredClone({chat:f.useIde.getState().chat,sessionTokens:f.useIde.getState().sessionTokens});
 f.useIde.setState({memoryWorkspace:'another-project',workspaceEpoch:2,chat:[],sessionTokens:{prompt:0,completion:0,estimated:false},lastRequestTokens:null});
 await new Promise(r=>setImmediate(r));assert.equal(f.useIde.getState().chat.length,0);assert.equal(f.useIde.getState().lastRequestTokens,null);
 f.useIde.setState({memoryWorkspace:state.project,workspaceEpoch:3,...saved,lastRequestTokens:null});
 await until(()=>f.useIde.getState().lastRequestTokens?.prompt===456);
 assert.equal(f.useIde.getState().sessionTokens.prompt,456);assert.equal(f.useIde.getState().sessionTokens.completion,12);assert.equal(f.useIde.getState().chat.filter(m=>m.id===`background-${state.id}`).length,1);
});

test('finished snapshots connect run output, duration, stop reason and plugin events exactly once',async t=>{
 const f=await setup(t),events=[];
 f.onPlugin('change',value=>events.push(['change',value]));f.onPlugin('run',value=>events.push(['run',value.id]));
 const state=job({status:'done',finishedAt:7400,text:'Paused with work remaining.',execution:true,stopReason:'round-limit',harness:'Arbeit · Runden 8 · Tools 5',plan:[{text:'Verify',status:'todo'}],drafts:{'created.ts':{before:null,after:'export const ready = true;',applied:true,version:1}},lastRun:{id:'test-1',path:'created.ts',ok:false,stdout:'synthetic stdout',stderr:'synthetic failure',duration:450,attempt:2,max:4}});
 await f.deliver(state);
 const assistant=f.useIde.getState().chat.find(m=>m.id===`background-${state.id}`);
 assert.equal(assistant.ms,6400);assert.equal(assistant.incompleteReason,'Rundenlimit erreicht');assert.match(assistant.harness,/Rundenlimit erreicht/);assert.match(assistant.harness,/Tools 5/);
 assert.equal(assistant.lastRun.ok,false);assert.equal(assistant.lastRun.attempt,2);assert.equal(assistant.lastRun.max,4);assert.equal(assistant.lastRun.stderr,'synthetic failure');assert.ok(assistant.changes.some(c=>c.path==='created.ts'));
 assert.equal(f.useIde.getState().output.length,1);assert.equal(f.useIde.getState().output[0].duration,0.45);assert.equal(f.useIde.getState().output[0].stdout,'synthetic stdout');
 assert.deepEqual(events,[['change','created.ts'],['run','test-1']]);
 await f.deliver({...state,revision:2});assert.equal(f.useIde.getState().output.length,1);assert.equal(events.length,2);
 // Simulate persisted chat returning after renderer reconnect; the event cursor must survive.
 f.useIde.setState({chat:JSON.parse(JSON.stringify(f.useIde.getState().chat))});
 await f.deliver({...state,revision:3});assert.equal(f.useIde.getState().output.length,1);assert.equal(events.length,2);
 await f.deliver({...state,revision:4,lastRun:{...state.lastRun,id:'test-2',ok:true}});assert.equal(f.useIde.getState().output.length,2);assert.deepEqual(events.at(-1),['run','test-2']);
});

test('background diagnostics preserve other compilers, reject stale fingerprints and do not duplicate on replay',async t=>{
 const f=await setup(t);
 const hit=(path,message,source='fixture-check')=>({path,message,source,line:1,col:1,severity:'error'});
 const manual=hit('current.ts','Manual compiler finding','tsc'),other=hit('unrelated.ts','Other project finding','custom');
 const obsolete=hit('current.ts','Old background finding','background:fixture-check');
 const files={'current.ts':'const current=1;','stale.ts':'const changed=2;','dirty.ts':'const dirty=3;'};
 f.useIde.setState({files,dirty:{'dirty.ts':true}});f.useIde.getState().setCompileProblems([manual,other,obsolete]);
 const state=job({lastDiagnostics:{ok:false,detail:'Synthetic diagnostics',versions:{'current.ts':contentVersion(files['current.ts']),'stale.ts':contentVersion('const old=0;'),'dirty.ts':contentVersion(files['dirty.ts']),'deleted.ts':contentVersion('deleted')},hits:[hit('current.ts','New current finding'),hit('stale.ts','Stale finding must not appear'),hit('dirty.ts','Dirty finding must not appear'),hit('deleted.ts','Deleted finding must not appear')]}});
 await f.deliver(state);
 assert.deepEqual(f.useIde.getState().compileProblems,[manual,other,{...hit('current.ts','New current finding'),source:'background:fixture-check'}]);
 await f.deliver({...state,revision:2});assert.equal(f.useIde.getState().compileProblems.length,3);
 assert.equal(f.useIde.getState().compileProblems.filter(h=>h.message==='New current finding').length,1);
 await f.deliver({...state,revision:3,lastDiagnostics:{ok:true,detail:'Current file clean',versions:{'current.ts':contentVersion(files['current.ts'])},hits:[]}});
 assert.deepEqual(f.useIde.getState().compileProblems,[manual,other],'a clean background result clears only its own matching-file diagnostics');
});

test('historical finished background snapshots cannot overwrite active foreground request status',async t=>{
 const f=await setup(t);
 const request={id:404,phase:'thinking',detail:'Active foreground inference',at:12345};
 f.useIde.setState({agentBusy:true});f.useRequestState.setState(request);
 const state=job({status:'done',finishedAt:6000,text:'Historical completion'});
 await f.deliver(state);assert.deepEqual(f.useRequestState.getState(),request);assert.equal(f.useIde.getState().agentBusy,true);
 await f.deliver({...state,revision:2});assert.deepEqual(f.useRequestState.getState(),request);
});

test('stable file and run event identities avoid plugin replay when a job resumes under a new id',async t=>{
 const f=await setup(t),events=[];
 f.onPlugin('change',value=>events.push(['change',value]));f.onPlugin('run',value=>events.push(['run',value.eventId]));
 const state=job({status:'done',finishedAt:6000,drafts:{'stable.ts':{before:null,after:'original write',applied:true,version:1,eventId:'file-operation-1'}},lastRun:{id:'first-local-run',eventId:'run-operation-1',path:'stable.ts',ok:true,stdout:'First completed run',duration:10}});
 await f.deliver(state);assert.deepEqual(events,[['change','stable.ts'],['run','run-operation-1']]);assert.equal(f.useIde.getState().output.length,1);
 f.useIde.setState({chat:JSON.parse(JSON.stringify(f.useIde.getState().chat))});
 const resumed={...state,id:'resumed-'+state.id,status:'running',revision:1,resumedFrom:state.id,lastRun:{...state.lastRun,id:'new-local-run-id'}};
 await f.deliver(resumed);assert.equal(events.length,2);assert.equal(f.useIde.getState().output.length,1,'the same real run must not be added again');
 await f.deliver({...resumed,revision:2});assert.equal(events.length,2);
 await f.deliver({...resumed,revision:3,drafts:{'stable.ts':{...state.drafts['stable.ts'],after:'new resumed write',version:2,eventId:'file-operation-2'}},lastRun:{...resumed.lastRun,eventId:'run-operation-2',stdout:'A new completed run'}});
 assert.deepEqual(events,[['change','stable.ts'],['run','run-operation-1'],['change','stable.ts'],['run','run-operation-2']]);assert.equal(f.useIde.getState().output.length,2);
});

test('waiting for a user answer releases busy state without pretending the job has finished',async t=>{
 const f=await setup(t),state=job();
 const journal=structuredClone(f.useIde.getState().sessionJournal);
 await f.deliver(state);assert.equal(f.useIde.getState().agentBusy,true);
 await f.deliver({...state,revision:2,status:'waiting-user',parked:true,ask:{id:'choice',prompt:'Which fixture?',why:'Need a choice',choices:[{id:'A',label:'Fixture A'},{id:'B',label:'Fixture B'}],allowText:false,blocking:'hard'}});
 const assistant=f.useIde.getState().chat.find(m=>m.id===`background-${state.id}`);
 assert.equal(f.useIde.getState().agentBusy,false);assert.equal(f.useRequestState.getState().phase,'waiting');
 assert.equal(assistant.backgroundFinalized,false);assert.equal(assistant.ms,undefined);assert.equal(assistant.harness,'Wartet auf deine Antwort');
 assert.match(assistant.content,/Deine Antwort wird benötigt/);assert.doesNotMatch(assistant.content,/beendet|fertig/i);
 assert.deepEqual(f.useIde.getState().sessionJournal,journal,'parking must not distill a completion journal');
 await f.deliver({...state,id:'answered-'+state.id,resumedFrom:state.id,revision:1,status:'running'});
 const old=f.useIde.getState().chat.find(m=>m.id===`background-${state.id}`);
 assert.equal(old.backgroundWaiting,false);assert.equal(old.backgroundContinued,true);assert.equal(old.backgroundFinalized,true);
});
