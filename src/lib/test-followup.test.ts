import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialAgentPlan, requestPlanContext } from './plan.ts';
import { agentTaskPolicy } from './agent-task-policy.ts';
import { parsePlayInput, performPreviewInput, type PreviewDriver } from './preview-input.ts';
import { PlanProgress } from './plan-progress.ts';
import { AgentLoopProgress, loopObservation } from './agent-loop-progress.ts';
import { AgentEvidence } from './agent-evidence.ts';
import { AgentWorkflow } from './agent-workflow.ts';

const objective = 'Prüfe Start und Pause mit play in der HTML-Vorschau. Nur testen, keine Dateien ändern oder Fehler reparieren.';
const plan = initialAgentPlan(objective).map(s => ({ ...s, status: 'ok' as const, completedBy: 'agent' as const }));
const chat = [{ role: 'user', content: objective }, { role: 'assistant', content: 'Prüfung beendet.', plan }];

test('a retest preserves its objective and restrictions but starts with fresh proof', () => {
  const context = requestPlanContext('noch einmal', chat);
  assert.equal(context.text, objective);
  assert.equal(agentTaskPolicy(context.text).allowChanges, false);
  assert.ok(context.plan?.length && context.plan.every(s => s.status === 'todo' && !s.completedBy));
  assert.equal(plan.every(s => s.status === 'ok'), true);
});

test('an additive report correction keeps the test task instead of inventing a read-only information task', () => {
  const text = 'Korrektur: und bericht warum es nicht funktioniert wenn fehler auftretten';
  const context = requestPlanContext(text, chat);
  assert.ok(context.text.includes(objective));
  assert.ok(context.text.includes(text));
  assert.equal(agentTaskPolicy(context.text).allowChanges, false);
  assert.ok(context.plan?.some(s => s.kind === 'check'));
  assert.equal(requestPlanContext('Korrektur: Baue ein neues CAD-Projekt.', chat).text, 'Korrektur: Baue ein neues CAD-Projekt.');
});

test('a target rejection before the first input is distinguishable from a failed assertion or partial action', async () => {
  let sends = 0;
  const driver: PreviewDriver = { current() {}, target() { throw Error('Ziel nicht bedienbar'); }, async event() { sends++; }, assert() { throw Error('Erwartung fehlgeschlagen'); } };
  await assert.rejects(performPreviewInput(parsePlayInput({ actions: [{ type: 'click', selector: '#canvas' }] }), undefined, driver), (err: unknown) => {
    assert.equal((err as { inputRejected?: boolean }).inputRejected, true); return true;
  });
  assert.equal(sends, 0);
  await assert.rejects(performPreviewInput(parsePlayInput({keys:['s','UnknownKey']}),undefined,driver),(err:unknown)=>{
    assert.equal((err as {inputRejected?:boolean}).inputRejected,true);return true;
  });
  assert.equal(sends,0);
  await assert.rejects(performPreviewInput(parsePlayInput({ actions: [{ type: 'assert', selector: '#count', text: '1' }] }), undefined, driver), (err: unknown) => {
    assert.notEqual((err as { inputRejected?: boolean }).inputRejected, true); return true;
  });
});

test('each requested preview behavior gets a concrete test and a picture does not complete a generic function check', () => {
  const request = 'Prüfe mit play. Keine Dateiänderungen.\n1. Lies die Dateien.\n2. Prüfe die Funktionen:\n - Start: Roboter bewegt sich.\n - Pause: Fortschritt hält an.\n3. Berichte das Ergebnis.';
  const concrete = initialAgentPlan(request);
  assert.equal(concrete.filter(s => s.kind === 'check').length, 2);
  assert.ok(concrete.some(s => s.text.includes('Roboter bewegt sich')));
  const progress = new PlanProgress(); progress.sync([{text:'Geänderte Funktionen prüfen',kind:'check',status:'todo'}]);
  const image = progress.record('play',{actions:[{type:'click',selector:'#start'}]},{ok:true,image:'frame',functionalChecks:false});
  assert.ok(progress.set({updates:[{step:1,status:'ok',evidence:[image],reason:'Only clicked.'}]}).error);
});

test('only completed identical cycles repeat; changing observations and file edits reset the guard', () => {
  assert.doesNotThrow(()=>loopObservation({state:{elements:[null,0,'unknown',{selector:'#ok'}]}}));
  const p = new AgentLoopProgress();
  for (let i=0;i<80;i++) p.record(JSON.stringify(loopObservation({ok:true,state:{text:`Aufträge erledigt: ${i}`}})));
  assert.equal(p.stop,false);
  const cycle = new AgentLoopProgress();
  for (let i=0;i<12;i++) cycle.record(String(i%3));
  assert.equal(cycle.warning || cycle.stop,true);
  const reset = new AgentLoopProgress();
  for(let i=0;i<7;i++)reset.record('same');
  reset.record('source changed',true);
  assert.equal(reset.stop,false);
});

test('rejected input cannot erase a real failed assertion or invalidate an earlier passing assertion', async () => {
  const rejected={ok:false,error:'Target unavailable',rejected:true,definitelyNotExecuted:true};
  const evidence=new AgentEvidence();
  evidence.record('run_file',{path:'index.html'},{ok:true,stage:{kind:'html'},state:{text:'Ready'}});
  evidence.record('play',{actions:[{type:'assert',selector:'#status',text:'Running'}]},{ok:false,error:'Expected Running',state:{text:'Ready'}});
  evidence.record('play',{actions:[{type:'click',selector:'#missing'}]},rejected);
  assert.equal(evidence.status({'index.html':'<p>Ready</p>'}).state,'failed');
  const progress=new PlanProgress();progress.sync([{text:'Mit play prüfen: Start',kind:'check',status:'todo'}]);
  const id=progress.record('play',{actions:[{type:'assert',selector:'#status',text:'Running'}]},{ok:true,functionalChecks:true});
  assert.equal(progress.set({updates:[{step:1,status:'ok',evidence:[id],reason:'Expected Running.'}]}).ok,true);
  progress.record('play',{actions:[{type:'click',selector:'#missing'}]},rejected);
  const restored=new PlanProgress();assert.equal(restored.restore(progress.snapshot()),true);restored.sync(restored.plan);
  assert.equal(restored.plan[0].status,'ok');
  const w=new AgentWorkflow({'index.html':'<p>Ready</p>'},{runLoop:false,graphLoop:false,afterWrite:'none',loopTries:2},['play']);await w.update({'index.html':'<p>Ready</p>'});
  const op=await w.begin('play',{actions:[{type:'click',selector:'#missing'}]});w.finish(op.id,'play',{actions:[{type:'click',selector:'#missing'}]},rejected);
  assert.deepEqual(w.outstandingChecks(),{failed:[],pending:[]});
  const delivered=await w.begin('play',{actions:[{type:'click',selector:'#start'}]});
  w.finish(delivered.id,'play',{actions:[{type:'click',selector:'#start'}]},{ok:true,functionalChecks:false});
  assert.match(w.snapshot().nodes.at(-1)!.reason,/keine Funktionsbestätigung/);
});
