import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'vite';
import {fork} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {buildAgentRuntime} from './build-agent-runtime.mjs';
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Token update timed out');};

test('real background worker reports pending context and confirmed usage through the host',async()=>{
 mkdirSync('artifacts',{recursive:true});
 const root=mkdtempSync(path.resolve('artifacts','token-worker-')),build=path.join(root,'worker');mkdirSync(build);
 await buildAgentRuntime(build); // Never replace the worker of a running user test.
 let requests=0,release;
 const api=httpServer(async(req,res)=>{
  for await(const chunk of req){};
  const n=++requests;
  if(n===1)await new Promise(r=>release=r);
  const delta=n===1?{tool_calls:[{index:0,id:'read',function:{name:'read_file',arguments:'{"path":"notes.txt"}'}}]}:{content:'Gelesen.'};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:n===1?'tool_calls':'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:n===1?1234:2222,completion_tokens:n===1?56:33}})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(r=>api.listen(0,'127.0.0.1',r));
 const host=new AgentJobHost({snapshotPath:path.join(root,'state.json'),launch:()=>fork(path.join(build,'worker.mjs'),[],{stdio:['ignore','ignore','inherit','ipc']})});
 try{
  host.start({project:'tokens',files:{'notes.txt':'Synthetic note'},messages:[{role:'user',content:'Lies notes.txt und antworte kurz. Keine Änderungen.'}],maxRounds:8,model:{provider:'custom',baseUrl:`http://127.0.0.1:${api.address().port}/v1`,model:'fixture',context:32768,thinking:'off',maxOut:1000,hardStopMin:1}});
  await until(()=>release&&host.state.requestTokens);
  assert.ok(host.state.requestTokens.prompt>0);
  assert.equal(host.state.requestTokens.estimated,true);
  assert.equal(host.state.requestTokens.limit,32768);
  assert.equal(host.state.usage.prompt,0,'pending input is not already a completed request');
  release();
  await until(()=>!host.busy());
  assert.equal(host.state.status,'done',host.state.error);
  assert.equal(requests,2);
  assert.deepEqual(host.state.usage,{prompt:3456,completion:89,estimated:false});
  assert.deepEqual(host.state.requestTokens,{prompt:2222,limit:32768,estimated:false});
  const persisted=JSON.parse(readFileSync(path.join(root,'state.json'),'utf8'));
  assert.deepEqual(persisted.usage,host.state.usage);
  assert.deepEqual(persisted.requestTokens,host.state.requestTokens);
 }finally{release?.();await host.close();api.closeAllConnections();await new Promise(r=>api.close(r));}
});

test('background polling, reopening and foreground requests do not count the same usage twice',async t=>{
 const values=new Map();
 globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 globalThis.window=Object.assign(new EventTarget(),{localStorage,setTimeout,clearTimeout});
 globalThis.document=Object.assign(new EventTarget(),{documentElement:{lang:'de'}});
 const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':path.resolve('src')}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
 let stop;
 t.after(async()=>{stop?.();try{const {flushPersistence}=await server.ssrLoadModule('/src/lib/persist-storage.ts');await flushPersistence().catch(()=>{});}finally{await server.close();delete globalThis.window;delete globalThis.document;delete globalThis.localStorage;}});
 const {useIde}=await server.ssrLoadModule('/src/store/ide.ts');
 const {useIntern}=await server.ssrLoadModule('/src/lib/intern.ts');useIntern.getState().setPrefs({on:false,autoHeal:false});
 const {startBackgroundAgentMonitor,useBackgroundAgent}=await server.ssrLoadModule('/src/lib/background-agent.ts');
 useIde.setState({files:{},dirty:{},pendingDiffs:[],workspaceCwd:'',memoryWorkspace:'token-project',sessionTokens:{prompt:10,completion:5,estimated:false},lastRequestTokens:null,chat:[]});
 let revision=0;
 const base={id:'token-job',project:'token-project',status:'running',prompt:'Test',startedAt:1,text:'',thinking:'',steps:[],plan:[],drafts:{},harness:'',error:'',dismissed:false};
 const deliver=async fields=>{
  const job={...base,...fields,revision:++revision};
  window.anvilNative={agentJob:async action=>action==='status'?{state:job}:{unchanged:true}};
  stop=startBackgroundAgentMonitor();
  try{await until(()=>useBackgroundAgent.getState().job?.revision===revision);}finally{stop();stop=null;}
 };
 const requestTokens={prompt:1200,limit:32768,estimated:true};
 await deliver({requestTokens,requestSequence:1,usage:{prompt:0,completion:0,estimated:false}});
 assert.deepEqual(useIde.getState().lastRequestTokens,requestTokens);
 assert.equal(useIde.getState().sessionTokens.prompt,10);
 const complete={requestTokens:{...requestTokens,prompt:1234,estimated:false},requestSequence:1,usage:{prompt:1234,completion:56,estimated:false}};
 await deliver(complete);await deliver(complete);
 assert.equal(useIde.getState().sessionTokens.prompt,1244);
 assert.equal(useIde.getState().sessionTokens.completion,61);
 useIde.getState().addSessionTokens(20,2,false);
 const foreground={prompt:20,limit:8192,estimated:false};useIde.setState({lastRequestTokens:foreground});
 await deliver(complete);
 assert.deepEqual(useIde.getState().lastRequestTokens,foreground,'old background polling does not replace a newer foreground display');
 assert.equal(useIde.getState().sessionTokens.prompt,1264);
 useIde.setState({sessionTokens:JSON.parse(JSON.stringify(useIde.getState().sessionTokens)),lastRequestTokens:null});
 await deliver(complete);
 assert.equal(useIde.getState().lastRequestTokens.prompt,1234,'reconnect restores the visible context');
 assert.equal(useIde.getState().sessionTokens.prompt,1264,'persisted cursor prevents replay counting');
 await deliver({...complete,requestSequence:2,requestTokens:{...requestTokens,prompt:2222,estimated:false},usage:{prompt:3456,completion:89,estimated:false}});
 assert.equal(useIde.getState().sessionTokens.prompt,3486);
 assert.equal(useIde.getState().sessionTokens.completion,96);
 assert.equal(useIde.getState().lastRequestTokens.prompt,2222);
 await deliver({...complete,project:'another-project'});
 assert.equal(useIde.getState().lastRequestTokens.prompt,2222);
 assert.equal(useIde.getState().sessionTokens.prompt,3486);
});

test('host rejects duplicate, stale and malformed token messages',async()=>{
 const root=mkdtempSync(path.resolve('artifacts','token-host-'));
 const host=new AgentJobHost({snapshotPath:path.join(root,'state.json'),launch:()=>{throw Error('not used');}});
 host.state={status:'running',revision:1,requestSequence:0,usageSequence:0,usage:{prompt:0,completion:0,estimated:false}};
 const requestTokens={prompt:100,limit:32768,estimated:true};
 const pending={type:'request-tokens',sequence:1,requestTokens};
 const usage={type:'token-usage',sequence:1,requestTokens:{...requestTokens,estimated:false},usage:{prompt:100,completion:20,estimated:false}};
 try{
  host.message({...pending,requestTokens:{...requestTokens,prompt:-1}});
  assert.equal(host.state.requestSequence,0);
  host.message(pending);host.message(usage);
  const revision=host.state.revision;
  host.message(usage);host.message(pending);
  host.message({...pending,sequence:2,requestTokens:{...requestTokens,limit:NaN}});
  assert.equal(host.state.revision,revision);
  host.message({...pending,sequence:2});
  host.message(usage);
  host.message({...usage,sequence:2,usage:{prompt:99,completion:20,estimated:false}});
  assert.equal(host.state.usageSequence,1);
  host.message({...usage,sequence:2,usage:{prompt:250,completion:40,estimated:false}});
  assert.deepEqual(host.state.usage,{prompt:250,completion:40,estimated:false});
 }finally{await host.close();}
});
