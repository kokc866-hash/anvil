import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createServer } from 'vite';
import { pipeQuiet } from './llm-agent.mjs';

let vite, readSseChat, readSseResponses, readSseAnthropic, beginAgent, useIde;
before(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: 'artifacts/model-continuation-2026-10-22/stream/vite-cache',
    resolve: { alias: { '@': path.resolve('src') } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  ({ readSseChat, readSseResponses, readSseAnthropic } = await vite.ssrLoadModule('/src/lib/sse.ts'));
  ({ beginAgent } = await vite.ssrLoadModule('/src/lib/abort.ts'));
  ({ useIde } = await vite.ssrLoadModule('/src/store/ide.ts'));
});
after(async () => { await vite?.close(); });

const chat = (delta, finish_reason) => ({ choices: [{ delta, ...(finish_reason ? { finish_reason } : {}) }] });
const text = 'Half an answer';
function response(events, options = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      options.onPull?.();
      if (index === events.length) return controller.close();
      const event = events[index++];
      controller.enqueue(new TextEncoder().encode(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`));
    },
    cancel(reason) { options.onCancel?.(reason); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}
function reset(thinking = 'auto') {
  beginAgent();
  useIde.setState({ llmThinking: thinking, llmProvider: 'custom', llmBaseUrl: 'http://127.0.0.1:1/v1', llmHardStopMin: 0 });
}

for (const [name, parser, events] of [
  ['chat partial EOF', () => readSseChat, [chat({ content: text })]],
  ['chat error after partial text', () => readSseChat, [chat({ content: text }), { error: { message: 'backend stopped' } }]],
  ['chat error followed by DONE', () => readSseChat, [{ error: { message: 'backend stopped' } }, '[DONE]']],
  ['Responses partial EOF', () => readSseResponses, [{ type: 'response.output_text.delta', delta: text }]],
  ['Responses nested failure', () => readSseResponses, [{ type: 'response.output_text.delta', delta: text }, { type: 'response.failed', response: { status: 'failed', error: { message: 'backend stopped' } } }]],
  ['Anthropic partial EOF', () => readSseAnthropic, [{ type: 'content_block_start', content_block: { type: 'text' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text } }]],
]) {
  test(`${name} cannot become a successful response`, async () => {
    reset();
    await assert.rejects(parser()(response(events)), /unterbrochen|Abschluss|backend stopped/);
  });
}

test('Responses output token limit retains its incomplete finish reason', async () => {
  reset();
  const choice = await readSseResponses(response([
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } }, '[DONE]',
  ]));
  assert.equal(choice.content, text);
  assert.equal(choice.finish_reason, 'length');
});

test('Anthropic output token limit retains its incomplete finish reason', async () => {
  reset();
  const choice = await readSseAnthropic(response([
    { type: 'content_block_start', content_block: { type: 'text' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' },
  ]));
  assert.equal(choice.content, text);
  assert.equal(choice.finish_reason, 'length');
});

test('hidden thinking continues beyond twelve seconds until the actual answer', async () => {
  reset('off');
  const originalNow = Date.now;
  let now = 1_000_000;
  const res = response([
    chat({ reasoning_content: 'Still thinking...' }), chat({ reasoning_content: 'Almost ready...' }),
    chat({ content: 'The actual answer' }, 'stop'), '[DONE]',
  ], { onPull: () => { now += 13_001; } });
  const deltas = [];
  Date.now = () => now;
  let choice;
  try { choice = await readSseChat(res, (part, kind) => deltas.push([part, kind])); }
  finally { Date.now = originalNow; }
  assert.equal(choice.content, 'The actual answer');
  assert.equal(choice.finish_reason, 'stop');
  assert.equal(choice.reasoning, 'Still thinking...Almost ready...');
  assert.deepEqual(deltas, [['The actual answer', 'text']]);
});

test('hidden inline thinking stays hidden across content chunks and keeps the final answer', async () => {
  reset('off');
  const deltas = [];
  const choice = await readSseChat(response([
    chat({ content: '<think>Still thinking...' }), chat({ content: 'Almost ready...' }),
    chat({ content: '</think>The actual answer' }, 'stop'), '[DONE]',
  ]), (part, kind) => deltas.push([part, kind]));
  assert.equal(choice.content, 'The actual answer');
  assert.equal(choice.reasoning, 'Still thinking...Almost ready...');
  assert.deepEqual(deltas, [['The actual answer', 'text']]);
});

test('an upstream reset destroys the pipe instead of reporting graceful EOF', async () => {
  const src = new PassThrough(), dest = new PassThrough();
  let output = '', failure;
  dest.on('data', part => { output += part; });
  const settled = new Promise(resolve => {
    dest.on('error', error => { failure = error; resolve(); });
    dest.on('finish', resolve);
  });
  pipeQuiet(src, dest);
  src.write('half response');
  src.emit('error', new Error('upstream reset'));
  await settled;
  assert.equal(output, 'half response');
  assert.equal(dest.writableEnded, false);
  assert.match(failure?.message ?? '', /upstream reset/);
});

test('malformed streamed JSON and partial tool arguments cannot be silently accepted', async () => {
  reset();
  await assert.rejects(readSseChat(response([chat({ content: text }), '{', '[DONE]'])), /JSON|ungültig|unvollständig/i);
  reset();
  await assert.rejects(readSseChat(response([
    chat({ tool_calls: [{ index: 0, id: 'write', function: { name: 'write_file', arguments: '{"path":' } }] }, 'tool_calls'), '[DONE]',
  ])), /Werkzeug|JSON|ungültig|unvollständig/i);
});

test('a truncated tool reply is not executable even with additional text or reasoning', async () => {
  reset();
  for (const content of [undefined, 'A partial explanation']) {
    await assert.rejects(readSseChat(response([
      chat({ content, reasoning_content: 'Still preparing the change', tool_calls: [{ index: 0, id: 'write', function: { name: 'write_file', arguments: '{"path":' } }] }, 'length'), '[DONE]',
    ])), /Werkzeug|unterbrochen|unvollständig/i);
  }
});

test('a valid completed tool response keeps late usage and tool fragments', async () => {
  reset();
  const choice = await readSseChat(response([
    chat({ tool_calls: [{ index: 0, id: 'read', function: { name: 'read_file', arguments: '{"path":' } }] }),
    chat({ tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }, 'tool_calls'),
    { choices: [], usage: { prompt_tokens: 41, completion_tokens: 9 } }, '[DONE]',
  ]));
  assert.equal(choice.tool_calls?.[0].function.arguments, '{"path":"a.ts"}');
  assert.equal(choice.finish_reason, 'tool_calls');
  assert.deepEqual(choice.usage, { prompt: 41, completion: 9 });
});

test('an actual stream abort remains an abort and is never consumed as an answer', async () => {
  reset();
  let pulls = 0;
  const res = new Response(new ReadableStream({ pull(controller) {
    if (++pulls === 1) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chat({ content: text }))}\n\n`));
    else controller.error(new DOMException('User stopped the request', 'AbortError'));
  } }));
  await assert.rejects(readSseChat(res), error => error.name === 'AbortError');
});

test('named SSE error events preserve the provider message without requiring a JSON type field', async () => {
  for (const parser of [readSseChat, readSseResponses, readSseAnthropic]) {
    reset();
    const res = new Response('event: error\ndata: {"message":"named backend failure"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    await assert.rejects(parser(res), /named backend failure/);
  }
});

test('stream transport failures are not eligible for automatic request replay', async () => {
  const { isRecoverableModelFailure } = await vite.ssrLoadModule('/electron/agent-failure.mjs');
  const { shouldRetryLocalLlm } = await vite.ssrLoadModule('/src/lib/abort.ts');
  reset();
  const res = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chat({ content: text }))}\n\n`));
    controller.error(new TypeError('Failed to fetch', { cause: Object.assign(new Error('socket ended'), { code: 'ECONNRESET' }) }));
  } }));
  await assert.rejects(readSseChat(res), error => isRecoverableModelFailure(error) === false && shouldRetryLocalLlm(error) === false);
});
