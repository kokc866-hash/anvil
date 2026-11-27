import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as socketServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from 'playwright';
import { spawn } from 'node:child_process';
import { verifyBuild } from './build-fingerprint.mjs';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

// Real production UI and bundled worker; only the model is synthetic.
const output = path.resolve('artifacts/qwen-fix-2026-10-26/desktop');
await mkdir(output, { recursive: true });
const executableFlag = process.argv.indexOf('--executable');
const requestedExecutable = executableFlag >= 0 ? path.resolve(process.argv[executableFlag + 1]) : undefined;
const manifest = requestedExecutable ? await verifyPackageFingerprint(path.join(path.dirname(requestedExecutable), 'resources/app')) : await verifyBuild(process.cwd(), true);
const profile = await mkdtemp(path.join(output, 'profile-'));
const project = path.join(profile, 'synthetic-project');
await mkdir(project);
const original = 'SYNTHETIC_NOTE: This confirmed file must remain unchanged.\n';
await writeFile(path.join(project, 'note.txt'), original);
const block = Array.from({ length: 80 }, (_, n) => `Observation ${n}: check synthetic requirement ${n * 17} before the independent result ${n * n}.\n`).join('').slice(0, 1919);
const checks = [], errors = [], consoleErrors = [], failedRequests = [], fixtureErrors = [], requests = [], gates = new Map();
let app, page, companionProcess, loopClosed = false, gateTimer;
const until = async (predicate, label) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error('Reasoning desktop QA timed out: ' + label);
};
const freePort = async () => {
  const socket = socketServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
};
const port = await freePort(), companionPort = await freePort();
const api = createServer(async (req, res) => {
  try {
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'synthetic-reasoning-qa' }] })); return; }
    assert.equal(req.url, '/v1/chat/completions');
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), stage = requests.length + 1;
    requests.push({ stage, max_tokens: body.max_tokens, num_predict: body.options?.num_predict });
    assert.ok(stage <= 5, 'no automatic replay or invented recovery work');
    assert.equal(body.max_tokens, 16384, 'the actual independent worker sends the standard output limit');
    const send = (delta, finish_reason) => res.write(`data: ${JSON.stringify({ choices: [{ delta, ...(finish_reason ? { finish_reason } : {}) }] })}\n\n`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (stage === 1 || stage === 3) {
      send({ tool_calls: [{ index: 0, id: 'read-' + stage, type: 'function', function: { name: 'read_file', arguments: '{"path":"note.txt"}' } }] }, 'tool_calls');
      res.end('data: [DONE]\n\n'); return;
    }
    if (stage === 2) {
      for (let n = 0; n < 30; n++) send({ reasoning_content: `SLOW_THINK_PROGRESS ${n}: separate finding ${n * 13}, continue the observation.\n` });
      await new Promise(resolve => { gates.set(stage, resolve); res.once('close', resolve); });
      if (res.destroyed) return;
      send({ content: 'ADVANCING_OK: Die Datei wurde gelesen. Keine Änderungen oder Tests ausgeführt.' }, 'stop');
      res.end('data: [DONE]\n\n'); return;
    }
    if (stage === 4) {
      // A fully formed pending write must never execute after the loop error.
      send({ tool_calls: [{ index: 0, id: 'must-not-run', type: 'function', function: { name: 'write_file', arguments: '{"path":"note.txt","content":"UNCONFIRMED_WRITE_MUST_NOT_RUN"}' } }] });
      send({ reasoning_content: block.repeat(3) });
      await new Promise(resolve => { gates.set(stage, resolve); res.once('close', resolve); });
      if (res.destroyed) return;
      res.once('close', () => { loopClosed = !res.writableEnded; clearTimeout(gateTimer); });
      send({ reasoning_content: block.repeat(5) });
      gateTimer = setTimeout(() => { fixtureErrors.push('Repetitive upstream was not cancelled'); res.end('data: [DONE]\n\n'); }, 10000);
      return;
    }
    send({ content: 'RECOVERY_OK: Eine neue Anfrage funktioniert nach der erkannten Schleife.' }, 'stop');
    res.end('data: [DONE]\n\n');
  } catch (error) { fixtureErrors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end('Synthetic fixture error.'); }
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${api.address().port}/v1`;
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort),
  ANVIL_COMPANION_TOKEN: 'reasoning-qa-only', ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'companion-token'),
  ANVIL_QA_USER_DATA: profile, ANVIL_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
const result = { realModelInference: false, source: manifest.source, outputFingerprint: manifest.outputFingerprint, profile, project, checks, errors, consoleErrors, failedRequests, fixtureErrors, requests };
const job = async () => (await page.evaluate(() => window.anvilNative.agentJob('status'))).state;
const release = stage => { assert.ok(gates.has(stage)); const resolve = gates.get(stage); gates.delete(stage); resolve(); };
const prompt = async text => { await page.locator('textarea').last().fill(text); await page.locator('textarea').last().press('Enter'); };
try {
  // Start the genuine isolated Companion before mounting components that ping
  // it. The application must never contact the user's service on port 7845.
  const companionScript = requestedExecutable ? path.join(path.dirname(requestedExecutable), 'resources/app/companion/server.mjs') : path.resolve('companion/server.mjs');
  companionProcess = spawn(process.execPath, [companionScript], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const companionErrors = [];
  companionProcess.on('error', error => companionErrors.push(error.message));
  companionProcess.stderr.on('data', part => { if (companionErrors.join('').length < 4000) companionErrors.push(String(part)); });
  await until(async () => {
    if (companionProcess.exitCode !== null) throw Error('Isolated Companion exited: ' + companionErrors.join(''));
    try { return (await fetch(`http://127.0.0.1:${companionPort}/v1/ping`, { headers: { 'x-anvil-token': 'reasoning-qa-only' }, signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, 'isolated Companion readiness');
  app = await _electron.launch({ executablePath: requestedExecutable || path.resolve('node_modules/electron/dist/electron.exe'), args: requestedExecutable ? [] : [process.cwd()], env, timeout: 45000 });
  await app.context().route('**/*', route => {
    const url = new URL(route.request().url()), headers = route.request().headers();
    if (url.hostname === '127.0.0.1' && url.port === '7845') {
      url.port = String(companionPort);
      return route.continue({ url: url.href, headers: { ...headers, 'x-anvil-token': 'reasoning-qa-only' } });
    }
    if ([`http://127.0.0.1:${port}`, `http://127.0.0.1:${companionPort}`, new URL(base).origin].includes(url.origin)) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await until(() => { page = app.windows().find(window => window.url() === `http://127.0.0.1:${port}/`); return page; }, 'production window');
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure() }));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 1000); window.setTitle('Anvil – isolierter Schleifenschutz-Test'); });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(({ project, original, base }) => {
    const ide = window.__anvilIde;
    ide.setState({ setupDone: true, settingsOpen: false, autoUpdate: false, companionKeep: false, locale: 'de', workspaceCwd: project, workspaceEpoch: 2,
      files: { 'note.txt': original }, dirs: [], openPaths: ['note.txt'], activePath: 'note.txt', dirty: {}, pendingDiffs: [], chat: [],
      backgroundAgent: true, backgroundWriteThrough: true, agentMode: 'agent', agentQueue: [], agentInbox: null,
      autoSaveDisk: false, autoPreview: false, autoRunAgent: false, runLoop: false, graphLoop: false, testLoop: false, engineLoop: false,
      harnessAutoContinue: false, llmContextAuto: false, llmContext: 131072, llmMaxOut: 16384, llmRetries: 4, llmThinking: 'high', mcpServers: [] });
    const state = ide.getState(); state.setLlmProvider('custom', 'key'); state.setLlmBaseUrl(base); state.setLlmModel('synthetic-reasoning-qa'); state.setLlmApiKey('');
    ide.setState({ llmContextAuto: false, llmContext: 131072, llmMaxOut: 16384, llmThinking: 'high', llmRetries: 4 });
  }, { project, original, base });
  await prompt('Lies note.txt einmal und berichte den Inhalt. Nur beobachten, nichts ändern und keine Tests ausführen. ADVANCING_CASE');
  await until(() => gates.has(2), 'advancing reasoning');
  await until(async () => (await job())?.thinking?.includes('SLOW_THINK_PROGRESS 29'), 'visible advancing reasoning state');
  assert.equal((await job()).status, 'running');
  await page.getByText(/SLOW_THINK_PROGRESS 29/).first().waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'advancing-thinking.png') });
  checks.push('The real worker retains a running task while reasoning introduces new findings');
  release(2);
  await until(async () => (await job())?.status === 'done', 'advancing completion');
  await page.locator('[data-chat-msg]').filter({ hasText: 'ADVANCING_OK:' }).last().waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'advancing-complete.png') });
  checks.push('Advancing thinking completes normally and its actual answer appears in the production UI');
  await until(() => page.evaluate(() => !window.__anvilIde.getState().agentBusy), 'first task idle');
  await prompt('Lies note.txt einmal und berichte den Inhalt. Nur beobachten, nichts ändern und keine Tests ausführen. LOOP_CASE');
  await until(() => gates.has(4), 'held repetition');
  const previous = await job();
  release(4);
  await until(async () => ['failed', 'stopped'].includes((await job())?.status), 'loop terminal state');
  const stopped = await job();
  assert.equal(stopped.id, previous.id);
  assert.equal(stopped.status, 'failed');
  assert.equal(stopped.failure?.error?.code, 'reasoning_repetition');
  assert.match(stopped.error, /Wiederholungsschleife/);
  assert.equal(stopped.steps.filter(step => step.name === 'read_file' && step.status === 'ok').length, 1);
  assert.equal(stopped.steps.some(step => step.name === 'write_file'), false);
  assert.equal(await readFile(path.join(project, 'note.txt'), 'utf8'), original);
  await until(() => loopClosed, 'actual upstream socket close');
  assert.equal(requests.length, 4);
  await page.locator('[data-chat-msg]').filter({ hasText: /Modellantwort angehalten:.*Wiederholungsschleife/ }).last().waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'loop-stopped.png') });
  result.stoppedJob = { id: stopped.id, status: stopped.status, failure: stopped.failure, steps: stopped.steps.map(step => ({ name: step.name, status: step.status })) };
  checks.push('Loop failure keeps its cause visible, cancels the upstream socket, and never executes pending writes or repeats the completed read');
  await until(() => page.evaluate(() => !window.__anvilIde.getState().agentBusy), 'loop task idle');
  await prompt('Antworte kurz, ohne Werkzeuge, ohne Änderungen und ohne Tests. RECOVERY_CASE');
  await until(async () => (await job())?.status === 'done' && (await job())?.text?.includes('RECOVERY_OK'), 'fresh task after repetition');
  await page.locator('[data-chat-msg]').filter({ hasText: 'RECOVERY_OK:' }).last().waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'new-task-works.png') });
  assert.equal(requests.length, 5);
  assert.deepEqual((await job()).steps, [], 'a plain answer must not invent a file operation or edit/test checklist');
  assert.equal(await readFile(path.join(project, 'note.txt'), 'utf8'), original);
  checks.push('A fresh plain-answer task works immediately after the guard error, without invented edits, tests or replay');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(fixtureErrors, []);
  result.ok = true;
} catch (error) { result.ok = false; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  for (const resolve of gates.values()) resolve();
  clearTimeout(gateTimer);
  if (page && !result.ok) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); result.body = await page.locator('body').innerText().catch(() => ''); }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  if (companionProcess && companionProcess.exitCode === null) {
    const closed = new Promise(resolve => companionProcess.once('exit', resolve));
    companionProcess.kill();
    await closed;
  }
  api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
}
console.log(JSON.stringify({ ok: result.ok, checks, error: result.error, output }, null, 2));
