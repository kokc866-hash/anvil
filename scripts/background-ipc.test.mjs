import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AgentJobHost } from '../electron/agent-job-host.mjs';

const artifacts = path.resolve('artifacts/audit-2026-10-04');
const cacheDir = label => {
  mkdirSync(artifacts, { recursive: true });
  return mkdtempSync(path.join(artifacts, `${label}-cache-`));
};
const until = async predicate => {
  for (let n = 0; n < 250; n++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Synthetic IPC fixture did not settle.');
};

function hostFixture(t, { execute = async () => ({ ok: true, applied: false }), files = { 'source.txt': 'original' } } = {}) {
  mkdirSync(artifacts, { recursive: true });
  const root = mkdtempSync(path.join(artifacts, 'ipc-host-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  const snapshotPath = path.join(root, 'state/latest.json');
  let child;
  const host = new AgentJobHost({ snapshotPath,
    runtime: { begin() {}, close() {}, finish() {}, execute },
    launch() { child = new EventEmitter(); child.send = () => {}; child.kill = () => {}; return child; },
  });
  const request = { project: root, execution: true, files, dirs: [], model: { model: 'synthetic-no-model' }, messages: [{ role: 'user', content: 'Synthetic fixture; never launch a model.' }] };
  host.start(request);
  child.emit('message', { type: 'ready' });
  t.after(() => host.close());
  return { host, request, root, snapshotPath, send: message => child.emit('message', message) };
}

test('draft omission needs an exact job and safe draft revision; legacy whole-state cursors remain compatible', async t => {
  const f = hostFixture(t);
  f.send({ type: 'file', path: 'source.txt', content: 'draft' });
  const initial = f.host.snapshot().state;
  assert.equal(initial.draftRevision, 1);
  assert.equal(initial.drafts['source.txt'].after, 'draft');
  f.send({ type: 'delta', text: 'Only text changed.' });
  f.send({ type: 'delta', kind: 'think', text: 'Only thinking changed.' });
  f.send({ type: 'phase', phase: 'answering' });
  f.send({ type: 'harness', value: 'Synthetic progress.' });
  assert.equal(f.host.state.draftRevision, initial.draftRevision);
  const delta = f.host.snapshot(initial.id, initial.revision, initial.draftRevision);
  assert.equal(delta.draftsUnchanged, true);
  assert.equal(Object.hasOwn(delta.state, 'drafts'), false);
  assert.equal(delta.state.text, 'Only text changed.');
  for (const cursor of [undefined, null, -1, 0.5, NaN, '1', initial.draftRevision + 1]) {
    assert.ok(f.host.snapshot(initial.id, initial.revision, cursor).state.drafts, `Invalid acknowledgement: ${String(cursor)}`);
  }
  assert.ok(f.host.snapshot('another-job', initial.revision, initial.draftRevision).state.drafts);
  assert.ok(f.host.snapshot(initial.id, f.host.state.revision, initial.draftRevision + 1).state.drafts, 'A whole-state match cannot conceal an invalid draft acknowledgement.');
  assert.deepEqual(f.host.snapshot(initial.id, f.host.state.revision), { unchanged: true });
  assert.deepEqual(f.host.snapshot(initial.id, f.host.state.revision, initial.draftRevision), { unchanged: true });
  const full = f.host.snapshot().state;
  full.drafts['source.txt'].after = 'receiver-local mutation';
  assert.equal(f.host.state.drafts['source.txt'].after, 'draft', 'A full reply remains detached from the host.');
  f.send({ type: 'file', path: 'source.txt', content: 'draft' });
  assert.equal(f.host.state.draftRevision, initial.draftRevision + 1, 'A new file event/version is a draft change even when text is equal.');
  assert.ok(f.host.snapshot(initial.id, initial.revision, initial.draftRevision).state.drafts);
});

test('staged writes and their applied flag each invalidate the acknowledged draft snapshot', async t => {
  let release;
  const f = hostFixture(t, { execute: () => new Promise(resolve => { release = resolve; }) });
  const initial = f.host.snapshot().state;
  f.send({ type: 'operation', id: 1, operation: { kind: 'write', path: 'source.txt', content: 'changed' } });
  const staged = f.host.snapshot(initial.id, initial.revision, initial.draftRevision).state;
  assert.ok(staged.draftRevision > initial.draftRevision);
  assert.equal(staged.drafts['source.txt'].applied, false);
  await until(() => release);
  release({ ok: true, applied: true });
  await f.host.operation;
  const applied = f.host.snapshot(staged.id, staged.revision, staged.draftRevision).state;
  assert.ok(applied.draftRevision > staged.draftRevision);
  assert.equal(applied.drafts['source.txt'].applied, true);
  const writeRelease = release;
  f.send({ type: 'operation', id: 2, operation: { kind: 'mkdir', path: 'generated' } });
  const stagedDirectory = f.host.snapshot(applied.id, applied.revision, applied.draftRevision);
  assert.equal(stagedDirectory.draftsUnchanged, true);
  assert.equal(stagedDirectory.state.directoryChanges.generated.applied, false);
  await until(() => release !== writeRelease);
  release({ ok: true, applied: true });
  await f.host.operation;
  const appliedDirectory = f.host.snapshot(applied.id, applied.revision, applied.draftRevision);
  assert.equal(appliedDirectory.draftsUnchanged, true);
  assert.equal(appliedDirectory.state.directoryChanges.generated.applied, true, 'Fresh directory metadata needs no bulk draft transfer.');
});

test('rename, delete, directory changes, manual apply and restore all replace stale draft acknowledgements', async t => {
  const f = hostFixture(t);
  let known = f.host.snapshot().state;
  for (const [id, operation] of [
    [1, { kind: 'rename', from: 'source.txt', to: 'renamed.txt' }],
    [2, { kind: 'delete', path: 'renamed.txt' }],
    [3, { kind: 'mkdir', path: 'generated' }],
  ]) {
    f.send({ type: 'operation', id, operation });
    const reply = f.host.snapshot(known.id, known.revision, known.draftRevision);
    const next = reply.state;
    if (operation.kind === 'mkdir') {
      assert.equal(next.draftRevision, known.draftRevision);
      assert.equal(reply.draftsUnchanged, true);
      assert.equal(next.directoryChanges.generated.after, true);
    } else {
      assert.ok(next.draftRevision > known.draftRevision, operation.kind);
      assert.ok(next.drafts);
    }
    known = { ...next, drafts: next.drafts ?? known.drafts };
    await f.host.operation;
    assert.equal(f.host.state.draftRevision, known.draftRevision, 'An unchanged false applied flag does not invalidate drafts again.');
  }
  assert.equal(f.host.state.drafts['source.txt'].after, null);
  assert.equal(f.host.state.drafts['renamed.txt'].after, null);
  assert.equal(f.host.state.directoryChanges.generated.after, true);
  f.host.stop();
  const applied = f.host.changeFiles(f.host.state.id, 'apply').state;
  assert.ok(applied.draftRevision > known.draftRevision);
  assert.equal(existsSync(path.join(f.root, 'source.txt')), false);
  assert.equal(existsSync(path.join(f.root, 'generated')), true);
  assert.equal(applied.drafts['source.txt'].applied, true);
  assert.ok(f.host.snapshot(known.id, known.revision, known.draftRevision).state.drafts);
  const restored = f.host.changeFiles(f.host.state.id, 'restore').state;
  assert.ok(restored.draftRevision > applied.draftRevision);
  assert.equal(restored.restored, true);
  assert.equal(readFileSync(path.join(f.root, 'source.txt'), 'utf8'), 'original');
  assert.equal(existsSync(path.join(f.root, 'generated')), false);
  assert.equal(restored.drafts['source.txt'].after, 'original');
  assert.ok(f.host.snapshot(applied.id, applied.revision, applied.draftRevision).state.drafts);
});

test('resume has a new job identity and a complete copied draft state', t => {
  const f = hostFixture(t);
  f.send({ type: 'file', path: 'source.txt', content: 'draft to retain' });
  f.host.stop();
  const previous = f.host.snapshot().state;
  const resumed = f.host.resume(previous.id, f.request).state;
  assert.notEqual(resumed.id, previous.id);
  assert.equal(resumed.resumedFrom, previous.id);
  assert.deepEqual(resumed.drafts, previous.drafts);
  assert.ok(f.host.snapshot(previous.id, previous.revision, resumed.draftRevision).state.drafts, 'Equal numeric revisions of different jobs never share drafts.');
  assert.equal(resumed.draftRevision, 1);
});

test('legacy disk snapshots migrate safely and rejected oversized drafts keep their last draft revision', async t => {
  const f = hostFixture(t);
  f.send({ type: 'file', path: 'source.txt', content: 'retained' });
  const revision = f.host.state.draftRevision;
  f.send({ type: 'file', path: 'source.txt', content: 'x'.repeat(17 * 1024 * 1024) });
  assert.equal(f.host.state.status, 'failed');
  assert.equal(f.host.state.draftRevision, revision);
  assert.equal(f.host.state.drafts['source.txt'].after, 'retained');
  const saved = JSON.parse(readFileSync(f.snapshotPath, 'utf8'));
  assert.equal(saved.draftRevision, revision);
  delete saved.draftRevision;
  writeFileSync(f.snapshotPath, JSON.stringify(saved));
  const reopened = new AgentJobHost({ snapshotPath: f.snapshotPath, launch() { assert.fail('Restoration never replays a worker.'); } });
  t.after(() => reopened.close());
  assert.equal(reopened.state.draftRevision, 0);
  assert.deepEqual(reopened.snapshot().state.drafts, saved.drafts);
  assert.ok(reopened.snapshot(saved.id, saved.revision, revision).state.drafts);
});

test('the real IPC handler forwards the draft cursor and still rejects other windows or frames', async t => {
  const previous = globalThis.backgroundIpcBinding;
  const calls = [];
  let handler;
  globalThis.backgroundIpcBinding = {
    Host: class { snapshot(...args) { calls.push(args); return { state: null }; } busy() { return false; } },
    bind: (_name, fn) => { handler = fn; },
  };
  const server = await createServer({ configFile: false, root: process.cwd(), cacheDir: cacheDir('ipc-binding'), optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom',
    plugins: [{ name: 'ipc-native-boundaries', resolveId(id) { if (id === 'virtual:ipc-native-boundaries') return '\0' + id; },
      load(id) {
        if (id !== '\0virtual:ipc-native-boundaries') return;
        return `
          const fixture = globalThis.backgroundIpcBinding;
          export const AgentJobHost = fixture.Host;
          export const handleOnce = fixture.bind;
          export const utilityProcess = { fork() { throw Error('No utility process allowed'); } };
          export class AgentProjectRuntime {}
          export class AgentPreview {}
          export class AgentConnections {}
          export class AgentEngines {}
          export class AgentKnowledge { permissions() { return 'fixture'; } }
          export const knowledgePermissions = () => 'fixture';
          export const createBackgroundMcpHost = () => ({});
          export const CLI_KINDS = [];
          export const engineEnvironment = () => ({});
          export const readEngineConfig = () => ({});
          export const toolEnv = () => ({});
          export const loadPaths = () => ({ packages: 'fixture-only' });
        `;
      },
      transform(code, id) {
        if (!id.endsWith('/electron/agent-job-ipc.mjs')) return;
        // Only native constructors/imports are replaced. The handler itself runs unchanged.
        return code.replace(/from ('[^']+')/g, (match, quoted) => quoted.startsWith("'node:") ? match : "from 'virtual:ipc-native-boundaries'");
      },
    }],
  });
  t.after(async () => { await server.close(); if (previous === undefined) delete globalThis.backgroundIpcBinding; else globalThis.backgroundIpcBinding = previous; });
  const { bindAgentJobIpc } = await server.ssrLoadModule('/electron/agent-job-ipc.mjs');
  const contents = { mainFrame: { url: 'fixture:trusted' } };
  bindAgentJobIpc({ root: artifacts, dataHome: artifacts, editor: () => ({ webContents: contents }), isTrusted: url => url === 'fixture:trusted' });
  const event = { sender: contents, senderFrame: contents.mainFrame };
  await handler(event, 'status', { id: 'job', revision: 9, draftRevision: 2 });
  await handler(event, 'permissions', { id: 'job', revision: 10, draftRevision: 2 });
  assert.deepEqual(calls, [['job', 9, 2], ['job', 10, 2]]);
  await assert.rejects(handler({ ...event, senderFrame: { url: 'fixture:trusted' } }, 'status', {}), /Hauptfenster/);
  await assert.rejects(handler({ ...event, sender: { mainFrame: contents.mainFrame } }, 'status', {}), /Hauptfenster/);
  contents.mainFrame.url = 'fixture:untrusted';
  await assert.rejects(handler(event, 'status', {}), /Hauptfenster/);
});

async function rendererFixture(t) {
  const keys = ['fetch', 'window', 'document', 'localStorage', 'indexedDB', 'IDBKeyRange'];
  const previous = keys.map(key => [key, Object.hasOwn(globalThis, key), globalThis[key]]);
  const storage = new Map(), timers = new Set(), network = [], stops = [];
  globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout: (fn, ms) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer;
  }, clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); } });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: 'de' } });
  globalThis.fetch = async (...args) => { network.push(String(args[0])); throw new Error('No model/network allowed in the IPC fixture.'); };
  const external = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'zustand', 'zustand/vanilla', 'zustand/middleware', 'js-yaml', 'fake-indexeddb', 'lucide-react', '@tanstack/react-start', '@tanstack/react-router'];
  // Each run owns its optimizer/module cache. Other native-suite fixtures can
  // use different SSR externalization settings without sharing this cache.
  const server = await createServer({ configFile: false, root: process.cwd(), cacheDir: cacheDir('ipc-renderer'), resolve: { alias: { '@': path.resolve('src') } },
    ssr: { external }, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom',
  });
  t.after(async () => {
    stops.forEach(stop => stop());
    try {
      const { flushPersistence } = await server.ssrLoadModule('/src/lib/persist-storage.ts'); await flushPersistence();
      const { flushSecrets } = await server.ssrLoadModule('/src/lib/secrets.ts'); await flushSecrets();
      await new Promise(resolve => setTimeout(resolve, 30));
    } finally {
      for (const timer of timers) clearTimeout(timer);
      await server.close();
      for (const [key, existed, value] of previous) { if (existed) globalThis[key] = value; else delete globalThis[key]; }
    }
    assert.deepEqual(network, [], 'The fixture must not reach models, helpers or services.');
  });
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts'); await useIde.persist.rehydrate();
  const { useIntern } = await server.ssrLoadModule('/src/lib/intern.ts'); useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const { useBrain } = await server.ssrLoadModule('/src/lib/brain/store.ts');
  useBrain.setState({ on: false, autoLoad: false, autoUpdate: false, autonomy: 'off', jobs: Object.fromEntries(Object.keys(useBrain.getState().jobs).map(key => [key, false])) });
  const { useLearn } = await server.ssrLoadModule('/src/lib/learn.ts'); await useLearn.persist.rehydrate(); useLearn.setState({ on: false });
  const bg = await server.ssrLoadModule('/src/lib/background-agent.ts');
  // A different workspace avoids applying draft contents to editor files; the
  // actual background store, accept path and polling lifecycle still run.
  useIde.setState({ workspaceCwd: '', memoryWorkspace: 'isolated-renderer-project', workspaceEpoch: 1, files: {}, dirty: {}, pendingDiffs: [], chat: [], agentBusy: false, backgroundAgent: false });
  bg.useBackgroundAgent.setState({ job: null, available: true, error: '' });
  const polls = [];
  window.anvilNative = { agentJob: (action, payload) => action === 'status' ? new Promise((resolve, reject) => polls.push({ payload, resolve, reject })) : Promise.resolve({ unchanged: true }) };
  const monitor = () => { const stop = bg.startBackgroundAgentMonitor(); stops.push(stop); return stop; };
  let cursor = 0;
  const next = async () => { await until(() => polls.length > cursor); return polls[cursor++]; };
  return { ...bg, monitor, next };
}

