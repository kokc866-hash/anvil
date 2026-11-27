import assert from 'node:assert/strict';
import {test} from 'node:test';
import path from 'node:path';
import {createServer} from 'vite';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';

async function fixture(t, legacy) {
  const original = Object.fromEntries(['window', 'document', 'localStorage', 'indexedDB', 'IDBKeyRange', 'fetch'].map(key => [key, globalThis[key]]));
  const values = new Map(), timers = new Set(), notes = [], network = [];
  let denyArchive = false, quota = Infinity;
  const factory = new IDBFactory();
  const originalOpen = factory.open.bind(factory);
  factory.open = (...args) => {
    const request = originalOpen(...args);
    request.addEventListener('success', () => {
      const db = request.result, transact = db.transaction.bind(db);
      db.transaction = (...params) => {
        if (denyArchive && params[1] === 'readwrite') throw new DOMException('Synthetic archive quota', 'QuotaExceededError');
        return transact(...params);
      };
    });
    return request;
  };
  globalThis.indexedDB = factory;
  globalThis.IDBKeyRange = IDBKeyRange;
  if (legacy) {
    const request = factory.open('anvil-persist', 3);
    request.onupgradeneeded = () => {for (const name of ['kv', 'file', 'chat']) request.result.createObjectStore(name);};
    const db = await new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    const tx = db.transaction(['kv', 'file'], 'readwrite');
    tx.objectStore('kv').put({state: legacy, savedAt: 1}, 'anvil-ide:state');
    tx.objectStore('kv').put(true, 'anvil-ide:files-present');
    for (const [path, content] of Object.entries(legacy.files)) tx.objectStore('file').put(content, `anvil-ide\t${path}`);
    await new Promise((resolve, reject) => {tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);});
    db.close();
  }
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { if (value.length > quota) throw new DOMException('Synthetic local quota', 'QuotaExceededError'); values.set(key, String(value)); },
    removeItem: key => values.delete(key),
  };
  globalThis.window = Object.assign(new EventTarget(), {localStorage, location: {pathname: '/'},
    setTimeout(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
  });
  globalThis.document = new EventTarget();
  globalThis.fetch = async (...args) => {network.push(String(args[0])); throw new Error('No external calls in persistence fixture');};
  const server = await createServer({configFile: false, root: process.cwd(),
    resolve: {alias: {'@': path.resolve('src')}}, ssr: {external: ['react', 'react-dom', 'zustand', 'js-yaml', 'fake-indexeddb']},
    optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, hmr: false, watch: null}, appType: 'custom',
    plugins: [{name: 'persistence-diagnostics-fixture', transform(_code, id) {
      if (id.endsWith('/src/lib/intern.ts')) return 'export function note(kind, text) { globalThis.__persistenceNotes.push({kind,text}); }';
    }}],
  });
  globalThis.__persistenceNotes = notes;
  const persistence = await server.ssrLoadModule('/src/lib/persist-storage.ts');
  const database = await server.ssrLoadModule('/src/lib/persist-db.ts');
  await server.ssrLoadModule('/src/lib/intern.ts');
  t.after(async () => {
    denyArchive = false;
    await persistence.flushPersistence().catch(() => undefined);
    for (const timer of timers) clearTimeout(timer);
    await server.close();
    for (const [key, value] of Object.entries(original)) {if (value === undefined) delete globalThis[key]; else globalThis[key] = value;}
    delete globalThis.__persistenceNotes;
    assert.deepEqual(network, [], 'persistence must never send project contents externally');
  });
  const storage = persistence.idePersistStorage();
  await storage.getItem('anvil-ide');
  return {storage, persistence, database, values, factory, notes,
    deny(value) {denyArchive = value;}, quota(value) {quota = value;},
    async save(state) {storage.setItem('anvil-ide', {state}); await persistence.flushPersistence();},
    reload: () => persistence.idePersistStorage().getItem('anvil-ide'),
  };
}

function state(content = 'old', project = 'I:/Synthetic/A') {
  return {workspaceCwd: project, workspaceMemoryId: project, files: {'src/app.ts': content},
    openPaths: ['src/app.ts'], recentPaths: [], dirty: {}, llmProvider: 'ollama',
    chat: [{id: 'reply', role: 'assistant', content}],
    pendingDiffs: [{path: 'src/app.ts', before: 'base', after: content, lines: []}], editBases: {'src/app.ts': 'base'},
    checkpoints: [], dirs: [], title: content};
}

