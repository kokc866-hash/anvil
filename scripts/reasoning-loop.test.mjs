import assert from 'node:assert/strict';
import { before, after, test as nodeTest } from 'node:test';
import { agentLoopFixture } from '../fixtures/agent-loop-fixture.mjs';

let fixture, completeRuntime, readSseChat, readSseResponses, readSseAnthropic;
const cleanups = [];
const realFetch = globalThis.fetch;
const test = (name, run) => nodeTest(name, async t => {
  try { await run(t); } finally { globalThis.fetch = realFetch; }
});
before(async () => {
  fixture = await agentLoopFixture({ after(fn) { cleanups.push(fn); } });
  ({ completeRuntime } = await fixture.server.ssrLoadModule('/src/agent-runtime/transport.ts'));
  ({ readSseChat, readSseResponses, readSseAnthropic } = await fixture.server.ssrLoadModule('/src/lib/sse.ts'));
});
after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const planning = Array.from({ length: 80 }, (_, n) => `Observation ${n}: inspect synthetic module ${n}, then verify its distinct requirement.\n`).join('').slice(0, 1919);
const repeated = planning.repeat(8);
const model = { provider: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-reasoning', apiKey: '', context: 131072, thinking: 'high', temperature: 0.1, maxOut: 16384, hardStopMin: 0, retries: 4 };
const chat = (delta, finish_reason) => ({ choices: [{ delta, ...(finish_reason ? { finish_reason } : {}) }] });
const chunks = (text, size) => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));
function response(events, options = {}) {
  let index = 0, pending = new Uint8Array();
  return new Response(new ReadableStream({
    pull(controller) {
      options.pull?.();
      if (!pending.length) {
        if (index === events.length) { controller.close(); return; }
        const next = events[index++];
        pending = new TextEncoder().encode(`data: ${typeof next === 'string' ? next : JSON.stringify(next)}\n\n`);
      }
      const size = options.wireBytes || pending.length;
      controller.enqueue(pending.slice(0, size));
      pending = pending.slice(size);
    },
    cancel() { options.cancel?.(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}
function reset(thinking = 'high') {
  fixture.beginAgent();
  fixture.useIde.setState({ llmThinking: thinking, llmProvider: 'custom', llmBaseUrl: 'http://127.0.0.1:1/v1', llmHardStopMin: 0 });
}
const repetition = error => error?.code === 'reasoning_repetition' && /Wiederholung|repetition/i.test(error.message);
const final = chat({ content: 'Synthetic answer.' }, 'stop');
const history = [{ role: 'user', content: 'Work on the artificial diagnostic only.' }];

test('Custom thinking sends a standard output limit through the real background transport', async () => {
  let sent;
  globalThis.fetch = async (_url, init) => { sent = JSON.parse(init.body); return response([final, '[DONE]']); };
  await completeRuntime(model, history, [], new AbortController().signal, () => {});
  assert.equal(sent.max_tokens, 16384);
});

for (const [name, parse, events] of [
  ['background token-sized reasoning', 'background', chunks(repeated, 7).map(reasoning_content => chat({ reasoning_content }))],
  ['background whole-response reasoning', 'background', [chat({ reasoning_content: repeated })]],
  ['foreground token-sized reasoning', 'chat', chunks(repeated, 11).map(reasoning_content => chat({ reasoning_content }))],
  ['foreground hidden reasoning', 'hidden', [chat({ reasoning_content: repeated })]],
  ['background inline thinking with split tags', 'background', chunks(`<think>${repeated}</think>`, 3).map(content => chat({ content }))],
  ['foreground inline thinking with split tags', 'chat', chunks(`<think>${repeated}</think>`, 3).map(content => chat({ content }))],
  ['Responses reasoning', 'responses', chunks(repeated, 17).map(delta => ({ type: 'response.reasoning_text.delta', delta }))],
  ['Anthropic thinking', 'anthropic', [{ type: 'content_block_start', content_block: { type: 'thinking' } }, ...chunks(repeated, 31).map(thinking => ({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking } }))]],
]) {
  test(`${name} stops an identical long loop and cancels its upstream`, async () => {
    reset(parse === 'hidden' ? 'off' : 'high');
    let cancelled = 0, requests = 0;
    const stream = () => response([...events, final, '[DONE]'], { cancel() { cancelled += 1; } });
    globalThis.fetch = async () => { requests += 1; return stream(); };
    let run;
    if (parse === 'background') run = completeRuntime(model, history, [], new AbortController().signal, () => {});
    else run = (parse === 'responses' ? readSseResponses : parse === 'anthropic' ? readSseAnthropic : readSseChat)(stream());
    await assert.rejects(run, repetition);
    assert.equal(cancelled, 1, 'only the offending upstream must be cancelled');
    if (parse === 'background') assert.equal(requests, 1, 'never retry a consumed repetitive stream');
  });
}

test('background accepts hours of distinct slow reasoning without a timeout-based loop verdict', async () => {
  const advancing = Array.from({ length: 500 }, (_, n) => `Observation ${n}: evaluate case ${n * 17}; the result is ${n * n}.\n`);
  const oldNow = Date.now;
  let now = oldNow(), requests = 0;
  Date.now = () => now;
  try {
    globalThis.fetch = async () => { requests += 1; return response([...advancing.map(reasoning_content => chat({ reasoning_content })), final, '[DONE]'], { pull() { now += 60_000; } }); };
    const result = await completeRuntime(model, history, [], new AbortController().signal, () => {});
    assert.equal(result.reasoning, advancing.join(''));
    assert.equal(result.content, 'Synthetic answer.');
    assert.equal(requests, 1);
  } finally { Date.now = oldNow; }
});

test('foreground preserves slow advancing thinking and UTF-8 split over network chunks', async () => {
  reset();
  const advancing = Array.from({ length: 200 }, (_, n) => `Prüfung ${n}: 🐣 nächster eigenständiger Schritt ${n * 19}.\n`).join('');
  const result = await readSseChat(response([chat({ reasoning_content: advancing }), final, '[DONE]'], { wireBytes: 3 }));
  assert.equal(result.reasoning, advancing);
});

for (const parse of ['background', 'chat']) {
  test(`${parse} keeps legitimate repetition in answers and tool data`, async () => {
    reset();
    const events = [chat({ content: repeated }), chat({ tool_calls: [{ index: 0, id: 'synthetic-tool', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'fixture.txt', content: repeated }) } }] }, 'tool_calls'), '[DONE]'];
    globalThis.fetch = async () => response(events);
    const result = parse === 'background' ? await completeRuntime(model, history, [], new AbortController().signal, () => {}) : await readSseChat(response(events));
    assert.equal(result.content, repeated);
    assert.equal(JSON.parse(result.tool_calls[0].function.arguments).content, repeated);
  });
}

test('repeated headings and fewer than five full copies remain valid thinking', async () => {
  reset();
  const reasoning = Array.from({ length: 100 }, (_, n) => `Check:\nDistinct synthetic finding ${n}: ${n * 71}.\n`).join('') + planning.repeat(4);
  const result = await readSseChat(response([chat({ reasoning_content: reasoning }), final, '[DONE]']));
  assert.equal(result.reasoning, reasoning);
});

test('a new response has its own reasoning history', async () => {
  reset();
  for (let n = 0; n < 3; n++) {
    const result = await readSseChat(response([chat({ reasoning_content: planning.repeat(3) }), final, '[DONE]']));
    assert.equal(result.reasoning, planning.repeat(3));
  }
});

for (const finish of ['content_filter', 'incomplete']) {
  for (const format of ['json', 'sse']) test(`background ${format} never turns an explicit ${finish} into an output-limit continuation`, async () => {
    reset();
    let requests = 0;
    const message = { content: '<think>A short synthetic thought before the server ends this response.' };
    globalThis.fetch = async () => {
      requests++;
      return format === 'json'
        ? new Response(JSON.stringify({ choices: [{ message, finish_reason: finish }] }), { headers: { 'content-type': 'application/json' } })
        : response([chat(message, finish), '[DONE]']);
    };
    await assert.rejects(completeRuntime(model, history, [], new AbortController().signal, () => {}), /keine Antwort/);
    assert.equal(requests, 1);
  });
  test(`foreground preserves an explicit ${finish} even inside an unclosed think block`, async () => {
    reset();
    const result = await readSseChat(response([chat({ content: '<think>A short synthetic thought.' }, finish), '[DONE]']));
    assert.equal(result.finish_reason, finish);
  });
}

test('Studio repetition errors preserve their cause and are not retryable', async () => {
  reset();
  const { isRecoverableModelFailure } = await import('../electron/agent-failure.mjs');
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return response([{ error: { message: 'Wiederholungsschleife im Denktext erkannt; Änderungen bleiben erhalten.', code: 'reasoning_repetition' } }, '[DONE]']); };
  let failure;
  try { await completeRuntime(model, history, [], new AbortController().signal, () => {}); } catch (error) { failure = error; }
  assert.ok(repetition(failure), String(failure));
  assert.equal(isRecoverableModelFailure(failure), false);
  assert.equal(requests, 1);
});

