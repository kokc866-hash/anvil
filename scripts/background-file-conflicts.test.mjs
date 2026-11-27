import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {AgentProjectRuntime} from '../electron/agent-project-runtime.mjs';
import {createNativeWorkspace} from '../electron/native-workspace.mjs';
import {agentLoopFixture} from '../fixtures/agent-loop-fixture.mjs';

const project='conflict-renderer-qa';
const userCss='body { background: #242323; }\nheader { color: black; }\n';
const agentCss='body { background: #1a1a2e; }\nheader { color: white; }\n';
const conflict={kind:'changed',message:'Datei inzwischen geändert; Nutzeränderungen geschützt.'};
let sequence=0;
const job=(overrides={})=>({id:`conflict-${++sequence}`,project,revision:1,draftRevision:1,status:'running',startedAt:1000,
  prompt:'Artificial file-conflict fixture',text:'',thinking:'',steps:[],plan:[],harness:'Arbeit',drafts:{},error:'',execution:true,...overrides});

async function setup(t){
 const f=await agentLoopFixture(t);
 const bg=await f.server.ssrLoadModule('/src/lib/background-agent.ts');
 f.useIde.setState({workspaceCwd:'',memoryWorkspace:project,workspaceEpoch:1,locale:'de',files:{'styles.css':userCss,'notes.txt':'User notes'},
   dirs:[],dirty:{},pendingDiffs:[],chat:[],openPaths:['notes.txt'],recentPaths:[],activePath:'notes.txt',agentBusy:false,agentJob:null,
   agentInbox:null,agentQueue:[],pendingAsk:null,notice:'',backgroundAgent:true,backgroundWriteThrough:true,mcpServers:[],
   sessionTokens:{prompt:0,completion:0,estimated:false},lastRequestTokens:null});
 bg.useBackgroundAgent.setState({job:null,available:true,error:'',selectedJobId:null,jobs:[]});
 window.alert=()=>assert.fail('No alert dialog belongs in conflict recovery');
 window.confirm=()=>assert.fail('No confirmation dialog belongs in conflict recovery');
 const deliver=async(state,{metadataOnly=false}={})=>{
  const full=metadataOnly?Object.fromEntries(Object.entries(state).filter(([key])=>key!=='drafts')):state;
  window.anvilNative={agentJob:async action=>action==='status'?{available:true,state:full,...(metadataOnly?{draftsUnchanged:true}:{})}:{unchanged:true}};
  const stop=bg.startBackgroundAgentMonitor();
  try{
   for(let n=0;n<100;n++){
    if(bg.useBackgroundAgent.getState().job?.id===state.id&&bg.useBackgroundAgent.getState().job?.revision===state.revision)return;
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   throw Error('Background conflict snapshot was not accepted');
  }finally{stop();}
 };
 return {...f,...bg,deliver};
}

test('a conflict flag prevents auto-install even if the snapshot incorrectly says applied',async t=>{
 const f=await setup(t);
 const state=job({drafts:{
  'styles.css':{before:userCss,after:agentCss,applied:true,version:1,conflict},
  'helper.js':{before:null,after:'export const helper = 1;',applied:true,version:2},
 }});
 await f.deliver(state);
 const current=f.useIde.getState();
 assert.equal(current.files['styles.css'],userCss,'The explicit conflict must outweigh the applied flag');
 assert.equal(current.files['helper.js'],'export const helper = 1;','Independent confirmed work still arrives');
 assert.equal(current.activePath,'helper.js');
 assert.deepEqual(current.pendingDiffs,[]);
});

test('dirty and saved user versions survive repeat polls and a fresh renderer connection',async t=>{
 const f=await setup(t),unsaved=userCss+'/* unsaved user note */\n';
 f.useIde.setState({files:{'styles.css':unsaved,'notes.txt':'User notes'},dirty:{'styles.css':true}});
 const state=job({drafts:{'styles.css':{before:userCss,after:agentCss,applied:false,version:1,conflict}}});
 await f.deliver(state);
 await f.deliver({...state,revision:2},{metadataOnly:true});
 assert.equal(f.useIde.getState().files['styles.css'],unsaved);
 assert.equal(f.useIde.getState().dirty['styles.css'],true);
 assert.equal(f.useIde.getState().activePath,'notes.txt');
 f.useIde.setState({files:{'styles.css':userCss,'notes.txt':'User notes'},dirty:{},chat:JSON.parse(JSON.stringify(f.useIde.getState().chat))});
 await f.deliver({...state,revision:3,drafts:{'styles.css':{...state.drafts['styles.css'],applied:true}}});
 assert.equal(f.useIde.getState().files['styles.css'],userCss);
 assert.equal(f.useIde.getState().activePath,'notes.txt');
});

test('manual draft apply cannot adopt a conflict proposal even when its original baseline matches',async t=>{
 const f=await setup(t),state=job({status:'failed',finishedAt:2000,drafts:{
  'styles.css':{before:userCss,after:agentCss,applied:false,version:1,conflict},
 }});
 await f.deliver(state);
 await f.applyBackgroundDrafts();
 assert.equal(f.useIde.getState().files['styles.css'],userCss);
 assert.deepEqual(f.useIde.getState().pendingDiffs,[],'A blocked proposal must not become an editor patch');
 assert.match(f.useIde.getState().notice,/Konflikt|geändert/i);
});

test('manual restore does not dispatch a conflicting file transaction',async t=>{
 const f=await setup(t),state=job({status:'failed',finishedAt:2000,drafts:{
  'styles.css':{before:userCss,after:agentCss,applied:false,version:1,conflict},
 }});
 await f.deliver(state);
 const calls=[];
 window.anvilNative={agentJob:async action=>{calls.push(action);return{unchanged:true};}};
 await f.restoreBackgroundFiles();
 assert.deepEqual(calls,[],'Renderer must not request restore over a recorded user conflict');
 assert.equal(f.useIde.getState().files['styles.css'],userCss);
 assert.match(f.useIde.getState().notice,/Konflikt|geändert/i);
});

test('an unresolved conflict cannot be presented as a fully completed saved change',async t=>{
 const f=await setup(t),state=job({status:'done',finishedAt:2000,text:'Modellantwort mit ungeprüfter Erfolgsmeldung.',drafts:{
  'styles.css':{before:userCss,after:agentCss,applied:false,version:1,conflict},
 }});
 await f.deliver(state);
 const message=f.useIde.getState().chat.find(message=>message.backgroundJobId===state.id);
 assert.match(message.incompleteReason||'',/Dateikonflikt/i);
 assert.match(message.content,/styles\.css/);
 assert.equal(f.useIde.getState().files['styles.css'],userCss);
});

test('a conflicted deletion keeps its parent directory while independent file work arrives',async t=>{
 const f=await setup(t);
 f.useIde.setState({files:{'src/styles.css':userCss,'notes.txt':'User notes'},dirs:['src','empty-old']});
 const state=job({drafts:{
  'src/styles.css':{before:userCss,after:null,applied:true,version:1,conflict:{kind:'deleted'}},
  'new/helper.js':{before:null,after:'export const helper = 1;',applied:true,version:2},
 },directoryChanges:{src:{before:true,after:false,applied:true},'empty-old':{before:true,after:false,applied:true},new:{before:false,after:true,applied:true}}});
 await f.deliver(state);
 const stateNow=f.useIde.getState();
 assert.equal(stateNow.files['src/styles.css'],userCss);
 assert.equal(stateNow.dirs.includes('src'),true,'A retained conflicted file must retain its directory');
 assert.equal(stateNow.dirs.includes('empty-old'),false,'Unrelated confirmed directory work remains usable');
 assert.equal(stateNow.files['new/helper.js'],'export const helper = 1;');
 assert.equal(stateNow.activePath,'new/helper.js');
});

test('a later confirmed narrow edit arrives after the conflict is cleared',async t=>{
 const f=await setup(t),state=job({drafts:{'styles.css':{before:userCss,after:agentCss,applied:false,version:1,conflict}}});
 await f.deliver(state);
 const saved=userCss.replace('header { color: black; }','header { color: white; }');
 await f.deliver({...state,revision:2,draftRevision:2,drafts:{'styles.css':{before:userCss,after:saved,applied:true,version:2}}});
 assert.equal(f.useIde.getState().files['styles.css'],saved);
 assert.match(f.useIde.getState().files['styles.css'],/#242323/);
 assert.equal(f.useIde.getState().activePath,'styles.css');
});

test('background assistant replacement and reattachment never inherit a generic round checkpoint',async t=>{
 const f=await setup(t),state=job();
 const checkpoint={id:'foreground-checkpoint',at:1,label:'Unrelated foreground round',files:{'notes.txt':'original'},dirs:[],
  endFiles:{'notes.txt':'User notes'},endDirs:[],workspace:project};
 const priorForeground={id:'foreground-message',role:'assistant',at:1,content:'Older genuine foreground round.',checkpointId:checkpoint.id};
 const legacy={id:`background-${state.id}`,role:'assistant',at:state.startedAt,content:'Legacy background metadata.',backgroundJobId:state.id,checkpointId:checkpoint.id};
 f.useIde.setState({checkpoints:[checkpoint],chat:[priorForeground,legacy]});
 await f.deliver(state);
 let message=f.useIde.getState().chat.find(message=>message.backgroundJobId===state.id);
 assert.equal(message.checkpointId,undefined,'Background results must never route to generic checkpoint restoration');
 assert.equal(f.useIde.getState().chat.find(message=>message.id===priorForeground.id).checkpointId,checkpoint.id);
 // A fresh full native connection must also clean rehydrated older metadata.
 f.useIde.setState({chat:JSON.parse(JSON.stringify(f.useIde.getState().chat)).map(message=>message.backgroundJobId===state.id?{...message,checkpointId:checkpoint.id}:message)});
 await f.deliver({...state,revision:2});
 message=f.useIde.getState().chat.find(message=>message.backgroundJobId===state.id);
 assert.equal(message.checkpointId,undefined);
 await f.deliver({...state,revision:3,status:'done',finishedAt:2000});
 assert.deepEqual(f.useIde.getState().checkpoints,[checkpoint],'Background finalization must not reseal an unrelated foreground checkpoint');
});

function sendInput(draft){return {draft,images:[],setDraft(){},setImages(){},setMention(){}};}
function prepareSender(f){
 f.useIde.setState({backgroundWriteThrough:false,llmProvider:'custom',llmAuthMode:'key',llmModel:'synthetic-conflict',
  llmBaseUrl:'http://127.0.0.1:1/v1',llmApiKey:'',llmRetries:1,llmContextAuto:false,llmContext:32768,llmMaxOut:1024});
 const sent=[];
 window.anvilNative={agentJob:async(action,payload)=>{
  if(action==='start'||action==='resume'){
   sent.push({action,payload});
   return{state:job({project:payload.project,prompt:payload.userPrompt,status:'done',finishedAt:2000})};
  }
  return{unchanged:true};
 }};
 return sent;
}

async function nativeAssetFixture(t){
 const f=await setup(t),sent=prepareSender(f);
 const parent=resolve('artifacts/blender-dateiabgleich-2026-11-23');
 mkdirSync(parent,{recursive:true});
 const base=mkdtempSync(join(parent,'asset-fixture-')),root=join(base,'project');
 mkdirSync(root);
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 const disk=createNativeWorkspace(base);
 disk.remember(root);
 const oldAsset=Buffer.alloc(1392221,0x81),newAsset=Buffer.alloc(1569918,0x82);
 const originals={'figure.blend':oldAsset,'figure.blend1':Buffer.from([0x80,0]),'removed.asset':Buffer.from([0x81,0]),'notes.txt':Buffer.from('User notes')};
 for(const [path,bytes] of Object.entries(originals))writeFileSync(join(root,path),bytes);
 const tree=disk.run({action:'tree',root});
 assert.equal(tree.ok,true,tree.error);
 f.useIde.setState({workspaceCwd:root,workspaceNative:true,backgroundWriteThrough:true,files:tree.files});
 writeFileSync(join(root,'figure.blend'),newAsset);
 writeFileSync(join(root,'figure.blend1'),oldAsset);
 rmSync(join(root,'removed.asset'));
 const runtime=new AgentProjectRuntime();
 t.after(()=>runtime.close());
 const respond=window.anvilNative.agentJob;
 window.anvilNative={
  workspaceDisk:async request=>disk.run(request),
  agentJob:async(action,payload)=>{
   if(action==='start'||action==='resume')runtime.begin(payload,'asset-fixture');
   return respond(action,payload);
  },
 };
 return {...f,sent,root,oldAsset,newAsset};
}

test('a native continuation reconciles closed binary assets after an external save',async t=>{
 const f=await nativeAssetFixture(t);
 const old=job({project:f.root,status:'done',finishedAt:2000});
 f.useBackgroundAgent.setState({job:old});
 await f.trySendBackground(sendInput('mach weiter'),'agent');
 assert.equal(f.sent.length,1,f.useIde.getState().notice);
 const [{payload}]=f.sent;
 assert.equal(payload.continuationId,old.id);
 assert.equal(Object.hasOwn(payload.files,'figure.blend'),false);
 assert.equal(Object.hasOwn(payload.files,'removed.asset'),false);
 assert.equal(payload.files['figure.blend1'],`data:application/octet-stream;base64,${f.oldAsset.toString('base64')}`);
 const current=f.useIde.getState();
 assert.deepEqual(current.files,payload.files);
 assert.equal(current.activePath,'notes.txt');
 assert.deepEqual(current.dirty,{});
 assert.deepEqual(readFileSync(join(f.root,'figure.blend')),f.newAsset);
 assert.deepEqual(readFileSync(join(f.root,'figure.blend1')),f.oldAsset);
});

test('binary refresh cannot absorb an editor change made while opening a native job',async t=>{
 const f=await nativeAssetFixture(t);
 const read=window.anvilNative.workspaceDisk;
 window.anvilNative.workspaceDisk=async request=>{
  f.useIde.setState(state=>({files:{...state.files,'notes.txt':'Unsaved user edit'},dirty:{'notes.txt':true}}));
  return read(request);
 };
 await f.trySendBackground(sendInput('Prüfe das Projekt.'),'agent');
 assert.deepEqual(f.sent,[]);
 assert.equal(f.useIde.getState().files['notes.txt'],'Unsaved user edit');
 assert.equal(f.useIde.getState().dirty['notes.txt'],true);
 assert.equal(readFileSync(join(f.root,'notes.txt'),'utf8'),'User notes');
});

test('short chat continuation sends the previous job ID captured before preparation yields',async t=>{
 const f=await setup(t),sent=prepareSender(f);
 const old=job({status:'failed',finishedAt:2000});
 f.useBackgroundAgent.setState({job:old});
 const pending=f.trySendBackground(sendInput('mach weiter'),'agent');
 f.useBackgroundAgent.setState({job:job({status:'done',finishedAt:3000})});
 assert.equal(await pending,true);
 assert.equal(sent.length,1,f.useIde.getState().notice);
 assert.equal(sent[0].action,'start');
 assert.equal(sent[0].payload.continuationId,old.id,'Native protection must be inherited from the originally selected job');
});

test('substantive tasks and an unrelated project do not inherit a prior job protection scope',async t=>{
 const f=await setup(t),sent=prepareSender(f);
 f.useBackgroundAgent.setState({job:job({status:'done',finishedAt:2000})});
 await f.trySendBackground(sendInput('Ergänze eine neue Rabattberechnung in cart.js.'),'agent');
 assert.equal(sent.length,1,f.useIde.getState().notice);
 assert.equal(Object.hasOwn(sent[0].payload,'continuationId'),false);
 f.useBackgroundAgent.setState({job:job({project:'another-project',status:'done',finishedAt:2000})});
 await f.trySendBackground(sendInput('weiter'),'agent');
 assert.equal(sent.length,2,f.useIde.getState().notice);
 assert.equal(Object.hasOwn(sent[1].payload,'continuationId'),false,'Another workspace must never supply the continuation owner');
});

test('explicit native resume keeps its own ID without adding a second continuation selector',async t=>{
 const f=await setup(t),sent=prepareSender(f);
 const old=job({status:'failed',finishedAt:2000});
 f.useBackgroundAgent.setState({job:old});
 await f.trySendBackground(sendInput('weiter'),'agent',{id:old.id});
 assert.equal(sent.length,1,f.useIde.getState().notice);
 assert.equal(sent[0].action,'resume');
 assert.equal(sent[0].payload.resumeId,old.id);
 assert.equal(Object.hasOwn(sent[0].payload,'continuationId'),false);
});
