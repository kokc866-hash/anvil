import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { agentLoopFixture } from '../fixtures/agent-loop-fixture.mjs';

test('helper mode does not replace inherited progress with a fresh generic helper plan',async t=>{
 const f=await agentLoopFixture(t);
 const {prepareBackgroundContext}=await f.server.ssrLoadModule('/src/lib/background-context.ts');
 const plan=[
  {text:'Rabatt in cart.js ergänzen',kind:'edit',status:'ok',completedBy:'agent'},
  {text:'Rabattgrenzen in cart.test.js prüfen',kind:'check',status:'todo'},
 ];
 f.useIde.setState({chat:[{id:'task',role:'user',content:'Ergänze die Rabattberechnung.',at:1},{id:'reply',role:'assistant',content:'Test noch offen.',plan,planLocked:false,at:2}],planWho:'helper',files:{'cart.js':'artificial'},locale:'de'});
 const prepared=await prepareBackgroundContext('weiter',[]);
 assert.deepEqual(prepared.plan,plan);
});


const task=readFileSync('fixtures/workshop-task.txt','utf8');

test('a new task in helper mode gets a named fallback when the helper is unavailable',async t=>{
 const f=await agentLoopFixture(t);
 const {prepareBackgroundContext}=await f.server.ssrLoadModule('/src/lib/background-context.ts');
 f.useIde.setState({chat:[],planWho:'helper',files:{'cart.js':'artificial'},locale:'de'});
 const prepared=await prepareBackgroundContext('Ergänze die Rabattberechnung im Warenkorb.',[]);
 assert.ok(prepared.plan.some(step=>/Rabattberechnung.*Warenkorb/.test(step.text)),JSON.stringify(prepared.plan));
});

test('background preparation carries the concrete last checklist on a short continuation only',async t=>{
 const f=await agentLoopFixture(t);
 const {initialAgentPlan}=await f.server.ssrLoadModule('/src/lib/plan.ts');
 const {prepareBackgroundContext}=await f.server.ssrLoadModule('/src/lib/background-context.ts');
 const plan=initialAgentPlan(task,undefined,'agent');
 plan[0]={...plan[0],status:'ok',completedBy:'agent'};
 const prior=[{id:'task',role:'user',content:task,at:1},{id:'reply',role:'assistant',content:'Weitere Prüfung ausstehend.',plan,planLocked:true,at:2}];
 f.useIde.setState({chat:prior,planWho:'agent',files:{'notes.txt':'artificial'},locale:'de'});
 const prepared=await prepareBackgroundContext('mach weiter',[]);
 assert.equal(prepared.plan.length,12);
 assert.deepEqual(prepared.plan,plan);
 assert.equal(prepared.planLocked,true);
 assert.notEqual(prepared.plan,plan);
 assert.match(prepared.messages.findLast(row=>row.role==='user').content,/mach weiter/,'the active current request remains authoritative');
 const fresh=await prepareBackgroundContext('Ergänze die Rabattberechnung im Warenkorb.',[]);
 assert.ok(fresh.plan.some(step=>/Rabattberechnung.*Warenkorb/.test(step.text)));
 assert.ok(fresh.plan.every(step=>step.status==='todo'));
 assert.equal(fresh.planLocked,false);
 assert.ok(!fresh.plan.some(step=>/Kanban|Projektplaner/.test(step.text)));
});

test('background preparation preserves a manually locked generic checklist verbatim',async t=>{
 const f=await agentLoopFixture(t);
 const {prepareBackgroundContext}=await f.server.ssrLoadModule('/src/lib/background-context.ts');
 const plan=['Auftrag und Projekt verstehen','Angefragte Änderungen umsetzen','Geänderte Funktionen prüfen'].map(text=>({text,status:'todo'}));
 f.useIde.setState({chat:[{id:'task',role:'user',content:task,at:1},{id:'reply',role:'assistant',content:'Manuell gesperrte Liste.',plan,planLocked:true,at:2}],planWho:'agent',files:{'notes.txt':'artificial'},locale:'de'});
 const prepared=await prepareBackgroundContext('weiter',[]);
 assert.deepEqual(prepared.plan,plan);
 assert.equal(prepared.planLocked,true);
});

test('the real loop does not silently upgrade a locked manual checklist',async t=>{
 const f=await agentLoopFixture(t);f.beginAgent();
 const generic=['Auftrag und Projekt verstehen','Angefragte Änderungen umsetzen','Geänderte Funktionen prüfen'].map(text=>({text,status:'todo'}));
 let visible=generic.map(step=>({...step})),initialUpdates=0;
 await f.runAgentLoop({context:32768,compact:'off',files:[{path:'notes.txt',content:'fixture'}],messages:[{role:'user',content:task}],humanRequest:task,runLoop:false,graphLoop:false,testLoop:false,autoRunAgent:false,maxRounds:2},async()=>({content:'No implementation was performed in this locked-plan fixture.'}),{
  getPlan:()=>visible,canReplacePlan:()=>false,
  onTool:info=>{if(info.name==='set_plan'&&info.result?.initial){initialUpdates++;visible=info.result.plan;}},
 });
 assert.deepEqual(visible,generic);
 assert.equal(initialUpdates,0);
});

