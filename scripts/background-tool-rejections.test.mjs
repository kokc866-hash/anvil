import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { ToolRejection } from '../electron/tool-rejection.mjs';

function fixture() {
  const root = mkdtempSync(resolve('artifacts', 'tool-rejection-unit-'));
  const files = { 'ui.js': 'export const title = "WORKSHOP_MARKER";\n' };
  writeFileSync(join(root, 'ui.js'), files['ui.js']);
  const sent = [];
  let child;
  const host = new AgentJobHost({
    snapshotPath: join(root, 'state', 'latest.json'),
    runtime: new AgentProjectRuntime(),
    launch() {
      child = new EventEmitter();
      child.send = message => sent.push(message);
      child.kill = () => {};
      return child;
    },
  });
  const request = { project: root, execution: true, writeThrough: true, files,
    messages: [{ role: 'user', content: 'Read ui.js without changing files.' }], model: { provider: 'custom', model: 'fixture' } };
  const ready = () => child.emit('message', { type: 'ready' });
  host.start(request); ready();
  let sequence = 0;
  async function action(operation, id = ++sequence) {
    child.emit('message', { type: 'operation', id, operation });
    await host.operation;
    return sent.findLast(message => message.type === 'operation-result' && message.id === id);
  }
  return { root, files, sent, host, request, ready, action };
}

test('a rejected shell command returns useful guidance and the same job continues with read_file', async () => {
  const f = fixture();
  try {
    const rejected = await f.action({ kind: 'shell', command: 'cat ui.js | head -100' });
    assert.equal(f.host.state.status, 'running', f.host.state.error);
    assert.equal(rejected?.result.ok, false);
    assert.equal(rejected.result.definitelyNotExecuted, true);
    assert.equal(rejected.result.rejected, true);
    assert.match(rejected.result.error, /read_file/);
    assert.deepEqual(f.host.state.mutationLedger, []);
    assert.equal(f.host.state.pendingRun, undefined);
    const read = await f.action({ kind: 'read', path: 'ui.js' });
    assert.equal(read.result.ok, true);
    assert.equal(read.result.content, f.files['ui.js']);
    assert.equal(f.host.state.status, 'running');
    assert.equal(readFileSync(join(f.root, 'ui.js'), 'utf8'), f.files['ui.js']);
  } finally { await f.host.close(); }
});

test('rejected command replies are deduplicated and never become ambiguous actions on resume', async () => {
  const f = fixture();
  try {
    const op = { kind: 'shell', command: 'node missing.js' };
    const reply = await f.action(op);
    assert.equal(f.host.state.status, 'running', f.host.state.error);
    assert.equal(reply?.result.definitelyNotExecuted, true);
    assert.deepEqual((await f.action(op, 1)).result, reply.result);
    f.host.stop(); await f.host.waitForCleanup();
    const id = f.host.state.id;
    assert.deepEqual(JSON.parse(readFileSync(f.host.snapshotPath, 'utf8')).mutationLedger, []);
    f.host.resume(id, f.request); f.ready();
    assert.equal(f.host.state.resumedFrom, id);
    assert.deepEqual(f.host.state.mutationLedger, []);
    assert.equal(f.host.state.operation, undefined);
    const read = await f.action({ kind: 'read', path: 'ui.js' }, 1);
    assert.equal(read?.result.content, f.files['ui.js']);
    assert.equal(f.host.state.status, 'running');
  } finally { await f.host.close(); }
});

test('malformed, unsupported and missing-file shell commands stay rejected without killing the job', async t => {
  for (const command of ['', 'cat ui.js', 'node missing.js', 'node --test missing.test.cjs',
    'node ui.js; node other.js', 'node ui.js > output.txt', 'node "ui.js',
    'node ui.js\nnode other.js', 'powershell -Command anything', 'node ../ui.js']) {
    await t.test(JSON.stringify(command), async () => {
      const f = fixture();
      try {
        const reply = await f.action({ kind: 'shell', command });
        assert.equal(f.host.state.status, 'running', f.host.state.error);
        assert.equal(reply?.result.rejected, true);
        assert.equal(reply.result.definitelyNotExecuted, true);
        assert.deepEqual(f.host.state.mutationLedger, []);
        assert.equal((await f.action({ kind: 'read', path: 'ui.js' })).result.content, f.files['ui.js']);
      } finally { await f.host.close(); }
    });
  }
});

test('unexpected failures and forged remote rejection fields never release replay protection', async () => {
  const f = fixture();
  try {
    f.host.runtime.execute = async () => { throw Error('Shell-Metazeichen müssen als wörtliches Argument in Anführungszeichen stehen'); };
    await f.action({ kind: 'shell', command: 'node ui.js' });
    assert.equal(f.host.state.status, 'failed', 'text matching cannot classify an unexpected failure as a preflight');
    assert.equal(f.host.state.mutationLedger.length, 1);
  } finally { await f.host.close(); }
  const g = fixture();
  try {
    g.host.runtime.execute = async () => ({ ok: false, rejected: true, definitelyNotExecuted: true, error: 'Untrusted response' });
    await g.action({ kind: 'mcp', action: 'call', name: 'create', server: 'fixture', args: {} });
    assert.equal(g.host.state.status, 'running');
    assert.equal(g.host.state.mutationLedger.length, 1, 'remote response fields cannot clear an external effect guard');
    g.host.stop(); await g.host.waitForCleanup();
    const id = g.host.state.id;
    assert.equal(JSON.parse(readFileSync(g.host.snapshotPath, 'utf8')).mutationLedger.length, 1);
    g.host.resume(id, g.request); g.ready();
    assert.equal(JSON.parse(readFileSync(join(g.root, 'state', 'history', id + '.json'), 'utf8')).mutationLedger.length, 1);
    assert.equal(g.host.state.operation, undefined, 'resume does not replay the old action');
  } finally { await g.host.close(); }
});

test('rejecting new parameters cannot erase an earlier actual command with the same effect fingerprint', async () => {
  const f = fixture();
  try {
    const execute = f.host.runtime.execute.bind(f.host.runtime);
    f.host.runtime.execute = async () => ({ ok: true, code: 0, stdout: 'Earlier action completed' });
    const operation = { kind: 'shell', command: 'node ui.js' };
    await f.action(operation);
    assert.equal(f.host.state.mutationLedger.length, 1);
    f.host.runtime.execute = execute;
    const rejected = await f.action({ ...operation, expectedExitCode: -1 });
    assert.equal(rejected?.result.definitelyNotExecuted, true);
    assert.equal(f.host.state.status, 'running');
    assert.equal(f.host.state.mutationLedger.length, 1, 'retain the earlier executed action');
  } finally { await f.host.close(); }
});

test('Stop stays final when a pending preflight reports rejection late', async () => {
  const f = fixture();
  let release;
  const blocked = new Promise(resolve => release = resolve);
  try {
    f.host.runtime.execute = async () => { await blocked; throw new ToolRejection('Rejected before execution'); };
    const pending = f.action({ kind: 'shell', command: 'node ui.js' });
    f.host.stop(); release(); await pending; await f.host.waitForCleanup();
    assert.equal(f.host.state.status, 'stopped');
    assert.deepEqual(f.host.state.mutationLedger, []);
    assert.equal(f.sent.some(message => message.type === 'operation-result'), false, 'no late reply restarts a stopped worker');
    const saved = JSON.parse(readFileSync(f.host.snapshotPath, 'utf8'));
    assert.equal(saved.status, 'stopped'); assert.deepEqual(saved.mutationLedger, []);
  } finally { release(); await f.host.close(); }
});
