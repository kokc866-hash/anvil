import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { TaskAcceptance } from '../electron/task-acceptance.mjs';

const bytes = Buffer.from('{"solid_count":1}\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');
async function check(t, artifact = 'checks/geometry.json', digest = sha256, prepare = () => {}) {
  mkdirSync('artifacts/freecad-repair-2026-10-11/artifact-fixtures', { recursive: true });
  const root = mkdtempSync(resolve('artifacts/freecad-repair-2026-10-11/artifact-fixtures', 'project-'));
  mkdirSync(join(root, 'checks')); writeFileSync(join(root, 'checks/geometry.json'), bytes); prepare(root);
  const row = { criterion: 'solid', actual: 1, artifact, sha256: digest };
  const tool = { isError: false, text: JSON.stringify({ anvil_acceptance: { observations: [row] } }), anvilArtifactChecks: [{ artifact, sha256: digest, ok: true }] };
  const runtime = new AgentProjectRuntime({ connections: { begin() {}, close() {}, async execute() { return tool; } } });
  let child; const replies = [];
  const host = new AgentJobHost({ snapshotPath: join(root, 'job.json'), runtime, launch() { child = new EventEmitter(); child.send = message => replies.push(message); child.kill = () => {}; return child; } });
  t.after(() => host.close());
  host.start({ project: root, execution: true, writeThrough: true, files: {}, messages: [{ role: 'user', content: 'Synthetic artifact verification' }], model: { model: 'fixture' } });
  child.emit('message', { type: 'ready' });
  child.emit('message', { type: 'operation', id: 1, operation: { kind: 'mcp', action: 'call', server: 'fixture', name: 'verify' } });
  await host.operation;
  const result = replies.findLast(message => message.type === 'operation-result').result;
  const acceptance = new TaskAcceptance(); acceptance.define([{ id: 'solid', label: 'Solid count', required: true, operator: 'eq', expected: 1 }]);
  acceptance.record('mcp_call', result, 'e1', { failed: false, pending: false, changed: false });
  return { result, acceptance: acceptance.result(), root };
}

test('background host verifies the actual saved artifact bytes before accepting a measurement', async t => {
  const { result, acceptance } = await check(t);
  assert.equal(result.anvilArtifactChecks[0].ok, true);
  assert.equal(result.anvilArtifactChecks[0].sha256, sha256);
  assert.equal(acceptance.state, 'passed');
});

test('a wrong digest cannot be made valid by a tool-supplied verification flag', async t => {
  const { result, acceptance } = await check(t, 'checks/geometry.json', '1234567890abcdef'.repeat(4));
  assert.equal(result.anvilArtifactChecks[0].ok, false);
  assert.equal(acceptance.state, 'unverified');
  assert.match(acceptance.checks[0].reason || '', /Prüfsumme/);
});

test('missing files and paths outside the owning project cannot certify acceptance', async t => {
  for (const path of ['verification', '../other/geometry.json', '.env']) {
    const { result, acceptance } = await check(t, path);
    assert.equal(result.anvilArtifactChecks[0].ok, false, path);
    assert.equal(acceptance.state, 'unverified', path);
  }
});

test('directory junctions cannot redirect artifact verification to another project', async t => {
  const { result, acceptance } = await check(t, 'linked/geometry.json', sha256, root => {
    const outside = mkdtempSync(resolve('artifacts/freecad-repair-2026-10-11/artifact-fixtures', 'outside-'));
    writeFileSync(join(outside, 'geometry.json'), bytes);
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  });
  assert.equal(result.anvilArtifactChecks[0].ok, false);
  assert.equal(acceptance.state, 'unverified');
});
