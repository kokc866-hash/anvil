// Actual desktop UI, IPC, worker, stop/reopen/resume; synthetic local model only.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { fork } from 'node:child_process';
import { _electron } from 'playwright';
import { verifyBuild } from './build-fingerprint.mjs';
import { listTree } from '../companion/git.mjs';

const build = await verifyBuild(process.cwd(), true);
const output = path.resolve('artifacts/resume-fix-2026-10-08/desktop');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const project = await mkdtemp(path.join(output, 'project-'));
const bytes = Buffer.from([80, 75, 3, 4, 0, 255, 128, 65, 10]);
const cadPath = 'Stage.20261008-051748.FCBak';
await writeFile(path.join(project, cadPath), bytes);
await writeFile(path.join(project, 'Stage.FCStd'), bytes);
await writeFile(path.join(project, 'notes.txt'), 'Synthetic CAD fixture; preserve all files.');
const files = listTree(project).files;
const freePort = async () => {
  const server = netServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
const port = await freePort(), companionPort = await freePort(), url = `http://127.0.0.1:${port}/`;
let requests = 0, abortedStream = false;
const model = httpServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(JSON.parse(body).model, 'synthetic-cad-resume');
  requests++;
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (requests === 1) {
    response.on('close', () => { abortedStream = true; });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Synthetic progress before the controlled stop.' } }] })}\n\n`);
  } else response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Synthetic continuation completed. No files changed.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort), ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
// A non-default QA port has no renderer auto-start. Start its own real Companion
// before either UI boot; the fixed fixture token never touches the user token.
const companionToken = 'synthetic-cad-resume-companion';
const companion = fork(path.resolve('companion/server.mjs'), [], { env: { ...env,
  ANVIL_COMPANION_TOKEN: companionToken, ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'companion-fixture-token'),
  ANVIL_ENGINE_ROOT: project, ANVIL_INSTALL_DIR: profile }, stdio: 'ignore', windowsHide: true });
