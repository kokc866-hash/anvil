// Synthetic Node measurement of the real host snapshot seam, without a worker,
// project, model, profile or build. Electron renderer latency is not measured.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { serialize } from 'node:v8';
import { AgentJobHost } from '../electron/agent-job-host.mjs';

const outputArg = process.argv.indexOf('--out');
const output = path.resolve(outputArg < 0 ? 'artifacts/audit-2026-10-04/background-ipc-performance.json' : process.argv[outputArg + 1]);
const chunks = 8, halfFileBytes = 512 * 1024, changes = 100, runs = 5;
const drafts = Object.fromEntries(Array.from({ length: chunks }, (_, i) => [`synthetic/file-${i}.txt`, {
  before: 'a'.repeat(halfFileBytes), after: 'b'.repeat(halfFileBytes), version: 1, eventId: `synthetic-change-${i}`,
}]));
const draftContentBytes = Object.values(drafts).reduce((n, draft) => n + Buffer.byteLength(draft.before) + Buffer.byteLength(draft.after), 0);
assert.equal(draftContentBytes, 8 * 1024 * 1024);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function measure() {
  const host = new AgentJobHost({ snapshotPath: path.join(path.dirname(output), 'never-created-benchmark-state.json'), launch() { assert.fail('The fixture never launches a worker.'); } });
  host.state = { schema: 1, id: 'synthetic-ipc-job', revision: 1, draftRevision: 1,
    project: 'synthetic-memory-only', status: 'running', startedAt: 1, text: '', thinking: '',
    steps: [], plan: [], drafts, directoryChanges: {}, harness: '', error: '', dismissed: false, knowledgeEvents: [] };
  let known = host.snapshot().state;
  const initialBytes = serialize({ state: known }).byteLength;
  let hostMs = 0, receiverCloneMs = 0, transferredBytes = 0, fullDraftSnapshots = 0, reusedDraftSnapshots = 0;
  for (let n = 0; n < changes; n++) {
    host.message({ type: 'delta', text: `text update ${n}\n` }, {}, {});
    const started = performance.now();
    const reply = host.snapshot(known.id, known.revision, known.draftRevision);
    hostMs += performance.now() - started;
    const receiverStarted = performance.now();
    const received = structuredClone(reply);
    receiverCloneMs += performance.now() - receiverStarted;
    transferredBytes += serialize(reply).byteLength;
    assert.ok(received.state);
    if (Object.hasOwn(received.state, 'drafts')) fullDraftSnapshots++;
    else {
      assert.equal(received.draftsUnchanged, true);
      assert.equal(received.state.id, known.id);
      assert.equal(received.state.draftRevision, known.draftRevision);
      reusedDraftSnapshots++;
    }
    known = { ...received.state, drafts: received.state.drafts ?? known.drafts };
  }
  assert.equal(known.text, host.state.text);
  assert.deepEqual(known.drafts, drafts);
  assert.equal(host.persistTimer, null, 'Text-only revisions must not write a snapshot.');
  return { hostMs, receiverCloneMs, transferredBytes, initialBytes, fullDraftSnapshots, reusedDraftSnapshots };
}

measure(); // Warm up the actual module path before collecting samples.
const samples = Array.from({ length: runs }, measure);
const sourceHashes = Object.fromEntries(['electron/agent-job-host.mjs', 'electron/agent-job-ipc.mjs', 'src/lib/background-agent.ts'].map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
const result = { schema: 1, measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
  measurement: 'Node host snapshot plus a receiver structuredClone; serialized size uses node:v8. Not an Electron latency measurement.',
  fixture: { draftContentBytes, textChanges: changes, runs }, sourceHashes,
  median: { hostMs: median(samples.map(s => s.hostMs)), receiverCloneMs: median(samples.map(s => s.receiverCloneMs)) },
  transfer: { textUpdateBytes: samples[0].transferredBytes, initialBytes: samples[0].initialBytes,
    fullDraftSnapshots: samples[0].fullDraftSnapshots, reusedDraftSnapshots: samples[0].reusedDraftSnapshots }, samples };
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, fixture: result.fixture, median: result.median, transfer: result.transfer }));
