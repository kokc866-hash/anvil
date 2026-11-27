import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunRequests } from './run-requests.mjs';

test('request correlation never mistakes an unknown, duplicate or pending start for completion', async () => {
  let finish;
  const requests = new RunRequests({ status: () => assert.fail('No run ID before completion') });
  const id = 'synthetic-request-0001';
  const pending = requests.start(id, () => new Promise(resolve => { finish = resolve; }));
  assert.deepEqual(requests.read(id), { requestId: id, pending: true });
  assert.throws(() => requests.read('unknown-request-0001'), /nicht bekannt/);
  assert.throws(() => requests.read('../invalid-path'), /Ungültige/);
  await assert.rejects(requests.start(id, () => assert.fail('Duplicate may not execute')), /bereits verwendet/);
  finish({ running: false, ok: false, code: 1 }); await pending;
  assert.equal(requests.read(id).running, false);
});

test('only the correlated actual run status completes a detached request', async () => {
  let current = { stage: { id: 'engine/123-abc' }, running: true, ok: true };
  const requests = new RunRequests({ status: id => { assert.equal(id, 'engine/123-abc'); return current; } });
  await requests.start('synthetic-request-0002', async () => current);
  assert.equal(requests.read('synthetic-request-0002').running, true);
  current = { ...current, running: false, stdout: 'real exit receipt' };
  assert.equal(requests.read('synthetic-request-0002').stdout, 'real exit receipt');
});

test('bounded request storage preserves pending work and leaves unexpected failures uncertain', async () => {
  const requests = new RunRequests({ max: 1, status: () => assert.fail() });
  await assert.rejects(requests.start('synthetic-request-0003', async () => { throw Error('unexpected after dispatch'); }), /unexpected/);
  assert.deepEqual(requests.read('synthetic-request-0003'), { requestId: 'synthetic-request-0003', pending: true });
  await assert.rejects(requests.start('synthetic-request-0004', () => assert.fail()), /Zu viele/);
  const done = new RunRequests({ max: 1 });
  await done.start('synthetic-request-0005', async () => ({ running: false }));
  await done.start('synthetic-request-0006', async () => ({ running: false }));
  assert.throws(() => done.read('synthetic-request-0005'), /nicht bekannt/);
});
