import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as socketServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { _electron } from 'playwright';
import { verifyBuild } from './build-fingerprint.mjs';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

// Real production window, independent worker, native writes and Node tests.
// Only model replies and concurrent user edits are controlled local fixtures.
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), name + ' needs a value');
  return path.resolve(process.argv[index + 1]);
};
const executable = argument('--executable');
const output = argument('--output', path.resolve('artifacts/file-conflicts-2026-10-30/desktop'));
await mkdir(output, { recursive: true });
const manifest = executable
  ? await verifyPackageFingerprint(path.join(path.dirname(executable), 'resources/app'))
  : await verifyBuild(process.cwd(), true);
const profile = await mkdtemp(path.join(output, 'profile-'));
const project = path.join(profile, 'synthetic-project');
await mkdir(project);

const INITIAL_CSS = '/* Artificial concurrent editing fixture. */\nbody {\n  background: #f5f5f5;\n}\n\nheader {\n  color: #223344;\n}\n';
const USER_CSS = INITIAL_CSS.replace('#f5f5f5', '#242323');
const STALE_CSS = INITIAL_CSS.replace('#f5f5f5', '#1a1a2e').replace('#223344', '#deadbe');
const HEADER_CSS = USER_CSS.replace('#223344', '#334455');
const FINAL_CSS = HEADER_CSS.replace('#334455', '#335577');
const DIRTY_CSS = HEADER_CSS + '\n/* USER_UNSAVED_NOTE: retain this exact editor draft. */\n';
const INITIAL_MODULE = "module.exports = { status: 'initial' };\n";
const FINAL_MODULE = "module.exports = { status: 'done' };\n";
const NOTES = '# Other work\n\nOTHER_WORK_CONTINUED_AFTER_PROTECTED_CONFLICT\n';
const TEST_SOURCE = [
  "const { test } = require('node:test');",
  "const assert = require('node:assert/strict');",
  "const { readFileSync } = require('node:fs');",
  "const path = require('node:path');",
  "const css = readFileSync(path.join(__dirname, 'styles.css'), 'utf8');",
  "test('manual body color remains exact', () => { assert.match(css, /background: #242323;/); assert.doesNotMatch(css, /#f5f5f5|#1a1a2e|#101010/); assert.equal((css.match(/background:/g) || []).length, 1); });",
  "test('unrelated header edit is applied', () => assert.match(css, /color: #335577;/));",
  "test('other files progress after blocked writes', () => { assert.equal(require('./result.cjs').status, 'done'); assert.match(readFileSync(path.join(__dirname, 'notes.md'), 'utf8'), /OTHER_WORK_CONTINUED_AFTER_PROTECTED_CONFLICT/); });",
  '',
].join('\n');
const steps = [
  'Update styles.css while preserving the user body background',
  'Implement result.cjs and notes.md',
  'Write preserve.test.cjs and run the tests',
  'Write TESTBERICHT.md',
];
const errors = [], consoleErrors = [], fixtureErrors = [], requests = [], checks = [], snapshots = [];
const gates = new Map(), receipts = new Map();
let app, page, companion;
const until = async (predicate, label) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Conflict desktop QA timed out: ' + label);
};
const freePort = async () => {
  const socket = socketServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
};
const port = await freePort(), companionPort = await freePort();
const evidence = stage => {
  const id = receipts.get(`conflict-qa-${stage}`)?.id;
  assert.ok(id, `stage ${stage} supplies a genuine evidence ID`);
  return id;
};
const update = (step, stages) => ({ updates: [{ step, status: 'ok', evidence: stages.map(evidence),
  reason: 'The referenced actual successful file acknowledgements and Node test execution support this step.' }] });
