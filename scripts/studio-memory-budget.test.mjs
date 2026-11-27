import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'vite';
import { agentLoopFixture } from '../fixtures/agent-loop-fixture.mjs';

const refusal = JSON.stringify({ error: { message: 'Der vollständige Agentenverlauf passt mit Ausgabereserve nicht in das verfügbare Speicherbudget. Verlauf verkleinern oder ein kleineres Modell wählen. Der geschätzte Modellbedarf (95.3 GiB) überschreitet das Studio-GPU-Budget einschließlich Reserve (95.8288 GiB).', type: 'invalid_request_error', code: 'invalid_request' } });
const contextRefusal = 'Der vollständige Verlauf mit Ausgabereserve benötigt geschätzt 369,767 Kontext-Tokens; verfügbar sind 262,144. Der deklarierte Modellkontext reicht dafür nicht aus. Verlauf oder Ausgabegrenze im Agenten verkleinern oder ein Modell mit größerem Kontext wählen. Es wurden keine Nachrichten entfernt.';
const task = 'Continue the synthetic CAD review. Never repeat the already completed external action.';
const requestMark = '[Anvil current user request; preserve the complete text]\n';
const tool = { type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } };
const messages = () => [
  { role: 'system', content: 'Keep the current task, do not invent results or repeat completed external actions.' },
  { role: 'user', content: requestMark + task },
  ...Array.from({ length: 8 }, (_, n) => [{ role: 'user', content: `Old synthetic detail ${n} ${'old detail '.repeat(900)}` }, { role: 'assistant', content: `Recorded synthetic progress ${n} ${'old output '.repeat(900)}` }]).flat(),
  { role: 'assistant', content: '', tool_calls: [{ id: 'confirmed-action', type: 'function', function: { name: 'read_file', arguments: '{"path":"synthetic.txt"}' } }] },
  { role: 'tool', tool_call_id: 'confirmed-action', content: 'CONFIRMED_RESULT: synthetic.txt has already been read.' },
];
let vite, completeRuntime;
before(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  ({ completeRuntime } = await vite.ssrLoadModule('/src/agent-runtime/transport.ts'));
});
after(async () => { await vite?.close(); });

