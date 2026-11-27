import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopObservation, AgentLoopProgress } from './agent-loop-progress.ts';

test('foreground and background output observations both preserve real application progress', () => {
  for (const field of ['state','observation']) {
    const guard = new AgentLoopProgress();
    for (let i=0;i<30;i++) {
      const observed = loopObservation({ok:true,[field]:{text:'Large constant page prefix',observations:[{selector:'#completed',text:String(i)}]}});
      guard.record(JSON.stringify(observed));
      assert.equal(guard.stop,false);
    }
  }
});

test('a fresh capture id without changed output does not disguise repeated testing actions', () => {
  const guard = new AgentLoopProgress();
  for(let i=0;i<12;i++)guard.record(JSON.stringify(loopObservation({ok:true,state:{text:'Ready',observations:[null,7,{selector:'#completed',text:'0',rect:{x:i},capture:i}]},image:String(i)})));
  assert.equal(guard.stop,true);
});