const receiptJson = stage => {
  const receipt = receipts.get(`conflict-qa-${stage}`);
  assert.ok(receipt, 'tool result reaches the model for stage ' + stage);
  return JSON.parse(receipt.text);
};
const assertConflict = (stage, kind) => {
  const result = receiptJson(stage);
  assert.equal(result.ok, false, 'the native refusal is not successful');
  assert.equal(result.definitelyNotExecuted, true, 'the rejected proposal did not mutate the project');
  assert.equal(result.fileConflict?.path, 'styles.css', 'this is the real file conflict, not a generic tool-policy rejection');
  assert.equal(result.fileConflict.kind, kind);
  return result;
};
const api = createServer(async (req, res) => {
  try {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'synthetic-file-conflict-qa' }] }));
      return;
    }
    assert.equal(req.url, '/v1/chat/completions');
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), stage = requests.length + 1;
    assert.equal(body.model, 'synthetic-file-conflict-qa');
    assert.ok(stage <= 22, 'completion reconciliation stays bounded and never restarts the fixture');
    for (const message of body.messages.filter(message => message.role === 'tool')) {
      const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      const match = text.match(/(?:"plan_evidence_id"\s*:\s*"|Plan evidence ID:\s*)(e\d+)/);
      receipts.set(message.tool_call_id, { text, ...(match ? { id: match[1] } : {}) });
    }
    requests.push({ stage, toolResults: [...receipts.keys()] });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if ([4, 5, 6, 9, 10, 19].includes(stage)) {
      await new Promise(resolve => { gates.set(stage, resolve); res.once('close', resolve); });
      if (res.destroyed) return;
    }
    let name, args;
    if (stage === 1) { name = 'set_plan'; args = { steps, kinds: ['edit', 'edit', 'check', 'report'] }; }
    if (stage === 2) { name = 'write_file'; args = { path: 'styles.css', content: INITIAL_CSS }; }
    if (stage === 3) { name = 'write_file'; args = { path: 'result.cjs', content: INITIAL_MODULE }; }
    if (stage === 4) { name = 'write_file'; args = { path: 'styles.css', content: STALE_CSS,
      overwrite_reason: 'Controlled stale full-file proposal on this tiny artificial CSS fixture; the existing user body edit must remain protected.' }; }
    if (stage === 5) { name = 'read_file'; args = { path: 'styles.css' }; }
    if (stage === 6) { name = 'edit_file'; args = { path: 'styles.css', old_string: 'color: #223344;', new_string: 'color: #334455;' }; }
    if (stage === 7) { name = 'edit_file'; args = { path: 'result.cjs', old_string: "status: 'initial'", new_string: "status: 'done'" }; }
    if (stage === 8) { name = 'edit_file'; args = { path: 'styles.css', old_string: 'background: #242323;', new_string: 'background: #101010;' }; }
    if (stage === 9) { name = 'write_file'; args = { path: 'notes.md', content: NOTES }; }
    if (stage === 10) { name = 'read_file'; args = { path: 'styles.css' }; }
    if (stage === 11) { name = 'edit_file'; args = { path: 'styles.css', old_string: 'color: #334455;', new_string: 'color: #335577;' }; }
    if (stage === 12) { name = 'set_plan'; args = update(1, [11]); }
    if (stage === 13) { name = 'set_plan'; args = update(2, [7, 9]); }
    if (stage === 14) { name = 'write_file'; args = { path: 'preserve.test.cjs', content: TEST_SOURCE }; }
    if (stage === 15) { name = 'run_file'; args = { path: 'preserve.test.cjs' }; }
    if (stage === 16) { name = 'set_plan'; args = update(3, [14, 15]); }
    if (stage === 17) {
      assert.match(receipts.get('conflict-qa-15')?.text || '', /RUN OK/);
      name = 'write_file'; args = { path: 'TESTBERICHT.md', content: '# File conflict QA\n\nTwo conflicting CSS proposals were rejected. The manual body background remains #242323. Independent header and module changes were saved. Three real Node function tests passed. The unsaved editor note is separate from the on-disk file and remains untouched. No remote model inference was performed.\n' };
    }
    if (stage === 18) { name = 'set_plan'; args = update(4, [17]); }
    const delta = stage >= 19
      ? { content: 'FILE_CONFLICT_QA_COMPLETE: Nutzerfarbe erhalten, unabhängige Änderungen gespeichert und drei Funktionstests erfolgreich. Die verworfenen Überschreibversuche wurden nicht ausgeführt.' }
      : { tool_calls: [{ index: 0, id: `conflict-qa-${stage}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
    res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: stage >= 19 ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
  } catch (error) {
    fixtureErrors.push(error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end('Synthetic conflict fixture assertion failed.');
  }
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${api.address().port}/v1`;
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort),
  ANVIL_COMPANION_TOKEN: 'file-conflict-qa-only', ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'companion-token'),
  ANVIL_QA_USER_DATA: profile, ANVIL_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
const result = { realModelInference: false, source: manifest.source, outputFingerprint: manifest.outputFingerprint,
  profile, project, checks, snapshots, errors, consoleErrors, fixtureErrors, requests };
const job = async () => (await page.evaluate(() => window.anvilNative.agentJob('status'))).state;
const waitGate = stage => until(async () => {
  if (gates.has(stage)) return true;
  const current = await job();
  if (current && ['failed', 'stopped', 'interrupted', 'done'].includes(current.status))
    throw Error(`Job terminated before fixture stage ${stage}: ${current.status}: ${current.error || ''}`);
  return false;
}, 'model request gate ' + stage);
const release = stage => { assert.ok(gates.has(stage), 'request gate exists: ' + stage); const resolve = gates.get(stage); gates.delete(stage); resolve(); };
const noConfirmationUi = async () => {
  assert.equal(await page.getByRole('dialog').count(), 0, 'no additional selection or confirmation dialog');
  assert.equal(await page.getByRole('region', { name: 'Gesamtabnahme', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^(Prüfergebnis speichern|Bestätigen|Freigeben)$/ }).count(), 0);
};
const snapshot = async (stage, image) => {
  const current = await job();
  snapshots.push({ stage, id: current.id, status: current.status, plan: current.plan, steps: current.steps,
    cssDraft: current.drafts['styles.css'], operation: current.operation });
  await noConfirmationUi();
  if (image) await page.screenshot({ path: path.join(output, image) });
  return current;
};
try {
  const companionScript = executable ? path.join(path.dirname(executable), 'resources/app/companion/server.mjs') : path.resolve('companion/server.mjs');
  companion = spawn(process.execPath, [companionScript], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let companionError = '';
  companion.on('error', error => { companionError += error.message; });
  companion.stderr.on('data', part => { companionError = (companionError + String(part)).slice(-6000); });
  await until(async () => {
    if (companion.exitCode !== null) throw Error('Isolated Companion exited: ' + companionError);
    try { return (await fetch(`http://127.0.0.1:${companionPort}/v1/ping`, { headers: { 'x-anvil-token': 'file-conflict-qa-only' }, signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, 'isolated Companion');
  app = await _electron.launch({ executablePath: executable || path.resolve('node_modules/electron/dist/electron.exe'), args: executable ? [] : [process.cwd()], env, timeout: 45000 });
  await app.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === '7845') {
      url.port = String(companionPort);
      return route.continue({ url: url.href, headers: { ...route.request().headers(), 'x-anvil-token': 'file-conflict-qa-only' } });
    }
    return [`http://127.0.0.1:${port}`, `http://127.0.0.1:${companionPort}`, new URL(base).origin].includes(url.origin)
      ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await until(() => { page = app.windows().find(window => window.url() === `http://127.0.0.1:${port}/`); return page; }, 'production window');
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 1040); window.setTitle('Anvil – isolierter Dateikonflikt-Test'); });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(({ project, base }) => {
    const ide = window.__anvilIde;
    ide.setState({ setupDone: true, settingsOpen: false, autoUpdate: false, companionKeep: false, locale: 'de', workspaceCwd: project, workspaceEpoch: 2,
      files: {}, dirs: [], openPaths: [], activePath: null, dirty: {}, pendingDiffs: [], chat: [],
      backgroundAgent: true, backgroundWriteThrough: true, agentMode: 'agent', planWho: 'agent', agentQueue: [], agentInbox: null,
      autoSaveDisk: false, autoPreview: false, autoRunAgent: false, runLoop: false, graphLoop: false, testLoop: false, engineLoop: false,
      harnessAutoContinue: false, llmContextAuto: false, llmContext: 131072, llmMaxOut: 16384, llmRetries: 1, mcpServers: [] });
    const state = ide.getState(); state.setLlmProvider('custom', 'key'); state.setLlmBaseUrl(base); state.setLlmModel('synthetic-file-conflict-qa'); state.setLlmApiKey(''); state.setLlmThinking('off');
    ide.setState({ llmContextAuto: false, llmContext: 131072, llmMaxOut: 16384, llmRetries: 1 });
  }, { project, base });
  const prompt = 'Create a small artificial CSS and CommonJS example with styles.css, result.cjs and notes.md. Retain any concurrent user changes exactly, apply only unrelated header/code changes, and keep working after a rejected CSS proposal. Write preserve.test.cjs and run its three function tests, then save TESTBERICHT.md. The controlled fixture includes blocked stale and protected-line proposals; these must not overwrite user content. Use a concrete checklist with the four corresponding steps. Complete the work autonomously using the existing interface. This local transport fixture uses deterministic replies.';
  await page.locator('textarea').last().fill(prompt); await page.locator('textarea').last().press('Enter');

  await waitGate(4);
  assert.equal(await readFile(path.join(project, 'styles.css'), 'utf8'), INITIAL_CSS);
  assert.equal(await readFile(path.join(project, 'result.cjs'), 'utf8'), INITIAL_MODULE);
  await writeFile(path.join(project, 'styles.css'), USER_CSS);
  await page.evaluate(css => {
    const ide = window.__anvilIde, current = ide.getState();
    ide.setState({ files: { ...current.files, 'styles.css': css }, dirty: { ...current.dirty, 'styles.css': false }, activePath: 'styles.css', openPaths: [...new Set([...current.openPaths, 'styles.css'])] });
  }, USER_CSS);
  checks.push('A genuine on-disk user edit occurs after the worker acknowledged its initial CSS snapshot');
  release(4);

  await waitGate(5);
  assertConflict(4, 'changed');
  const firstConflict = await snapshot(5, 'stale-write-blocked.png');
  assert.equal(firstConflict.status, 'running', firstConflict.error);
  assert.equal(firstConflict.drafts['styles.css'].applied, false);
  assert.ok(firstConflict.drafts['styles.css'].conflict, 'conflicting proposal is explicitly marked');
  assert.equal(await readFile(path.join(project, 'styles.css'), 'utf8'), USER_CSS);
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['styles.css']), USER_CSS);
  checks.push('The native stale write is rejected without stopping the worker or replacing saved editor/disk content');
  release(5);

  await waitGate(6);
  const currentRead = receipts.get('conflict-qa-5')?.text || '';
  assert.match(currentRead, /#242323/);
  assert.doesNotMatch(currentRead, /#f5f5f5/);
  assert.equal((await job()).status, 'running');
  checks.push('Actual read_file refresh delivers the current user-edited source to the independent worker');
  release(6);

  await waitGate(9);
  assertConflict(8, 'protected');
  await until(async () => (await page.evaluate(() => window.__anvilIde.getState().files['result.cjs'])) === FINAL_MODULE, 'renderer adopts the confirmed module write');
  const protectedConflict = await snapshot(9, 'protected-line-blocked.png');
  assert.equal(protectedConflict.status, 'running', protectedConflict.error);
  assert.equal(await readFile(path.join(project, 'styles.css'), 'utf8'), HEADER_CSS);
  assert.equal(await readFile(path.join(project, 'result.cjs'), 'utf8'), FINAL_MODULE);
  const visible = await page.evaluate(() => ({ css: window.__anvilIde.getState().files['styles.css'], module: window.__anvilIde.getState().files['result.cjs'] }));
  assert.match(visible.css, /#242323/);
  assert.doesNotMatch(visible.css, /#1a1a2e|#101010/);
  assert.equal(visible.module, FINAL_MODULE);
  checks.push('An unrelated header/module edit succeeds, but rereading does not authorize changing the protected user color');
  await page.evaluate(css => {
    const ide = window.__anvilIde, current = ide.getState();
    ide.setState({ files: { ...current.files, 'styles.css': css }, dirty: { ...current.dirty, 'styles.css': true } });
  }, DIRTY_CSS);
  release(9);

  await waitGate(10);
  assert.equal(await readFile(path.join(project, 'notes.md'), 'utf8'), NOTES);
  assert.equal((await job()).status, 'running');
  checks.push('Another file is genuinely saved after the protected-line refusal without a confirmation step');
  release(10);

  await waitGate(19);
  await until(async () => page.evaluate(() => { const p = window.__anvilIde.getState().chat.findLast(m => m.role === 'assistant')?.plan; return p?.length === 4 && p.every(s => s.status === 'ok'); }), 'renderer adopts the confirmed checklist');
  const beforeCompletion = await snapshot(19, 'work-continued-tests-passed.png');
  assert.equal(beforeCompletion.plan.length, 4);
  assert.ok(beforeCompletion.plan.every(step => step.status === 'ok'), JSON.stringify(beforeCompletion.plan));
  assert.equal(await readFile(path.join(project, 'styles.css'), 'utf8'), FINAL_CSS);
  assert.match(receipts.get('conflict-qa-15')?.text || '', /RUN OK/);
  const editor = await page.evaluate(() => ({ content: window.__anvilIde.getState().files['styles.css'], dirty: window.__anvilIde.getState().dirty['styles.css'] }));
  assert.equal(editor.content, DIRTY_CSS, 'later successful native write leaves the unsaved editor draft exact');
  assert.equal(editor.dirty, true);
  checks.push('Three real Node tests pass with the user color intact, while a later native edit leaves the separate dirty editor copy unchanged');
  release(19);
  await until(async () => ['done', 'failed', 'stopped', 'interrupted'].includes((await job())?.status), 'final task result');
  const final = await job();
  assert.equal(final.status, 'done', final.error);
  assert.equal(final.verification?.state, 'passed', JSON.stringify(final.verification));
  assert.match(final.verification.detail, /preserve\.test\.cjs.*3\/3 Tests bestanden/);
  assert.match(final.text, /FILE_CONFLICT_QA_COMPLETE/);
  assert.match(final.text, /preserve\.test\.cjs.*3\/3 Tests bestanden/);
  assert.equal(final.steps.filter(step => step.name === 'run_file').length, 1, 'one actual test execution, no replay');
  const nativeRefusals = final.steps.filter(step => step.status === 'err' && ['write_file', 'edit_file'].includes(step.name));
  assert.equal(nativeRefusals.length, 2, 'exactly the controlled stale and protected writes fail');
  assert.equal(await readFile(path.join(project, 'styles.css'), 'utf8'), FINAL_CSS);
  await page.locator('[data-chat-msg]').filter({ hasText: 'FILE_CONFLICT_QA_COMPLETE:' }).last().waitFor({ state: 'visible' });
  await noConfirmationUi();
  await page.screenshot({ path: path.join(output, 'completed-with-user-change.png') });
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(fixtureErrors, []);
  checks.push('The same job completes with current named test results, two honest rejected proposals, and no extra confirmation dialog');
  result.finalJob = { id: final.id, status: final.status, verification: final.verification, text: final.text, plan: final.plan, steps: final.steps };
  result.finalDiskCss = FINAL_CSS;
  result.finalEditor = editor;
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const resolve of gates.values()) resolve();
  if (page && !result.ok) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    result.body = await page.locator('body').innerText().catch(() => '');
    result.observedJob = await job().catch(() => null);
  }
  result.receipts = Object.fromEntries(receipts);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  if (companion && companion.exitCode === null) {
    const closed = new Promise(resolve => companion.once('exit', resolve));
    companion.kill(); await closed;
  }
  api.closeAllConnections();
  await new Promise(resolve => api.close(resolve));
}
console.log(JSON.stringify({ ok: result.ok, checks, error: result.error, output }, null, 2));
