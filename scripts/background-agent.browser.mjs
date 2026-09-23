// Real packaged UI, preload, utility process and main-process crash recovery.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as socketServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from 'playwright';
await import('./pack-ui.mjs');

const output = path.resolve('artifacts/background-agent'); await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const socket = socketServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port; await new Promise(r => socket.close(r));
let release, rounds = 0, responseClosed = false;
const modelServer = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'qa-local' }] })); return; }
  rounds++; const n = rounds;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.on('close', () => { responseClosed = true; });
  const emit = choice => res.write(`data: ${JSON.stringify({ choices: [choice] })}\n\n`);
  if (n === 1 || n > 3) { emit({ delta: { reasoning_content: 'Hintergrundprozess denkt weiter.' } }); await new Promise(r => { release = r; }); }
  if (n === 1 || n === 2) {
    const name = n === 1 ? 'read_file' : 'edit_file';
    const args = n === 1 ? { path: 'notes.md' } : { path: 'notes.md', old_string: '# Ausgang\n', new_string: '# Fertiger Entwurf\n' };
    emit({ delta: { tool_calls: [{ index: 0, id: `qa-${n}`, function: { name, arguments: JSON.stringify(args) } }] } });
    emit({ delta: {}, finish_reason: 'tool_calls' });
  } else { emit({ delta: { content: 'Der Dateientwurf ist fertig. Keine Ausführung geprüft.' } }); emit({ delta: {}, finish_reason: 'stop' }); }
  res.end('data: [DONE]\n\n');
});
await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${port}/`;
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_QA_USER_DATA: profile,
  ANVIL_HOME: path.join(profile, 'packages'), ANVIL_WATCHDOG: '0' };
delete env.ELECTRON_RUN_AS_NODE;
const until = async check => { for (let i = 0; i < 180; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 200)); } throw new Error('QA condition timed out'); };
let app, appProcess;
const timeout = setTimeout(() => { appProcess?.kill(); modelServer.closeAllConnections(); process.exitCode = 1; }, 120000);
try {
  app = await _electron.launch({ args: [path.resolve('fixtures/electron-boot.mjs')], env, timeout: 45000 });
  appProcess = app.process();
  let page; await until(() => { page = app.windows().find(p => p.url() === url); return page; });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(baseUrl => {
    const store = window.__anvilIde;
    store.setState({ setupDone: true, autoUpdate: false, backgroundAgent: true, agentMode: 'agent',
      files: { 'notes.md': '# Ausgang\n' }, dirty: {}, pendingDiffs: [], chat: [], workspaceCwd: '',
      llmProvider: 'custom', llmAuthMode: 'key', llmBaseUrl: baseUrl, llmModel: 'qa-local', llmApiKey: '', llmContext: 32768,
      llmContextAuto: false, llmThinking: 'auto', llmHardStopMin: 0, autoRunAgent: false, runLoop: false, graphLoop: false });
  }, `http://127.0.0.1:${modelServer.address().port}/v1`);
  const nativeStatus = () => page.evaluate(() => window.anvilNative.agentJob('status'));
  await until(async () => (await nativeStatus()).available);
  await page.locator('textarea').last().fill('Lies notes.md und erstelle einen fertigen Markdown-Entwurf.');
  await page.locator('textarea').last().press('Enter');
  await until(() => release);
  await until(async () => (await nativeStatus()).state?.thinking.length > 0);
  const id = (await nativeStatus()).state.id;
  await page.waitForFunction(() => window.__anvilIde.getState().chat.some(m => m.id.startsWith('background-')));
  await page.screenshot({ path: path.join(output, 'running.png') });
  await app.evaluate(({ dialog }) => { globalThis.__backgroundDialogs = []; dialog.showMessageBox = async (_w, opts) => { globalThis.__backgroundDialogs.push(opts); return { response: 0 }; }; });
  const crashed = page.waitForEvent('crash');
  await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
    const wc = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/')).webContents;
    wc.once('did-finish-load', resolve); wc.forcefullyCrashRenderer();
  }));
  await crashed;
  const evaluateRestored = code => app.evaluate(({ BrowserWindow }, source) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/')).webContents.executeJavaScript(source), code);
  await until(async () => evaluateRestored('Boolean(window.__anvilIde?.getState().agentBusy)').catch(() => false));
  assert.equal(rounds, 1); assert.equal(responseClosed, false, 'renderer death must not cancel the model request');
  assert.match((await app.evaluate(() => globalThis.__backgroundDialogs))[0].detail, /Hintergrundauftrag läuft weiter/);
  release(); release = undefined;
  let finished; await until(async () => { finished = await evaluateRestored('window.anvilNative.agentJob("status")'); return finished.state?.status === 'done'; });
  assert.equal(finished.state.id, id); assert.equal(rounds, 3);
  assert.equal(finished.state.drafts['notes.md'].after, '# Fertiger Entwurf\n');
  await until(async () => evaluateRestored('window.__anvilIde.getState().chat.at(-1)?.content.includes("Keine Ausführung geprüft")'));
  assert.equal(await evaluateRestored(`window.__anvilIde.getState().chat.filter(m => m.id === ${JSON.stringify('background-' + id)}).length`), 1);
  assert.equal(await evaluateRestored('window.__anvilIde.getState().files["notes.md"]'), '# Ausgang\n');
  const click = text => evaluateRestored(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)})?.click()`);
  // Concurrent editing is never overwritten by a stale background draft.
  await evaluateRestored('window.__anvilIde.setState({files:{"notes.md":"Meine Änderung"}})');
  await click('Im Editor prüfen');
  assert.equal(await evaluateRestored('window.__anvilIde.getState().files["notes.md"]'), 'Meine Änderung');
  assert.match(await evaluateRestored('window.__anvilIde.getState().notice'), /inzwischen geänderte/);
  await evaluateRestored('window.__anvilIde.setState({files:{"notes.md":"# Ausgang\\n"}})');
  await click('Im Editor prüfen');
  assert.equal(await evaluateRestored('window.__anvilIde.getState().pendingDiffs[0]?.source'), 'propose');
  assert.equal(await evaluateRestored('window.__anvilIde.getState().files["notes.md"]'), '# Fertiger Entwurf\n');
  const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/')).webContents.capturePage()).toDataURL());
  await writeFile(path.join(output, 'restored.png'), Buffer.from(image.split(',')[1], 'base64'));
  await click('Abschließen');
  // Actual Stop control after reattaching, without an old sendChat promise.
  await evaluateRestored(`window.anvilNative.agentJob('start', {project:window.__anvilIde.getState().memoryWorkspace,files:{},messages:[{role:'user',content:'Warte'}],model:{provider:'custom',baseUrl:'http://127.0.0.1:${modelServer.address().port}/v1',model:'qa-local',context:32768,thinking:'auto',hardStopMin:0},maxRounds:8})`);
  await until(() => release);
  await until(async () => evaluateRestored('document.body.innerText.includes("Stoppen")'));
  await click('Stoppen');
  await until(async () => (await evaluateRestored('window.anvilNative.agentJob("status")')).state.status === 'stopped');
  release(); release = undefined;
  await evaluateRestored('window.__anvilIde.setState({dirty:{},pendingDiffs:[]})');
  await click('Abschließen');
  await evaluateRestored(`window.anvilNative.agentJob('start', {project:window.__anvilIde.getState().memoryWorkspace,files:{},messages:[{role:'user',content:'Warte bis Anvil geschlossen wird'}],model:{provider:'custom',baseUrl:'http://127.0.0.1:${modelServer.address().port}/v1',model:'qa-local',context:32768,thinking:'auto',hardStopMin:0},maxRounds:8})`);
  await until(() => release);
  await app.evaluate(({ app }) => { setImmediate(() => app.quit()); });
  await until(() => appProcess.exitCode !== null);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'agent-jobs', 'latest.json'), 'utf8')).status, 'stopped');
  assert.deepEqual(errors, []);
  assert.ok(!(await readFile(path.join(profile, 'agent-jobs', 'latest.json'), 'utf8')).includes('apiKey'));
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks: ['actual utility process', 'live model stream survives renderer crash', 'same job reconnects', 'no duplicate requests or chat', 'draft survives', 'concurrent file edit protected', 'draft review', 'Stop after reconnect', 'normal app quit stops background job'], rounds }, null, 2));
  console.log('BACKGROUND_AGENT_CRASH_RECONNECT_AND_STOP_OK');
} finally {
  clearTimeout(timeout); release?.();
  // Test cleanup must not wait on an editor's unsaved-draft close prompt.
  const cleanupDeadline = setTimeout(() => { appProcess?.kill(); modelServer.closeAllConnections(); }, 8000);
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  clearTimeout(cleanupDeadline);
  modelServer.closeAllConnections(); await new Promise(r => modelServer.close(r));
}