for (const status of [200, 422, 503]) test(`Studio non-streaming repetition error with HTTP ${status} stops without retry`, async () => {
  reset();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ error: { code: 'reasoning_repetition', message: 'Wiederholungsschleife erkannt.' } }), { status, headers: { 'content-type': 'application/json' } }); };
  await assert.rejects(completeRuntime(model, history, [], new AbortController().signal, () => {}), repetition);
  assert.equal(requests, 1);
});

test('foreground Custom does not retry a Studio repetition error returned before streaming starts', async () => {
  reset();
  const { chatWithProvider } = await fixture.server.ssrLoadModule('/src/lib/agent-client.ts');
  fixture.useIde.setState({ llmRetries: 4, llmMaxOut: 4096, autoRunAgent: false, autoPreview: false, runLoop: false, graphLoop: false, testLoop: false, engineLoop: false });
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ error: { code: 'reasoning_repetition', message: 'Wiederholungsschleife erkannt.' } }), { status: 503, headers: { 'content-type': 'application/json', 'x-anvil-lan': '1' } }); };
  const result = await chatWithProvider({ provider: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-reasoning', apiKey: '', thinking: 'high', context: 131072, observeOnly: true, files: [], messages: history });
  assert.equal(result.ok, false);
  assert.match(result.error, /Wiederholung/);
  assert.equal(requests, 1);
});