test('newer recovery keeps files, chat and drafts when the archive write failed', async t => {
  const f = await fixture(t);
  await f.save(state());
  f.deny(true);
  await assert.rejects(f.save(state('new')), /Sicherung unvollständig/);
  const recovered = (await f.reload()).state;
  assert.equal(recovered.files['src/app.ts'], 'new');
  assert.equal(recovered.chat[0].content, 'new');
  assert.equal(recovered.pendingDiffs[0].after, 'new');
  assert.equal(recovered.title, 'new');
});

test('a newer intentionally cleared chat and recovery never revive old archive content', async t => {
  const f = await fixture(t);
  await f.save(state());
  f.deny(true);
  await assert.rejects(f.save({...state('new'), chat: [], pendingDiffs: [], editBases: {}}));
  const recovered = (await f.reload()).state;
  assert.deepEqual(recovered.chat, []);
  assert.deepEqual(recovered.pendingDiffs, []);
  assert.deepEqual(recovered.editBases, {});
});

test('failed persistence during a project switch cannot mix the old project into the new one', async t => {
  const f = await fixture(t);
  await f.save(state('A'));
  f.deny(true);
  await assert.rejects(f.save({...state('B', 'I:/Synthetic/B'), files: {'new.ts': 'B'}, chat: [], pendingDiffs: [], editBases: {}}));
  const recovered = (await f.reload()).state;
  assert.equal(recovered.workspaceCwd, 'I:/Synthetic/B');
  assert.deepEqual(recovered.files, {'new.ts': 'B'});
  assert.deepEqual(recovered.chat, []);
});

