import assert from 'node:assert/strict';
import {test} from 'node:test';
import {agentLoopFixture} from '../fixtures/agent-loop-fixture.mjs';

async function fixture(t){
  const f=await agentLoopFixture(t),bg=await f.server.ssrLoadModule('/src/lib/background-agent.ts');
  const project='continuation-controls-fixture';
  const job={id:'paused-fixture',project,revision:1,status:'stopped',startedAt:1,prompt:'Read notes.txt and explain it.',images:[],text:'',thinking:'',steps:[],plan:[],drafts:{},harness:'',error:'',dismissed:false};
  const calls=[];
  f.useIde.setState({workspaceCwd:'',memoryWorkspace:project,files:{'notes.txt':'Synthetic fixture'},dirty:{},pendingDiffs:[],chat:[],agentBusy:false,agentJob:null,agentQueue:[],agentInbox:null,backgroundAgent:true,backgroundWriteThrough:false,locale:'de',llmProvider:'custom',llmBaseUrl:'http://127.0.0.1:1/v1',llmModel:'synthetic',llmAuthMode:'key',llmApiKey:'',agentDraft:'retain this draft'});
  bg.useBackgroundAgent.setState({available:true,job,error:'',selectedJobId:'fixture-slot',jobs:[]});
  window.anvilNative={agentJob:async(action,payload)=>{
    calls.push({action,payload});
    if(action==='resume')return {available:true,jobId:'fixture-slot',state:{...job,id:'resumed-fixture',resumedFrom:job.id,status:'running',revision:2}};
    return {available:true,state:job};
  }};
  return {...f,...bg,job,calls};
}

test('direct continuation reports native acceptance and retains the existing composer draft',async t=>{
  const f=await fixture(t);
  assert.equal(await f.resumeBackgroundJob(undefined,f.job.id),true);
  const resume=f.calls.find(call=>call.action==='resume');assert.equal(resume.payload.resumeId,f.job.id);
  assert.equal(f.useIde.getState().agentDraft,'retain this draft');
  assert.equal(f.useBackgroundAgent.getState().job.resumedFrom,f.job.id);
});

test('a stale resume control cannot resume a different selected task',async t=>{
  const f=await fixture(t);f.useBackgroundAgent.setState({job:{...f.job,id:'different-task'}});
  assert.equal(await f.resumeBackgroundJob(undefined,f.job.id),false);
  assert.equal(f.calls.length,0);assert.equal(f.useIde.getState().agentDraft,'retain this draft');
});

test('a native refusal never consumes the composer text or invents a successful continuation',async t=>{
  const f=await fixture(t);window.anvilNative={agentJob:async()=>({error:'Synthetic native refusal'})};
  assert.equal(await f.resumeBackgroundJob(undefined,f.job.id),false);
  assert.equal(f.useIde.getState().agentDraft,'retain this draft');
  assert.match(f.useBackgroundAgent.getState().startFailure.message,/Synthetic native refusal/);
});

test('answering a background question forwards its actual task and question identities',async t=>{
  const f=await fixture(t),ask={id:'question-fixture',prompt:'Which colour?',choices:[{id:'B',label:'Red'}],allowText:true,blocking:'hard'};
  f.useBackgroundAgent.setState({job:{...f.job,status:'waiting-user',ask}});
  assert.equal(await f.resumeBackgroundJob({askId:ask.id,choiceId:'B'},f.job.id),true);
  const answer=f.calls.find(call=>call.action==='resume').payload;
  assert.deepEqual(answer.answer,{askId:ask.id,choiceId:'B'});assert.equal(answer.resumeId,f.job.id);
});

test('direct continuation keeps unsaved editor contents protected',async t=>{
  const f=await fixture(t);f.useIde.setState({files:{'notes.txt':'own unsaved content'},dirty:{'notes.txt':true}});
  assert.equal(await f.resumeBackgroundJob(undefined,f.job.id),false);assert.equal(f.calls.length,0);
  assert.equal(f.useIde.getState().files['notes.txt'],'own unsaved content');
});
