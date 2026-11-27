import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createServer } from 'vite';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { JobResourceGate } from '../electron/resource-gate.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await pause(25); } assert.fail('Synthetic run lifecycle did not settle'); };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('foreground native runs keep ownership through transport loss and release on verified process exit', { timeout: 65000 }, async t => {
  const output = path.resolve('artifacts/cursor-adoption-2026-10-19/rules-plugins/resource-lifecycle');
  mkdirSync(output, { recursive: true });
  const area = mkdtempSync(path.join(output, 'fixture-'));
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`, token = 'synthetic-run-lifecycle-token';
  const env = { ...process.env, ANVIL_ENGINE_ROOT: area, ANVIL_COMPANION_HOST: '127.0.0.1', ANVIL_COMPANION_PORT: String(port),
    ANVIL_COMPANION_TOKEN: token, ANVIL_HOME: path.join(area, 'home'), ANVIL_HOME_FILE: path.join(area, 'home-pointer.txt'),
    ANVIL_INSTALL_DIR: area, ANVIL_TOOLCHAIN_HOME: path.join(area, 'tools'), ANVIL_LSP_HOME: path.join(area, 'lsp'),
    ANVIL_GODOT_BIN: process.execPath, ANVIL_UNITY_BIN: '', ANVIL_UNREAL_BIN: '' };
  const child = spawn(process.execPath, ['companion/server.mjs'], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let companionLog = '';
  child.stdout.on('data', data => { companionLog += data; }); child.stderr.on('data', data => { companionLog += data; });
  const keys = ['window', 'document', 'localStorage', 'indexedDB', 'IDBKeyRange', 'fetch'];
  const original = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]), realFetch = globalThis.fetch;
  const values = new Map(), timers = new Set(), network = [], releases = [];
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.window = Object.assign(new EventTarget(), { localStorage, setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; }, clearTimeout: id => { timers.delete(id); clearTimeout(id); } });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: 'de' } });
  const gate = new JobResourceGate(); let onAcquire = () => {}, observedPid;
  window.anvilNative = { agentJob: async (action, payload) => {
    if (action === 'resource-acquire') { const lease = gate.acquire('foreground:run-fixture:renderer', payload.key); onAcquire(); return lease; }
    assert.equal(action, 'resource-release'); releases.push({ at: Date.now(), pid: observedPid, alive: observedPid ? alive(observedPid) : undefined });
    return gate.release(payload.leaseId, 'foreground:run-fixture:renderer');
  } };
  let transport = (url, init) => realFetch(url, init);
  globalThis.fetch = (url, init) => { assert.ok(String(url).startsWith(base + '/'), 'Only this isolated Companion may be contacted'); network.push({ url: String(url), method: init?.method || 'GET' }); return transport(url, init); };
  const server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(area, 'vite'), resolve: { alias: { '@': path.resolve('src') } },
    ssr: { external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'zustand', 'zustand/vanilla', 'zustand/middleware', 'js-yaml', 'fake-indexeddb', 'lucide-react', '@tanstack/react-start', '@tanstack/react-router'] },
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  t.after(async () => {
    writeFileSync(path.join(area, 'evidence.json'), JSON.stringify({ network, releases, companionLog }, null, 2));
    try { await server.ssrLoadModule('/src/lib/persist-storage.ts').then(m => m.flushPersistence()); await server.ssrLoadModule('/src/lib/secrets.ts').then(m => m.flushSecrets()); }
    finally {
      await server.close(); for (const timer of timers) clearTimeout(timer);
      if (child.exitCode == null) { child.kill(); await once(child, 'exit'); }
      for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    }
  });
  await until(() => companionLog.includes('Anvil companion'), 10000);
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts'); await useIde.persist.rehydrate();
  const { useIntern } = await server.ssrLoadModule('/src/lib/intern.ts'); useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const { useBrain } = await server.ssrLoadModule('/src/lib/brain/store.ts'); useBrain.setState({ on: false, autoLoad: false, autoUpdate: false, autonomy: 'off', jobs: {} });
  const companion = await server.ssrLoadModule('/src/lib/companion.ts'); companion.setCompanionToken(token);
  const resources = await server.ssrLoadModule('/src/lib/external-resource.ts');
  const { beginAgent } = await server.ssrLoadModule('/src/lib/agent-abort.ts');
  const reset = () => useIde.setState({ workspaceCwd: area, workspaceEpoch: useIde.getState().workspaceEpoch + 1, companionUrl: base,
    files: {}, dirty: {}, output: [], chat: [], agentBusy: false, agentJob: null, autoSaveDisk: false });
  const script = (name, ms) => {
    const file = path.join(area, name + '.mjs'), pidFile = path.join(area, name + '.pid');
    writeFileSync(file, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));console.log('synthetic ${name} started');setTimeout(()=>console.log('synthetic ${name} ended'),${ms});`);
    return { cmd: `godot "${file}"`, pidFile };
  };

  await t.test('ordinary engine_run is watched automatically until its actual end', async () => {
    reset(); const probe = script('natural-end', 3600);
    const run = await companion.companionRun({ cwd: area, cmd: probe.cmd, action: 'editor' }, base, new AbortController().signal);
    assert.equal(run.running, true); assert.equal(gate.held(), true);
    useIde.getState().pushOutput({ ...run, label: 'Synthetic editor' });
    await until(() => !gate.held(), 6000);
    assert.match(useIde.getState().output.at(-1).stdout, /synthetic natural-end ended/);
    assert.equal(useIde.getState().output.at(-1).stage.kind, 'log');
  });

  await t.test('a lost accepted response retains ownership and recovers the actual stage before exit', async () => {
    reset(); const probe = script('lost-reply', 5500); let requestId, stageId;
    transport = async (url, init) => {
      if (String(url).endsWith('/v1/run')) { requestId = JSON.parse(init.body).requestId; const response = await realFetch(url, init); stageId = (await response.json()).stage.id; throw new TypeError('synthetic reply lost after process start'); }
      return realFetch(url, init);
    };
    try {
      await assert.rejects(companion.companionRun({ cwd: area, cmd: probe.cmd, action: 'editor' }, base, new AbortController().signal), /synthetic reply lost/);
      assert.equal(gate.held(), true); assert.throws(() => gate.acquire('background:other', 'external'), /bereits/);
      assert.match(useIde.getState().output.at(-1).stderr, /unbekannt|nicht bestätigt/i);
      await until(() => useIde.getState().output.some(o => o.stage?.id === stageId && o.stage.kind === 'window'), 2300);
      assert.equal(gate.held(), true, 'a later running status restores the stage, without releasing ownership');
      await until(() => !gate.held(), 6000);
      assert.ok(requestId); assert.match(useIde.getState().output.at(-1).stdout, /synthetic lost-reply ended/);
    } finally { transport = (url, init) => realFetch(url, init); if (requestId) await resources.releaseForegroundResource(`engine-request:${base}:${requestId}`); }
  });

  await t.test('cancellation before dispatch runs no process and releases the unused lease', async () => {
    reset(); const controller = new AbortController(), count = network.filter(r => r.method === 'POST').length;
    onAcquire = () => controller.abort('synthetic pre-dispatch cancellation');
    try { await assert.rejects(companion.companionRun({ cwd: area, cmd: 'godot', action: 'editor' }, base, controller.signal)); }
    finally { onAcquire = () => {}; }
    assert.equal(network.filter(r => r.method === 'POST').length, count); assert.equal(gate.held(), false);
  });

  await t.test('HTTP disconnect before ready is correlated and terminates a real synthetic process', async () => {
    reset(); const probe = script('abort-before-ready', 12000), controller = new AbortController(); let requestId;
    transport = (url, init) => { if (String(url).endsWith('/v1/run')) requestId = JSON.parse(init.body).requestId; return realFetch(url, init); };
    const running = companion.companionRun({ cwd: area, cmd: probe.cmd, action: 'editor' }, base, controller.signal); const rejected = assert.rejects(running);
    await until(() => existsSync(probe.pidFile)); observedPid = Number(readFileSync(probe.pidFile, 'utf8'));
    assert.equal(alive(observedPid), true); const releaseCount = releases.length; controller.abort('synthetic HTTP disconnect'); await rejected;
    assert.equal(gate.held(), true, 'client abort alone is not a process completion receipt');
    await until(() => !gate.held(), 6000); assert.equal(alive(observedPid), false);
    assert.equal(releases.slice(releaseCount).every(r => !r.alive), true, 'ownership is released only after the actual child exited');
    const response = await realFetch(`${base}/v1/run-status?requestId=${requestId}`, { headers: { 'x-anvil-token': token } }); const status = await response.json();
    assert.equal(status.requestId, requestId); assert.equal(status.running, false); assert.equal(status.aborted, true);
    observedPid = undefined; transport = (url, init) => realFetch(url, init);
  });

  await t.test('project switches preserve foreign output while the original lease still expires', async () => {
    reset(); const probe = script('project-switch', 3500);
    const run = await companion.companionRun({ cwd: area, cmd: probe.cmd, action: 'editor' }, base, new AbortController().signal);
    const output = [{ ok: true, stdout: 'selected project sentinel', stderr: '', duration: 7, label: 'other project', stage: run.stage }];
    const chat = [{ id: 'other-chat', role: 'assistant', content: 'sentinel', lastRun: { id: run.stage.id, ok: true, stdout: 'sentinel', stderr: '', path: 'other.py', attempt: 1, max: 1 } }];
    useIde.setState({ workspaceCwd: path.join(area, 'other'), workspaceEpoch: useIde.getState().workspaceEpoch + 1, output, chat });
    await until(() => !gate.held(), 6000); assert.deepEqual(useIde.getState().output, output); assert.deepEqual(useIde.getState().chat, chat);
  });

  await t.test('a replaced generation receives no stale run updates', async () => {
    reset(); const probe = script('generation-switch', 3500);
    const run = await companion.companionRun({ cwd: area, cmd: probe.cmd, action: 'editor' }, base, new AbortController().signal);
    const output = [{ ok: true, stdout: 'new generation sentinel', stderr: '', duration: 8, label: 'new generation', stage: run.stage }];
    useIde.setState({ output }); beginAgent(); await until(() => !gate.held(), 6000); assert.deepEqual(useIde.getState().output, output);
  });

  await t.test('the real compile GUI watcher accepts legacy command records and completed logs', async () => {
    reset(); useIde.setState({ runHtml: false, netCompiler: false });
    const { runFile } = await server.ssrLoadModule('/src/lib/run-client.ts');
    const run = await runFile('synthetic-gui.mjs', { 'synthetic-gui.mjs': '// QWidget is a synthetic GUI classification marker, no GUI library is loaded.\nconsole.log("synthetic compile started");setTimeout(()=>console.log("synthetic compile ended"),5000);' });
    assert.equal(run.stage.kind, 'window'); useIde.getState().pushOutput(run);
    const recordFile = path.join(area, 'runs', run.stage.id, 'run.json');
    const legacy = JSON.parse(readFileSync(recordFile, 'utf8')); legacy.command = legacy.cmd; delete legacy.cmd; legacy.stdout += '\nlegacy command record observed';
    writeFileSync(recordFile, JSON.stringify(legacy));
    await until(() => useIde.getState().output.at(-1)?.stdout.includes('legacy command record observed'), 2000);
    await until(() => useIde.getState().output.at(-1)?.stage.kind === 'log', 5000);
    assert.match(useIde.getState().output.at(-1).stdout, /synthetic compile ended/);
    const completed = JSON.parse(readFileSync(recordFile, 'utf8')); completed.command = completed.cmd; delete completed.cmd; delete completed.running; completed.stdout += '\nlegacy terminal log observed';
    writeFileSync(recordFile, JSON.stringify(completed)); companion.watchCompanionRun(run.stage.id, base);
    await until(() => useIde.getState().output.at(-1)?.stdout.includes('legacy terminal log observed'), 2000);
  });

  await t.test('unknown or malformed status never turns an uncertain dispatch into an exit', async () => {
    reset(); let requestId;
    transport = async (url, init) => {
      if (String(url).endsWith('/v1/run')) { requestId = JSON.parse(init.body).requestId; throw new TypeError('synthetic dispatch outcome unknown'); }
      return new Response(JSON.stringify({ requestId: 'another-request', running: false }), { headers: { 'content-type': 'application/json' } });
    };
    try {
      await assert.rejects(companion.companionRun({ cwd: area, cmd: 'godot', action: 'play' }, base, new AbortController().signal), /outcome unknown/);
      await pause(1400); assert.equal(gate.held(), true); assert.throws(() => gate.acquire('background:other', 'external'), /bereits/);
    } finally { transport = (url, init) => realFetch(url, init); await resources.releaseForegroundResource(`engine-request:${base}:${requestId}`); }
  });
});
