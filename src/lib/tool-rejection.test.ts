import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentEvidence } from './agent-evidence.ts';
import { AgentWorkflow } from './agent-workflow.ts';
import { afterTool } from './harness-project.ts';
import { startHarness } from './harness.ts';

const rejected = { ok: false, error: 'Use read_file', rejected: true, definitelyNotExecuted: true };

test('rejected commands spend no execution or repair budget and do not request source patches', () => {
  const options = { runLoop: true, graphLoop: true, testLoop: true, loopTries: 1, maxTools: 32, afterWrite: 'run' as const };
  let state = startHarness(options);
  for (let n = 0; n < 4; n++) {
    const next = afterTool(state, 'shell', { ...rejected, command: `node missing-${n}.js` }, options);
    assert.equal(next.stop, false);
    assert.equal(next.state.used.runs, 0);
    assert.equal(next.state.used.patches, 0);
    assert.equal(next.state.used.tools, n + 1, 'normal tool limits still count rejected calls');
    assert.doesNotMatch(next.inject, /Patch \+|patch and run|correction batches/i);
    state = next.state;
  }
});

test('rejected execution commands cannot create, erase or certify application evidence', () => {
  const evidence = new AgentEvidence();
  evidence.record('shell', { command: 'node missing.js' }, rejected);
  assert.equal(evidence.status().state, 'none');
  evidence.record('shell', { command: 'node --test broken.test.cjs' }, { ok: false, code: 1, stderr: 'Real assertion failed' });
  evidence.record('shell', { command: 'node --test broken.test.cjs' }, rejected);
  assert.equal(evidence.status().state, 'failed', 'a rejection cannot erase a genuine failed test');
  const restored = new AgentEvidence();
  assert.equal(restored.restore(evidence.snapshot()), true);
  assert.equal(restored.status().state, 'failed');
  const passed = new AgentEvidence();
  passed.record('shell', { command: 'node --test success.test.cjs' }, { ok: true, code: 0, stdout: 'tests 1\npass 1\nfail 0\n' });
  passed.record('shell', { command: 'node --test success.test.cjs' }, rejected);
  assert.equal(passed.status().state, 'passed', 'no source change or real execution superseded the passing proof');
});

test('a rejected retry cannot clear the workflow failure of a test that actually ran', async () => {
  const files = { 'bad.test.cjs': 'throw Error("intentional");' };
  const workflow = new AgentWorkflow(files, { runLoop: false, graphLoop: false, testLoop: false, loopTries: 3, afterWrite: 'none' }, ['shell']);
  await workflow.update(files);
  const args = { command: 'node --test bad.test.cjs' };
  const first = await workflow.begin('shell', args);
  workflow.finish(first.id, 'shell', args, { ok: false, code: 1, stderr: 'Real assertion failed' });
  const previousFailures = workflow.outstandingChecks().failed.length;
  assert.ok(previousFailures > 0);
  const retry = await workflow.begin('shell', args);
  workflow.finish(retry.id, 'shell', args, rejected);
  assert.equal(workflow.outstandingChecks().failed.length, previousFailures);
  assert.equal(workflow.testsPassed, false);
});
