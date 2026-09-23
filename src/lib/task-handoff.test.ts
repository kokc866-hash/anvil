import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskHandoff } from './task-handoff.ts';
import type { ChatMsg } from '../store/ide-types';

const turn = (patch: Partial<ChatMsg> = {}): ChatMsg => ({ id: 'a', role: 'assistant', content: 'Everything works!', ...patch });
test('handoff preserves changes, recorded checks and unfinished work without copying raw output', () => {
  const text = taskHandoff([turn({
    changes: [{path:'src/counter.ts',kind:'edit',add:3,del:1}],
    lastRun:{path:'src/counter.ts',ok:true,stdout:'PRIVATE RAW OUTPUT',stderr:'',attempt:1,max:1},
    lastTests:{ok:false,pass:3,fail:1},
    plan:[{text:'Fix reset',status:'todo'},{text:'Add counter',status:'ok'}],
  })]);
  assert.match(text,/src\/counter.ts/); assert.match(text,/3 passed, 1 failed/);
  assert.match(text,/Fix reset/); assert.match(text,/historical/);
  assert.doesNotMatch(text,/PRIVATE RAW OUTPUT|Everything works|Add counter/);
});
test('latest checklist supersedes older open items; unfinished checks are not successes', () => {
  const text=taskHandoff([turn({plan:[{text:'OLD OPEN',status:'todo'}]}),turn({lastTests:{ok:true,pass:2,fail:0,running:true},plan:[{text:'OLD OPEN',status:'ok'}]})]);
  assert.doesNotMatch(text,/OLD OPEN/);assert.match(text,/Last tests: unfinished/);
});
test('new chats have no handoff; secret paths are omitted and old records have bounded size', () => {
  assert.equal(taskHandoff([]),''); assert.equal(taskHandoff([turn()]),'');
  const text=taskHandoff(Array.from({length:30},(_,i)=>turn({changes:[{path:'.env',kind:'edit',add:1,del:0},{path:`src/task-${i}.ts`,kind:'edit',add:1,del:0}],plan:[{text:'x'.repeat(5000),status:'todo'}]})));
  assert.doesNotMatch(text,/\.env|task-0\.ts/);assert.match(text,/task-29\.ts/);assert.ok(text.length<6500);
});
