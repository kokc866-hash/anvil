import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';

test('service recovery classifies native connection failures without replaying the completed action', async t => {
  const f = await agentLoopFixture(t);
  const { withModelFailureContext } = await f.server.ssrLoadModule('/electron/agent-failure.mjs');
  const cases = [
    { name: 'Node fetch failed with socket cause', recover: true, error: () => new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }) },
    { name: 'browser Failed to fetch', recover: true, error: () => new TypeError('Failed to fetch') },
    { name: 'native reset cause with a generic message', recover: true, error: () => withModelFailureContext(new TypeError('request unavailable', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }), { phase: 'connect', attempt: 1 }) },
    { name: 'partly read model stream is not replayed', recover: false, error: () => withModelFailureContext(new Error('ECONNRESET after a partial answer'), { phase: 'stream', attempt: 1, status: 200 }) },
    { name: 'permanent permission cause is not retried', recover: false, error: () => new TypeError('fetch failed', { cause: Object.assign(new Error('denied'), { code: 'EACCES' }) }) },
    { name: 'explicit cancellation is not retried', recover: false, error: () => new DOMException('Request aborted', 'AbortError') },
  ];
  for (const entry of cases) await t.test(entry.name, async () => {
    f.beginAgent(); let calls = 0, serviceCalls = 0, recoveryHint = false;
    const run = f.runAgentLoop({ context: 131072, compact: 'off', maxRounds: 8, runLoop: false, graphLoop: false, locale: 'en', files: [],
      mcpCatalog: 'server=fixture name=status', messages: [{ role: 'user', content: 'Read the service state once, then report it. Never replay a completed action.' }] }, async messages => {
      calls++;
      if (calls === 1) return tool('mcp_call', { server: 'fixture', name: 'status', arguments: {} });
      if (calls === 2) throw entry.error();
      recoveryHint = /current state/.test(String(messages.at(-1)?.content));
      return { content: 'The existing service result is ready; no action was repeated.' };
    }, { mcp: async () => { serviceCalls++; return { ok: true, text: 'Service ready.' }; } });
    if (entry.recover) { const result = await run; assert.equal(result.ok, true); assert.equal(calls, 3); assert.equal(recoveryHint, true); }
    else { await assert.rejects(run); assert.equal(calls, 2); assert.equal(recoveryHint, false); }
    assert.equal(serviceCalls, 1);
  });
  await t.test('repeated socket failures stop after the existing two recovery nudges', async () => {
    f.beginAgent(); let calls = 0, serviceCalls = 0;
    await assert.rejects(f.runAgentLoop({ context: 131072, compact: 'off', maxRounds: 20, files: [], locale: 'en', mcpCatalog: 'server=fixture name=status',
      messages: [{ role: 'user', content: 'Read the existing service state once.' }] }, async () => {
      calls++; if (calls === 1) return tool('mcp_call', { server: 'fixture', name: 'status', arguments: {} });
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('closed'), { code: 'UND_ERR_SOCKET' }) });
    }, { mcp: async () => { serviceCalls++; return { ok: true, text: 'Ready.' }; } }), /fetch failed/);
    assert.equal(calls, 4); assert.equal(serviceCalls, 1);
  });
});
