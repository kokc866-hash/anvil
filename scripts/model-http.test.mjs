import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { channel } from 'node:diagnostics_channel';
import { createServer as createVite } from 'vite';
import { Agent, getGlobalDispatcher } from 'undici';

let vite, completeRuntime;
before(async () => {
  const requestStub = { name: 'synthetic-model-http-request', enforce: 'pre',
    config: () => ({ ssr: { noExternal: ['@tanstack/react-start', '@tanstack/react-start/server'] } }),
    resolveId: source => source === '@tanstack/react-start/server' ? '\0synthetic-model-http-request' : undefined,
    load: id => id === '\0synthetic-model-http-request' ? 'export const getRequest=()=>globalThis.__anvilTransportTestRequest;' : undefined,
  };
  vite = await createVite({ configFile: false, root: process.cwd(), plugins: [requestStub], optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  ({ completeRuntime } = await vite.ssrLoadModule('/src/agent-runtime/transport.ts'));
});
after(async () => { await vite?.close(); });

const data = (content, done = false) => `data: ${JSON.stringify({ choices: [{ delta: { content }, ...(done ? { finish_reason: 'stop' } : {}) }] })}\n\n${done ? 'data: [DONE]\n\n' : ''}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, handle, options = {}) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({ headers: req.headers, body: JSON.parse(body) });
    await handle(req, res, requests.length);
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const url = `http://127.0.0.1:${api.address().port}/v1/chat/completions`;
  const model = { provider: 'custom', baseUrl: url.replace(/\/chat\/completions$/, ''), model: 'synthetic', apiKey: '', context: 32768, thinking: 'off', temperature: 0, maxOut: 1000, hardStopMin: 0, retries: 3, ...options };
  const deltas = [];
  const run = (signal = new AbortController().signal) => completeRuntime(model, [{ role: 'user', content: 'Artificial transport fixture.' }], [], signal, (text, kind) => deltas.push([text, kind]));
  return { url, requests, run, deltas };
}

test('actual native model dispatch disables hidden header and body timeouts without changing global fetch', async t => {
  const f = await fixture(t, async (_req, res) => {
    await delay(120);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(data('first '));
    await delay(120);
    res.end(data('last', true));
  });
  const actual = [];
  const events = channel('undici:request:create');
  const listener = ({ request }) => {
    if (request.origin === new URL(f.url).origin) actual.push({ headersTimeout: request.headersTimeout, bodyTimeout: request.bodyTimeout });
  };
  const globalBefore = getGlobalDispatcher();
  events.subscribe(listener); t.after(() => events.unsubscribe(listener));
  await (await fetch(f.url, { method: 'POST', body: '{}' })).text();
  const baseline = actual.splice(0);
  const result = await f.run();
  assert.equal(result.content, 'first last');
  assert.deepEqual(actual, [{ headersTimeout: 0, bodyTimeout: 0 }], 'verify the actual wire dispatch, not just Agent constructor defaults');
  assert.equal(getGlobalDispatcher(), globalBefore);
  await (await fetch(f.url, { method: 'POST', body: '{}' })).text();
  assert.deepEqual(actual.slice(1), baseline, 'unrelated global fetch retains its own defaults');
});

test('a real short-idle control fails while the model transport survives the same response pause', async t => {
  const f = await fixture(t, async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(data('before '));
    await delay(1400);
    if (!res.destroyed) res.end(data('after', true));
  });
  const agent = new Agent();
  t.after(() => agent.destroy());
  const control = { dispatch: (options, handler) => agent.dispatch({ ...options, headersTimeout: 50, bodyTimeout: 50 }, handler) };
  const res = await fetch(f.url, { method: 'POST', body: '{}', dispatcher: control });
  await assert.rejects(res.text(), error => error.cause?.code === 'UND_ERR_BODY_TIMEOUT');
  const result = await f.run();
  assert.equal(result.content, 'before after');
  assert.equal(f.requests.length, 2);
});

test('explicit cancellation closes the exact upstream request before headers and during a response', async t => {
  for (const streaming of [false, true]) {
    let started, ended;
    const ready = new Promise(resolve => { started = resolve; });
    const closed = new Promise(resolve => { ended = resolve; });
    const f = await fixture(t, (_req, res) => {
      res.on('close', ended);
      if (streaming) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(data('partial')); }
      started();
    });
    const controller = new AbortController();
    const pending = f.run(controller.signal);
    const rejection = assert.rejects(pending, error => error.name === 'AbortError');
    await ready;
    if (streaming) while (!f.deltas.length) await delay(5);
    controller.abort();
    await rejection;
    await Promise.race([closed, delay(1500).then(() => { throw Error('request socket remained open'); })]);
    assert.equal(f.requests.length, 1);
  }
});

