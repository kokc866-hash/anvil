import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as socketServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from 'playwright';
import { verifyBuild } from './build-fingerprint.mjs';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

const flag = (name, fallback) => { const i = process.argv.indexOf(name); return path.resolve(i < 0 ? fallback : process.argv[i + 1]); };
const executable = process.argv.includes('--executable') ? flag('--executable') : undefined;
const output = flag('--output', 'artifacts/tool-rejection-2026-10-31/desktop'); await mkdir(output, { recursive: true });
const manifest = executable ? await verifyPackageFingerprint(path.join(path.dirname(executable), 'resources/app')) : await verifyBuild(process.cwd(), true);
const profile = await mkdtemp(path.join(output, 'profile-')), project = path.join(profile, 'synthetic-project'); await mkdir(project);
const files = { 'index.html': '<!doctype html><html><head><meta charset="utf-8"><title>Rejection QA</title></head><body style="background:#182333;color:#e5edf7;font:22px system-ui;padding:40px"><h1>Werkzeugtest</h1><button id="start">Start</button><p id="status">Ready</p><script src="ui.js"></script></body></html>',
  'ui.js': 'const marker="WORKSHOP_MARKER";document.querySelector("#start").onclick=()=>document.querySelector("#status").textContent="Running";' };
for (const [name, content] of Object.entries(files)) await writeFile(path.join(project, name), content);
const socket = socketServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const requests = [], issues = [], checks = [], errors = [], consoleErrors = [];
let readEvidence, held = false, release, playResult;
const toolText = (body, id) => { const value = body.messages.find(message => message.role === 'tool' && message.tool_call_id === `rejection-${id}`)?.content; assert.equal(typeof value, 'string'); return value; };
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"data":[]}'); return; }
  let name, args;
  try {
    const body = JSON.parse(raw), n = requests.push({ at: Date.now(), tools: (body.tools || []).map(tool => tool.function.name) });
    assert.ok(n <= 8, 'bounded recovery without repeated commands');
    if (n === 1) { name = 'select_tools'; args = { names: ['shell', 'read_file', 'run_file', 'play', 'set_plan'] }; }
    if (n === 2) { name = 'set_plan'; args = { steps: ['ui.js lesen und vorhandene Bedienung ermitteln', 'Start anklicken und Status Running prüfen'], kinds: ['read', 'check'] }; }
    if (n === 3) { assert.equal(JSON.parse(toolText(body, 2)).ok, true); name = 'shell'; args = { command: 'cat ui.js | head -100' }; }
    if (n === 4) {
      const rejected = JSON.parse(toolText(body, 3)); assert.equal(rejected.ok, false); assert.equal(rejected.rejected, true); assert.equal(rejected.definitelyNotExecuted, true); assert.match(rejected.error, /read_file/);
      name = 'read_file'; args = { path: 'ui.js' };
    }
    if (n === 5) { const read = toolText(body, 4); assert.match(read, /WORKSHOP_MARKER/); readEvidence = /Plan evidence ID: (e\d+)/.exec(read)?.[1]; name = 'run_file'; args = { path: 'index.html' }; }
    if (n === 6) { assert.match(toolText(body, 5), /RUN OK/); name = 'play'; args = { actions: [{ type: 'click', selector: '#start' }, { type: 'assert', selector: '#status', text: 'Running' }] }; }
    if (n === 7) {
      playResult = JSON.parse(toolText(body, 6)); assert.equal(playResult.ok, true, playResult.error); assert.equal(playResult.functionalChecks, true);
      assert.equal(typeof readEvidence, 'string'); name = 'set_plan'; args = { updates: [{ step: 1, status: 'ok', kind: 'read', evidence: [readEvidence], reason: 'ui.js was read successfully after the shell rejection.' }, { step: 2, status: 'ok', kind: 'check', evidence: [playResult.plan_evidence_id], reason: 'Actual native click followed by explicit DOM text assertion.' }] };
    }
    if (n === 8) { assert.equal(JSON.parse(toolText(body, 7)).ok, true); held = true; await new Promise(resolve => release = resolve); }
  } catch (error) { issues.push(error.stack); }
  const n = requests.length;
  const delta = name ? { tool_calls: [{ index: 0, id: `rejection-${n}`, function: { name, arguments: JSON.stringify(args) } }] }
    : { content: 'TOOL_RECOVERY_OK: ui.js mit read_file gelesen. Start angeklickt und den Status Running geprüft. Der abgelehnte Shell-Befehl wurde nicht ausgeführt. Keine Dateien geändert.' };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: name ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') }; delete env.ELECTRON_RUN_AS_NODE;