test('renderer merges only matching draft revisions and requests full states after omission errors, disconnects and reconnects', { timeout: 30000 }, async t => {
  const f = await rendererFixture(t);
  const state = (changes = {}) => ({ id: 'ipc-renderer-job', revision: 1, draftRevision: 3, project: 'host-fixture-project',
    prompt: 'Synthetic', status: 'running', startedAt: 1, text: 'initial', thinking: '', steps: [], plan: [],
    drafts: { 'source.txt': { before: 'old', after: 'draft', version: 1 } }, harness: '', error: '', dismissed: false, ...changes });
  const cached = state();
  f.useBackgroundAgent.setState({ job: cached });
  let stop = f.monitor();
  let poll = await f.next();
  assert.deepEqual(poll.payload, {}, 'The first connection requests a full state even with cached drafts.');
  const full = state({ revision: 2 }); poll.resolve({ state: full });
  await until(() => f.useBackgroundAgent.getState().job?.revision === 2);
  assert.notEqual(f.useBackgroundAgent.getState().job.drafts, cached.drafts);
  const draftIdentity = f.useBackgroundAgent.getState().job.drafts;
  poll = await f.next();
  assert.deepEqual(poll.payload, { id: full.id, revision: 2, draftRevision: 3 });
  const { drafts: _drafts, ...metadata } = state({ revision: 3, text: 'streamed text' });
  poll.resolve({ state: metadata, draftsUnchanged: true });
  await until(() => f.useBackgroundAgent.getState().job?.revision === 3);
  assert.equal(f.useBackgroundAgent.getState().job.drafts, draftIdentity);
  assert.equal(f.useBackgroundAgent.getState().job.text, 'streamed text');
  poll = await f.next();
  poll.resolve({ state: { ...metadata, revision: 4 } });
  poll = await f.next();
  assert.equal(f.useBackgroundAgent.getState().job.revision, 3, 'A matching revision alone is insufficient without the explicit omission marker.');
  assert.deepEqual(poll.payload, {});
  poll.resolve({ state: { ...metadata, revision: 4, draftRevision: 4 }, draftsUnchanged: true });
  poll = await f.next();
  assert.equal(f.useBackgroundAgent.getState().job.revision, 3, 'An unknown draft revision must not reuse cached contents.');
  assert.deepEqual(poll.payload, {});
  const updated = state({ revision: 4, draftRevision: 4, drafts: { 'source.txt': { before: 'old', after: 'new contents', applied: true, version: 2 } } });
  poll.resolve({ state: updated });
  await until(() => f.useBackgroundAgent.getState().job?.revision === 4);
  poll = await f.next();
  poll.resolve({ state: state({ revision: 2 }) });
  poll = await f.next();
  assert.equal(f.useBackgroundAgent.getState().job.revision, 4, 'An older full snapshot must not undo an accepted newer revision.');
  assert.equal(f.useBackgroundAgent.getState().job.drafts, updated.drafts);
  poll.reject(new Error('Synthetic connection dropped.'));
  poll = await f.next();
  assert.deepEqual(poll.payload, {}, 'Recovery requests a full state, without revision acknowledgements.');
  poll.resolve({ state: state({ revision: 5, draftRevision: 5 }) });
  await until(() => f.useBackgroundAgent.getState().job?.revision === 5);
  poll = await f.next();
  poll.resolve({ state: { ...metadata, id: 'new-ipc-job', revision: 1, draftRevision: 5 }, draftsUnchanged: true });
  poll = await f.next();
  assert.equal(f.useBackgroundAgent.getState().job.id, full.id, 'A new job cannot inherit drafts from the previous job.');
  assert.deepEqual(poll.payload, {});
  const nextJob = state({ id: 'new-ipc-job', revision: 1, draftRevision: 5 });
  poll.resolve({ state: nextJob });
  await until(() => f.useBackgroundAgent.getState().job?.id === nextJob.id);
  stop();
  stop = f.monitor();
  poll = await f.next();
  assert.deepEqual(poll.payload, {}, 'A restarted renderer connection gets a full state.');
  // A delayed prior-job status cannot replace an independently accepted new job.
  const newestJob = state({ id: 'newest-ipc-job', revision: 1 });
  f.useBackgroundAgent.setState({ job: newestJob });
  poll.resolve({ state: nextJob });
  poll = await f.next();
  assert.equal(f.useBackgroundAgent.getState().job.id, newestJob.id);
  assert.deepEqual(poll.payload, {});
  poll.resolve({ state: newestJob });
  stop();
});