test('a repetition error does not execute pending tools or replay completed work', async () => {
  reset();
  const { ToolSession } = await fixture.server.ssrLoadModule('/src/lib/tool-compat.ts');
  const { AGENT_TOOLS } = await fixture.server.ssrLoadModule('/src/lib/agent-tools.ts');
  const tools = AGENT_TOOLS.filter(tool => tool.function.name === 'read_file');
  const session = new ToolSession('standard', 'Inspect the artificial note.');
  let requests = 0;
  const completed = [];
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return response([chat({ tool_calls: [{ index: 0, id: 'read-once', type: 'function', function: { name: 'read_file', arguments: '{"path":"fixture.txt"}' } }] }, 'tool_calls'), '[DONE]']);
    return response([chat({ tool_calls: [{ index: 0, id: 'never-execute', type: 'function', function: { name: 'read_file', arguments: '{"path":"second.txt"}' } }] }), ...chunks(repeated, 19).map(reasoning_content => chat({ reasoning_content })), final, '[DONE]']);
  };
  await assert.rejects(fixture.runAgentLoop({ context: 131072, observeOnly: true, locale: 'en', runLoop: false, graphLoop: false, maxRounds: 4, compact: 'off', files: [{ path: 'fixture.txt', content: 'Confirmed first read.' }, { path: 'second.txt', content: 'Must never be read.' }], messages: history }, async messages => {
    for (const message of messages.filter(message => message.role === 'tool')) if (!completed.includes(message.tool_call_id)) completed.push(message.tool_call_id);
    return { ...await completeRuntime(model, messages, tools, new AbortController().signal, () => {}, session), toolContract: session.contract };
  }), repetition);
  assert.equal(requests, 2);
  assert.deepEqual(completed, ['read-once'], 'the interrupted answer cannot run its pending read or replay the confirmed first read');
});

test('a plain answer after a failure does not invent editing or verification work', async () => {
  reset();
  fixture.beginAgent();
  let requests = 0;
  const events = [];
  const result = await fixture.runAgentLoop({ context: 131072, locale: 'de', runLoop: false, graphLoop: false, maxRounds: 6, compact: 'off', files: [], messages: [{ role: 'user', content: 'Antworte kurz, ohne Werkzeuge, ohne Änderungen und ohne Tests.' }] }, async () => {
    requests++;
    return { content: 'Eine neue Antwort ist ohne weitere Arbeit möglich.', finish_reason: 'stop', toolContract: { transport: 'native', names: [] } };
  }, { getPlan: () => [], onTool: event => events.push(event.name) });
  assert.equal(requests, 1);
  assert.deepEqual(result.tools, []);
  assert.deepEqual(events, []);
  assert.match(result.reply, /Eine neue Antwort/);
});
