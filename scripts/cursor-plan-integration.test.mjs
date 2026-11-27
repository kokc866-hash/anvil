import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentLoopFixture} from '../fixtures/agent-loop-fixture.mjs';
test('late hydration preserves a new plan and frozen queued versions; only restored generations are interrupted',async t=>{
 const f=await agentLoopFixture(t),module=await f.server.ssrLoadModule('/src/lib/task-plan-store.ts');
 await module.useTaskPlans.persist.rehydrate();
 const {newTaskPlan}=await f.server.ssrLoadModule('/src/lib/task-plan.ts');
 const old=newTaskPlan('old-project','Old interrupted plan.');old.createdAt-=10000;
 let restore;
 module.useTaskPlans.persist.setOptions({storage:{getItem:()=>new Promise(resolve=>{restore=resolve;}),setItem(){},removeItem(){}}});
 const hydration=module.useTaskPlans.persist.rehydrate();
 const current=module.beginPlanning('fixture','Only improve the artificial clock.');
 module.finishPlanning(current.id,current.generation,'Read, implement the clock, test its ticks.');
 const marker=module.preparePlanExecution(current.id,1,'fixture');
 module.editTaskPlan(current.id,'Read, implement a different clock.','fixture');
 restore({state:{plans:[old],executions:[]},version:1});await hydration;
 const state=module.useTaskPlans.getState();assert.equal(state.plans.find(p=>p.id===old.id).status,'interrupted');assert.equal(state.plans.find(p=>p.id===current.id).revisions.length,2);
 assert.match(module.expandPlanExecution(marker,'fixture'),/test its ticks/);assert.doesNotMatch(module.expandPlanExecution(marker,'fixture'),/different clock/);assert.throws(()=>module.expandPlanExecution(marker,'another-project'));
});
