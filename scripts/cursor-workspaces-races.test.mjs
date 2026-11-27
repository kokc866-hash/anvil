import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { AgentJobRegistry } from '../electron/agent-job-registry.mjs';
import { AgentJobHost } from '../electron/agent-job-host.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async check => { for (let n = 0; n < 200; n++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('Workspace isolation fixture timed out'); };

test('real foreground entry reserves its writer root, and late dismissal/debug replies preserve the selected project', async t => {
  const output = path.resolve('artifacts/cursor-adoption-2026-10-19/worktrees'); mkdirSync(output, { recursive: true });
  const area = mkdtempSync(path.join(output, 'race-tests-')), roots = ['a', 'b', 'c'].map(name => path.join(area, name)); roots.forEach(root => mkdirSync(root));
  const keys = ['window', 'document', 'localStorage', 'indexedDB', 'IDBKeyRange', 'fetch'];
  const original = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]), storage = new Map(), timers = new Set(), network = [], calls = [];
  globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; }, clearTimeout: id => { timers.delete(id); clearTimeout(id); } });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: 'de' } });
  globalThis.fetch = async (...args) => { network.push(String(args[0])); throw Error('No network allowed in workspace isolation fixture'); };
  const server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(area, 'vite'), resolve: { alias: { '@': path.resolve('src') } },
    ssr: { external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'zustand', 'zustand/vanilla', 'zustand/middleware', 'js-yaml', 'fake-indexeddb', 'lucide-react', '@tanstack/react-start', '@tanstack/react-router'] },
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  let stop = () => {}, pausedClose = false, closeEntered = false; const close = deferred();
  const registry = new AgentJobRegistry({ directory: path.join(area, 'jobs'), createHost({ snapshotPath }) {
    const child = Object.assign(new EventEmitter(), { send() {}, kill() {} });
    const runtime = { begin() {}, async execute() { throw Error('No tools in workspace isolation fixture'); }, async finish() {}, async close() { if (pausedClose) { closeEntered = true; await close.promise; } } };
    const host = new AgentJobHost({ snapshotPath, runtime, launch: () => child }); queueMicrotask(() => child.emit('message', { type: 'ready' })); return host;
  } });
  t.after(async () => {
    stop(); pausedClose = false; close.resolve(); await registry.close(); for (const timer of timers) clearTimeout(timer);
    try { await server.ssrLoadModule('/src/lib/persist-storage.ts').then(m => m.flushPersistence()); await server.ssrLoadModule('/src/lib/secrets.ts').then(m => m.flushSecrets()); }
    finally { await server.close(); for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
    assert.deepEqual(network, [], 'No model, real Companion or private service is contacted');
  });
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts'); await useIde.persist.rehydrate();
  const { useLearn } = await server.ssrLoadModule('/src/lib/learn.ts'); await useLearn.persist.rehydrate(); useLearn.setState({ on: false });
  const { useIntern } = await server.ssrLoadModule('/src/lib/intern.ts'); useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const { useBrain } = await server.ssrLoadModule('/src/lib/brain/store.ts'); useBrain.setState({ on: false, autoLoad: false, autoUpdate: false, autonomy: 'off', jobs: {} });
  const bg = await server.ssrLoadModule('/src/lib/background-agent.ts');
  const { captureAgentRun } = await server.ssrLoadModule('/src/lib/agent-run.ts');
  const make = project => ({ project, execution: true, files: { 'shared.py': 'print(1)\n' }, messages: [{ role: 'user', content: 'Synthetic, no model' }], model: { provider: 'custom', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const a = await registry.start(make(roots[0])), b = await registry.start(make(roots[1]));
  const native = async (action, payload = {}) => {
    calls.push({ action, payload });
    if (action === 'jobs') return { available: true, ...registry.jobs() };
    if (action === 'status') return { available: true, ...registry.snapshot(payload.id, payload.revision, payload.draftRevision, payload.jobId) };
    if (action === 'select') return { available: true, ...registry.select(payload.jobId) };
    if (action === 'permissions') { const host = registry.hostFor(payload); return registry.wrap(host, host.snapshot()); }
    if (action === 'workspace-acquire') return registry.acquireWorkspace(payload.projects, `foreground:42:${payload.owner}`);
    if (action === 'workspace-release') return registry.releaseWorkspace(payload.leaseId, `foreground:42:${payload.owner}`);
    if (action === 'dismiss') { const host = registry.hostFor(payload), reply = host.dismiss(payload.id); await host.waitForCleanup(); return registry.wrap(host, reply); }
    throw Error('Unexpected native action: ' + action);
  };
  window.anvilNative = { agentJob: native };
  useIde.setState({ workspaceCwd: roots[0], memoryWorkspace: 'race-a', workspaceEpoch: 1, files: { 'shared.py': 'print(1)\n' }, dirs: [], openPaths: ['shared.py'], activePath: 'shared.py', chat: [], dirty: {}, pendingDiffs: [], agentBusy: false, agentJob: null, backgroundAgent: false,
    llmProvider: 'custom', llmAuthMode: 'key', llmBaseUrl: 'http://127.0.0.1:1/v1', llmModel: 'synthetic', llmContextAuto: false, mcpServers: [], activeSurfaceId: 'anvil', surfaceMode: 'bridge' });
  stop = bg.startBackgroundAgentMonitor(); await bg.selectBackgroundJob(a.jobId); assert.equal(useIde.getState().agentBusy, true);
  await bg.selectBackgroundJob(b.jobId); assert.equal(useIde.getState().agentBusy, false); stop();
  const { sendChat } = await server.ssrLoadModule('/src/lib/chat-session.ts');
  let accepted = false, erased = false; const before = calls.length;
  await sendChat({ draft: 'Inspect synthetic source', images: [], setDraft(value) { erased ||= value === ''; }, setImages() {}, setMention() {} }, { onAccepted() { accepted = true; } });
  assert.equal(accepted, false); assert.equal(erased, false, 'Rejected writer retains the request');
  assert.equal(registry.hostFor({ jobId: a.jobId }).busy(), true);
  assert.equal(calls.slice(before).filter(call => call.action === 'workspace-acquire').length, 1, 'The real foreground entry asks the native writer arbiter');
  assert.match(useIde.getState().notice, /aktiven Hintergrundauftrag|bearbeitet/);
  assert.equal(registry.projectLeases.size, 0);

  const controller = new AbortController(), release = await bg.acquireForegroundWorkspace(roots[2], captureAgentRun(() => true, controller.signal));
  controller.abort(); assert.throws(() => registry.assertStart(roots[2]), /Dateiaktion/);
  await release(); await release(); assert.equal(registry.projectLeases.size, 0, 'Only actual finalization releases the idempotent lease');
  const acquisition = deferred(), cancelled = new AbortController();
  window.anvilNative.agentJob = async (action, payload) => { const reply = await native(action, payload); if (action === 'workspace-acquire') { acquisition.resolve(); await close.promise; } return reply; };
  const pendingAcquire = bg.acquireForegroundWorkspace(roots[2], captureAgentRun(() => true, cancelled.signal));
  await acquisition.promise; cancelled.abort(); close.resolve(); await assert.rejects(pendingAcquire, /abge|abort/i); assert.equal(registry.projectLeases.size, 0);
  window.anvilNative.agentJob = native;
  const rootlessBefore = calls.length; await (await bg.acquireForegroundWorkspace('', captureAgentRun()))(); assert.equal(calls.length, rootlessBefore);
  delete window.anvilNative; await (await bg.acquireForegroundWorkspace(roots[0], captureAgentRun()))(); window.anvilNative = { agentJob: native };

  // A dismiss may genuinely wait for a retained engine session to close.
  const slowClose = deferred(); pausedClose = true;
  registry.hostFor({ jobId: a.jobId }).runtime.close = async () => { closeEntered = true; await slowClose.promise; };
  registry.hostFor({ jobId: a.jobId }).finish('done'); useIde.setState({ agentBusy: false }); await bg.selectBackgroundJob(a.jobId);
  const dismissal = bg.dismissBackgroundJob(); await until(() => closeEntered); await bg.selectBackgroundJob(b.jobId); slowClose.resolve(); await dismissal;
  assert.equal(bg.useBackgroundAgent.getState().job.id, b.state.id); assert.equal(bg.useBackgroundAgent.getState().selectedJobId, b.jobId);

  const fresh = await registry.start(make(roots[0])); await bg.selectBackgroundJob(fresh.jobId); stop = bg.startBackgroundAgentMonitor();
  const { applyBackgroundDebug, backgroundDebugCommand } = await server.ssrLoadModule('/src/lib/background-debug.ts');
  applyBackgroundDebug(fresh.state.id, { active: true, paused: true, path: 'shared.py', line: 1 });
  const debug = deferred();
  window.anvilNative.agentJob = (action, payload) => action === 'debug' ? debug.promise : native(action, payload);
  const pendingDebug = backgroundDebugCommand('step'); assert.ok(pendingDebug);
  useIde.getState().setWorkspaceCwd(roots[1]); useIde.getState().applyFiles({ 'shared.py': 'Different project B' }); await Promise.resolve(); await bg.selectBackgroundJob(b.jobId);
  assert.equal(useIde.getState().debug.active, false, 'Project switch clears the foreign debug mirror');
  debug.resolve({ state: { id: fresh.state.id, lastDebug: { active: true, paused: true, path: 'shared.py', line: 7, breakpoints: { 'shared.py': [7] } } } });
  assert.equal((await pendingDebug).ok, false); assert.equal(useIde.getState().debug.active, false); assert.equal(useIde.getState().debug.backgroundJobId, undefined); assert.deepEqual(useIde.getState().breakpoints, {});
});