const until = async (fn, label) => { for (let i = 0; i < 450; i++) { if (issues.length) throw Error(issues.join('\n')); if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('Recovery desktop QA timeout: ' + label); };
let app, proc, page;
try {
  app = await _electron.launch({ ...(executable ? { executablePath: executable, args: [] } : { args: [path.resolve('fixtures/electron-boot.mjs')] }), env, timeout: 45000 }); proc = app.process();
  await app.context().route('**/*', route => { const req = route.request(), url = new URL(req.url()), type = req.resourceType(); return url.hostname === '127.0.0.1' ? route.continue() : route.fulfill({ status: 200, contentType: type === 'script' ? 'application/javascript' : type === 'stylesheet' ? 'text/css' : 'application/json', body: ['script', 'stylesheet'].includes(type) ? '' : '{}' }); });
  const editorUrl = `http://127.0.0.1:${port}/`; await until(() => { page = app.windows().find(window => window.url() === editorUrl); return page; }, 'editor');
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url).setSize(1500, 1000), editorUrl);
  await page.evaluate(({ project, files, base }) => window.__anvilIde.setState({ setupDone: true, settingsOpen: false, autoUpdate: false, locale: 'de', backgroundAgent: true, backgroundWriteThrough: false, agentMode: 'agent', files, dirs: [], openPaths: ['index.html'], activePath: 'index.html', dirty: {}, editBases: {}, pendingDiffs: [], chat: [], agentQueue: [], agentInbox: null, workspaceCwd: project, workspaceEpoch: 2, autoSaveDisk: false, autoPreview: false, llmProvider: 'custom', llmAuthMode: 'key', llmBaseUrl: base, llmModel: 'synthetic-tool-recovery', llmApiKey: '', llmContext: 32768, llmContextAuto: false, llmThinking: 'off', llmHardStopMin: 0, autoRunAgent: false, runLoop: false, graphLoop: false, testLoop: false, engineLoop: false, harnessAfterWrite: 'none', harnessAutoContinue: false, planWho: 'agent', agentRules: '' }), { project, files, base: `http://127.0.0.1:${server.address().port}/v1` });
  await page.locator('textarea').last().fill('Lies ui.js und teste Start in der HTML-Vorschau. Prüfe ausdrücklich, dass danach Running angezeigt wird. Keine Dateien ändern. Bei Werkzeugfehlern mit dem passenden Werkzeug weiterarbeiten.'); await page.locator('textarea').last().press('Enter');
  await until(() => held, 'corrected read and native preview test');
  const snapshot = () => page.evaluate(async () => (await window.anvilNative.agentJob('status')).state);
  const state = await snapshot(); assert.equal(state.status, 'running', state.error); assert.equal(state.steps.find(step => step.name === 'shell').status, 'err'); assert.equal(state.steps.find(step => step.name === 'read_file').status, 'ok');
  assert.deepEqual(state.mutationLedger, []); assert.equal(state.plan.every(step => step.status === 'ok'), true); assert.equal(state.lastPreview.input.assertions, 1);
  checks.push('same live job continues after rejected shell with read_file, native preview click and DOM assertion');
  assert.equal(state.workflow.operations.some(operation => operation.status === 'started'), false); checks.push('no ambiguous operation or unexecuted application test remains');
  assert.equal(await page.getByRole('dialog', { name: 'Auftragsdetails' }).count(), 0); checks.push('no additional confirmation window');
  await page.reload(); await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated()); assert.equal((await snapshot()).id, state.id); assert.equal(requests.length, 8); checks.push('renderer reload preserves the live job without replay');
  release(); release = undefined; await until(async () => (await snapshot()).status === 'done', 'honest completion'); await page.getByText(/TOOL_RECOVERY_OK:/).last().waitFor(); await page.getByText(/TOOL_RECOVERY_OK:/).last().scrollIntoViewIfNeeded();
  const final = await snapshot(); assert.equal(final.error, ''); assert.equal(final.verification.state, 'passed'); checks.push('completion uses the actual successful preview assertion');
  await page.screenshot({ path: path.join(output, 'completed-agent.png') });
  const preview = app.windows().find(window => window !== page && window.url().includes('/index.html')); assert.ok(preview); await preview.screenshot({ path: path.join(output, 'native-preview.png') });
  for (const [name, content] of Object.entries(files)) assert.equal(await readFile(path.join(project, name), 'utf8'), content); checks.push('project files remain byte-identical');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(issues, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, source: manifest.source, outputFingerprint: manifest.outputFingerprint, realModelInference: false, requests, checks, errors, consoleErrors, final: { id: final.id, status: final.status, plan: final.plan, verification: final.verification } }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, output }));
} catch (error) { if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, issues, requests, errors, consoleErrors }, null, 2)); throw error; }
finally { release?.(); if (app) { const timer = setTimeout(() => proc?.kill(), 8000); try { await app.close(); } catch { /* Only this isolated QA process. */ } clearTimeout(timer); } server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