test('one explicit hard deadline also stops a silent response body', async t => {
  let closed;
  const socketClosed = new Promise(resolve => { closed = resolve; });
  const f = await fixture(t, (_req, res) => {
    res.on('close', closed);
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(data('partial'));
  }, { hardStopMin: 0.002, retries: 8 });
  await assert.rejects(f.run(), error => error.name === 'TimeoutError');
  await Promise.race([socketClosed, delay(1500).then(() => { throw Error('hard deadline left socket open'); })]);
  assert.equal(f.requests.length, 1);
});

test('a severed partial response is consumed once and keeps its native transport cause', async t => {
  const f = await fixture(t, async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(data('partial'));
    await delay(40); req.socket.destroy();
  }, { retries: 8 });
  const { captureAgentFailure, isRecoverableModelFailure } = await vite.ssrLoadModule('/electron/agent-failure.mjs');
  await assert.rejects(f.run(), error => {
    const failure = captureAgentFailure(error);
    assert.equal(failure.transport.phase, 'stream'); assert.equal(failure.transport.status, 200);
    assert.ok(failure.error.cause?.code); assert.equal(isRecoverableModelFailure(error), false);
    return true;
  });
  assert.equal(f.requests.length, 1); assert.deepEqual(f.deltas, [['partial', 'text']]);
});

test('redirects never move credentials to another endpoint and independent requests retain their own keys', async t => {
  const target = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(data('target', true)); });
  const f = await fixture(t, (_req, res) => { res.writeHead(307, { location: target.url }); res.end(); }, { apiKey: 'synthetic-secret', retries: 1 });
  await assert.rejects(f.run(), /fetch failed|redirect/i);
  assert.equal(target.requests.length, 0); assert.equal(f.requests[0].headers.authorization, 'Bearer synthetic-secret');
  const [a, b] = await Promise.all([
    fixture(t, (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(data('a', true)); }, { apiKey: 'synthetic-a' }),
    fixture(t, (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(data('b', true)); }, { apiKey: 'synthetic-b' }),
  ]);
  await Promise.all([a.run(), b.run()]);
  assert.equal(a.requests[0].headers.authorization, 'Bearer synthetic-a'); assert.equal(b.requests[0].headers.authorization, 'Bearer synthetic-b');
});

test('foreground server transport shares timeout policy and keeps its originally captured request signal', async t => {
  const { requestTransport } = await vite.ssrLoadModule('/src/lib/request-abort.server.ts');
  const controller = new AbortController();
  globalThis.__anvilTransportTestRequest = new Request('http://fixture.invalid', { signal: controller.signal });
  t.after(() => { delete globalThis.__anvilTransportTestRequest; });
  const captured = requestTransport();
  // Another incoming request must not replace the cancellation owner.
  globalThis.__anvilTransportTestRequest = new Request('http://fixture.invalid');
  let closed;
  const socketClosed = new Promise(resolve => { closed = resolve; });
  const f = await fixture(t, (_req, res) => {
    res.on('close', closed);
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(data('pending'));
  });
  const events = channel('undici:request:create'), actual = [];
  const listener = ({ request }) => { if (request.origin === new URL(f.url).origin) actual.push([request.headersTimeout, request.bodyTimeout]); };
  events.subscribe(listener); t.after(() => events.unsubscribe(listener));
  const res = await captured.send(f.url, { method: 'POST', body: '{}' });
  const reading = res.text(), rejection = assert.rejects(reading, error => error.name === 'AbortError');
  controller.abort(); await rejection;
  await Promise.race([socketClosed, delay(1500).then(() => { throw Error('foreground transport left socket open'); })]);
  assert.deepEqual(actual, [[0, 0]]);
  await assert.rejects(captured.send(f.url, { method: 'POST', body: '{}' }), error => error.name === 'AbortError');
  assert.equal(f.requests.length, 1);
});

test('the model-specific pool rejects an untrusted local TLS certificate and never sends credentials', async t => {
  const { modelFetch } = await import('../electron/model-http.mjs');
  let calls = 0;
  // These checked-in keys are an artificial test identity, never a real service credential.
  const server = createHttpsServer({ key: readFileSync(new URL('../fixtures/model-http-test-key.pem', import.meta.url)), cert: readFileSync(new URL('../fixtures/model-http-test-cert.pem', import.meta.url)) }, (_req, res) => { calls++; res.end('unexpected'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await assert.rejects(modelFetch(`https://127.0.0.1:${server.address().port}/v1`, { headers: { authorization: 'Bearer synthetic-only' } }), error => error.cause?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT');
  assert.equal(calls, 0);
});
