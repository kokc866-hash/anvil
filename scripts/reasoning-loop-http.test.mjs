import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { agentLoopFixture } from '../fixtures/agent-loop-fixture.mjs';

const nativeFetch = globalThis.fetch;
const block = Array.from({ length: 80 }, (_, n) => `Native-boundary observation ${n}: inspect requirement ${n * 13}, then verify distinct case ${n * n}.\n`).join('').slice(0, 1919);
const model = baseUrl => ({ provider: 'custom', baseUrl, model: 'local-http-no-real-model', apiKey: '', context: 131072, thinking: 'high', temperature: 0.1, maxOut: 16384, hardStopMin: 0, retries: 4 });

for (const mode of ['repetition', 'user-stop', 'advancing']) test(`real HTTP ${mode} preserves cancellation ownership and never retries a consumed stream`, async t => {
  const f = await agentLoopFixture(t);
  const { completeRuntime } = await f.server.ssrLoadModule('/src/agent-runtime/transport.ts');
  const user = new AbortController();
  let requests = 0, sent = 0, completed = false, released;
  const closed = new Promise(resolve => { released = resolve; });
  const api = createServer(async (req, res) => {
    for await (const _part of req) { /* consume the artificial request */ }
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const timer = setInterval(() => {
      const reasoning_content = mode === 'advancing' ? `Independent observation ${sent}: verified value ${sent * 43}.\n` : block;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content } }] })}\n\n`);
      sent++;
      if (sent === 12) {
        completed = true;
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Confirmed advancing answer.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      }
    }, 5);
    res.once('close', () => { clearInterval(timer); released(); });
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  globalThis.fetch = nativeFetch;
  const pending = completeRuntime(model(`http://127.0.0.1:${api.address().port}/v1`), [{ role: 'user', content: 'Synthetic network boundary check only.' }], [], user.signal, () => {
    if (mode === 'user-stop' && !user.signal.aborted) user.abort(new Error('USER_STOP_HTTP_CHECK'));
  });
  if (mode === 'repetition') {
    await assert.rejects(pending, error => error.code === 'reasoning_repetition');
    assert.equal(user.signal.aborted, false, 'guard cancels this model response, never the job owner');
  } else if (mode === 'user-stop') {
    await assert.rejects(pending, /USER_STOP_HTTP_CHECK|aborted/i);
    assert.equal(user.signal.aborted, true);
  } else {
    const result = await pending;
    assert.equal(result.content, 'Confirmed advancing answer.');
  }
  let timer;
  try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Upstream HTTP socket was not released')), 2500); })]); }
  finally { clearTimeout(timer); }
  assert.equal(requests, 1);
  assert.equal(completed, mode === 'advancing');
  assert.ok(mode === 'advancing' || sent < 12, 'upstream must stop before producing its full answer');
});
