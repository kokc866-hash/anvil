import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { buildAgentRuntime } from './build-agent-runtime.mjs';

const options = { context: 32768, compact: 'off', runLoop: false, graphLoop: false, testLoop: false, autoRunAgent: false, maxRounds: 16 };

test('large shell output is read completely through task-local handles without executing the command twice', async t => {
  const f = await agentLoopFixture(t); f.beginAgent();
  const raw = { ok: true, code: 0, stdout: 'LOG_START\n' + 'synthetic build output\n'.repeat(6500) + 'FINAL_DIAGNOSTIC', stderr: '' };
  let shellCalls = 0, outputId, collected = '', nextOffset = 0;
  const result = await f.runAgentLoop({ ...options, messages: [{ role: 'user', content: 'Read the existing synthetic build log and report its final diagnostic. Do not edit files.' }], files: [] }, async messages => {
    const last = messages.at(-1);
    if (last?.role !== 'tool') return tool('shell', { command: 'node fixture.js' });
    const content = JSON.parse(String(last.content));
    if (!outputId) {
      assert.equal(content.truncated, true);
      assert.equal(content.retained, true);
      assert.match(content.text, /FINAL_DIAGNOSTIC/);
      outputId = content.outputId;
    } else {
      assert.equal(content.outputId, outputId, JSON.stringify(content));
      collected += content.text; nextOffset = content.nextOffset;
      if (nextOffset === null) return { content: 'The existing log ends with FINAL_DIAGNOSTIC.' };
    }
    return tool('read_tool_output', { output_id: outputId, offset: nextOffset, limit: 24000 });
  }, { shell: async () => { shellCalls++; return raw; } });
  assert.equal(shellCalls, 1);
  assert.deepEqual(JSON.parse(collected), { ...raw, command: 'node fixture.js' });
  assert.equal(result.ok, true, result.error);

  f.beginAgent(); let turn = 0;
  const foreign = await f.runAgentLoop({ ...options, observeOnly: true, messages: [{ role: 'user', content: 'Inspect the old output handle without rerunning its command.' }], files: [] }, async messages => {
    if (!turn++) return tool('read_tool_output', { output_id: outputId });
    assert.match(String(messages.at(-1).content), /unavailable in this task|evicted/);
    return { content: 'The earlier handle is unavailable; no command was repeated.' };
  });
  assert.equal(shellCalls, 1);
  assert.doesNotMatch(foreign.reply, /RUN OK/);
});

test('a summary that increases the framed context is rejected; smaller historical summaries remain usable', async t => {
  const f = await agentLoopFixture(t);
  for (const shrink of [false, true]) await t.test(shrink ? 'smaller summary' : 'larger summary', async () => {
    f.beginAgent(); let summaries = 0;
    const messages = Array.from({ length: 32 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `HISTORY_${i} ` + 'old history '.repeat(600) }));
    messages.push({ role: 'user', content: 'Preserve this exact current request and explain the history.' });
    await f.runAgentLoop({ messages, files: [], context: 16384, compact: 'aggressive', observeOnly: true }, async history => {
      const compact = history.find(message => String(message.content).startsWith('Older history (compact'));
      assert.ok(compact);
      if (shrink) {
        assert.match(String(compact.content), /SMALL_SUMMARY/);
        assert.match(String(compact.content), /historical context|Historical context/i);
      } else {
        assert.doesNotMatch(String(compact.content), /LARGER_SUMMARY/);
        assert.match(String(compact.content), /HISTORY_/);
      }
      assert.ok(history.some(message => String(message.content).includes('Preserve this exact current request')));
      return { content: 'A concise synthetic explanation.' };
    }, { summarize: async () => { summaries++; return shrink ? 'SMALL_SUMMARY' : 'LARGER_SUMMARY '.repeat(16000); } });
    assert.ok(summaries > 0);
  });
});

