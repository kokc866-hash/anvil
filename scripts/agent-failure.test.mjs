import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as modelFailure from '../electron/agent-failure.mjs';
const { captureAgentFailure, withModelFailureContext, isRecoverableModelFailure } = modelFailure;

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

test('connection recovery never turns cancellation, response errors or certificate failures into retries', () => {
  const socket = Object.assign(new Error('closed'), { code: 'UND_ERR_SOCKET' });
  const reset = new TypeError('fetch failed', { cause: socket });
  assert.equal(isRecoverableModelFailure(reset), true);
  assert.equal(reset.cause, socket);
  for (const phase of ['http-body', 'response', 'stream']) {
    assert.equal(isRecoverableModelFailure(withModelFailureContext(new TypeError('fetch failed', { cause: socket }), { phase, attempt: 1, status: 200 })), false);
  }
  assert.equal(isRecoverableModelFailure(new TypeError('fetch failed', { cause: new DOMException('Cancelled', 'AbortError') })), false);
  assert.equal(isRecoverableModelFailure(new SyntaxError('network JSON cannot be parsed', { cause: socket })), false);
  assert.equal(isRecoverableModelFailure(new TypeError('fetch failed', { cause: Object.assign(new Error('certificate expired'), { code: 'CERT_HAS_EXPIRED' }) })), false);
  const cyclic = new Error('permanent application failure'); cyclic.cause = cyclic;
  assert.equal(isRecoverableModelFailure(cyclic), false);
});

test('timeouts and interrupted model streams have understandable text while diagnostics retain their native cause', () => {
  assert.equal(typeof modelFailure.modelFailureMessage, 'function');
  for (const [code, expected] of [
    ['UND_ERR_BODY_TIMEOUT', /Antwortpause.*Empfangszeitlimit/],
    ['UND_ERR_HEADERS_TIMEOUT', /Beginn der Modellantwort.*Zeitlimit/],
    ['UND_ERR_SOCKET', /Modellverbindung.*unterbrochen/],
  ]) {
    const cause = Object.assign(new Error('native detail'), { code });
    const error = withModelFailureContext(new TypeError('terminated', { cause }), { phase: 'stream', attempt: 1, status: 200 });
    const message = modelFailure.modelFailureMessage(error);
    assert.match(message, expected); assert.match(message, /nicht automatisch wiederholt/);
    assert.equal(error.message, 'terminated'); assert.equal(captureAgentFailure(error).error.cause.code, code);
  }
  const deadline = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  assert.match(modelFailure.modelFailureMessage(deadline), /Zeitlimit.*Modellanfrage/);
  assert.equal(modelFailure.modelFailureMessage(new DOMException('User stop', 'AbortError')), 'User stop');
  assert.equal(modelFailure.modelFailureMessage(new SyntaxError('Invalid JSON response')), 'Invalid JSON response');
  const cyclic = new Error('original'); cyclic.cause = cyclic;
  assert.equal(modelFailure.modelFailureMessage(cyclic), 'original');
});
