import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import path from 'node:path';
import ts from 'typescript';
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';

const external = ['react', 'react/jsx-runtime', 'react-dom', 'zustand', 'zustand/vanilla', 'zustand/middleware', 'js-yaml', 'fake-indexeddb'];
const call = (name, args) => ({ content: '', tool_calls: [{ id: `fixture-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(t, plugins = []) {
  const cacheRoot = path.resolve('artifacts/audit-2026-10-04');
  mkdirSync(cacheRoot, { recursive: true });
  const cacheDir = mkdtempSync(path.join(cacheRoot, 'vite-agent-fixture-'));
  if (!cacheDir.startsWith(cacheRoot + path.sep) || !path.basename(cacheDir).startsWith('vite-agent-fixture-')) throw Error('Invalid fixture cache target');
  const keys = ['window', 'document', 'localStorage', 'indexedDB', 'IDBKeyRange', 'fetch'];
  const previous = keys.map(key => [key, Object.hasOwn(globalThis, key), globalThis[key]]);
  const values = new Map(), timers = new Set(), network = [];
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.window = Object.assign(new EventTarget(), { localStorage,
    setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; },
    clearTimeout: id => { timers.delete(id); clearTimeout(id); } });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: 'de' }, getElementById: () => null });
  globalThis.fetch = async (...args) => { network.push(String(args[0])); throw Error('No external network in agent fixture'); };
  const server = await createServer({ configFile: false, root: process.cwd(), cacheDir, plugins,
    resolve: { alias: { '@': path.resolve('src') } }, ssr: { external }, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(async () => {
    try {
      const { flushPersistence } = await server.ssrLoadModule('/src/lib/persist-storage.ts');
      const { flushSecrets } = await server.ssrLoadModule('/src/lib/secrets.ts');
      await flushPersistence(); await flushSecrets();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.deepEqual(network, []);
    } finally {
      for (const timer of timers) clearTimeout(timer);
      await server.close();
      rmSync(cacheDir, { recursive: true, force: true });
      for (const [key, exists, value] of previous) { if (exists) globalThis[key] = value; else delete globalThis[key]; }
    }
  });
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts');
  await useIde.persist.rehydrate();
  const { useIntern } = await server.ssrLoadModule('/src/lib/intern.ts'); useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const { useBrain } = await server.ssrLoadModule('/src/lib/brain/store.ts');
  useBrain.setState({ on: false, autoLoad: false, autoUpdate: false, autonomy: 'off', jobs: Object.fromEntries(Object.keys(useBrain.getState().jobs).map(key => [key, false])) });
  const { useLearn } = await server.ssrLoadModule('/src/lib/learn.ts'); await useLearn.persist.rehydrate(); useLearn.setState({ on: false });
  useIde.setState({ workspaceCwd: '', memoryWorkspace: 'agent-boundary-fixture', workspaceEpoch: 1,
    files: {}, dirs: [], openPaths: [], recentPaths: [], activePath: null, attached: [], dirty: {}, pendingDiffs: [], agentRules: '', pendingAsk: null,
    chat: [], checkpoints: [], output: [], agentBusy: false, agentJob: null, agentInbox: null, agentQueue: [], backgroundAgent: false,
    agentMode: 'ask', locale: 'de', llmProvider: 'ollama', llmAuthMode: 'key', llmModel: 'fixture', llmBaseUrl: 'http://127.0.0.1:1', llmApiKey: '',
    llmContext: 65536, llmCompact: 'off', planWho: 'agent', mcpServers: [], activeSurfaceId: 'anvil', surfaceMode: 'bridge', autoSaveDisk: false,
    autoPreview: false, autoRunAgent: false, testLoop: false, runLoop: false, graphLoop: false });
  const core = await server.ssrLoadModule('/src/lib/agent-core.ts');
  const abort = await server.ssrLoadModule('/src/lib/agent-abort.ts');
  const { prepChatPayload, estimatePrompt } = await server.ssrLoadModule('/src/lib/compact.ts');
  const capture = async (messages, context = 65536, extra = {}) => {
    abort.beginAgent(); let payload;
    const result = await core.runAgentLoop({ messages, files: [], context, compact: 'off', observeOnly: true, ...extra }, async outgoing => {
      payload = { messages: structuredClone(outgoing), max_tokens: 256 };
      prepChatPayload(payload, context);
      return { content: 'The synthetic explanation is complete; no workspace operation is required.' };
    });
    return { result, payload };
  };
  return { server, useIde, ...core, ...abort, prepChatPayload, estimatePrompt, capture,
    fakeFetch: handler => { globalThis.fetch = handler; } };
}

test('current user requests survive auxiliary context and provider fitting', async t => {
  const f = await fixture(t);
  const { prepareBackgroundContext } = await f.server.ssrLoadModule('/src/lib/background-context.ts');
  await t.test('the real background preparation and legacy runtime rebind a new constrained build to its own journal', async () => {
    const prompt = readFileSync('fixtures/workshop-task.txt', 'utf8');
    const { EMPTY_JOURNAL } = await f.server.ssrLoadModule('/src/lib/session.ts');
    const old = { ...EMPTY_JOURNAL, goal: 'Baue mir ein Tower Defence Spiel.', corrections: ['Alte Tower-Eigenschaft.'], notes: 'Alte Tower-Notiz.' };
    f.useIde.setState({ sessionJournal: old, files: {}, attached: [], chat: [], planWho: 'auto' });
    const prepared = await prepareBackgroundContext(prompt, []);
    assert.match(prepared.journal.goal, /Werkstatt-Projektplaner/);
    assert.equal(prepared.plan.length, 12);
    assert.ok(prepared.plan.every(step => step.status === 'todo'));
    assert.equal(f.useIde.getState().sessionJournal, old, 'preparation must not mutate the live profile before acceptance');
    const { payload } = await f.capture(prepared.messages, 131072, { humanRequest: prompt, journal: old });
    const system = payload.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    assert.match(system, /Ziel: Erstelle einen vollständigen Werkstatt-Projektplaner/);
    assert.doesNotMatch(system, /Tower Defence|Nicht: Erstelle|Der Fehler gehört zum beauftragten Negativtest/);
    f.useIde.setState({ sessionJournal: EMPTY_JOURNAL, planWho: 'agent' });
  });
  await t.test('background attachments cannot replace the current request', async () => {
    const prompt = 'CURRENT_BACKGROUND_TASK: Erkläre die drei angehängten Zahlen.', files = { 'one.txt': 'a'.repeat(7900), 'two.txt': 'b'.repeat(7900), 'three.txt': 'c'.repeat(7900) };
    f.useIde.setState({ files, attached: Object.keys(files), chat: [] });
    const prepared = await prepareBackgroundContext(prompt, []);
    const { payload } = await f.capture(prepared.messages);
    assert.ok(JSON.stringify(payload.messages).includes(prompt), 'the actual first provider payload must include the entire task');
  });
  await t.test('long rules and a follow-up keep the new instruction intact', async () => {
    const prompt = 'CURRENT_FOLLOWUP_HEAD ' + 'request '.repeat(2600) + ' CURRENT_FOLLOWUP_TAIL';
    f.useIde.setState({ files: {}, attached: [], agentRules: 'rule '.repeat(18000), chat: [{ role: 'user', content: 'OLDER_TASK' }, { role: 'assistant', content: 'Earlier answer' }] });
    const { payload } = await f.capture((await prepareBackgroundContext(prompt, [])).messages, 32768);
    assert.ok(JSON.stringify(payload.messages).includes(prompt));
    assert.ok(f.estimatePrompt(payload.messages) + payload.max_tokens + 192 <= 32768);
    assert.match(JSON.stringify(payload.messages), /gekürzt|shortened|compact/);
  });
  await t.test('image-only request text and current image remain together', async () => {
    const prompt = 'Beschreibe das angehängte Bild.', image = 'data:image/png;base64,c3ludGhldGlj';
    f.useIde.setState({ files: {}, attached: [], agentRules: 'rule '.repeat(18000), chat: [] });
    const { payload } = await f.capture((await prepareBackgroundContext(prompt, [image])).messages, 16384);
    assert.ok(JSON.stringify(payload.messages).includes(prompt)); assert.ok(JSON.stringify(payload.messages).includes(image));
  });
  await t.test('an incompatible budget fails before asking a model instead of shortening the task', async () => {
    f.useIde.setState({ files: {}, attached: [], agentRules: '', chat: [] });
    const prompt = 'CURRENT_TASK_HEAD ' + 'request '.repeat(12000) + ' CURRENT_TASK_TAIL';
    const messages = (await prepareBackgroundContext(prompt, [])).messages;
    await assert.rejects(f.capture(messages, 4096), /Auftrag|request|Context window.*klein/i);
  });
});

test('a stopped loop cannot adopt a subsequent request while summarizing', async t => {
  const f = await fixture(t);
  for (const restart of [false, true]) await t.test(restart ? 'Stop followed by a new request' : 'Stop without a new request', async () => {
    f.beginAgent(); const entered = deferred(), release = deferred(); let completeCalls = 0, shellCalls = 0;
    const messages = Array.from({ length: 32 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'older synthetic history ' + i + ' ' + 'x'.repeat(6000) }));
    messages.push({ role: 'user', content: 'Current synthetic request' });
    const pending = f.runAgentLoop({ messages, files: [], context: 4096, compact: 'aggressive', observeOnly: true }, async () => {
      completeCalls++; return call('shell', { command: 'node fixture.js' });
    }, { summarize: async () => { entered.resolve(); await release.promise; return 'Synthetic summary'; }, shell: async () => { shellCalls++; return { ok: true, stdout: '', stderr: '' }; } });
    const rejected = assert.rejects(pending, error => error.name === 'AgentAbortError');
    await entered.promise; f.abortAgent('fixture stop'); if (restart) f.beginAgent(); release.resolve(); await rejected;
    assert.equal(completeCalls, 0); assert.equal(shellCalls, 0);
  });
  await t.test('allowed summary continues the original request', async () => {
    f.beginAgent(); let completeCalls = 0;
    const messages = Array.from({ length: 32 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'old '.repeat(1800) })); messages.push({ role: 'user', content: 'Current request' });
    const result = await f.runAgentLoop({ messages, files: [], context: 16384, compact: 'aggressive', observeOnly: true }, async () => { completeCalls++; return { content: 'A complete synthetic explanation without side effects.' }; }, { summarize: async () => 'Synthetic summary' });
    assert.equal(result.ok, true); assert.equal(completeCalls, 1);
  });
});

test('delayed tools cannot publish workspace or tool results into a replacement run', async t => {
  const f = await fixture(t);
  const cases = [
    ['format_file', { path: 'fixture.ts' }, 'formatFile', 'formatted synthetic source'],
    ['git_clone', { url: 'fixture/repo' }, 'gitClone', [{ path: 'cloned.ts', content: 'synthetic clone' }]],
    ['git_commit', { message: 'synthetic commit' }, 'gitCommit', { ok: true }],
    ['skill_write', { name: 'fixture', body: 'synthetic skill' }, 'learn', { ok: true, workspaceWrites: [{ path: 'skill.md', before: null, content: 'synthetic skill' }] }],
  ];
  for (const [name, args, adapter, output] of cases) await t.test(name, async () => {
    f.beginAgent(); const entered = deferred(), release = deferred(), writes = [], tools = [];
    let rounds = 0;
    const pending = f.runAgentLoop({ messages: [{ role: 'user', content: 'Do the synthetic fixture operation.' }], files: [{ path: 'fixture.ts', content: 'synthetic source' }], compact: 'off', context: 32768 }, async () => {
      rounds++; return call(name, args);
    }, { [adapter]: async () => { entered.resolve(); await release.promise; return output; },
      onWorkspace: event => writes.push(event), onTool: info => tools.push(info) });
    const rejected = assert.rejects(pending, error => error.name === 'AgentAbortError');
    await entered.promise; f.abortAgent('fixture stop'); f.beginAgent(); release.resolve(); await rejected;
    assert.equal(rounds, 1); assert.deepEqual(writes, []); assert.deepEqual(tools, []);
  });
});

function ollamaAnswer(content, tool_calls) {
  return new Response(JSON.stringify({ message: { role: 'assistant', content: content || '', ...(tool_calls ? { tool_calls } : {}) }, done: true, prompt_eval_count: 20, eval_count: 5 }) + '\n',
    { headers: { 'content-type': 'application/x-ndjson', 'x-anvil-lan': '1' } });
}
const sendInput = draft => ({ draft, images: [], title: 'Synthetic fixture', setTitle() {}, setDraft() {}, setImages() {}, setMention() {} });

test('single completions keep a long request and reject an incompatible budget', async t => {
  const f = await fixture(t), payloads = [];
  const { completeLocal } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
  f.fakeFetch(async (url, init) => {
    assert.equal(String(url), '/__lan'); payloads.push(JSON.parse(init.body));
    return ollamaAnswer('A complete synthetic answer.');
  });
  const opts = { provider: 'ollama', baseUrl: 'http://127.0.0.1:1', model: 'fixture', apiKey: '' };
  const prompt = 'SINGLE_REQUEST_HEAD ' + 'request '.repeat(2200) + ' SINGLE_REQUEST_TAIL';
  f.beginAgent(); f.useIde.setState({ llmContext: 32768 });
  assert.equal(await completeLocal({ ...opts, prompt }), 'A complete synthetic answer.');
  assert.ok(JSON.stringify(payloads[0].messages).includes(prompt));
  f.useIde.setState({ llmContext: 4096 });
  await assert.rejects(completeLocal({ ...opts, prompt: prompt.repeat(6) }), /Auftrag|request|Context window.*klein/i);
  assert.equal(payloads.length, 1);
});

test('a single completion cannot settle an old response after Stop and a new request', async t => {
  for (const provider of ['lmstudio', 'ollama']) await t.test(provider, async t => {
    const f = await fixture(t), entered = deferred(), release = deferred();
    const { completeLocal } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
    f.fakeFetch(async () => provider === 'ollama'
      ? new Response(new ReadableStream({ async start(controller) { entered.resolve(); await release.promise; controller.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: 'Old synthetic answer' }, done: true }) + '\n')); controller.close(); } }), { headers: { 'x-anvil-lan': '1' } })
      : { ok: true, headers: new Headers({ 'x-anvil-lan': '1' }), json: async () => { entered.resolve(); await release.promise; return { choices: [{ message: { content: 'Old synthetic answer' } }] }; } });
    f.beginAgent();
    const pending = completeLocal({ provider, baseUrl: 'http://127.0.0.1:1', model: 'fixture', apiKey: '', prompt: 'Original task' });
    const rejected = assert.rejects(pending, error => error.name === 'AgentAbortError');
    await entered.promise; f.abortAgent('fixture stop'); f.beginAgent(); release.resolve(); await rejected;
  });
});

function serverFunctionBoundary() {
  const builder = 'const api=()=>({middleware(){return this},validator(){return this},server(){return this},client(){return this},handler(fn){return opts=>fn({data:opts.data})}});export const createServerFn=api;export const createMiddleware=api;';
  return { name: 'synthetic-server-framework', enforce: 'pre', config: () => ({ ssr: { noExternal: ['@tanstack/react-start', '@tanstack/react-start/server'] } }), resolveId(source) {
    if (source === '@tanstack/react-start') return '\0synthetic-server-functions';
    if (source === '@tanstack/react-start/server') return '\0synthetic-server-request';
  }, load(id) {
    if (id === '\0synthetic-server-functions') return builder;
    if (id === '\0synthetic-server-request') return 'export const getRequest=()=>globalThis.__anvilServerRequest;';
  } };
}

test('server retries retain their own HTTP request cancellation signal', async t => {
  const f = await fixture(t, [serverFunctionBoundary()]);
  const { proxyLlm } = await f.server.ssrLoadModule('/src/lib/llm-proxy.ts');
  const first = new AbortController(), entered = deferred(), release = deferred(); let http = 0;
  globalThis.__anvilServerRequest = new Request('http://fixture.invalid', { signal: first.signal });
  t.after(() => { delete globalThis.__anvilServerRequest; });
  f.fakeFetch(async (url, init) => {
    assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(init.signal.aborted, false); http++;
    if (http > 1) throw Error('A canceled server request must not retry');
    return { ok: false, status: 400, text: async () => { entered.resolve(); await release.promise; return 'tool schema unsupported'; } };
  });
  const pending = proxyLlm({ data: { action: 'chat', provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'fixture', apiKey: 'synthetic-key',
    messages: [{ role: 'user', content: 'Synthetic task' }], useTools: true, context: 32768 } });
  await entered.promise; first.abort('fixture stop');
  globalThis.__anvilServerRequest = new Request('http://fixture.invalid'); release.resolve();
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(http, 1);
});

test('a server completion checks its captured request again after reading the response body', async t => {
  const f = await fixture(t, [serverFunctionBoundary()]), first = new AbortController(), entered = deferred(), release = deferred();
  const { proxyLlm } = await f.server.ssrLoadModule('/src/lib/llm-proxy.ts');
  globalThis.__anvilServerRequest = new Request('http://fixture.invalid', { signal: first.signal });
  t.after(() => { delete globalThis.__anvilServerRequest; });
  f.fakeFetch(async () => ({ ok: true, text: async () => { entered.resolve(); await release.promise; return JSON.stringify({ choices: [{ message: { content: 'Old synthetic answer' } }] }); } }));
  const pending = proxyLlm({ data: { action: 'chat', provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'fixture', apiKey: 'synthetic-key', messages: [{ role: 'user', content: 'Original task' }], useTools: false, context: 32768 } });
  await entered.promise; first.abort('fixture stop'); globalThis.__anvilServerRequest = new Request('http://fixture.invalid'); release.resolve();
  assert.equal((await pending).ok, false);
});

test('a server completion preserves long text before the provider call', async t => {
  const f = await fixture(t, [serverFunctionBoundary()]), payloads = [];
  const { proxyLlm } = await f.server.ssrLoadModule('/src/lib/llm-proxy.ts');
  globalThis.__anvilServerRequest = new Request('http://fixture.invalid');
  t.after(() => { delete globalThis.__anvilServerRequest; });
  f.fakeFetch(async (url, init) => {
    assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions');
    payloads.push(JSON.parse(init.body)); return Response.json({ choices: [{ message: { content: 'Synthetic answer' } }] });
  });
  const prompt = 'SERVER_REQUEST_HEAD ' + 'request '.repeat(2200) + ' SERVER_REQUEST_TAIL';
  const result = await proxyLlm({ data: { action: 'complete', provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'fixture', apiKey: 'synthetic-key', prompt, context: 32768 } });
  assert.equal(result.ok, true); assert.ok(JSON.stringify(payloads[0].messages).includes(prompt));
});

test('a stopped GitHub workflow cannot dispatch its next server mutation', async t => {
  for (const stopAt of [0, 1, 2, 3]) await t.test(`Stop after response body ${stopAt + 1}`, async t => {
    const f = await fixture(t, [serverFunctionBoundary()]), original = new AbortController(), entered = deferred(), release = deferred(), requests = [];
    const { pushGithub } = await f.server.ssrLoadModule('/src/lib/github.ts');
    globalThis.__anvilServerRequest = new Request('http://fixture.invalid', { signal: original.signal });
    t.after(() => { delete globalThis.__anvilServerRequest; });
    const bodies = [{ object: { sha: 'old-head' } }, { tree: { sha: 'old-tree' }, sha: 'old-head' }, { sha: 'new-tree' }, { sha: 'new-commit' }];
    f.fakeFetch(async (url, init) => {
      assert.ok(String(url).startsWith('https://api.github.com/repos/fixture/repo/git/'));
      const index = requests.length; requests.push({ method: init?.method || 'GET', url: String(url) });
      return { ok: true, json: async () => { if (index === stopAt) { entered.resolve(); await release.promise; } return bodies[index]; } };
    });
    const pending = pushGithub({ data: { repo: 'fixture/repo', token: 'synthetic-key', message: 'Synthetic commit', files: { 'fixture.txt': 'synthetic content' } } });
    const rejected = assert.rejects(pending);
    await entered.promise; original.abort('fixture stop'); globalThis.__anvilServerRequest = new Request('http://fixture.invalid'); release.resolve();
    await rejected; assert.equal(requests.length, stopAt + 1);
    assert.ok(!requests.some(request => request.method === 'PATCH'), 'The canceled workflow must not advance the branch');
  });
});

test('foreground preparation keeps the originally selected connection while allowing context updates', async t => {
  const entered = deferred(), release = deferred(), bodies = [];
  globalThis.__anvilContextBoundary = async () => { entered.resolve(); await release.promise; };
  t.after(() => { delete globalThis.__anvilContextBoundary; });
  const f = await fixture(t, [replaceFunctionBody('model-context', 'applyCloudContext', '{ return globalThis.__anvilContextBoundary(); }')]);
  const { sendChat } = await f.server.ssrLoadModule('/src/lib/chat-session.ts');
  f.fakeFetch(async (url, init) => { assert.equal(String(url), '/__lan'); bodies.push(JSON.parse(init.body)); return ollamaAnswer('Synthetic answer from the original connection.'); });
  const pending = sendChat(sendInput('Explain the synthetic fixture.'), { mode: 'ask' });
  await entered.promise;
  f.useIde.setState({ llmProvider: 'lmstudio', llmAuthMode: 'key', llmModel: 'replacement-model', llmBaseUrl: 'http://127.0.0.1:2', llmContext: 32768 });
  release.resolve(); await pending;
  assert.equal(bodies.length, 1); assert.equal(bodies[0].model, 'fixture');
  assert.equal(bodies[0].options.num_ctx, 32768, 'The intentional context update may reach the original connection');
});

test('a stopped public web read cannot follow a server redirect with a replacement request signal', async t => {
  const f = await fixture(t, [serverFunctionBoundary()]), original = new AbortController(), entered = deferred(), release = deferred(); let calls = 0;
  const { fetchWeb } = await f.server.ssrLoadModule('/src/lib/web-fetch.ts');
  globalThis.__anvilServerRequest = new Request('http://fixture.invalid', { signal: original.signal });
  t.after(() => { delete globalThis.__anvilServerRequest; });
  f.fakeFetch(async () => {
    calls++;
    if (calls === 1) { entered.resolve(); await release.promise; return new Response('', { status: 302, headers: { location: 'https://fixture.example/redirect' } }); }
    return new Response('Old synthetic web content');
  });
  const pending = fetchWeb({ data: { url: 'https://fixture.example/read' } });
  await entered.promise; original.abort('fixture stop'); globalThis.__anvilServerRequest = new Request('http://fixture.invalid'); release.resolve();
  assert.equal((await pending).ok, false); assert.equal(calls, 1);
});

test('provider conversion preserves current image requests with their full text', async t => {
  for (const provider of ['anthropic', 'openai']) await t.test(provider, async t => {
    const f = await fixture(t, [serverFunctionBoundary()]);
    const { proxyLlm } = await f.server.ssrLoadModule('/src/lib/llm-proxy.ts');
    globalThis.__anvilServerRequest = new Request('http://fixture.invalid');
    t.after(() => { delete globalThis.__anvilServerRequest; });
    const prompt = 'IMAGE_REQUEST_HEAD ' + 'request '.repeat(1800) + ' IMAGE_REQUEST_TAIL', image = 'data:image/png;base64,c3ludGhldGlj';
    const { payload } = await f.capture([{ role: 'user', content: prompt, images: [image] }], 32768);
    let body;
    f.fakeFetch(async (url, init) => {
      assert.equal(String(url), provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses');
      body = JSON.parse(init.body);
      return Response.json(provider === 'anthropic'
        ? { content: [{ type: 'text', text: 'Synthetic image answer' }] }
        : { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic image answer' }] }] });
    });
    const result = await proxyLlm({ data: { action: 'chat', provider, baseUrl: provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
      model: provider === 'anthropic' ? 'claude-fixture' : 'gpt-5-fixture', apiKey: 'synthetic-key', messages: payload.messages, useTools: provider === 'openai', context: 32768 } });
    assert.equal(result.ok, true, result.error); assert.ok(JSON.stringify(body).includes(prompt));
    assert.ok(JSON.stringify(body).includes('c3ludGhldGlj'), 'The actual provider body must retain the current image');
    assert.doesNotMatch(JSON.stringify(body), /\[object Object\]/);
  });
});

test('foreground sends preserve long follow-ups through the real provider wire', async t => {
  const f = await fixture(t), payloads = [];
  const { sendChat } = await f.server.ssrLoadModule('/src/lib/chat-session.ts');
  f.fakeFetch(async (url, init) => {
    assert.equal(String(url), '/__lan'); assert.equal(init.signal.aborted, false);
    payloads.push(JSON.parse(init.body)); return ollamaAnswer('A complete synthetic explanation without file operations.');
  });
  f.useIde.setState({ llmModel: 'qwen3-vl', llmContext: 32768, agentRules: 'rule '.repeat(18000),
    files: { 'one.txt': 'a'.repeat(7900), 'two.txt': 'b'.repeat(7900), 'three.txt': 'c'.repeat(7900) },
    attached: ['one.txt', 'two.txt', 'three.txt'], chat: [{ id: 'older-user', role: 'user', content: 'OLDER_REQUEST' }, { id: 'older-answer', role: 'assistant', content: 'Earlier synthetic answer' }] });
  const prompt = 'CURRENT_FOREGROUND_HEAD ' + 'request '.repeat(2600) + ' CURRENT_FOREGROUND_TAIL';
  await sendChat(sendInput(prompt), { mode: 'ask' });
  assert.equal(payloads.length, 1); assert.ok(JSON.stringify(payloads[0].messages).includes(prompt));
  assert.equal(f.useIde.getState().chat.at(-1).content, 'A complete synthetic explanation without file operations.');
  assert.equal(f.useIde.getState().agentBusy, false);
});

test('Stop during native pipe preparation rejects before invoking fetch', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); let http = 0;
  const { chatWithProvider } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
  window.anvilNative = { llmPipe: async () => { entered.resolve(); await release.promise; return { port: 12345, token: 'synthetic-token' }; } };
  f.fakeFetch(async () => { http++; throw Error('An old request must not reach HTTP'); });
  f.beginAgent();
  const pending = chatWithProvider({ provider: 'ollama', baseUrl: 'http://127.0.0.1:1', model: 'fixture', apiKey: '', messages: [{ role: 'user', content: 'Synthetic task' }], files: [], compact: 'off', observeOnly: true });
  await entered.promise; f.abortAgent('fixture stop'); f.beginAgent(); release.resolve();
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(http, 0);
});

function replaceFunctionBody(file, name, body) {
  return { name: `synthetic-boundary-${name}`, enforce: 'pre', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith(`/src/lib/${file}.ts`)) return;
    const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    const variable = source.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations).find(node => ts.isIdentifier(node.name) && node.name.text === name);
    const target = declaration?.body ?? variable?.initializer;
    assert.ok(target, `Fixture boundary ${name} must exist`);
    const replacement = declaration?.body ? body : `async (..._args) => ${body}`;
    return code.slice(0, target.getStart(source)) + replacement + code.slice(target.end);
  } };
}

test('Stop while preparing a real Git commit prevents the later Git transport call', async t => {
  const entered = deferred(), release = deferred();
  globalThis.__anvilFlushBoundary = async () => { entered.resolve(); await release.promise; };
  t.after(() => { delete globalThis.__anvilFlushBoundary; });
  const f = await fixture(t, [replaceFunctionBody('disk-sync', 'flushDiskSync', '{ return globalThis.__anvilFlushBoundary(); }')]);
  const { chatWithProvider } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
  let modelCalls = 0, gitCalls = 0;
  f.fakeFetch(async (url) => {
    if (String(url).endsWith('/v1/workspace')) return Response.json({ ok: true });
    if (String(url).endsWith('/v1/git')) { gitCalls++; return Response.json({ ok: true }); }
    assert.equal(String(url), '/__lan'); modelCalls++;
    return ollamaAnswer('', [{ function: { name: 'git_commit', arguments: { message: 'synthetic commit' } } }]);
  });
  f.useIde.setState({ workspaceCwd: 'C:/synthetic-anvil-fixture' }); f.beginAgent();
  const pending = chatWithProvider({ provider: 'ollama', baseUrl: 'http://127.0.0.1:1', model: 'fixture', apiKey: '', messages: [{ role: 'user', content: 'Commit the synthetic fixture.' }], files: [], compact: 'off', git: { repo: 'fixture/repo' } });
  await entered.promise; f.abortAgent('fixture stop'); f.beginAgent(); release.resolve();
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(modelCalls, 1); assert.equal(gitCalls, 0);
});

test('a stopped test shell cannot start the next test file or replace new test output', async t => {
  const entered = deferred(), release = deferred(), shellCalls = [];
  globalThis.__anvilShellBoundary = async path => { shellCalls.push(path); entered.resolve(); await release.promise; return { ok: true, stdout: 'synthetic test pass', stderr: '', duration: 0, label: path }; };
  t.after(() => { delete globalThis.__anvilShellBoundary; });
  const f = await fixture(t, [replaceFunctionBody('run-client', 'runFile', '{ return globalThis.__anvilShellBoundary(path); }')]);
  const { runAgentShell } = await f.server.ssrLoadModule('/src/lib/agent-shell.ts');
  const { captureAgentRun } = await f.server.ssrLoadModule('/src/lib/agent-run.ts');
  const files = { 'one.test.js': 'test("synthetic one", () => {});', 'two.test.js': 'test("synthetic two", () => {});' };
  f.useIde.setState({ files, testsRunning: false, testResults: {}, output: [] }); f.beginAgent();
  const pending = runAgentShell('npm test', files, captureAgentRun());
  const rejected = assert.rejects(pending, error => error.name === 'AgentAbortError');
  await entered.promise; f.abortAgent('fixture stop'); f.beginAgent();
  const newOutput = [{ ok: true, stdout: 'next request output', stderr: '', duration: 0, label: 'next request' }];
  f.useIde.setState({ output: newOutput, testsRunning: true, testResults: {} });
  release.resolve(); await rejected;
  assert.deepEqual(shellCalls, ['one.test.js']); assert.deepEqual(f.useIde.getState().output, newOutput);
  assert.deepEqual(f.useIde.getState().testResults, {}); assert.equal(f.useIde.getState().testsRunning, true);
});

test('Stop between a tool-schema error and retry cannot send a new HTTP request', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); let http = 0;
  const { chatWithProvider } = await f.server.ssrLoadModule('/src/lib/agent-client.ts');
  f.fakeFetch(async () => {
    http++;
    if (http > 1) throw Error('An old request must not retry');
    return { ok: false, status: 400, headers: new Headers({ 'x-anvil-lan': '1' }), text: async () => { entered.resolve(); await release.promise; return 'tool_choice required is unsupported'; } };
  });
  f.beginAgent();
  const pending = chatWithProvider({ provider: 'ollama', baseUrl: 'http://127.0.0.1:1', model: 'fixture', apiKey: '', messages: [{ role: 'user', content: 'Synthetic task' }], files: [], compact: 'off', observeOnly: true });
  await entered.promise; f.abortAgent('fixture stop'); f.beginAgent(); release.resolve();
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(http, 1);
});

function testTailBoundary() {
  return { name: 'synthetic-test-tail', enforce: 'pre', resolveId(source) {
    const normalized = source.replaceAll('\\', '/');
    if (normalized.endsWith('/test-loop') || normalized.endsWith('/test-loop.ts')) return '\0synthetic-test-tail';
  }, load(id) { if (id === '\0synthetic-test-tail') return 'export const shouldTestAfterRound = () => true; export const testAfterRound = () => globalThis.__anvilTestTail();'; } };
}

test('a completed test tail cannot distill old files into the next request or project', async t => {
  for (const switchProject of [false, true]) await t.test(switchProject ? 'project changed' : 'new request begun', async t => {
    const entered = deferred(), release = deferred();
    globalThis.__anvilTestTail = async () => { entered.resolve(); await release.promise; };
    t.after(() => { delete globalThis.__anvilTestTail; });
    const f = await fixture(t, [testTailBoundary()]);
    const { sendChat } = await f.server.ssrLoadModule('/src/lib/chat-session.ts');
    let rounds = 0;
    f.fakeFetch(async (url, init) => {
      assert.equal(String(url), '/__lan'); assert.equal(init.signal.aborted, false); rounds++;
      return rounds === 1
        ? ollamaAnswer('', [{ function: { name: 'write_file', arguments: { path: 'old-round.md', content: 'synthetic old file' } } }])
        : ollamaAnswer('Synthetic file written.');
    });
    f.useIde.setState({ agentMode: 'agent', autoAcceptDiffs: true, testLoop: true, files: {}, llmModel: 'fixture' });
    const pending = sendChat(sendInput('Create the synthetic old-round markdown file.'), { mode: 'agent' });
    await entered.promise;
    f.abortAgent('fixture stop'); f.beginAgent();
    const journal = { ...f.useIde.getState().sessionJournal, files: ['next-round.md'], goal: 'Next synthetic task' };
    f.useIde.setState({ workspaceEpoch: switchProject ? 2 : 1, chat: [{ id: 'next-answer', role: 'assistant', content: 'Next synthetic answer', steps: [] }], sessionJournal: journal, files: { 'next-round.md': 'synthetic new file' }, agentBusy: true });
    release.resolve(); await pending;
    assert.deepEqual(f.useIde.getState().sessionJournal, journal);
    assert.deepEqual(f.useIde.getState().files, { 'next-round.md': 'synthetic new file' });
    assert.equal(f.useIde.getState().chat.at(-1).content, 'Next synthetic answer');
    assert.equal(f.useIde.getState().agentBusy, true);
  });
});

test('an agent debug start cannot launch after delayed Companion preparation and Stop', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), actions = [], leases = [];
  const { agentDebug } = await f.server.ssrLoadModule('/src/lib/debug-engine.ts');
  const { captureAgentRun } = await f.server.ssrLoadModule('/src/lib/agent-run.ts');
  const { setCompanionToken } = await f.server.ssrLoadModule('/src/lib/companion.ts');
  const { loadSecrets } = await f.server.ssrLoadModule('/src/lib/secrets.ts');
  setCompanionToken('current-synthetic-token');
  window.anvilNative = { companionEnsure: async () => { entered.resolve(); await release.promise; return { ok: true, token: 'synthetic-token' }; }, companionRelease: async keep => { leases.push(keep); } };
  f.fakeFetch(async (url, init) => {
    if (String(url).endsWith('/v1/workspace')) return Response.json({ ok: true });
    assert.ok(String(url).endsWith('/v1/debug')); const body = JSON.parse(init.body); actions.push(body.action);
    return Response.json(body.action === 'start' ? { ok: true, id: 'old-debug' } : { ok: true, done: true, stdout: 'Synthetic debug complete' });
  });
  f.useIde.setState({ workspaceCwd: 'C:/synthetic-anvil-fixture', files: { 'fixture.py': 'print("synthetic")' } }); f.beginAgent();
  const pending = agentDebug('start', { path: 'fixture.py' }, captureAgentRun());
  const rejected = assert.rejects(pending, error => error.name === 'AgentAbortError');
  await entered.promise; f.abortAgent('fixture stop'); f.beginAgent(); release.resolve(); await rejected;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(actions, []); assert.equal(leases.length, 1);
  assert.equal(loadSecrets().companionToken, 'current-synthetic-token');
});

test('a late agent debug ID is cleaned up without replacing or stopping a new manual session', async t => {
  const started = deferred(), release = deferred(), manualDone = deferred(), actions = []; let manualKills = 0;
  globalThis.__anvilDebugJs = () => ({ done: manualDone.promise, kill: () => { manualKills++; }, eval: async () => '', watches: async () => ({}) });
  t.after(() => { delete globalThis.__anvilDebugJs; });
  const f = await fixture(t, [replaceFunctionBody('debug-sandbox', 'startJsDebugIframe', '{ return globalThis.__anvilDebugJs(); }')]);
  const { agentDebug, startDebug } = await f.server.ssrLoadModule('/src/lib/debug-engine.ts');
  const { captureAgentRun } = await f.server.ssrLoadModule('/src/lib/agent-run.ts');
  f.fakeFetch(async (url, init) => {
    if (String(url).endsWith('/v1/workspace')) return Response.json({ ok: true });
    assert.ok(String(url).endsWith('/v1/debug')); const body = JSON.parse(init.body); actions.push(body);
    if (body.action === 'start') { started.resolve(); await release.promise; return Response.json({ ok: true, id: 'old-agent-debug' }); }
    assert.equal(body.action, 'stop'); return Response.json({ ok: true });
  });
  f.useIde.setState({ workspaceCwd: 'C:/synthetic-anvil-fixture', files: { 'old.py': 'print("old synthetic")', 'manual.js': 'const synthetic = 1;' } }); f.beginAgent();
  const pending = agentDebug('start', { path: 'old.py' }, captureAgentRun());
  const rejected = assert.rejects(pending, error => error.name === 'AgentAbortError');
  await started.promise; f.abortAgent('fixture stop'); f.beginAgent(); await rejected;
  const manual = startDebug('manual.js', f.useIde.getState().files);
  try {
    release.resolve(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(actions.map(action => [action.action, action.id]), [['start', undefined], ['stop', 'old-agent-debug']]);
    assert.equal(f.useIde.getState().debug.path, 'manual.js'); assert.equal(f.useIde.getState().debug.active, true);
    assert.equal(manualKills, 0); assert.deepEqual(f.useIde.getState().output, []);
  } finally { manualDone.resolve({ stdout: 'Synthetic manual debug complete', stderr: '' }); await manual; }
});

test('manual native debugging continues across an unrelated agent Stop', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), actions = [];
  const { startDebug } = await f.server.ssrLoadModule('/src/lib/debug-engine.ts');
  f.fakeFetch(async (url, init) => {
    if (String(url).endsWith('/v1/workspace')) return Response.json({ ok: true });
    const body = JSON.parse(init.body); actions.push(body.action);
    if (body.action === 'start') return Response.json({ ok: true, id: 'manual-native-debug' });
    if (body.action === 'poll') { entered.resolve(); await release.promise; return Response.json({ ok: true, done: true, stdout: 'Synthetic manual result' }); }
    return Response.json({ ok: true });
  });
  f.useIde.setState({ workspaceCwd: 'C:/synthetic-anvil-fixture', files: { 'manual.py': 'print("manual synthetic")' } });
  const pending = startDebug('manual.py', f.useIde.getState().files);
  await entered.promise; f.beginAgent(); f.abortAgent('unrelated agent Stop'); f.beginAgent();
  assert.equal(f.useIde.getState().debug.active, true); assert.deepEqual(actions, ['start', 'poll']);
  release.resolve(); const result = await pending;
  assert.equal(result.ok, true); assert.deepEqual(actions, ['start', 'poll', 'stop']);
  assert.equal(f.useIde.getState().output.at(-1).stdout, 'Synthetic manual result');
});

test('an unconfirmed agent debug start cannot adopt a session or start a browser fallback', async t => {
  for (const uncertain of [false, true]) await t.test(uncertain ? 'response unavailable' : 'response lacks an ID', async t => {
    let fallbacks = 0; const actions = [];
    globalThis.__anvilUnexpectedDebugFallback = () => { fallbacks++; throw Error('A second synthetic debugger must not start'); };
    t.after(() => { delete globalThis.__anvilUnexpectedDebugFallback; });
    const f = await fixture(t, [replaceFunctionBody('run-client', 'getPyodide', '{ return globalThis.__anvilUnexpectedDebugFallback(); }')]);
    const { agentDebug } = await f.server.ssrLoadModule('/src/lib/debug-engine.ts');
    const { captureAgentRun } = await f.server.ssrLoadModule('/src/lib/agent-run.ts');
    f.fakeFetch(async (url, init) => {
      if (String(url).endsWith('/v1/workspace')) return Response.json({ ok: true });
      const body = JSON.parse(init.body); actions.push(body.action);
      if (uncertain) throw Error('Synthetic response unavailable');
      return Response.json({ ok: true });
    });
    f.useIde.setState({ workspaceCwd: 'C:/synthetic-anvil-fixture', files: { 'fixture.py': 'print("synthetic")' } }); f.beginAgent();
    const result = await agentDebug('start', { path: 'fixture.py' }, captureAgentRun());
    assert.equal(result.ok, false); assert.match(result.error, /nicht eindeutig/);
    assert.equal(fallbacks, 0); assert.deepEqual(actions, ['start']); assert.equal(f.useIde.getState().debug.active, false);
  });
});

test('a canceled agent TypeScript debug preparation cannot create its iframe', async t => {
  const entered = deferred(), release = deferred(); let iframes = 0;
  globalThis.__anvilDebugCompile = async () => { entered.resolve(); await release.promise; return 'const synthetic = 1;'; };
  globalThis.__anvilDebugJs = () => { iframes++; throw Error('An old debugger must not create an iframe'); };
  t.after(() => { delete globalThis.__anvilDebugCompile; delete globalThis.__anvilDebugJs; });
  const f = await fixture(t, [replaceFunctionBody('run-client', 'stripTs', '{ return globalThis.__anvilDebugCompile(); }'), replaceFunctionBody('debug-sandbox', 'startJsDebugIframe', '{ return globalThis.__anvilDebugJs(); }')]);
  const { agentDebug } = await f.server.ssrLoadModule('/src/lib/debug-engine.ts');
  const { captureAgentRun } = await f.server.ssrLoadModule('/src/lib/agent-run.ts');
  f.useIde.setState({ files: { 'fixture.ts': 'const synthetic: number = 1;' } }); f.beginAgent();
  const pending = agentDebug('start', { path: 'fixture.ts' }, captureAgentRun());
  const rejected = assert.rejects(pending, error => error.name === 'AgentAbortError');
  await entered.promise; f.abortAgent('fixture stop'); f.beginAgent(); release.resolve(); await rejected;
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(iframes, 0);
});

test('a canceled remote debug compiler lookup cannot dispatch the later compile', async t => {
  const f = await fixture(t, [serverFunctionBoundary()]), original = new AbortController(), entered = deferred(), release = deferred(); let compiles = 0;
  const { runRemote } = await f.server.ssrLoadModule('/src/lib/run-server.ts');
  globalThis.__anvilServerRequest = new Request('http://fixture.invalid', { signal: original.signal });
  t.after(() => { delete globalThis.__anvilServerRequest; });
  f.fakeFetch(async url => {
    if (String(url) === 'https://wandbox.org/api/list.json') return { ok: true, json: async () => { entered.resolve(); await release.promise; return [{ language: 'C++', name: 'synthetic-compiler' }]; } };
    assert.equal(String(url), 'https://wandbox.org/api/compile.json'); compiles++;
    return Response.json({ status: '0', program_output: 'Synthetic result' });
  });
  const pending = runRemote({ data: { lang: 'cpp', entry: 'fixture.cpp', files: [{ path: 'fixture.cpp', content: 'int main() { return 0; }' }] } });
  await entered.promise; original.abort('fixture stop'); globalThis.__anvilServerRequest = new Request('http://fixture.invalid'); release.resolve();
  assert.equal((await pending).ok, false); assert.equal(compiles, 0);
});
