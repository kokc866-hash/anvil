import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { workflowJournalPath, readWorkflowJournal } from '../electron/workflow-journal.mjs';
import { buildAgentRuntime } from './build-agent-runtime.mjs';

const root=resolve('artifacts/loop-graph-implementation-2026-10-06/host-fixtures');
const snapshot=(id='fixture-workflow')=>({schema:1,id,inputStamp:'a'.repeat(64),definitionStamp:'b'.repeat(64),phase:'act',nodes:[],operations:[],changed:[]});
function fixture(execute=async()=>({ok:true})){
  mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'host-'));let child;const sent=[];
  const request={project:dir,execution:true,files:{'main.cjs':'console.log(1)'},messages:[{role:'user',content:'Synthetic fixture'}],model:{model:'fixture'}};
  const host=new AgentJobHost({snapshotPath:join(dir,'latest.json'),runtime:{begin(){},close(){},finish(){},execute},launch(){child=new EventEmitter();child.send=msg=>sent.push(msg);child.kill=()=>{};return child;}});
  host.start(request);child.emit('message',{type:'ready'});
  return {dir,host,request,sent,send:msg=>child.emit('message',msg),action:async(id,op)=>{child.emit('message',{type:'operation',id,operation:op});await host.operation;}};
}
test('native workflow checkpoints are durable before the next effect and survive host recovery',async()=>{
  const f=fixture();try{
    const saved=snapshot();saved.operations=[{id:'fixture-workflow:1',name:'mcp_call',fingerprint:'c'.repeat(64),effectFingerprint:'c'.repeat(64),inputStamp:saved.inputStamp,status:'started',target:'create',external:true,at:Date.now()}];
    saved.nodes=[{id:'check',name:'run_file',label:'Prüfen',path:'main.cjs',status:'running',reason:'Prüfung läuft.',automatic:true,inputStamp:saved.inputStamp}];
    await f.action(1,{kind:'workflow',snapshot:saved});assert.equal(f.sent.at(-1).result.ok,true);
    assert.deepEqual(readWorkflowJournal(workflowJournalPath(join(f.dir,'workflows'),f.dir,saved.id)),saved);
    const restored=new AgentJobHost({snapshotPath:join(f.dir,'latest.json'),launch(){assert.fail('No automatic restart');}});
    try{assert.equal(restored.state.status,'interrupted');assert.equal(restored.state.workflow.operations[0].status,'unclear');assert.equal(restored.state.workflow.nodes[0].status,'waiting');assert.equal(restored.state.workflow.phase,'abort');}finally{await restored.close();}
    f.host.stop();assert.equal(f.host.state.cancellation.remote,'unconfirmed');assert.equal(f.host.state.workflow.operations[0].status,'unclear');
  }finally{await f.host.close();}
});
test('invalid workflow snapshots cannot reach native execution',async()=>{
  let effects=0;const f=fixture(async()=>{effects++;return {ok:true};});
  try{await f.action(1,{kind:'workflow',snapshot:{...snapshot(),harness:{budget:null}}});assert.equal(f.host.state.status,'failed');assert.equal(effects,0);}finally{await f.host.close();}
});
test('a known failed shell may be corrected after resume while uncertain commands remain blocked',async()=>{
  let effects=0;const f=fixture(async()=>{effects++;return {ok:false,code:1,stderr:'assertion failed'};});
  try{await f.action(1,{kind:'shell',command:'node main.cjs'});assert.deepEqual(f.host.state.mutationLedger,[]);f.host.stop();f.host.resume(f.host.state.id,f.request);f.send({type:'ready'});await f.action(1,{kind:'shell',command:'node main.cjs'});assert.equal(effects,2);}finally{await f.host.close();}
});
test('the built independent worker executes acknowledged code and tests without a renderer', {timeout:60000},async()=>{
  await buildAgentRuntime();mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'worker-'));
  const previous=process.env.ANVIL_INSTALL_DIR;process.env.ANVIL_INSTALL_DIR=dir;
  let rounds=0;const server=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);assert.equal(body.model,'synthetic-workflow');
    const choice=++rounds===1?{content:'',tool_calls:[{id:'fixture-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'main.cjs',content:'module.exports=2;console.log("NATIVE_WORKFLOW_OK");',overwrite_reason:'Replace the complete one-line synthetic fixture.'})}}]}:{content:'Die künstliche Änderung wurde geprüft.'};
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:choice,finish_reason:choice.tool_calls?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const host=new AgentJobHost({snapshotPath:join(dir,'jobs','latest.json'),runtime:new AgentProjectRuntime(),launch:()=>fork(resolve('agent-build/worker.mjs'),[],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true})});
  let stderr='';
  try{
    const completed=new Promise((resolveDone,reject)=>{const timer=setTimeout(()=>reject(Error('Independent workflow timed out')),45000);host.on('change',()=>{if(['done','failed','interrupted'].includes(host.state?.status)){clearTimeout(timer);resolveDone();}});});
    host.start({project:dir,execution:true,writeThrough:false,files:{'main.cjs':'module.exports=1;','main.test.cjs':'const assert=require("node:assert/strict");test("native export",()=>{assert.equal(require("./main.cjs"),2);console.log("TEST_PROOF_OK");});'},messages:[{role:'user',content:'Change the synthetic export to 2 and run its test.'}],locale:'de',maxRounds:8,autoContinue:false,compact:'off',automation:{runLoop:true,testLoop:true,graphLoop:false,afterWrite:'run',loopTries:3},
      model:{provider:'custom',model:'synthetic-workflow',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'',context:32768,thinking:'off',temperature:0,maxOut:512,hardStopMin:1,retries:1,toolMode:'native'}});
    host.child.stderr.on('data',part=>stderr+=part);await completed;
    assert.equal(host.state.status,'done',host.state.error||stderr);assert.equal(host.state.verification.tests,true);
    assert.equal(host.state.drafts['main.cjs'].after,'module.exports=2;console.log("NATIVE_WORKFLOW_OK");');
    assert.match(host.state.lastRun.stdout,/TEST_PROOF_OK/);assert.equal(host.state.lastRun.ok,true);
    const operations=host.state.workflow.operations;assert.deepEqual(operations.map(op=>op.name),['write_file','run_file','run_file']);assert.ok(operations.every(op=>op.status==='confirmed'));
    assert.equal(host.state.workflow.nodes.find(n=>n.id==='test:main.test.cjs').status,'passed');
    assert.ok(readWorkflowJournal(workflowJournalPath(join(dir,'jobs','workflows'),dir,host.state.workflow.id)));
    assert.ok(JSON.parse(readFileSync(join(dir,'jobs','latest.json'),'utf8')).workflow);
  }finally{await host.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(previous===undefined)delete process.env.ANVIL_INSTALL_DIR;else process.env.ANVIL_INSTALL_DIR=previous;}
});