async function endpoint(t, handle) {
  const requests = [];
  const server = httpServer(async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    requests.push(JSON.parse(text));
    await handle(requests.at(-1), res, requests.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}
function success(res) {
  res.writeHead(200, { 'content-type': 'application/json', 'x-anvil-lan': '1' });
  res.end(JSON.stringify({ choices: [{ message: { content: 'Synthetic review complete.' }, finish_reason: 'stop' }] }));
}
function assertPreserved(first, next) {
  assert.equal(next.model, first.model);
  assert.ok(JSON.stringify(next.messages).length < JSON.stringify(first.messages).length * 0.8, 'rejected history must actually become smaller');
  assert.ok(outputReserve(next) < outputReserve(first), 'output reserve must become smaller');
  assert.equal(next.options?.num_ctx, first.options?.num_ctx, 'the configured context remains unchanged');
  assert.equal(next.enable_thinking, first.enable_thinking);
  if (next.enable_thinking) assert.ok(next.reasoning_budget >= 1024 && next.reasoning_budget <= outputReserve(next) - 1024);
  assert.ok(next.messages.some(message => message.role === 'user' && message.content === requestMark + task));
  assert.deepEqual(next.messages.find(message => message.tool_calls)?.tool_calls, first.messages.find(message => message.tool_calls)?.tool_calls);
  assert.deepEqual(next.messages.find(message => message.role === 'tool'), first.messages.find(message => message.role === 'tool'));
  assert.deepEqual(next.tools, first.tools, 'memory refusal does not change the tool contract');
}
function outputReserve(payload) { return payload.max_tokens ?? payload.max_completion_tokens ?? payload.options?.num_predict; }
const model = baseUrl => ({ provider: 'custom', baseUrl, model: 'synthetic-memory-model', apiKey: '', context: 131072, thinking: 'high', temperature: 0.3, maxOut: 4096, hardStopMin: 0, retries: 8 });

for (const [dialect, rejection] of [['legacy German', contextRefusal], ['structured Studio', JSON.stringify({ error: { code: 'context_length_exceeded', message: 'Context does not fit.', details: { input_tokens: 300000, output_reserve: 66560, context_limit: 262144, method: 'native_chat_template', estimated: false } } })]]) {
  test(`${dialect} context admission retries only a smaller history and preserves output/thinking/tools`, async t => {
    const api = await endpoint(t, (_body, res, n) => { if (n === 1) { res.writeHead(400); res.end(rejection); } else success(res); });
    const original = messages(), snapshot = structuredClone(original), config = model(api.baseUrl);
    const answer = await completeRuntime(config, original, [tool], new AbortController().signal, () => {});
    assert.equal(answer.content, 'Synthetic review complete.'); assert.equal(api.requests.length, 2);
    const [first, second] = api.requests;
    assert.ok(JSON.stringify(second.messages).length < JSON.stringify(first.messages).length * 0.8);
    for (const key of ['max_tokens', 'max_completion_tokens', 'enable_thinking', 'reasoning_budget', 'options', 'tools', 'model']) assert.deepEqual(second[key], first[key], key);
    assert.deepEqual(second.messages.slice(-2), first.messages.slice(-2));
    assert.ok(second.messages.some(m => m.content === requestMark + task)); assert.deepEqual(original, snapshot);
    assert.equal(config.context, 131072);
  });
}

test('a persistent context refusal stops after two reductions and never reduces output or repeats a tool action', async t => {
  const api = await endpoint(t, (_body, res) => { res.writeHead(400); res.end(contextRefusal); });
  await assert.rejects(completeRuntime(model(api.baseUrl), messages(), [tool], new AbortController().signal, () => {}), /Modellkontext/);
  assert.equal(api.requests.length, 3);
  for (const request of api.requests) { assert.equal(outputReserve(request), outputReserve(api.requests[0])); assert.deepEqual(request.messages.slice(-2), api.requests[0].messages.slice(-2)); }
});

test('context recovery stops on an indivisible current task, configured last attempt or user cancellation', async t => {
  const only = [{ role: 'system', content: 'Preserve.' }, { role: 'user', content: requestMark + task }];
  const api = await endpoint(t, (_body, res) => { res.writeHead(400); res.end(contextRefusal); });
  await assert.rejects(completeRuntime(model(api.baseUrl), only, [tool], new AbortController().signal, () => {}), /Modellkontext/);
  assert.equal(api.requests.length, 1);
  assert.deepEqual(api.requests[0].messages, only);
  const once = await endpoint(t, (_body, res) => { res.writeHead(400); res.end(contextRefusal); });
  await assert.rejects(completeRuntime({ ...model(once.baseUrl), retries: 1 }, messages(), [tool], new AbortController().signal, () => {}), /Modellkontext/);
  assert.equal(once.requests.length, 1);
  const ctrl = new AbortController();
  const cancel = await endpoint(t, (_body, res) => { ctrl.abort(Error('User cancelled context recovery.')); res.writeHead(400); res.end(contextRefusal); });
  await assert.rejects(completeRuntime(model(cancel.baseUrl), messages(), [tool], ctrl.signal, () => {}), /User cancelled/);
  assert.equal(cancel.requests.length, 1);
});

for (const rejection of [contextRefusal, JSON.stringify({ error: { code: 'context_length_exceeded', message: 'Input does not fit.' } })]) {
  test(`foreground Custom context recovery preserves thinking/output and completes: ${rejection.slice(0, 50)}`, async t => {
    const f = await agentLoopFixture(t); f.beginAgent();
    window.location = { pathname: '/', origin: 'http://127.0.0.1:19381', hostname: '127.0.0.1', protocol: 'http:' };
    f.useIde.setState({ llmRetries: 8, llmHardStopMin: 0, llmContext: 131072, llmMaxOut: 4096, autoRunAgent: false, autoPreview: false, runLoop: false, graphLoop: false, engineLoop: false, mcpServers: [] });
    const { chatWithProvider } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
    const requests = [];
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body));
      if (requests.length === 1) return new Response(rejection, { status: 400, headers: { 'x-anvil-lan': '1' } });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Synthetic review complete.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream', 'x-anvil-lan': '1' } });
    };
    const result = await chatWithProvider({ provider: 'custom', baseUrl: 'http://127.0.0.1:19381/v1', model: 'synthetic-context-model', apiKey: '', context: 131072, thinking: 'high', observeOnly: true, locale: 'en', maxRounds: 2, files: [], messages: messages().slice(0, -2) });
    assert.equal(result.ok, true, result.error); assert.equal(requests.length, 2);
    assert.ok(JSON.stringify(requests[1].messages).length < JSON.stringify(requests[0].messages).length);
    for (const key of ['max_tokens', 'max_completion_tokens', 'enable_thinking', 'reasoning_budget', 'options', 'tools', 'model']) assert.deepEqual(requests[1][key], requests[0][key], key);
    assert.equal(f.useIde.getState().llmContext, 131072);
  });
}

