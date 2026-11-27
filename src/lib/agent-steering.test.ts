import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentSteeringInbox,openForegroundSteering,steerForeground,steeringProject} from './agent-steering.ts';
import {agentTaskPolicy,steeredTaskPolicy} from './agent-task-policy.ts';

test('neutral corrections preserve earlier no-change and intentional-negative constraints',()=>{
  const original=agentTaskPolicy('Run the intentional negative test. Do not repair or modify files.');
  const clarification=steeredTaskPolicy(original,'Focus on the exit code.');
  assert.equal(clarification.allowChanges,false);assert.equal(clarification.allowRepair,false);assert.equal(clarification.negativeTest,true);
  const explicit=steeredTaskPolicy(original,'Now fix the failure and test the repaired program.');
  assert.equal(explicit.allowChanges,true);assert.equal(explicit.allowRepair,true);
  assert.equal(steeredTaskPolicy(original,'Fix the bug.',true).allowChanges,false,'Ask never becomes a writing mode');
});

test('corrections have one owner, preserve order and are delivered once',()=>{
  const inbox=new AgentSteeringInbox('task-a');
  assert.equal(inbox.enqueue({id:'a',text:'Keep the negative test failing',createdAt:1}).ok,true);
  assert.equal(inbox.enqueue({id:'a',text:'Different content must not replace a correction',createdAt:2}).duplicate,true);
  inbox.enqueue({id:'b',text:'Only inspect the other function',createdAt:3});
  assert.deepEqual(inbox.drain().map(m=>m.text),['Keep the negative test failing','Only inspect the other function']);
  assert.deepEqual(inbox.drain(),[]);
  assert.equal(inbox.enqueue({id:'a',text:'Already delivered',createdAt:4}).duplicate,true);
});
test('inactive and wrong-project recipients retain no late corrections',()=>{
  let active=true;const owner=openForegroundSteering('project-a','a',()=>active);
  assert.equal(steerForeground('project-b','Wrong target','b').ok,false);
  assert.equal(steerForeground('project-a','Right target','a').ok,true);
  active=false;assert.deepEqual(owner.inbox.drain(),[]);
  assert.equal(steerForeground('project-a','Too late','late').ok,false);owner.close();
});
test('closing an old foreground inbox cannot erase its replacement',()=>{
  const old=openForegroundSteering('a','old',()=>true),next=openForegroundSteering('b','new',()=>true);old.close();
  assert.equal(steerForeground('b','Continue','b').ok,true);assert.equal(next.inbox.drain().length,1);next.close();
});
test('correction limits are explicit rather than silently truncating the instruction',()=>{
  const inbox=new AgentSteeringInbox('a');assert.equal(inbox.enqueue({id:'big',text:'x'.repeat(8001),createdAt:0}).ok,false);
  for(let i=0;i<16;i++)assert.equal(inbox.enqueue({id:String(i),text:'x',createdAt:i}).ok,true);
  assert.equal(inbox.enqueue({id:'overflow',text:'x',createdAt:0}).ok,false);assert.equal(inbox.drain().length,16);
});
test('foreground corrections bind image attachments to the same active recipient', () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const images = [image];
  const owner = openForegroundSteering('project-a', 'a', () => true);
  try {
    assert.equal(steerForeground('project-b', 'Wrong target', 'wrong', images).ok, false);
    assert.equal(steerForeground('project-a', 'Use the image', 'picture', ['https://example.invalid/image.png']).ok, false);
    assert.equal(steerForeground('project-a', 'Use the image', 'picture', images).ok, true);
    images.length = 0;
    assert.equal(steerForeground('project-a', 'Repeat', 'picture', [image]).duplicate, true);
    assert.deepEqual(owner.inbox.drain().map(message => message.images), [[image]]);
  } finally { owner.close(); }

  const textOnly = openForegroundSteering('project-a', 'b', () => true, 'No image transport');
  try {
    assert.equal(steerForeground('project-a', 'Use the image', 'picture', [image]).error, 'No image transport');
    assert.equal(steerForeground('project-a', 'Text still works', 'text').ok, true);
  } finally { textOnly.close(); }
});

test('project identity includes the workspace generation and remote companion',()=>{
  assert.notEqual(steeringProject({workspaceCwd:'I:/test',workspaceEpoch:1}),steeringProject({workspaceCwd:'I:/test',workspaceEpoch:2}));
  assert.notEqual(steeringProject({workspaceCwd:'I:/test',companionUrl:'http://one'}),steeringProject({workspaceCwd:'I:/test',companionUrl:'http://two'}));
});
