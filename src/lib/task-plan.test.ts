import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newTaskPlan,reviseTaskPlan,completeTaskPlan,freezePlanExecution,validTaskPlan,planExecutionPrompt} from './task-plan.ts';
test('queued plan version stays immutable after editing the source plan',()=>{
  const first=reviseTaskPlan(newTaskPlan('fixture','Build only a clock.'),'Read, build clock, test time.'),execution=freezePlanExecution(first,1,'fixture');
  const changed=reviseTaskPlan(first,'Build a different clock.');
  assert.equal(changed.revisions.at(-1)?.version,2);assert.equal(execution.body,first.revisions[0].body);assert.equal(execution.version,1);assert.equal(Object.isFrozen(execution),true);assert.match(planExecutionPrompt(execution),/Build only a clock/);
});
test('planning completion cannot overwrite a newer edit or another generation',()=>{
  const initial=newTaskPlan('fixture','Plan the change.');
  assert.throws(()=>completeTaskPlan(initial,'other','wrong'));
  const edited=reviseTaskPlan(initial,'Manual plan.');assert.throws(()=>completeTaskPlan(edited,initial.generation,'Late model answer'));
  assert.throws(()=>freezePlanExecution(initial,1,'fixture'));assert.throws(()=>freezePlanExecution(edited,1,'another-project'));
});
test('version history is bounded, monotonic and restorable',()=>{
  let plan=newTaskPlan('fixture','Plan.');for(let i=0;i<30;i++)plan=reviseTaskPlan(plan,`Version ${i}`);
  assert.equal(plan.revisions.length,16);assert.equal(plan.revisions.at(-1)?.version,30);assert.equal(validTaskPlan(JSON.parse(JSON.stringify(plan))),true);
  assert.throws(()=>freezePlanExecution(plan,1,'fixture'));assert.throws(()=>reviseTaskPlan(plan,'x'.repeat(50001)));
});
