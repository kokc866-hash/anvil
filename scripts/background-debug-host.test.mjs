import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await tick(); assert.ok(predicate(), 'expected host transition'); }
function fixture(overrides = {}) {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(resolve('artifacts', 'background-debug-host-'));
  const calls = [], sent = [], workers = [];
  const runtime = { begin(request, id) { calls.push(['begin', id]); }, execute: async op => ({ ok: true, active: true, paused: true, path: 'app.js', action: op.action }), close() {}, finish() {}, ...overrides };
  const host = new AgentJobHost({ runtime, snapshotPath: join(root, 'state.json'), launch() {
    const worker = new EventEmitter(); worker.send = message => sent.push(message); worker.kill = () => {}; workers.push(worker); return worker;
  } });
  const request = { project: root, execution: true, files: { 'app.js': 'const x = 1;' }, messages: [{ role: 'user', content: 'Synthetic debugging request' }], model: { model: 'fixture' } };
  const start = () => { const result = host.start(request); workers.at(-1).emit('message', { type: 'ready' }); return result.state.id; };
  const send = message => workers.at(-1).emit('message', message);
  const id = start();
  return { host, runtime, request, id, start, send, calls, sent, workers };
}

test('manual debugger commands are refused while a worker operation owns the runtime', async () => {
  const gate = deferred(), calls = [];
  const f = fixture({ execute(op) { calls.push(op.action); return gate.promise; } });
  try {
    f.send({ type: 'operation', id: 1, operation: { kind: 'debug', action: 'step', args: {} } });
    await until(() => calls.length === 1);
    await assert.rejects(f.host.debug(f.id, 'eval', { expr: 'x' }), /Werkzeug|arbeitet/);
    assert.deepEqual(calls, ['step']);
    gate.resolve({ ok: true, active: true, paused: true, line: 2 }); await f.host.operation;
    assert.equal(f.sent.filter(m => m.type === 'operation-result').length, 1);
    assert.equal(f.host.state.lastDebug.line, 2);
  } finally { gate.resolve({ ok: false }); await f.host.close(); }
});

test('worker debugger operation waits for manual evaluation and executes exactly once afterwards', async () => {
  const gate = deferred(), calls = [];
  const f = fixture({ execute(op) { calls.push(op.action); return op.action === 'eval' ? gate.promise : Promise.resolve({ ok: true, active: true, paused: true, line: 3 }); } });
  try {
    const manual = f.host.debug(f.id, 'eval', { expr: 'x' }); await until(() => calls.length === 1);
    f.send({ type: 'operation', id: 1, operation: { kind: 'debug', action: 'step', args: {} } });
    await tick(); assert.deepEqual(calls, ['eval']);
    await assert.rejects(f.host.debug(f.id, 'step'), /Werkzeug|arbeitet/);
    gate.resolve({ ok: true, active: true, paused: true, eval: '1' }); await manual;
    await until(() => f.sent.some(m => m.type === 'operation-result' && m.id === 1));
    assert.deepEqual(calls, ['eval', 'step']); assert.equal(f.host.state.lastDebug.line, 3); assert.equal(f.host.state.status, 'running');
    assert.equal(f.sent.filter(m => m.type === 'operation-result' && m.id === 1).length, 1);
    assert.equal(f.host.state.mutationLedger.length, 2, 'manual evaluation and worker step both enter the mutation ledger');
  } finally { gate.resolve({ ok: false }); await f.host.close(); }
});

test('stop during manual evaluation aborts its signal and drops the waiting worker command', async () => {
  const gate = deferred(), calls = []; let signal;
  const f = fixture({ execute(op, options) { signal = options.signal; calls.push(op.action); return gate.promise; } });
  try {
    const manual = f.host.debug(f.id, 'eval', { expr: 'x' }); await until(() => !!signal);
    f.send({ type: 'operation', id: 1, operation: { kind: 'debug', action: 'step', args: {} } });
    f.host.stop(); assert.equal(signal.aborted, true); assert.throws(() => f.host.dismiss(f.id), /aktiv|geändert/);
    gate.resolve({ ok: true, active: true, paused: true, eval: 'late result' }); await manual; await tick();
    assert.deepEqual(calls, ['eval']); assert.equal(f.host.state.status, 'stopped');
    assert.equal(f.host.state.lastDebug, undefined, 'late evaluation must not resurrect stopped debugger state');
    assert.equal(f.sent.some(m => m.type === 'operation-result'), false);
    await f.host.waitForCleanup(); f.host.dismiss(f.id); await f.host.waitForCleanup();
    assert.equal(f.host.busy(), false);
  } finally { gate.resolve({ ok: false }); await f.host.close(); }
});

test('async runtime cleanup completes before any next-job begin, including dismiss cleanup', async () => {
  const gate = deferred(), began = []; let closing = false, finished = false;
  const cleanup = () => { if (finished) return; closing = true; return gate.promise.then(() => { closing = false; finished = true; }); };
  const f = fixture({ begin(request, id) { assert.equal(closing, false, 'begin must never enter runtime while cleanup owns it'); began.push(id); }, finish: cleanup, close: cleanup });
  try {
    f.send({ type: 'result', result: { ok: true, reply: 'Synthetic completion' } }); assert.equal(f.host.state.status, 'done');
    f.host.dismiss(f.id);
    assert.throws(() => f.host.start(f.request), /aufgeräumt/);
    let settled = false; const waiting = f.host.waitForCleanup().then(() => { settled = true; }); await tick(); assert.equal(settled, false); assert.equal(began.length, 1);
    gate.resolve(); await waiting;
    const nextId = f.start(); assert.notEqual(nextId, f.id); assert.deepEqual(began, [f.id, nextId]);
  } finally { gate.resolve(); await f.host.close(); }
});

test('old debug state callbacks cannot overwrite a new job after awaited cleanup', async () => {
  const f = fixture();
  try {
    f.runtime.onDebug({ ok: true, active: true, paused: true, path: 'old.js', locals: { old: 'private' } }, f.id);
    assert.equal(f.host.state.lastDebug.path, 'old.js');
    f.host.stop(); await f.host.waitForCleanup(); f.host.dismiss(f.id); await f.host.waitForCleanup();
    const newId = f.start();
    f.runtime.onDebug({ ok: true, active: true, paused: true, path: 'old.js', locals: { old: 'private' } }, f.id);
    assert.equal(f.host.state.lastDebug, undefined);
    f.runtime.onDebug({ ok: true, active: true, paused: true, path: 'new.js', locals: { next: '2' } }, newId);
    assert.deepEqual(f.host.state.lastDebug.locals, { next: '2' }); assert.equal(f.host.state.lastDebug.path, 'new.js');
  } finally { await f.host.close(); }
});
