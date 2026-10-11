import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureAgentFailure, withModelFailureContext } from '../electron/agent-failure.mjs';

test('model failure retains native class, cause and request context without credentials or arbitrary fields', () => {
  const cause = Object.assign(new Error('Socket closed token=private-token https://user:pass@host/api?key=private-key#secret'), { code: 'UND_ERR_SOCKET', headers: { Authorization: 'Bearer private-key' } });
  const error = new TypeError('terminated; Authorization: Bearer private-key', { cause });
  assert.equal(withModelFailureContext(error, { phase: 'stream', attempt: 2, status: 200 }), error);
  const failure = captureAgentFailure(error, { phase: 'thinking', requestSequence: 9, jobId: 'qa-job', secrets: ['private-key'] });
  assert.equal(failure.error.name, 'TypeError');
  assert.equal(failure.error.cause.code, 'UND_ERR_SOCKET');
  assert.equal(failure.requestId, 'qa-job:model:9');
  assert.deepEqual(failure.transport, { phase: 'stream', attempt: 2, status: 200 });
  assert.ok(!/private-key|private-token|user:pass|#secret|headers/.test(JSON.stringify(failure)));
  assert.deepEqual(captureAgentFailure(failure.error, { ...failure, jobId: 'qa-job', secrets: ['private-key'] }), failure, 'host sanitization preserves worker diagnostics');
});

test('diagnostics bound cyclic causes and reject unrecognized context fields', () => {
  const error = new Error('x'.repeat(4000)); error.cause = error;
  const failure = captureAgentFailure(error, { phase: 'payload-secret', requestSequence: -1, jobId: 'url?token', transport: { phase: 'secret', attempt: 100 } });
  assert.equal(failure.error.message.length, 1000);
  assert.equal(failure.error.cause, undefined);
  assert.equal(failure.phase, 'preparing');
  assert.equal(failure.requestSequence, 0);
  assert.equal(failure.requestId, undefined);
  assert.equal(failure.transport, undefined);
});
