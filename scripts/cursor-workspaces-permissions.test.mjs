import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const until = async condition => { for (let n = 0; n < 200; n++) { if (condition()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('Bound permission synchronization did not settle.'); };
test('all active jobs retain their bound surfaces, real revocations still stop affected jobs, and late replies cannot steal selection', async t => {
  const keys = ['window', 'document', 'localStorage', 'indexedDB', 'IDBKeyRange', 'fetch'], original = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]), values = new Map(), timers = new Set(), network = [];
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; }, clearTimeout: id => { timers.delete(id); clearTimeout(id); } });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: 'de' } });
  globalThis.fetch = async url => { network.push(String(url)); throw Error('No network in permission fixture.'); };
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, ssr: { external: ['react', 'react-dom', 'react/jsx-runtime', 'zustand', 'zustand/vanilla', 'zustand/middleware', 'js-yaml', 'fake-indexeddb', 'lucide-react', '@tanstack/react-start', '@tanstack/react-router'] }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  let stop;
  t.after(async () => {
    stop?.(); for (const timer of timers) clearTimeout(timer);
    try { await server.ssrLoadModule('/src/lib/persist-storage.ts').then(m => m.flushPersistence()); await server.ssrLoadModule('/src/lib/secrets.ts').then(m => m.flushSecrets()); } finally { await server.close(); for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
    assert.deepEqual(network, []);
  });
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts'); await useIde.persist.rehydrate();
  const { useBrain } = await server.ssrLoadModule('/src/lib/brain/store.ts'); useBrain.setState({ on: false, autoLoad: false, autoUpdate: false, autonomy: 'off', jobs: {} });
  const { useIntern } = await server.ssrLoadModule('/src/lib/intern.ts'); useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const { useLearn } = await server.ssrLoadModule('/src/lib/learn.ts'); await useLearn.persist.rehydrate();
  const bg = await server.ssrLoadModule('/src/lib/background-agent.ts'), mcp = await server.ssrLoadModule('/src/lib/mcp.ts');
  const servers = [{ id: 'a', name: 'A', enabled: true, url: 'http://127.0.0.1:3/mcp' }, { id: 'b', name: 'B', enabled: true, url: 'http://127.0.0.1:4/mcp' }];
  useIde.setState({ workspaceCwd: '', memoryWorkspace: 'project-a', workspaceEpoch: 1, files: {}, dirty: {}, chat: [], agentBusy: false, agentJob: null, mcpServers: servers, activeSurfaceId: 'anvil', surfaceMode: 'bridge' });
  const make = id => ({ id: `job-${id}`, project: `project-${id}`, status: 'running', revision: 1, prompt: 'Synthetic', startedAt: 1, text: '', thinking: '', steps: [], plan: [], drafts: {}, harness: '', error: '', dismissed: false, services: [{ id, name: id.toUpperCase() }] });
  const jobs = { a: make('a'), b: make('b') }, calls = [], stops = []; let selected = 'a', deferA = false, releaseA;
  const summaries = () => Object.entries(jobs).map(([id, job]) => ({ jobId: `slot-${id}`, id: job.id, busy: job.status === 'running', services: job.services, surface: id === 'a' ? { id: 'anvil', mode: 'bridge' } : { id: 'b', mode: 'agent' } }));
  window.anvilNative = { agentJob: async (action, payload = {}) => {
    if (action === 'jobs') return { jobs: summaries(), selectedJobId: `slot-${selected}` };
    if (action === 'status') return { state: jobs[selected], jobId: `slot-${selected}`, selectedJobId: `slot-${selected}` };
    if (action === 'permissions') {
      calls.push(payload); const id = payload.id.at(-1);
      if (deferA && id === 'a') { deferA = false; await new Promise(r => { releaseA = r; }); }
      if (!payload.services.some(s => s.id === id) || payload.knowledge.skillBodies === false) jobs[id] = { ...jobs[id], status: 'stopped', revision: jobs[id].revision + 1 };
      return { state: jobs[id], jobId: `slot-${id}`, selectedJobId: `slot-${selected}` };
    }
    if (action === 'stop') { stops.push(payload); const id = payload.id.at(-1); jobs[id] = { ...jobs[id], status: 'stopped' }; return { state: jobs[id] }; }
    return { unchanged: true };
  } };
  bg.useBackgroundAgent.setState({ available: true, selectedJobId: 'slot-a', job: jobs.a, jobs: summaries(), error: '' });
  stop = bg.startBackgroundAgentMonitor(); await until(() => calls.length >= 2); calls.length = 0;
  useIde.setState({ activeSurfaceId: 'b', surfaceMode: 'agent', memoryWorkspace: 'project-b', workspaceEpoch: 2 });
  await new Promise(r => setTimeout(r, 30)); assert.equal(calls.length, 0, 'view and project changes are not permission revocation');
  assert.deepEqual(mcp.backgroundMcpServers(false, { surface: { id: 'anvil', mode: 'bridge' }, serverIds: ['a'] }).map(s => s.id), ['a']);
  deferA = true; useIde.setState({ mcpServers: [...servers] }); await until(() => releaseA);
  selected = 'b'; bg.useBackgroundAgent.setState({ selectedJobId: 'slot-b', job: jobs.b }); releaseA(); await until(() => calls.length >= 2);
  assert.equal(bg.useBackgroundAgent.getState().job.id, jobs.b.id); assert.deepEqual(calls.map(c => [c.jobId, c.surface.id, c.services.map(s => s.id)]), [['slot-a', 'anvil', ['a']], ['slot-b', 'b', ['b']]]);
  calls.length = 0; useIde.setState({ mcpServers: servers.map(s => s.id === 'a' ? { ...s, enabled: false } : s) }); await until(() => calls.length >= 2);
  assert.equal(jobs.a.status, 'stopped'); assert.equal(jobs.b.status, 'running'); assert.equal(bg.useBackgroundAgent.getState().job.id, jobs.b.id);
  calls.length = 0; useLearn.setState({ prefs: { ...useLearn.getState().prefs, skillBodies: false } }); await until(() => calls.length >= 1);
  assert.equal(calls[0].jobId, 'slot-b'); assert.equal(calls[0].knowledge.skillBodies, false); assert.equal(jobs.b.status, 'stopped');
  assert.deepEqual(stops, [], 'unchanged UI state must never cause fallback stop requests');
});
