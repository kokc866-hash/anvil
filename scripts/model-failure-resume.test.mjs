import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { captureAgentFailure, withModelFailureContext } from '../electron/agent-failure.mjs';

test('a persisted model interruption stays understandable and resumes only on an explicit new request', async t => {
  const evidence = resolve('artifacts/endurance-repair-2026-10-28/transport');
  mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(evidence, 'controlled-resume-'));
  const snapshotPath = join(root, 'latest.json'), starts = [];
  let child, launches = 0;
  const launch = () => {
    launches++;
    child = new EventEmitter(); child.kill = () => {};
    child.send = message => { if (message.type === 'start') starts.push(message.request); };
    return child;
  };
  const request = { project: root, files: { 'notes.md': '# Confirmed source' }, model: { model: 'synthetic-no-inference' }, messages: [{ role: 'user', content: 'Continue the artificial task carefully.' }] };
  const first = new AgentJobHost({ snapshotPath, launch });
  t.after(() => first.close());
  first.start(request); child.emit('message', { type: 'ready' });
  const failure = captureAgentFailure(withModelFailureContext(new TypeError('terminated', { cause: Object.assign(new Error('Body Timeout Error'), { code: 'UND_ERR_BODY_TIMEOUT' }) }), { phase: 'stream', attempt: 1, status: 200 }));
  child.emit('message', { type: 'failure', error: 'The worker supplies a human message too.', failure });
  assert.equal(first.state.status, 'failed');
  assert.match(first.state.error, /Antwortpause.*Empfangszeitlimit/);
  assert.match(first.state.error, /nicht automatisch wiederholt/);
  assert.equal(first.state.failure.error.message, 'terminated');
  assert.equal(first.state.failure.error.cause.code, 'UND_ERR_BODY_TIMEOUT');
  assert.equal(launches, 1);
  const failedId = first.state.id, savedFailure = structuredClone(first.state.failure);
  await first.close();

  const restored = new AgentJobHost({ snapshotPath, launch });
  t.after(() => restored.close());
  assert.equal(launches, 1, 'restoring a snapshot never replays a model request or external action');
  assert.equal(restored.state.status, 'failed'); assert.deepEqual(restored.state.failure, savedFailure);
  assert.match(restored.state.error, /Antwortpause.*Empfangszeitlimit/);
  restored.resume(failedId, { ...request, messages: [
    { role: 'tool', tool_call_id: 'old-call', content: 'Never replay this protocol fragment.' },
    { role: 'assistant', tool_calls: [{ id: 'old-call' }], content: 'Prior incomplete response.' },
    { role: 'user', content: 'Resume from the saved file state.' },
  ] });
  child.emit('message', { type: 'ready' });
  assert.equal(launches, 2); assert.equal(restored.state.resumedFrom, failedId);
  assert.deepEqual(starts[1].files, request.files);
  assert.ok(starts[1].messages.every(message => message.role !== 'tool' && !message.tool_calls), 'resume retains human context, never executable old calls');
  assert.match(starts[1].messages.at(-1).content, /Bereits abgeschlossene Arbeit nicht wiederholen/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'history', failedId + '.json'), 'utf8')).failure, savedFailure);
});