test('KI-Studio history-budget rejection compacts the actual background request and retains task/calls/results without changing model/context', async t => {
  const api = await endpoint(t, (_body, res, n) => {
    if (n === 1) { res.writeHead(400); res.end(refusal); } else success(res);
  });
  const config = model(api.baseUrl), original = messages(), snapshot = JSON.stringify(original), estimates = [];
  const choice = await completeRuntime(config, original, [tool], new AbortController().signal, () => {}, undefined, value => estimates.push(value));
  assert.equal(api.requests.length, 2);
  assertPreserved(api.requests[0], api.requests[1]);
  assert.equal(choice.content, 'Synthetic review complete.');
  assert.equal(config.context, 131072);
  assert.equal(JSON.stringify(original), snapshot, 'the persisted original history remains intact');
  assert.deepEqual(estimates.map(value => value.limit), [131072, 131072]);
  assert.ok(estimates[1].prompt < estimates[0].prompt);
});

test('repeated KI-Studio history refusal is bounded to two reductions and never reported as a completed task', async t => {
  const api = await endpoint(t, (_body, res) => { res.writeHead(400); res.end(refusal); });
  const config = model(api.baseUrl);
  await assert.rejects(completeRuntime(config, messages(), [tool], new AbortController().signal, () => {}), /Speicherbudget/);
  assert.equal(api.requests.length, 3, 'one initial request and at most two smaller requests');
  assert.equal(config.context, 131072);
});

test('an unrelated HTTP400 cannot trigger history-memory recovery', async t => {
  const api = await endpoint(t, (_body, res) => { res.writeHead(400); res.end('Invalid image format.'); });
  await assert.rejects(completeRuntime(model(api.baseUrl), messages(), [tool], new AbortController().signal, () => {}), /Invalid image format/);
  assert.equal(api.requests.length, 1);
});