test('connection recovery preserves a service workflow without forcing unrelated file tools or replaying the completed action', async t => {
  const f = await agentLoopFixture(t); f.beginAgent(); let round = 0, serviceCalls = 0;
  const result = await f.runAgentLoop({ ...options, messages: [{ role: 'user', content: 'Read the current synthetic CAD service state and explain it. Do not change files.' }], files: [], mcpCatalog: 'server=fixture name=status' }, async messages => {
    round++;
    if (round === 1) return tool('mcp_call', { server: 'fixture', name: 'status', arguments: {} });
    if (round === 2) throw Error('ECONNRESET synthetic model stream');
    const recovery = String(messages.at(-1).content);
    assert.match(recovery, /current state|aktuellen.*Stand/i);
    assert.doesNotMatch(recovery, /Next tool: write_file|Als Nächstes write_file|als Nächstes write_file/);
    return { content: 'The previously read service state is ready.' };
  }, { mcp: async () => { serviceCalls++; return { ok: true, text: 'Synthetic CAD ready.' }; } });
  assert.equal(serviceCalls, 1);
  assert.equal(result.ok, true, result.error);
});

test('the real independent worker advertises and executes its local output reader without another native action', { timeout: 45000 }, async () => {
  await buildAgentRuntime();
  const base = resolve('artifacts/rea-harness-2026-10-17/worker-fixtures'); mkdirSync(base, { recursive: true });
  const project = mkdtempSync(join(base, 'worker-')), original = { ok: true, code: 0, stdout: 'BEGIN ' + 'synthetic log '.repeat(12000) + ' END', stderr: '' };
  let calls = 0, id, offset = 0, restored = '', error = '', timer;
  const server = createServer(async (req, res) => {
    try {
      let text = ''; for await (const part of req) text += part;
      const body = JSON.parse(text), last = body.messages.at(-1);
      assert.ok(body.tools.some(tool => tool.function.name === 'read_tool_output'), 'worker must offer read_tool_output');
      let call;
      if (last.role !== 'tool') call = { name: 'shell', arguments: JSON.stringify({ command: 'node fixture.js' }) };
      else {
        const result = JSON.parse(last.content);
        if (!id) { assert.equal(result.retained, true); id = result.outputId; }
        else { assert.equal(result.outputId, id); restored += result.text; offset = result.nextOffset; }
        if (offset !== null) call = { name: 'read_tool_output', arguments: JSON.stringify({ output_id: id, offset, limit: 24000 }) };
      }
      const delta = call ? { tool_calls: [{ id: 'call-' + crypto.randomUUID(), index: 0, type: 'function', function: call }] } : { content: 'WORKER_OUTPUT_OK' };
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (failure) { error = failure.message; res.writeHead(500).end('Synthetic output fixture failed.'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const host = new AgentJobHost({ snapshotPath: join(project, 'jobs/latest.json'), runtime: { begin() {}, close() {}, finish() {}, execute: async operation => { assert.equal(operation.kind, 'shell'); calls++; return original; } },
    launch: () => fork(resolve('agent-build/worker.mjs'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true }) });
  try {
    const terminal = new Promise((done, reject) => { timer = setTimeout(() => reject(Error('Worker output fixture timed out')), 20000); host.on('change', () => { if (['done', 'failed', 'stopped', 'interrupted'].includes(host.state?.status)) { clearTimeout(timer); done(); } }); });
    host.start({ project, files: {}, execution: true, messages: [{ role: 'user', content: 'Read the synthetic shell log once, then read its retained pages.' }], maxRounds: 20, compact: 'off', automation: { runLoop: false, graphLoop: false },
      model: { provider: 'custom', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'synthetic-worker-output', context: 131072, thinking: 'off', retries: 1, hardStopMin: 1, toolMode: 'standard' } });
    await terminal;
    assert.equal(host.state.status, 'done', error || host.state.error);
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(restored), { ...original, command: 'node fixture.js' });
    assert.match(host.state.text, /WORKER_OUTPUT_OK/);
  } finally { clearTimeout(timer); await host.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
});
