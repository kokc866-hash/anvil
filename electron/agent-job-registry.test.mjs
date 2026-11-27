import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { AgentJobRegistry, JobResourceGate } from './agent-job-registry.mjs';

const home = path.resolve('artifacts/cursor-adoption-2026-10-19/worktrees'); mkdirSync(home, { recursive: true });
function fixture() {
  const area = mkdtempSync(path.join(home, 'registry-')), directory = path.join(area, 'jobs');
  const first = path.join(area, 'first'), second = path.join(area, 'second'), third = path.join(area, 'third');
  for (const root of [first, second, third]) mkdirSync(root);
  const calls = []; let sequence = 0;
  const createHost = ({ jobId, snapshotPath }) => {
    const host = new EventEmitter(); host.state = null;
    try { host.state = JSON.parse(readFileSync(snapshotPath, 'utf8')); host.state.status = 'interrupted'; } catch { /* New job. */ }
    host.busy = () => host.state?.status === 'running';
    host.persist = () => { mkdirSync(path.dirname(snapshotPath), { recursive: true }); writeFileSync(snapshotPath, JSON.stringify(host.state)); };
    host.snapshot = () => ({ state: host.state && structuredClone(host.state) });
    host.waitForCleanup = async () => {};
    host.start = request => { calls.push({ kind: 'start', jobId, request }); host.state = { id: `run-${++sequence}`, project: request.project, modelTarget: { provider: request.model.provider, model: request.model.model, baseUrl: request.model.baseUrl }, status: 'running', revision: 0, execution: true, drafts: {}, steps: [] }; host.persist(); host.emit('change'); return host.snapshot(); };
    host.resume = (id, request) => { calls.push({ kind: 'resume', jobId, id, request }); return host.start(request); };
    host.stop = () => { if (host.state) { host.state.status = 'stopped'; host.persist(); host.emit('change'); } return host.snapshot(); };
    host.steer = (...args) => { calls.push({ kind: 'steer', jobId, args }); return host.snapshot(); };
    host.close = async () => { host.stop(); };
    return host;
  };
  const registry = new AgentJobRegistry({ directory, createHost });
  return { area, directory, first, second, third, calls, createHost, registry, clean: () => { assert.equal(path.dirname(path.resolve(area)), home); rmSync(area, { recursive: true, force: true }); } };
}
const request = project => ({ project, model: { provider: 'custom', baseUrl: 'http://model.invalid/v1', model: 'synthetic-test' }, files: {}, messages: [{ role: 'user', content: 'Test only' }], generation: 'original', steering: { version: 1 } });

test('two disjoint jobs have separate factories, selection and exact ID routing', async () => {
  const f = fixture();
  try {
    const a = await f.registry.start(request(f.first)), b = await f.registry.start(request(f.second));
    assert.notEqual(a.jobId, b.jobId); assert.equal(f.registry.busy(), true);
    assert.equal(f.calls[0].request.generation, 'original'); assert.deepEqual(f.calls[0].request.steering, { version: 1 });
    const jobs = f.registry.jobs(); assert.equal(jobs.jobs.length, 2); assert.equal(jobs.maxParallel, 2);
    await assert.rejects(f.registry.start(request(f.third)), /Höchstens zwei/);
    f.registry.select(a.jobId); assert.equal(f.registry.state.id, a.state.id);
    assert.equal(f.registry.snapshot(undefined, undefined, undefined, b.jobId).state.project, f.second);
    const target = f.registry.hostFor({ id: b.state.id }); target.steer(b.state.id, 'Change only second', 'msg-one');
    assert.deepEqual(f.calls.at(-1).args, [b.state.id, 'Change only second', 'msg-one']);
    assert.equal(f.calls.at(-1).jobId, b.jobId);
    assert.throws(() => f.registry.hostFor({ jobId: a.jobId, id: b.state.id }), /inzwischen|gehört/);
    assert.throws(() => f.registry.hostFor({ jobId: 'missing' }), /Unbekannter/);
    await f.registry.close(); assert.equal(f.registry.busy(), false);
  } finally { f.clean(); }
});

test('same or nested real roots cannot have concurrent writers; unavailable roots cannot run in parallel', async () => {
  const f = fixture();
  try {
    const nested = path.join(f.first, 'nested'); mkdirSync(nested);
    await f.registry.start(request(f.first));
    await assert.rejects(f.registry.start(request(nested)), /überlappen/);
    await assert.rejects(f.registry.start(request(f.first)), /überlappen/);
    await assert.rejects(f.registry.start(request('memory-project')), /Projektordner/);
    assert.equal(f.registry.jobs().jobs.length, 1);
  } finally { await f.registry.close(); f.clean(); }
});

