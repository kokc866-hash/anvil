import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {fork} from 'node:child_process';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {buildAgentRuntime} from './build-agent-runtime.mjs';

test('real worker carries project memory, journal, locked plan, automatic run and independent diagnostics',async()=>{
  mkdirSync('artifacts',{recursive:true});const root=mkdtempSync(resolve('artifacts','background-settings-'));
  const build=join(root,'worker');await buildAgentRuntime(build);
  const payloads=[],operations=[],phases=[];
  const api=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    payloads.push(JSON.parse(raw));const n=payloads.length;
    const call=n===1?{name:'set_plan',arguments:JSON.stringify({steps:['REPLACED'],kinds:['report']})}:n===2?{name:'write_file',arguments:JSON.stringify({path:'test.cjs',content:'console.log("fixed");',overwrite_reason:'Synthetic whole-file correction'})}:null;
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'Synthetic thinking.'}}]})+'\n\n');
    res.end('data: '+JSON.stringify({choices:[{delta:call?{tool_calls:[{index:0,id:'call-'+n,function:call}]}:{content:'Die Änderung ist geprüft.'},finish_reason:call?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(r=>api.listen(0,'127.0.0.1',r));
  const runtime={begin(){},close(){},finish(){},async execute(op){operations.push(op);if(op.kind==='verify')return {ok:true,detail:'Independent diagnostic checked',scopes:{syntax:op.paths,types:[]}};return {ok:true,applied:true,code:0,stdout:'passed',stderr:''};}};
  const host=new AgentJobHost({runtime,snapshotPath:join(root,'state.json'),launch:()=>fork(join(build,'worker.mjs'),[],{stdio:['ignore','ignore','inherit','ipc']})});
  host.on('change',()=>{if(host.state?.phase)phases.push(host.state.phase.phase);});
  try{
    host.start({project:root,execution:true,files:{'test.cjs':'throw Error("old");'},messages:[{role:'user',content:'Behebe diese Probleme im Workspace:\ntest.cjs:1 [error · node-syntax] synthetic problem\nSchreibe die Korrektur und prüfe sie.'}],maxRounds:6,autoContinue:false,locale:'de',compact:'off',memory:'UNIQUE_LEARNED_RULE_481',journal:{goal:'UNIQUE_JOURNAL_GOAL_581',files:[],decisions:[],corrections:[],open:[],notes:'',at:1,turns:1},prefer:['test.cjs'],plan:[{text:'ORIGINAL_LOCKED_REPORT',status:'todo',kind:'report'}],planLocked:true,automation:{runLoop:true,afterWrite:'run',loopTries:4},model:{provider:'custom',baseUrl:`http://127.0.0.1:${api.address().port}/v1`,model:'fixture',context:32768,thinking:'off',maxOut:1000,hardStopMin:1}});
    for(let n=0;n<600&&host.busy();n++)await new Promise(r=>setTimeout(r,20));
    assert.equal(host.busy(),false,'worker must terminate');
    const first=JSON.stringify(payloads[0]);assert.match(first,/UNIQUE_LEARNED_RULE_481/);assert.match(first,/UNIQUE_JOURNAL_GOAL_581/);assert.match(first,/ORIGINAL_LOCKED_REPORT/);
    assert.equal(host.state.plan[0].text,'ORIGINAL_LOCKED_REPORT','set_plan cannot replace a locked list');
    assert.ok(JSON.stringify(payloads).includes('Checklist preserved'),'model receives actionable locked-plan refusal');
    assert.ok(operations.some(op=>op.kind==='write'),'model write acknowledged');
    assert.ok(operations.some(op=>op.kind==='run'&&op.path==='test.cjs'),'configured automatic run executes although model never requests run_file');
    assert.ok(operations.some(op=>op.kind==='verify'&&op.paths.includes('test.cjs')),'diagnostics independently checked');
    assert.equal(host.state.lastDiagnostics.ok,true);assert.equal(host.state.lastRun.path,'test.cjs');
    assert.ok(host.state.steps.some(step=>step.name==='write_file'&&step.code==='console.log("fixed");'));
    assert.ok(phases.includes('waiting'));assert.ok(phases.includes('thinking'));assert.ok(phases.includes('answering'));assert.ok(phases.includes('tool'));
    assert.ok(host.state.finishedAt>=host.state.startedAt);assert.equal(host.state.compacted,false);
  }finally{await host.close();api.closeAllConnections();await new Promise(r=>api.close(r));}
});
