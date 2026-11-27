import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardJobRuntime, JobResourceGate } from './resource-gate.mjs';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

test('leases cannot be stolen or released by another owner, and renderer cleanup is prefix scoped', () => {
  const gate = new JobResourceGate();
  const lease = gate.acquire('foreground:1:session', 'external');
  assert.throws(() => gate.acquire('foreground:2:session'), /belegt/);
  assert.throws(() => gate.release(lease.leaseId, 'foreground:2:session'), /anderen Auftrag/);
  assert.equal(gate.held('foreground:1:session'), true);
  gate.releasePrefix('foreground:2:'); assert.equal(gate.held(), true);
  gate.releasePrefix('foreground:1:'); assert.equal(gate.held(), false);
  assert.deepEqual(gate.release(lease.leaseId, 'foreground:1:session'), { ok: true, released: false });
  assert.throws(() => gate.acquire('owner', 'different-resource'), /Unbekannte/);
});

test('lease count is bounded, and the wrapper releases after success and error without replay', async () => {
  const gate = new JobResourceGate({ maxLeases: 2 });
  const a = gate.acquire('one'), b = gate.acquire('one');
  assert.throws(() => gate.acquire('one'), /Zu viele/); gate.release(a.leaseId, 'one'); gate.release(b.leaseId, 'one');
  let calls = 0;
  await assert.rejects(gate.run('one', 'external', async () => { calls++; throw Error('Actual failure'); }), /Actual failure/);
  assert.equal(calls, 1); assert.equal(gate.held(), false);
});

test('engine session owns the resource after run until actual process exit', async () => {
  const gate = new JobResourceGate(); let end; const done = new Promise(r => { end = r; });
  const job = { done }, engines = { jobs: new Set() };
  const runtime = guardJobRuntime({ engines, debugger: { state: { active: false } }, async execute() { engines.jobs.add(job); return { running: true }; }, async finish() {}, async close() { engines.jobs.clear(); end(); } }, gate, 'one');
  assert.deepEqual(await runtime.execute({ kind: 'engine' }, {}), { running: true });
  assert.throws(() => gate.acquire('two'), /belegt/);
  await runtime.finish(); assert.equal(gate.held(), true);
  engines.jobs.clear(); end(); await done; await new Promise(r => setImmediate(r));
  assert.equal(gate.held(), false);
});

test('debug session keeps a single persistent lease across many commands and only releases on close', async () => {
  const gate = new JobResourceGate(), debug = { state: { active: false } };
  const runtime = guardJobRuntime({ engines: { jobs: new Set() }, debugger: debug, async execute(op) { debug.state.active = op.action !== 'stop'; return { ok: true }; }, async finish() { debug.state.active = false; }, async close() { debug.state.active = false; } }, gate, 'debug-one');
  await runtime.execute({ kind: 'debug', action: 'start' }, {});
  for (let n = 0; n < 50; n++) await runtime.execute({ kind: 'debug', action: 'state' }, {});
  assert.equal(gate.snapshot().length, 1); assert.throws(() => gate.acquire('debug-two'), /belegt/);
  await runtime.execute({ kind: 'debug', action: 'stop' }, {}); assert.equal(gate.held(), false);
});

test('blocked operations never reach the runtime and non-external file actions stay independent', async () => {
  const gate = new JobResourceGate(); gate.acquire('foreground:active'); let calls = 0;
  const runtime = guardJobRuntime({ async execute() { calls++; }, async finish() {}, async close() {} }, gate, 'job');
  await assert.rejects(runtime.execute({ kind: 'mcp' }, {}), /belegt/); assert.equal(calls, 0);
  await runtime.execute({ kind: 'write' }, {}); assert.equal(calls, 1);
});

test('runtime actions remain bound to the original project directory identity', async () => {
  const home = path.resolve('artifacts/cursor-adoption-2026-10-19/worktrees'); mkdirSync(home, { recursive: true });
  const area = mkdtempSync(path.join(home, 'runtime-')), root = path.join(area, 'project'); mkdirSync(root); let calls = 0;
  try {
    const runtime = guardJobRuntime({ begin() {}, async execute() { calls++; }, async finish() {}, async close() {} }, new JobResourceGate(), 'bound');
    runtime.begin({ project: root }, 'run'); renameSync(root, root + '-original'); mkdirSync(root);
    await assert.rejects(runtime.execute({ kind: 'write' }, {}), /verschoben|ersetzt/); assert.equal(calls, 0);
  } finally { assert.equal(path.dirname(area), home); rmSync(area, { recursive: true, force: true }); }
});