let app, page;
const errors = [], consoleErrors = [], blockedRequests = [], companionPortAdaptations = [];
const launch = async () => {
  app = await _electron.launch({ args: [path.resolve('fixtures/electron-boot.mjs')], env });
  await app.context().route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    // Startup also uses the fixed default Companion URL. Keep that request
    // inside this fixture: never contact a user's service listening on 7845.
    if (target.origin === 'http://127.0.0.1:7845') {
      companionPortAdaptations.push(target.pathname);
      target.port = String(companionPort);
      return route.continue({ url: target.toString(), headers: { ...route.request().headers(), 'x-anvil-token': companionToken } });
    }
    if (target.origin === `http://127.0.0.1:${companionPort}`) return route.continue({ headers: { ...route.request().headers(), 'x-anvil-token': companionToken } });
    if (['http:', 'https:'].includes(target.protocol) && target.origin !== new URL(url).origin) {
      blockedRequests.push(target.origin + target.pathname); return route.abort();
    }
    return route.continue();
  });
  for (let n = 0; n < 160; n++) {
    page = app.windows().find(window => window.url() === url);
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, 'Production main window required');
  await page.waitForFunction(() => document.readyState === 'complete' && window.__anvilIde?.persist.hasHydrated());
  await page.waitForLoadState('load');
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ message: message.text(), resource: message.location().url }); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.isDestroyed())?.setSize(1440, 900));
  await page.evaluate(async ({ project, files, companionPort, companionToken, modelPort }) => {
    await window.anvilNative.secretsSave({ companionToken });
    localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false, autoUpdate: false, autonomy: 'off' }, version: 0 }));
    localStorage.setItem('anvil-intern', JSON.stringify({ state: { prefs: { on: false, autoHeal: false, autoSoft: false } }, version: 0 }));
    window.__anvilIde.setState({ setupDone: true, autoUpdate: false, locale: 'de', workspaceCwd: project, memoryWorkspace: project,
      companionUrl: `http://127.0.0.1:${companionPort}`, companionKeep: false, files, dirs: [], dirty: {}, pendingDiffs: [], editBases: {},
      openPaths: ['notes.txt'], activePath: 'notes.txt', attached: [], recentPaths: [], autoSaveDisk: false, autoRunAgent: false, autoPreview: false,
      llmProvider: 'custom', llmAuthMode: 'key', llmModel: 'synthetic-cad-resume', llmBaseUrl: `http://127.0.0.1:${modelPort}/v1`, llmApiKey: '', llmContext: 32768, llmContextAuto: false, llmRetries: 1,
      llmThinking: 'off', llmHardStopMin: 1, planWho: 'agent', runLoop: false, graphLoop: false, testLoop: false, engineLoop: false, harnessAutoContinue: false,
      backgroundAgent: true, backgroundWriteThrough: true, mcpServers: [], agentBusy: false, agentJob: null,
      panels: { editor: true, agent: true, trail: false, output: false }, sidebar: null, settingsOpen: false, agentMode: 'agent' });
  }, { project, files, companionPort, companionToken, modelPort: model.address().port });
  await page.locator('#anvil-chat').waitFor();
};
const until = async predicate => {
  const deadline = Date.now() + 20000;
  while (!await predicate()) { assert.ok(Date.now() < deadline, 'Synthetic desktop state did not settle'); await new Promise(resolve => setTimeout(resolve, 50)); }
};
const status = () => page.evaluate(async () => (await window.anvilNative.agentJob('status')).state);
const deadline = setTimeout(() => { app?.process()?.kill(); process.exitCode = 1; }, 120000);
try {
  let companionReady = false;
  for (let n = 0; n < 100; n++) {
    try { companionReady = (await fetch(`http://127.0.0.1:${companionPort}/v1/run-active`, { headers: { 'x-anvil-token': companionToken }, signal: AbortSignal.timeout(500) })).ok; } catch { /* Starting own finite test server. */ }
    if (companionReady) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(companionReady, 'Owned QA Companion must be ready before UI boot');
  await launch();
  await page.locator('#anvil-chat').fill('Describe the synthetic fixture without changing any files.');
  await page.locator('#anvil-chat').press('Enter');
  await until(() => requests === 1);
  await page.locator('button[aria-label="Stoppen"]').click();
  await until(async () => (await status())?.status === 'stopped');
  const stopped = await status();
  await until(() => abortedStream);
  await app.close(); app = null; page = null;
  await launch();
  assert.equal(requests, 1, 'Reopening must not automatically resume');
  assert.equal((await status()).id, stopped.id);
  await page.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await until(async () => (await status())?.status === 'done');
  const resumed = await status();
  assert.equal(resumed.resumedFrom, stopped.id);
  assert.equal(requests, 2);
  await page.screenshot({ path: path.join(output, 'resumed-production.png') });
  await page.getByRole('button', { name: 'Abschließen', exact: true }).click();

  // The genuine IPC conflict is intentional, confined to a synthetic cache.
  await page.evaluate(({ cadPath, stale }) => window.__anvilIde.setState({ files: { ...window.__anvilIde.getState().files, [cadPath]: stale } }), { cadPath, stale: bytes.toString('utf8') });
  await page.locator('#anvil-chat').fill('Keep this request until its start is accepted.');
  await page.locator('#anvil-chat').press('Enter');
  const alert = page.getByRole('alert').filter({ hasText: 'Auftrag konnte nicht gestartet werden' });
  await alert.waitFor();
  await page.evaluate(() => window.__anvilIde.getState().setNotice(''));
  await page.waitForTimeout(1600);
  assert.match(await alert.innerText(), /Projekt und Editor unterscheiden sich: Stage\.20261008-051748\.FCBak/);
  assert.equal(await page.locator('#anvil-chat').inputValue(), 'Keep this request until its start is accepted.');
  assert.equal(requests, 2, 'A rejected baseline never reaches a model');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('anvil-applog') || '[]').some(row => row.tag === 'agent-start' && row.msg.includes('FCBak'))));
  await page.screenshot({ path: path.join(output, 'persistent-conflict-production.png') });
  await page.evaluate(files => window.__anvilIde.setState({ files }), listTree(project).files);
  await page.locator('#anvil-chat').press('Enter');
  await until(async () => requests === 3 && (await status())?.status === 'done');
  assert.equal(await alert.count(), 0, 'An accepted retry clears its previous start failure');
  assert.equal(await page.locator('#anvil-chat').inputValue(), '');
  assert.deepEqual(await readFile(path.join(project, cadPath)), bytes);
  assert.deepEqual(await readFile(path.join(project, 'Stage.FCStd')), bytes);
  assert.deepEqual(errors, []);
  const unexpected = consoleErrors.filter(error => !(error.message === 'Failed to load resource: net::ERR_FAILED' && blockedRequests.includes(error.resource)));
  assert.deepEqual(unexpected, []);
  const { version, commit, source, outputFingerprint, builtAt } = build;
  const result = { ok: true, build: { version, commit, source, outputFingerprint, builtAt }, requests, abortedSyntheticStream: abortedStream, stoppedId: stopped.id, resumedId: resumed.id,
    bytePreservation: true, persistentIpcError: true, explicitRetry: true, errors, consoleErrors, blockedRequests, companionPortAdaptations,
    limits: 'Synthetic local model and artificial CAD bytes; no real Qwen inference or FreeCAD geometry operation.' };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(deadline); await app?.close(); companion.kill(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
}
