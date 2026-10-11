import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanProgress } from './plan-progress.ts';
import { TaskAcceptance, acceptanceResult, type AcceptanceCriterion } from '../../electron/task-acceptance.mjs';

const sha256='87300bbac8aba350f0b0683702cf0a759f9c5f47b8d217d3e64c7a39d9de3893';
const criterion:AcceptanceCriterion={id:'bbox',label:'STEP-Abweichung',required:true,operator:'eq',expected:0,tolerance:0.1,unit:'mm'};
const sample=(actual:number|boolean=0,id='bbox')=>({anvil_acceptance:{observations:[{criterion:id,actual,artifact:'exports/stage.step',sha256}]}});
const mcp=(output:unknown)=>({isError:false,structuredContent:output});
const code={server:'freecad',name:'execute_code',arguments:{code:'verify_saved_step()'}};
function setup(criteria:AcceptanceCriterion[]=[criterion]){
  const plan=new PlanProgress();plan.setInputStamp('saved-inputs');
  assert.equal(plan.set({criteria}).ok,true);return plan;
}

test('a successful CAD tool is not an acceptance result; evaluated failure overrides green checkmarks',()=>{
  const plan=setup();
  plan.record('mcp_call',code,{isError:false,text:'All tests passed.'});
  assert.equal(plan.acceptanceResult().state,'unverified');
  plan.record('mcp_call',code,mcp(sample(4)));
  assert.equal(plan.acceptanceResult().state,'failed');
  assert.equal(plan.acceptanceResult().checks[0].observation?.actual,4);
});

test('a relaxed tolerance or removed mandatory volume check cannot turn the original failure green, including after resume',()=>{
  const volume:AcceptanceCriterion={id:'volume',label:'STEP-Volumen',operator:'eq',required:true,expected:true};
  const plan=setup([criterion,volume]);
  plan.record('mcp_call',code,mcp(sample(4)));
  const changed=plan.set({criteria:[{...criterion,tolerance:5}],criteria_change_reason:'Bounding box contains intermediate geometry; omit volume comparison.'});
  assert.match(changed.error!,/nicht angewendet/);
  const resumed=new PlanProgress();assert.equal(resumed.restore(plan.snapshot()),true);
  assert.deepEqual(resumed.acceptanceResult().criteria,[criterion,volume]);
  assert.equal(resumed.acceptanceResult().changes[0].applied,false);
  assert.equal(resumed.acceptanceResult().state,'failed');
});

test('criteria must exist before a mutation or opaque external execution; legacy work cannot define post-hoc acceptance',()=>{
  for(const name of ['write_file','run_file','mcp_call']){
    const plan=new PlanProgress();plan.record(name,{path:'stage.FCStd'}, {ok:true});
    assert.match(plan.set({criteria:[criterion]}).error!,/vor der ersten Änderung/);
    const old=plan.snapshot();delete old.acceptance;
    const resumed=new PlanProgress();assert.equal(resumed.restore(old),true);
    assert.ok(resumed.set({criteria:[criterion]}).error);
    assert.equal(resumed.acceptanceResult().state,'unverified');
  }
});

test('numeric tolerance is evaluated at its boundary; all nine pose checks are mandatory',()=>{
  const criteria=Array.from({length:9},(_,i)=>({...criterion,id:`pose-${i}`}));
  const plan=setup(criteria);
  for(let i=0;i<8;i++)plan.record('mcp_call',code,mcp(sample(0.1,`pose-${i}`)));
  assert.equal(plan.acceptanceResult().state,'partial');
  plan.record('mcp_call',code,mcp(sample(0.10001,'pose-8')));
  assert.equal(plan.acceptanceResult().state,'failed');
  plan.record('mcp_call',code,mcp(sample(0.1,'pose-8')));
  assert.equal(plan.acceptanceResult().state,'passed');
  assert.equal(plan.acceptanceResult().observations.length,10,'failed measurements remain in the history');
});

