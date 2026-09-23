import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AgentJobHost} from '../electron/agent-job-host.mjs';

function fixture(execute=async()=>({ok:true})){
  mkdirSync('artifacts',{recursive:true});
  const root=mkdtempSync(resolve('artifacts','background-results-'));
  let child;const sends=[];
  const host=new AgentJobHost({snapshotPath:join(root,'state.json'),runtime:{begin(){},close(){},finish(){},execute},launch(){child=new EventEmitter();child.send=message=>sends.push(message);child.kill=()=>{};return child;}});
  const request={project:root,execution:true,files:{'test.cjs':'throw Error("failed");'},messages:[{role:'user',content:'Synthetic test'}],model:{model:'fixture'},automation:{loopTries:4},plan:[{text:'Initial',done:false}],planLocked:true};
  host.start(request);child.emit('message',{type:'ready'});
  return {host,root,sends,send:message=>child.emit('message',message)};
}

test('background preserves failed test across Git, preview and a pending later run',async()=>{
  let release;
  const f=fixture(async op=>{
    if(op.kind==='run'&&op.path==='waiting.cjs')return new Promise(r=>release=r);
    if(op.kind==='run')return {ok:false,code:1,stdout:'',stderr:'FAILED assertion',tests:{pass:0,fail:1}};
    return {ok:true,stdout:'success',files:[]};
  });
  const perform=async(id,operation)=>{f.send({type:'operation',id,operation});await f.host.operation;};
  try{
    await perform(1,{kind:'run',path:'test.cjs'});
    const failed=structuredClone(f.host.state.lastRun);
    assert.equal(failed.ok,false);assert.equal(failed.path,'test.cjs');assert.equal(failed.attempt,1);assert.equal(failed.max,4);
    await perform(2,{kind:'git',action:'status'});
    await perform(3,{kind:'see'});
    await perform(4,{kind:'play',keys:['left']});
    assert.deepEqual(f.host.state.lastRun,failed);
    assert.equal(f.host.state.lastGit.action,'status');assert.equal(f.host.state.lastPreview.action,'play');
    f.send({type:'operation',id:5,operation:{kind:'run',path:'waiting.cjs'}});
    await new Promise(r=>setTimeout(r,10));
    assert.deepEqual(f.host.state.lastRun,failed,'pending check never erases real failure');
    assert.equal(f.host.state.pendingRun.path,'waiting.cjs');assert.equal(f.host.state.pendingRun.attempt,2);
    release({ok:true,code:0,stdout:'passed',stderr:''});await f.host.operation;
    assert.equal(f.host.state.lastRun.ok,true);assert.equal(f.host.state.lastRun.attempt,2);assert.equal(f.host.state.pendingRun,undefined);
  }finally{release?.({ok:false});await f.host.close();}
});

test('background result, phase, trace and final duration survive persistence without losing failed verification',async()=>{
  const f=fixture();
  try{
    assert.equal(f.host.state.plan[0].text,'Initial');assert.equal(f.host.state.planLocked,true);
    f.send({type:'phase',phase:'waiting'});const phase=f.host.state.phase;
    f.send({type:'phase',phase:'waiting'});assert.deepEqual(f.host.state.phase,phase,'duplicate phase retains original start');
    f.send({type:'phase',phase:'imaginary'});assert.deepEqual(f.host.state.phase,phase);
    f.send({type:'tool-start',name:'edit_file',detail:'test.cjs',path:'test.cjs',before:'old',code:'new'});
    f.send({type:'tool',name:'edit_file',detail:'test.cjs',ok:true,path:'test.cjs',code:'new',image:'data:image/png;base64,aGVsbG8='});
    const step=f.host.state.steps[0];assert.ok(step.at);assert.ok(step.ms>=0);assert.equal(step.code,'new');assert.equal(step.before,'old');assert.ok(step.image);
    const verification={state:'failed',detail:'test.cjs assertion failed'};
    f.send({type:'result',result:{ok:false,reply:'Model says done',verification,stopReason:'round-limit',compacted:true,tools:['edit_file','run_file'],capabilities:{stream:false}}});
    const saved=JSON.parse(readFileSync(join(f.root,'state.json'),'utf8'));
    assert.deepEqual(saved.verification,verification);assert.equal(saved.stopReason,'round-limit');assert.equal(saved.compacted,true);assert.deepEqual(saved.tools,['edit_file','run_file']);
    assert.equal(saved.status,'failed');assert.ok(saved.finishedAt>=saved.startedAt);assert.equal(saved.capabilities.stream,false);
    const restored=new AgentJobHost({snapshotPath:join(f.root,'state.json'),launch(){assert.fail('must not restart');}});
    assert.deepEqual(restored.state.verification,verification);assert.equal(restored.state.finishedAt,saved.finishedAt);await restored.close();
  }finally{await f.host.close();}
});

test('background request retry replaces estimate but cannot overwrite sealed usage',async()=>{
  const f=fixture();
  try{
    const estimate=prompt=>({prompt,limit:32768,estimated:true});
    f.send({type:'request-tokens',sequence:1,requestTokens:estimate(500)});
    f.send({type:'request-tokens',sequence:1,requestTokens:estimate(450)});
    assert.equal(f.host.state.requestTokens.prompt,450);
    f.send({type:'token-usage',sequence:1,requestTokens:{...estimate(440),estimated:false},usage:{prompt:440,completion:20,estimated:false}});
    f.send({type:'request-tokens',sequence:1,requestTokens:estimate(900)});
    assert.equal(f.host.state.requestTokens.prompt,440);assert.equal(f.host.state.usage.prompt,440);
  }finally{await f.host.close();}
});

