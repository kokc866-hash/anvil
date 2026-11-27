import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t) {
  const before = new Map(['window', 'document', 'localStorage', '__persistPressure'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const values = new Map(), timers = new Map(); let timer = 0;
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage, location: { pathname: '/' }, setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id) });
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  const gate = deferred(), entered = deferred(), writes = [], operations = [];
  globalThis.__persistPressure = { load: async () => ({}), save: async (_name, snapshot) => { if (!writes.length) { entered.resolve(); await gate.promise; } const copy = structuredClone(snapshot); writes.push(copy); operations.push(['save', copy.state?.revision]); }, remove: async () => operations.push(['remove']) };
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', plugins: [{ name: 'controlled-archive-backpressure', enforce: 'pre', resolveId(id, importer) { if (id === './persist-db.ts' && importer?.endsWith('/persist-storage.ts')) return '\0pressure-archive'; }, load(id) { if (id === '\0pressure-archive') return 'export const loadArchive=(...a)=>globalThis.__persistPressure.load(...a); export const saveArchive=(...a)=>globalThis.__persistPressure.save(...a); export const removeArchive=(...a)=>globalThis.__persistPressure.remove(...a);'; } }] });
  const module = await server.ssrLoadModule('/src/lib/persist-storage.ts'), storage = module.idePersistStorage();
  await storage.getItem('anvil-ide');
  t.after(async () => { gate.resolve(); await module.flushPersistence().catch(() => {}); await server.close(); for (const [key, desc] of before) { if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key]; } });
  const put = revision => storage.setItem('anvil-ide', { state: { revision, chat: [{ id: 'same-message', role: 'assistant', content: `Version ${revision} ` + 'synthetic progress '.repeat(1000) }], files: { 'note.txt': 'preserve' } }, version: 0 });
  return { ...module, storage, gate, entered, writes, operations, put };
}

test('blocked persistence coalesces a thousand live updates to one latest pending snapshot', async t => {
  const f = await fixture(t); f.put(0); const first = f.flushPersistence(); await f.entered.promise;
  const waiters = [];
  for (let i = 1; i <= 1000; i++) { f.put(i); waiters.push(f.flushPersistence()); }
  f.gate.resolve(); await Promise.all([first, ...waiters]);
  assert.deepEqual(f.writes.map(w => w.state.revision), [0, 1000], 'only in-flight + latest may be serialized; intermediate stream snapshots must not form an unbounded queue');
  assert.match(f.writes.at(-1).chat[0].content, /^Version 1000 /);
  assert.equal(f.writes.at(-1).files['note.txt'], 'preserve');
});

test('removal remains an ordered barrier and a newer generation is saved after removal', async t => {
  const f = await fixture(t); f.put(0); const first = f.flushPersistence(); await f.entered.promise;
  f.put(1); const pending = f.flushPersistence();
  const removed = f.storage.removeItem('anvil-ide');
  f.put(2); const latest = f.flushPersistence();
  f.gate.resolve(); await Promise.all([first, pending, removed, latest]);
  assert.deepEqual(f.operations, [['save', 0], ['remove'], ['save', 2]]);
});