test('read-back reports, running tools, malformed artifact identity and failed executions never certify acceptance',()=>{
  for(const [name,result] of [
    ['read_file',{ok:true,...sample()}],
    ['mcp_call',{isError:false,running:true,...sample()}],
    ['mcp_call',{isError:false,truncated:true,...sample()}],
    ['mcp_call',{isError:false,structuredContent:{anvil_acceptance:{observations:[{criterion:'bbox',actual:0,artifact:'stage.step',sha256:'not-a-hash'}]}}}],
  ] as const){const plan=setup();plan.record(name,code,result);assert.equal(plan.acceptanceResult().state,'unverified',name);}
  const plan=setup();plan.record('mcp_call',code,{isError:true,...sample()});
  assert.equal(plan.acceptanceResult().state,'failed');
});

test('changed files, opaque CAD actions and changed execution inputs invalidate prior passed measurements',()=>{
  for(const change of ['file','external','shell','run','stamp']){
    const plan=setup();plan.record('mcp_call',code,mcp(sample()));assert.equal(plan.acceptanceResult().state,'passed');
    if(change==='file')plan.record('write_file',{path:'stage.py'},{ok:true},true);
    if(change==='external')plan.record('mcp_call',{...code,name:'create_object'},{isError:false});
    if(change==='shell')plan.record('shell',{command:'node modify.cjs'},{ok:true,code:0});
    if(change==='run')plan.record('run_file',{path:'modify.cjs'},{ok:true});
    if(change==='stamp')plan.setInputStamp('new-inputs');
    assert.equal(plan.acceptanceResult().state,'stale',change);
  }
});

test('MCP text wrappers and shell JSON logs use the same explicit measurement protocol',()=>{
  for(const [name,result] of [
    ['mcp_call',{content:[{type:'text',text:JSON.stringify({output:JSON.stringify(sample())})}]}],
    ['shell',{ok:true,code:0,stdout:`Checking STEP…\n${JSON.stringify(sample())}\nDone.\n`}],
  ] as const){const plan=setup();plan.record(name,code,result);assert.equal(plan.acceptanceResult().state,'passed',name);}
});

test('identical MCP text/structured copies are evaluated once; truncated history cannot certify a pass',()=>{
  const plan=setup();plan.record('mcp_call',code,{structuredContent:sample(),text:JSON.stringify(sample())});
  assert.equal(plan.acceptanceResult().state,'passed');assert.equal(plan.acceptanceResult().observations.length,1);
  const acceptance=new TaskAcceptance();acceptance.restore(plan.snapshot().acceptance);
  for(let i=0;i<1024;i++)acceptance.record('run_file',sample(),'e2',{failed:false,pending:false,changed:false});
  assert.equal(acceptance.result().state,'stale');
  assert.ok(JSON.stringify(acceptance.snapshot()).length<=512*1024);
});

test('stored pass labels, malformed contracts and conflicting measurements are not trusted',()=>{
  assert.equal(acceptanceResult({state:'passed'}).state,'stale');
  const acceptance=new TaskAcceptance();acceptance.define([criterion],undefined);
  assert.equal(acceptanceResult({...acceptance.snapshot(),state:'passed'}).state,'unverified');
  const plan=setup();plan.record('mcp_call',code,mcp({anvil_acceptance:{observations:[...sample(4).anvil_acceptance.observations,...sample(0).anvil_acceptance.observations]}}));
  assert.equal(plan.acceptanceResult().state,'stale');
  const large=new TaskAcceptance();large.define([criterion],undefined);
  for(let i=0;i<700;i++)large.record('run_file',{anvil_acceptance:{observations:[{...sample().anvil_acceptance.observations[0],artifact:'a'.repeat(500)}]}},`e${i+1}`,{failed:false,pending:false,changed:false});
  const expected=large.result();assert.equal(expected.state,'passed');
  const restored=new TaskAcceptance();assert.equal(restored.restore(expected),true,'derived verdict/check fields do not count against the durable snapshot budget');
  assert.equal(restored.result().state,'passed');
});

test('run success cannot replace missing required observations and failed execution blocks acceptance',()=>{
  const plan=setup();
  assert.equal(plan.acceptanceResult({verification:{state:'passed'}}).state,'unverified');
  plan.record('mcp_call',code,mcp(sample()));
  assert.equal(plan.acceptanceResult({verification:{state:'failed'}}).state,'failed');
  assert.equal(plan.acceptanceResult({open:true}).state,'partial');
});