test('an explicit memory retry never replays the tool action already completed by the real agent loop', async t => {
  const f = await agentLoopFixture(t); f.beginAgent();
  const { completeRuntime: complete } = await f.server.ssrLoadModule('/src/agent-runtime/transport.ts');
  const { ToolSession } = await f.server.ssrLoadModule('/src/lib/tool-compat.ts');
  const { AGENT_TOOLS } = await f.server.ssrLoadModule('/src/lib/agent-tools.ts');
  const offered = AGENT_TOOLS.filter(tool => tool.function.name === 'read_file');
  const session = new ToolSession('standard', task), config = model('http://127.0.0.1:19381/v1'), requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    if (requests.length === 2) return new Response(refusal, { status: 400 });
    const choice = requests.length === 1 ? { tool_calls: [{ index: 0, id: 'read-once', type: 'function', function: { name: 'read_file', arguments: '{"path":"synthetic.txt"}' } }] } : { content: 'Synthetic review complete; the file was read once.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: choice, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
  const result = await f.runAgentLoop({ context: 131072, compact: 'off', observeOnly: true, locale: 'en', runLoop: false, graphLoop: false, maxRounds: 4, files: [{ path: 'synthetic.txt', content: 'CONFIRMED_SYNTHETIC_CONTENT' }], messages: [{ role: 'user', content: task }] }, async history => {
    const choice = await complete(config, history, offered, new AbortController().signal, () => {}, session);
    return { ...choice, toolContract: session.contract };
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(requests.length, 3, 'tool request, rejected continuation, smaller continuation');
  assert.equal(result.tools.filter(name => name === 'read_file').length, 1);
  assert.deepEqual(requests[2].messages.find(message => message.role === 'tool'), requests[1].messages.find(message => message.role === 'tool'));
  assert.ok(JSON.stringify(requests[2].messages).includes('CONFIRMED_SYNTHETIC_CONTENT'));
  assert.equal(config.context, 131072);
});

test('an irreducible request stops on the original memory refusal without dropping the task or growing a tiny output reserve', async t => {
  const api = await endpoint(t, (_body, res) => { res.writeHead(400); res.end(refusal); });
  const config = { ...model(api.baseUrl), thinking: 'off', maxOut: 16 };
  const original = [{ role: 'system', content: 'Preserve these rules.' }, { role: 'user', content: requestMark + task }];
  await assert.rejects(completeRuntime(config, original, [], new AbortController().signal, () => {}), /Speicherbudget/);
  assert.equal(api.requests.length, 1);
  assert.equal(outputReserve(api.requests[0]), 16);
  assert.deepEqual(api.requests[0].messages, original);
});

test('one configured attempt never starts a hidden memory retry and abort after a refusal stops before another POST', async t => {
  const once = await endpoint(t, (_body, res) => { res.writeHead(400); res.end(refusal); });
  await assert.rejects(completeRuntime({ ...model(once.baseUrl), retries: 1 }, messages(), [tool], new AbortController().signal, () => {}), /Speicherbudget/);
  assert.equal(once.requests.length, 1);
  const controller = new AbortController();
  const stopped = await endpoint(t, (_body, res) => { controller.abort(new Error('User stopped the job.')); res.writeHead(400); res.end(refusal); });
  await assert.rejects(completeRuntime(model(stopped.baseUrl), messages(), [tool], controller.signal, () => {}), /User stopped the job/);
  assert.equal(stopped.requests.length, 1);
});

test('foreground Custom sends the same smaller request after an explicit KI-Studio memory refusal', async t => {
  const f = await agentLoopFixture(t); f.beginAgent();
  window.location = { pathname: '/', origin: 'http://127.0.0.1:19381', hostname: '127.0.0.1', protocol: 'http:' };
  f.useIde.setState({ llmRetries: 3, llmHardStopMin: 0, llmContext: 131072, llmTemperature: 0.3, llmMaxOut: 4096, autoRunAgent: false, autoPreview: false, runLoop: false, testLoop: false, graphLoop: false, engineLoop: false, harnessAfterWrite: 'none', mcpServers: [] });
  const { chatWithProvider } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    if (requests.length === 1) return new Response(refusal, { status: 400, headers: { 'x-anvil-lan': '1' } });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Synthetic review complete.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream', 'x-anvil-lan': '1' } });
  };
  const result = await chatWithProvider({ provider: 'custom', baseUrl: 'http://127.0.0.1:19381/v1', model: 'synthetic-memory-model', apiKey: '', context: 131072, compact: 'off', thinking: 'high', observeOnly: true, locale: 'en', runLoop: false, graphLoop: false, maxRounds: 4, files: [], messages: [{ role: 'user', content: task + '\nSupplemental old details: ' + 'synthetic context '.repeat(1500) }] });
  assert.equal(result.ok, true, result.error);
  assert.equal(requests.length, 2);
  assert.ok(outputReserve(requests[1]) < outputReserve(requests[0]));
  assert.equal(requests[1].model, requests[0].model);
  assert.equal(f.useIde.getState().llmContext, 131072);
});

test('foreground unrelated400 stays visible without stripping thinking or making another request', async t => {
  const f = await agentLoopFixture(t); f.beginAgent();
  window.location = { pathname: '/', origin: 'http://127.0.0.1:19381', hostname: '127.0.0.1', protocol: 'http:' };
  f.useIde.setState({ llmRetries: 8, llmHardStopMin: 0, llmContext: 131072, llmMaxOut: 4096, autoRunAgent: false, autoPreview: false, runLoop: false, graphLoop: false, engineLoop: false, mcpServers: [] });
  const { chatWithProvider } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
  const requests = [];
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(init.body)); return new Response('Invalid image encoding.', { status: 400, headers: { 'x-anvil-lan': '1' } }); };
  const result = await chatWithProvider({ provider: 'custom', baseUrl: 'http://127.0.0.1:19381/v1', model: 'synthetic-memory-model', apiKey: '', context: 131072, thinking: 'high', observeOnly: true, locale: 'en', maxRounds: 2, files: [], messages: [{ role: 'user', content: task }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid image encoding/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].enable_thinking, true);
});

test('foreground identified unsupported-tools fallback still adapts the actual supported dialect', async t => {
  const f = await agentLoopFixture(t); f.beginAgent();
  window.location = { pathname: '/', origin: 'http://127.0.0.1:19381', hostname: '127.0.0.1', protocol: 'http:' };
  f.useIde.setState({ llmRetries: 3, llmHardStopMin: 0, llmContext: 131072, llmMaxOut: 4096, autoRunAgent: false, autoPreview: false, runLoop: false, graphLoop: false, engineLoop: false, mcpServers: [] });
  const { chatWithProvider } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    if (requests.length === 1) return new Response('Model does not support tools.', { status: 400, headers: { 'x-anvil-lan': '1' } });
    assert.equal(body.tools, undefined);
    assert.match(JSON.stringify(body.messages), /Allowed tools and arguments/);
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Synthetic read-only explanation complete.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream', 'x-anvil-lan': '1' } });
  };
  const result = await chatWithProvider({ provider: 'custom', baseUrl: 'http://127.0.0.1:19381/v1', model: 'synthetic-memory-model', apiKey: '', context: 131072, thinking: 'off', observeOnly: true, locale: 'en', maxRounds: 2, files: [], messages: [{ role: 'user', content: 'Explain the synthetic example only.' }] });
  assert.equal(result.ok, true, result.error);
  assert.equal(requests.length, 2);
});