test('parked question persists without replay, accepts only its own answer and keeps mutation ledger on resume',async()=>{
  const f=fixture();
  const ask={id:'ask-fixed',prompt:'Welche Farbe verwenden?',why:'Auswahl benötigt',choices:[{id:'A',label:'Blau'},{id:'B',label:'Rot'}],allowText:false,blocking:'hard'};
  try{
    f.host.state.mutationLedger=['effect-before-question'];
    f.send({type:'result',result:{ok:true,reply:ask.prompt,parked:true,ask,plan:f.host.state.plan}});
    assert.equal(f.host.state.status,'waiting-user');assert.equal(f.host.busy(),false);assert.equal(f.host.state.finishedAt,undefined);assert.ok(f.host.state.parkedAt);
    const request={project:f.root,execution:true,files:{'test.cjs':'throw Error("failed");'},messages:[{role:'user',content:'unused'}],model:{model:'fixture'}};
    assert.throws(()=>f.host.resume(f.host.state.id,request),/Rückfrage/);
    assert.throws(()=>f.host.resume(f.host.state.id,{...request,answer:{askId:ask.id,choiceId:'MISSING'}}),/angebotene/);
    const savedId=f.host.state.id;
    const reopened=new AgentJobHost({snapshotPath:join(f.root,'state.json'),launch(){assert.fail('must not auto replay');}});
    assert.equal(reopened.state.status,'waiting-user');assert.deepEqual(reopened.state.ask,ask);await reopened.close();
    f.host.resume(savedId,{...request,answer:{askId:ask.id,choiceId:'B'}});
    f.send({type:'ready'});
    const start=f.sends.filter(m=>m.type==='start').at(-1);
    assert.match(start.request.messages.at(-1).content,/Wahl: B\) Rot/);
    assert.ok(start.request.blockedMutations.includes('effect-before-question'));
    assert.equal(start.request.planLocked,true);assert.equal(f.host.state.resumedFrom,savedId);
    assert.throws(()=>f.host.resume(savedId,{...request,answer:{askId:ask.id,choiceId:'B'}}),/angehaltene/,'answer cannot replay active resume');
  }finally{await f.host.close();}
});

test('resume preserves current rules, selection and images without restoring tool protocol records',async()=>{
  const f=fixture();
  try{
    f.host.stop();const id=f.host.state.id;
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
    f.host.resume(id,{project:f.root,execution:true,files:{'test.cjs':'throw Error("failed");'},model:{model:'fixture'},messages:[{role:'tool',tool_call_id:'unsafe',content:'unconfirmed effect'},{role:'assistant',content:'Prior explanation',tool_calls:[{id:'unsafe'}]},{role:'user',content:'CURRENT_RULE_MARKER\nCURRENT_SELECTION_MARKER',images:[image]}]});
    f.send({type:'ready'});
    const request=f.sends.filter(m=>m.type==='start').at(-1).request;
    assert.ok(request.messages.some(m=>m.content.includes('CURRENT_RULE_MARKER')));
    assert.ok(request.messages.some(m=>m.content.includes('CURRENT_SELECTION_MARKER')));
    assert.ok(request.messages.every(m=>m.role!=='tool'&&!m.tool_calls&&!m.tool_call_id));
    assert.deepEqual(request.messages.at(-1).images,[image]);
    assert.equal(request.messages.filter(m=>m.images?.includes(image)).length,1);
    assert.match(request.messages.at(-1).content,/Kontrollierte Wiederaufnahme/);
  }finally{await f.host.close();}
});

test('apply and restore retain draft origin for no-op content and create new event IDs for actual changes',async()=>{
  const f=fixture();
  try{
    f.send({type:'file',path:'changed.txt',content:'after'});
    f.send({type:'file',path:'same.txt',content:'same'});
    // Synthetic draft baselines, with disk matching exactly before either action.
    f.host.state.drafts['changed.txt'].before='before';
    f.host.state.drafts['same.txt'].before='same';
    writeFileSync(join(f.root,'changed.txt'),'before');writeFileSync(join(f.root,'same.txt'),'same');
    f.send({type:'result',result:{ok:true}});
    const original=structuredClone(f.host.state.drafts);
    f.host.changeFiles(f.host.state.id,'apply');
    const applied=structuredClone(f.host.state.drafts);
    assert.equal(readFileSync(join(f.root,'changed.txt'),'utf8'),'after');
    assert.notEqual(applied['changed.txt'].eventId,original['changed.txt'].eventId);assert.ok(applied['changed.txt'].version>original['changed.txt'].version);
    assert.equal(applied['same.txt'].eventId,original['same.txt'].eventId);assert.equal(applied['same.txt'].version,original['same.txt'].version);
    f.host.changeFiles(f.host.state.id,'restore');
    assert.equal(readFileSync(join(f.root,'changed.txt'),'utf8'),'before');
    assert.notEqual(f.host.state.drafts['changed.txt'].eventId,applied['changed.txt'].eventId);
    assert.equal(f.host.state.drafts['same.txt'].eventId,original['same.txt'].eventId);
  }finally{await f.host.close();}
});