test('parallel start reservations cannot race across an asynchronous cleanup', async () => {
  const f = fixture();
  try {
    const results = await Promise.allSettled([f.registry.start(request(f.first)), f.registry.start(request(f.first))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.calls.filter(c => c.kind === 'start').length, 1);
  } finally { await f.registry.close(); f.clean(); }
});

test('restart restores selector, model/project binding and preserves legacy latest.json', async () => {
  const f = fixture();
  try {
    mkdirSync(f.directory, { recursive: true });
    const legacy = JSON.stringify({ id: 'legacy-run', project: f.first, status: 'stopped', revision: 0, drafts: {}, steps: [], modelTarget: request(f.first).model });
    writeFileSync(path.join(f.directory, 'latest.json'), legacy);
    const first = new AgentJobRegistry({ directory: f.directory, createHost: f.createHost });
    assert.equal(first.jobs().jobs[0].id, 'legacy-run');
    const added = await first.start(request(f.second));
    first.select('legacy'); await first.close();
    const recovered = new AgentJobRegistry({ directory: f.directory, createHost: f.createHost });
    assert.equal(recovered.jobs().selectedJobId, 'legacy');
    assert.equal(recovered.jobs().jobs.length, 2);
    assert.equal(recovered.hostFor({ jobId: added.jobId }).state.project, f.second);
    const changed = request(f.second); changed.model.model = 'different';
    await assert.rejects(recovered.resume(added.state.id, changed, added.jobId), /Modell/);
    await assert.rejects(recovered.resume(added.state.id, request(f.third), added.jobId), /Projekt/);
    assert.equal(existsSync(path.join(f.directory, 'latest.json')), true);
    await recovered.close();
  } finally { f.clean(); }
});

test('explicitly detaching a saved selection survives restart without changing its snapshot', async () => {
  const f = fixture();
  try {
    const job = await f.registry.start(request(f.first));
    f.registry.stop(undefined, job.jobId);
    const file = path.join(f.directory, 'jobs', job.jobId, 'latest.json');
    const saved = readFileSync(file, 'utf8');

    assert.deepEqual(f.registry.select('', job.jobId), { state: null, jobId: '', selectedJobId: '' });
    assert.equal(f.registry.snapshot().state, null);
    assert.equal(f.registry.jobs().jobs.length, 1);
    assert.equal(readFileSync(file, 'utf8'), saved);

    const recovered = new AgentJobRegistry({ directory: f.directory, createHost: f.createHost });
    assert.equal(recovered.jobs().selectedJobId, '');
    assert.equal(recovered.snapshot().state, null);
    assert.equal(recovered.select(job.jobId).state.id, job.state.id);
  } finally { await f.registry.close(); f.clean(); }
});

test('conditional detachment respects changed selection and a running or waiting task', async () => {
  const f = fixture();
  try {
    const first = await f.registry.start(request(f.first));
    const second = await f.registry.start(request(f.second));
    assert.match(f.registry.select('', first.jobId).error, /auswahl/i);
    assert.equal(f.registry.jobs().selectedJobId, second.jobId);
    assert.match(f.registry.select('', second.jobId).error, /aktiv|Antwort/);
    const host = f.registry.hostFor({ jobId: second.jobId });
    host.state.status = 'waiting-user';
    assert.match(f.registry.select('', second.jobId).error, /aktiv|Antwort/);
    assert.equal(f.registry.jobs().selectedJobId, second.jobId);
    assert.deepEqual(f.registry.select(''), { state: null, jobId: '', selectedJobId: '' });
    assert.equal(f.registry.hostFor({ jobId: first.jobId }).state.status, 'running');
    assert.equal(host.state.status, 'waiting-user');
  } finally { await f.registry.close(); f.clean(); }
});

test('failed start preserves an intentional empty selection', async () => {
  const f = fixture();
  try {
    const job = await f.registry.start(request(f.first));
    f.registry.stop(undefined, job.jobId);
    f.registry.select('');
    f.registry.createHost = (...args) => {
      const host = f.createHost(...args);
      host.start = () => { throw Error('Synthetic dispatch failure'); };
      return host;
    };
    await assert.rejects(f.registry.start(request(f.second)), /Synthetic dispatch failure/);
    assert.equal(f.registry.jobs().selectedJobId, '');
    assert.equal(f.registry.jobs().jobs.length, 1);
  } finally { await f.registry.close(); f.clean(); }
});

test('job roots remain reserved while cleanup or owned external processes are active', async () => {
  const f = fixture();
  try {
    const a = await f.registry.start(request(f.first));
    const h = f.registry.hostFor({ jobId: a.jobId }); h.stop(); h.runtime = { resourceBusy: () => true };
    await assert.rejects(f.registry.start(request(f.first)), /überlappen/);
    h.runtime.resourceBusy = () => false;
    const next = await f.registry.start(request(f.first)); assert.notEqual(next.jobId, a.jobId);
  } finally { await f.registry.close(); f.clean(); }
});

test('external gate blocks before invoking a competing operation and never replays it', async () => {
  const gate = new JobResourceGate(); let firstCalls = 0, secondCalls = 0, releaseFirst;
  const pending = gate.run('first', 'external', async () => { firstCalls++; await new Promise(r => { releaseFirst = r; }); });
  await assert.rejects(gate.run('second', 'external', async () => { secondCalls++; }), /belegt/);
  assert.equal(firstCalls, 1); assert.equal(secondCalls, 0);
  releaseFirst(); await pending;
  await gate.run('second', 'external', async () => { secondCalls++; }); assert.equal(secondCalls, 1);
});

test('malformed registries block writes and never replace saved jobs', async () => {
  const f = fixture();
  try {
    mkdirSync(f.directory, { recursive: true }); const file = path.join(f.directory, 'registry.json');
    writeFileSync(file, '{malformed');
    const recovered = new AgentJobRegistry({ directory: f.directory, createHost: f.createHost });
    assert.match(recovered.jobs().error, /registrierung/i);
    await assert.rejects(recovered.start(request(f.first)), /registrierung/i);
    assert.equal(readFileSync(file, 'utf8'), '{malformed');
  } finally { f.clean(); }
});

test('explicit file-action leases prevent background starts and are scoped to real roots and owners', async () => {
  const f = fixture();
  try {
    const lease = f.registry.acquireWorkspace([f.first], 'foreground:1:return');
    await assert.rejects(f.registry.start(request(f.first)), /Dateiaktion/);
    assert.throws(() => f.registry.releaseWorkspace(lease.leaseId, 'foreground:2:return'), /anderen Dateiaktion/);
    const b = await f.registry.start(request(f.second)); assert.equal(b.state.project, f.second);
    assert.throws(() => f.registry.acquireWorkspace([f.second], 'foreground:1:return'), /aktiven Hintergrundauftrag/);
    f.registry.releaseWorkspacePrefix('foreground:2:'); await assert.rejects(f.registry.start(request(f.first)), /Dateiaktion/);
    f.registry.releaseWorkspacePrefix('foreground:1:'); assert.equal((await f.registry.start(request(f.first))).state.project, f.first);
  } finally { await f.registry.close(); f.clean(); }
});

test('a replaced project directory cannot inherit an older job after restart', async () => {
  const f = fixture();
  try {
    const run = await f.registry.start(request(f.first)); f.registry.hostFor({ jobId: run.jobId }).stop();
    renameSync(f.first, f.first + '-original'); mkdirSync(f.first);
    const restored = new AgentJobRegistry({ directory: f.directory, createHost: f.createHost });
    await assert.rejects(restored.resume(run.state.id, request(f.first), run.jobId), /ersetzt/);
    assert.throws(() => restored.assertWriteHost(restored.hostFor({ jobId: run.jobId })), /ersetzt/);
    await restored.close();
  } finally { await f.registry.close(); f.clean(); }
});

test('dismissed slots are reclaimed without deleting their persisted result', async () => {
  const f = fixture();
  try {
    const old = await f.registry.start(request(f.first)), host = f.registry.hostFor({ jobId: old.jobId }); host.stop(); host.state.dismissed = true; host.persist();
    await f.registry.start(request(f.second));
    assert.equal(f.registry.jobs().jobs.some(job => job.jobId === old.jobId), false);
    assert.equal(existsSync(path.join(f.directory, 'jobs', old.jobId, 'latest.json')), true);
  } finally { await f.registry.close(); f.clean(); }
});
