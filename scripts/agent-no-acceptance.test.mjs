import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';

function fixture(t) {
  const directory = resolve('artifacts/remove-acceptance-2026-10-15/fixtures');
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(join(directory, 'job-'));
  let child; const sent = []; let effects = 0;
  const host = new AgentJobHost({ snapshotPath: join(root, 'latest.json'),
    runtime: { begin() {}, close() {}, finish() {}, execute: async () => { effects++; return { ok: true, text: 'Synthetic result' }; } },
    launch() { child = new EventEmitter(); child.send = value => sent.push(value); child.kill = () => {}; return child; } });
  t.after(() => host.close());
  const request = { project: root, execution: true, files: { 'notes.txt': 'Artificial note' }, messages: [{ role: 'user', content: 'Read the note.' }], model: { model: 'fixture' } };
  const send = value => child.emit('message', value);
  host.start(request); send({ type: 'ready' });
  return { host, root, request, sent, send, effects: () => effects };
}

test('ordinary agent replies and tool contracts do not add task acceptance', async t => {
  const f = await agentLoopFixture(t); f.beginAgent();
  const planTool = f.AGENT_TOOLS.find(tool => tool.function.name === 'set_plan');
  assert.equal(Object.hasOwn(planTool.function.parameters.properties, 'criteria'), false);
  const result = await f.runAgentLoop({ messages: [{ role: 'user', content: 'Read the artificial note.' }],
    files: [{ path: 'notes.txt', content: 'Artificial note' }], context: 32768, compact: 'off', maxRounds: 2,
    runLoop: false, graphLoop: false, testLoop: false, autoRunAgent: false }, async messages => {
    assert.doesNotMatch(JSON.stringify(messages), /Binding task acceptance|anvil_acceptance|criteria_change_reason/);
    return { content: 'The artificial note is available.' };
  });
  assert.equal(result.reply, 'The artificial note is available.');
  assert.equal(Object.hasOwn(result, 'acceptance'), false);
  assert.equal(Object.hasOwn(JSON.parse(result.workflow.planProgress), 'acceptance'), false);
});

test('a completed job reports the model reply without an acceptance verdict', t => {
  const f = fixture(t);
  f.send({ type: 'result', result: { ok: true, reply: 'Finished.' } });
  assert.equal(f.host.state.status, 'done');
  assert.equal(f.host.state.text, 'Finished.');
  assert.equal(Object.hasOwn(f.host.state, 'acceptance'), false);
});

test('a resumed worker can finish new verified work while preserving uncertain historical actions', async t => {
  const f = await agentLoopFixture(t); f.beginAgent(); let round = 0;
  const workflow = { schema: 1, id: 'old-service', inputStamp: '', definitionStamp: '', phase: 'act', nodes: [], changed: [],
    operations: [{ id: 'old-service:1', name: 'mcp_call', fingerprint: 'a'.repeat(64), inputStamp: '', status: 'unclear', target: 'execute_code', external: true, at: 1 }] };
  const result = await f.runAgentLoop({ messages: [{ role: 'user', content: 'Read the current note and report it.' }], workflow,
    files: [{ path: 'notes.txt', content: 'Current artificial state.' }], context: 32768, compact: 'off', maxRounds: 4,
    runLoop: false, graphLoop: false, testLoop: false, autoRunAgent: false }, async () => ++round === 1
    ? tool('read_file', { path: 'notes.txt' }) : { content: 'Current artificial state read.' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.reply, 'Current artificial state read.');
  assert.equal(result.workflow.operations[0].status, 'unclear');
  assert.equal(result.workflow.operations[1].status, 'confirmed');
});

test('the next task starts without dismissing or confirming the previous job and archives its state', t => {
  const f = fixture(t), previous = f.host.state.id;
  f.send({ type: 'result', result: { ok: true, reply: 'Finished.' } });
  const next = f.host.start(f.request);
  assert.notEqual(next.state.id, previous);
  const archived = JSON.parse(readFileSync(join(f.root, 'history', previous + '.json'), 'utf8'));
  assert.equal(archived.id, previous);
  assert.equal(archived.text, 'Finished.');
});

test('reopening a legacy job removes obsolete approval instructions while retaining the actual error', t => {
  const f = fixture(t), saved = join(f.root, 'legacy.json');
  writeFileSync(saved, JSON.stringify({ ...f.host.state, status: 'failed', acceptance: { state: 'failed' },
    text: 'Gesamtabnahme: Nicht bestanden. Alte Prüfung.\n\nGesicherter Zwischenstand.',
    error: 'Der tatsächliche Test ist fehlgeschlagen.\nDer Ausgang einer gestarteten externen Aktion ist unbestätigt. Vor dem Abschließen zuerst beim Dienst oder im Werkzeugprotokoll prüfen.',
    blockedMutations: ['a'.repeat(64)], recoveryBlockedActions: ['mcp:execute_code'] }));
  const reopened = new AgentJobHost({ snapshotPath: saved, launch() { assert.fail('Opening a saved job does not restart it'); } });
  t.after(() => reopened.close());
  assert.equal(reopened.state.text, 'Gesicherter Zwischenstand.');
  assert.equal(reopened.state.error, 'Der tatsächliche Test ist fehlgeschlagen.');
  assert.equal(Object.hasOwn(reopened.state, 'acceptance'), false);
  assert.equal(Object.hasOwn(reopened.state, 'blockedMutations'), false);
  assert.equal(Object.hasOwn(reopened.state, 'recoveryBlockedActions'), false);
});

test('an interrupted legacy service task resumes and permits a new tool call without review fields', async t => {
  const f = fixture(t);
  const workflow = { schema: 1, id: 'legacy', inputStamp: '', definitionStamp: '', phase: 'act', nodes: [], changed: [],
    operations: [{ id: 'legacy:1', name: 'mcp_call', fingerprint: 'a'.repeat(64), effectFingerprint: 'b'.repeat(64), inputStamp: '', status: 'unclear', target: 'execute_code', external: true, at: 1 }] };
  f.send({ type: 'operation', id: 1, operation: { kind: 'workflow', snapshot: workflow } });
  f.host.stop();
  const resumed = f.host.resume(f.host.state.id, f.request);
  assert.equal(resumed.state.status, 'starting');
  assert.equal(resumed.state.workflow.operations[0].status, 'unclear', 'Unknown history is not fabricated as successful');
  f.send({ type: 'ready' });
  f.send({ type: 'operation', id: 1, operation: { kind: 'mcp', action: 'call', server: 'fixture', name: 'execute_code', args: { code: 'inspect_and_continue()' } } });
  await f.host.operation;
  assert.equal(f.effects(), 1, 'A new deliberate tool call is not permanently blocked by old uncertainty');
  assert.equal(f.sent.at(-1).result.ok, true);
});
