import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestPlanContext,initialAgentPlan} from './plan.ts';
import {agentTaskPolicy,steeredTaskPolicy} from './agent-task-policy.ts';

const correction='Korrektur: die Roboter sollten sich auch bewegen und auftrag ausführen.';
const objective='Prüfe den Logistiksimulator in der HTML-Vorschau. Keine Dateien ändern oder Fehler reparieren.';
const history=(request=objective)=>[{role:'user',content:request},{role:'assistant',content:'Noch nicht abgeschlossen.',plan:initialAgentPlan(request)}];
const policy=(context:ReturnType<typeof requestPlanContext>)=>(context.humanCorrections||[]).reduce((previous,text)=>steeredTaskPolicy(previous,text),agentTaskPolicy(context.humanPrompt??context.text));

test('the actual robot correction retains its current objective and concrete open check',()=>{
  const context=requestPlanContext(correction,history());
  assert.equal(context.continued,true);
  assert.ok(context.text.includes(objective));
  assert.equal(context.humanPrompt,objective);
  assert.deepEqual(context.humanCorrections,[correction]);
  assert.ok(context.plan?.some(step=>step.kind==='check' && /Roboter.*bewegen/.test(step.text) && step.status==='todo'));
  assert.equal(policy(context).allowChanges,false);
});

test('a terminal generic read/report list cannot erase the current test correction',()=>{
  const chat=[{role:'user',content:'teste alle durch'},{role:'assistant',content:'Unterbrochen.',plan:[{text:'Angefragte Projektinformationen prüfen',kind:'read' as const,status:'ok' as const},{text:'Ergebnis und Grenzen berichten',kind:'report' as const,status:'todo' as const}]}];
  const context=requestPlanContext(correction,chat);
  assert.ok(context.plan?.some(step=>step.kind==='check' && step.text.includes('Roboter')));
  assert.ok(!context.plan?.some(step=>step.kind==='read' && step.text==='Angefragte Projektinformationen prüfen'));
});

test('neutral behavior corrections preserve the actual write contract in both directions',()=>{
  const build='Erweitere den Logistiksimulator um Transportaufträge.';
  assert.equal(policy(requestPlanContext(correction,history(build))).allowChanges,true);
  assert.equal(policy(requestPlanContext(correction,history())).allowChanges,false);
  const negative='Führe den absichtlichen Negativtest aus. Keine Reparaturen.';
  const preserved=policy(requestPlanContext(correction,history(negative)));
  assert.equal(preserved.allowRepair,false);assert.equal(preserved.negativeTest,true);
  assert.equal(agentTaskPolicy('Korrektur: Zahlen bitte besser lesbar.').allowChanges,false);
  for(const text of ['Korrektur: die Roboter sollten den Auftrag speichern und die Anzeige aktualisieren.','Correction: The robots should store their orders and update the display.']){
    assert.equal(policy(requestPlanContext(text,history())).allowChanges,false,'describing expected writes is not permission to repair a read-only test');
    assert.equal(policy(requestPlanContext(text,history(build))).allowChanges,true);
    assert.equal(agentTaskPolicy(text).allowChanges,false);
  }
});

test('an explicit new repair correction is applied chronologically without deleting the old objective',()=>{
  const text='Korrektur: Repariere jetzt die Roboterbewegung und prüfe den Transport.';
  const context=requestPlanContext(text,history());
  assert.ok(context.text.includes(objective));
  assert.equal(policy(context).allowRepair,true);
});

test('new tasks and unrelated answer boundaries do not inherit an old write contract',()=>{
  for(const text of ['Korrektur: Baue ein neues CAD-Projekt.','Korrektur: Neue Aufgabe: Erstelle einen Kalender.'])assert.equal(requestPlanContext(text,history()).continued,false);
  const chat=[...history(),{role:'user',content:'Erkläre diese Fehlermeldung.'},{role:'assistant',content:'Eine Erklärung.'}];
  assert.equal(requestPlanContext(correction,chat).continued,false);
});

test('a correction preserves a locked user list and adds its own unconfirmed requirement',()=>{
  const plan=[{text:'Eigene Prüfung A',kind:'check' as const,status:'ok' as const,completedBy:'user' as const},{text:'Eigene Prüfung B',kind:'check' as const,status:'todo' as const}];
  const chat=[{role:'user',content:objective},{role:'assistant',content:'Stand.',plan,planLocked:true}];
  const context=requestPlanContext(correction,chat);
  assert.deepEqual(context.plan?.slice(0,2),plan);
  assert.equal(context.locked,true);
  assert.ok(context.plan?.some(step=>step.text.includes('Roboter') && step.status==='todo'));
});

test('a report addition does not become an extra interaction test',()=>{
  const context=requestPlanContext('Korrektur: und berichte warum ein Test scheitert.',history());
  assert.ok(context.plan?.some(step=>step.kind==='report'&&step.text.includes('warum')));
  assert.ok(!context.plan?.some(step=>step.kind==='check'&&step.text.includes('warum')));
  const standalone=initialAgentPlan('Korrektur: und berichte warum ein Test scheitert.');
  assert.deepEqual(standalone.map(step=>step.kind),['report']);
});
