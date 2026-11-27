import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentWorkflow } from './agent-workflow.ts';
import { PlanProgress } from './plan-progress.ts';

test('a legacy interrupted workflow keeps its history and accepts new service calls without outcome certification', async () => {
  const options = { runLoop: false, graphLoop: false, testLoop: false, loopTries: 1 };
  const old = new AgentWorkflow({}, options, ['mcp_call', 'write_file']);
  await old.begin('mcp_call', { server: 'fixture', name: 'execute_code', arguments: { code: 'old()' } });
  const saved = old.snapshot(), previous = saved.operations[0];
  previous.status = 'unclear'; previous.recovery = { mode: 'skip', at: previous.at };
  const resumed = new AgentWorkflow({}, options, ['mcp_call', 'write_file'], saved);
  const next = await resumed.begin('mcp_call', { server: 'fixture', name: 'execute_code', arguments: { code: 'inspect_current_state()' } });
  assert.ok(next.id); assert.equal(next.error, undefined);
  assert.notEqual(next.id, previous.id);
  assert.equal(resumed.snapshot().operations[0].status, 'unclear');
  assert.equal(resumed.snapshot().operations[0].resolution, undefined);
  assert.doesNotMatch(resumed.summary(), /remains unknown and blocked|keeping it blocked|not task acceptance/);
  assert.ok((await resumed.begin('write_file', { path: 'notes.txt', content: 'New work' })).id);
});

test('obsolete acceptance metadata cannot prevent a saved checklist from being restored', () => {
  const original = new PlanProgress(); original.sync([{ text: 'Read notes.txt', kind: 'read', status: 'todo' }]);
  const saved = { ...original.snapshot(), acceptance: { invalidOldContract: true } };
  const restored = new PlanProgress();
  assert.equal(restored.restore(saved), true);
  assert.deepEqual(restored.plan, original.plan);
  assert.equal(Object.hasOwn(restored.snapshot(), 'acceptance'), false);
  assert.equal(Object.hasOwn(restored.set({ updates: [{ step: 1, status: 'todo', reason: 'Continue reading' }] }), 'acceptance'), false);
});