test('checkpoint payloads are separate and shared; unchanged history is not serialized on the next edit', async t => {
  const f = await fixture(t);
  const files = Object.fromEntries(Array.from({length: 10}, (_, i) => [`src/${i}.ts`, `${i}\n${'x'.repeat(49_997)}`]));
  const checkpoints = Array.from({length: 40}, (_, i) => ({id: `round-${i}`, at: i, label: 'Synthetic round', workspace: 'I:/Synthetic/A', files: {...files}, dirs: [], endFiles: {...files}, endDirs: [], sealedBy: `reply-${i}`}));
  await f.save({...state(), files, checkpoints});
  const metadata = await f.database.loadArchive('anvil-ide');
  assert.ok(JSON.stringify(metadata.state).length < 64_000, 'archive metadata must not include document bodies');
  assert.ok(f.values.get('anvil-ide').length < 128_000, 'compact recovery must not repeat historical document bodies');
  assert.equal(metadata.checkpoints.length, 40);
  const restored = (await f.reload()).state;
  assert.deepEqual(restored.checkpoints.at(-1).files, files);
  assert.deepEqual(restored.checkpoints.at(-1).endFiles, files);
  await f.save({...state('updated'), files: {...files, 'src/0.ts': 'updated'}, checkpoints});
  assert.ok(f.values.get('anvil-ide').length < 128_000);
  const request = f.factory.open('anvil-persist');
  const db = await new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
  const blobCount = await new Promise((resolve, reject) => {const r = db.transaction('blob').objectStore('blob').count(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
  assert.equal(blobCount, 10, 'identical historical contents must be stored only once');
  db.close();
});

test('removing persisted history clears checkpoint records and unused contents', async t => {
  const f = await fixture(t);
  await f.save({...state(), checkpoints: [{id: 'round', at: 1, label: 'round', files: {'test.bin': 'data:application/octet-stream;base64,AAEC'}, dirs: []}]});
  await f.save({...state(), checkpoints: []});
  assert.deepEqual((await f.reload()).state.checkpoints, []);
  await f.storage.removeItem('anvil-ide');
  const archive = await f.database.loadArchive('anvil-ide');
  assert.equal(archive.files, null);
  assert.equal(archive.chat, null);
  assert.equal(archive.checkpoints, null);
});

test('version-three archives retain full history and migrate to shared contents on save', async t => {
  const checkpoint = {id: 'legacy', at: 1, label: 'old round', files: {'main.ts': 'before'}, endFiles: {'main.ts': 'after'}, dirs: [], endDirs: [],
    restoreIntent: {files: [{path: 'main.ts', before: 'after', after: 'before', expected: 'after'}], mkdir: [], rmdir: []}};
  const f = await fixture(t, {...state(), checkpoints: [checkpoint]});
  const loaded = (await f.reload()).state;
  assert.deepEqual(loaded.checkpoints, [checkpoint]);
  await f.save(loaded);
  const archive = await f.database.loadArchive('anvil-ide');
  assert.equal(archive.state.checkpoints, undefined);
  assert.deepEqual(archive.checkpoints[0].files, checkpoint.files);
  assert.deepEqual(archive.checkpoints[0].restoreIntent, checkpoint.restoreIntent);
});

test('a newer primary archive wins over stale compact contents from another project', async t => {
  const f = await fixture(t);
  await f.save(state('A'));
  const local = f.values.get('anvil-ide'), files = f.values.get('anvil-ide:files');
  await f.save({...state('B', 'I:/Synthetic/B'), files: {'B.ts': 'only B'}});
  f.values.set('anvil-ide', local);
  f.values.set('anvil-ide:files', files);
  const recovered = (await f.reload()).state;
  assert.equal(recovered.workspaceCwd, 'I:/Synthetic/B');
  assert.deepEqual(recovered.files, {'B.ts': 'only B'});
  assert.equal(recovered.chat[0].content, 'B');
});

test('large-workspace emergency copies preserve edits and deletion without serializing unchanged files', async t => {
  const f = await fixture(t);
  const files = {'large.ts': 'x'.repeat(1_700_000), 'edit.ts': 'old', 'deleted.ts': 'remove'};
  await f.save({...state(), files});
  f.deny(true);
  await assert.rejects(f.save({...state('new'), files: {'large.ts': files['large.ts'], 'edit.ts': 'new'}}));
  assert.ok(f.values.get('anvil-ide:files').length < 10_000);
  const recovered = (await f.reload()).state;
  assert.equal(recovered.files['large.ts'], files['large.ts']);
  assert.equal(recovered.files['edit.ts'], 'new');
  assert.equal('deleted.ts' in recovered.files, false);
});

test('missing checkpoint contents block restoration instead of treating missing data as an empty file', async t => {
  const f = await fixture(t);
  const checkpoint = {id: 'round', at: 1, label: 'round', files: {'test.ts': 'before'}, dirs: [], endFiles: {'test.ts': 'after'}, endDirs: []};
  await f.save({...state(), checkpoints: [checkpoint]});
  const request = f.factory.open('anvil-persist');
  const db = await new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
  const tx = db.transaction('blob', 'readwrite'); tx.objectStore('blob').clear();
  await new Promise((resolve, reject) => {tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);});
  db.close();
  const restored = (await f.reload()).state.checkpoints[0];
  assert.equal(restored.archiveMissing, true);
  const source = await import('node:fs/promises').then(fs => fs.readFile('src/lib/restore-plan.ts', 'utf8'));
  const ts = await import('typescript');
  const code = ts.transpile(source, {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022});
  const {checkpointRestorePlan} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const plan = checkpointRestorePlan(restored, {'test.ts': 'after'}, []);
  assert.deepEqual(plan.files, []);
  assert.match(plan.conflicts[0], /Dateiinhalte.*fehlen/);
});

test('partial compact writes choose a coherent primary generation and preserve rejected metadata separately', async t => {
  const f = await fixture(t);
  await f.save(state());
  const files = f.values.get('anvil-ide:files');
  f.deny(true);
  await assert.rejects(f.save(state('new')));
  f.values.set('anvil-ide:files', files);
  const recovered = (await f.reload()).state;
  assert.equal(recovered.files['src/app.ts'], 'old');
  assert.equal(recovered.title, 'old');
  assert.equal(recovered.chat[0].content, 'old');
  assert.equal(recovered.pendingDiffs[0].after, 'old');
  assert.match(recovered.persistenceWarning, /vollständigen passenden Dateistand/);
  assert.equal(JSON.parse(f.values.get('anvil-ide:incomplete-recovery')).state.title, 'new');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.notes.some(note => /vollständigen passenden Dateistand/.test(note.text)));
});

test('stale browser writers rebuild all content references after another writer deleted their history', async t => {
  const f = await fixture(t);
  const checkpoint = (id, content) => ({id, at: 1, label: id, files: {'file.ts': content}, dirs: [], endFiles: {'file.ts': content}, endDirs: []});
  const a = {state: {...state('A')}, files: {'A.ts': 'A'}, chat: [], checkpoints: [checkpoint('A', 'A')], savedAt: 100};
  const b = {state: {...state('B')}, files: {'B.ts': 'B'}, chat: [], checkpoints: [checkpoint('B', 'B')], savedAt: 101};
  await f.database.saveArchive('anvil-ide', a, {});
  await f.database.saveArchive('anvil-ide', b, {});
  const next = {...a, checkpoints: [...a.checkpoints, checkpoint('C', 'C')], savedAt: 102};
  await f.database.saveArchive('anvil-ide', next, a);
  const archive = await f.database.loadArchive('anvil-ide');
  assert.deepEqual(archive.files, a.files);
  assert.deepEqual(archive.checkpoints.map(c => c.id), ['A', 'C']);
  assert.equal(archive.checkpoints[0].files['file.ts'], 'A');
  assert.equal(archive.checkpoints.some(c => c.archiveMissing), false);
});
