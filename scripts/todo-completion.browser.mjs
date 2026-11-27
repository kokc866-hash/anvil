import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as socketServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { _electron } from 'playwright';
import { verifyBuild } from './build-fingerprint.mjs';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

// Genuine production UI, independent worker, disk writes and Node tests.
// Only the model is a deterministic local SSE fixture; no remote inference.
const outputArgument = process.argv.indexOf('--output');
const output = path.resolve(outputArgument >= 0 ? process.argv[outputArgument + 1] : 'artifacts/todo-fix-2026-10-27/desktop');
await mkdir(output, { recursive: true });
const flag = process.argv.indexOf('--executable');
const executable = flag < 0 ? undefined : path.resolve(process.argv[flag + 1]);
const manifest = executable ? await verifyPackageFingerprint(path.join(path.dirname(executable), 'resources/app')) : await verifyBuild(process.cwd(), true);
const profile = await mkdtemp(path.join(output, 'profile-'));
const project = path.join(profile, 'synthetic-project');
await mkdir(project);
const errors = [], consoleErrors = [], fixtureErrors = [], requests = [], checks = [], snapshots = [], gates = new Map(), receipts = new Map();
let app, page, companion;
let continuationProbe = false, continuationHeld = false, continuationClosed = false;
const until = async (predicate, label) => {
  const end = Date.now() + 60000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error('To-do desktop QA timed out: ' + label);
};
const freePort = async () => {
  const socket = socketServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
};
const port = await freePort(), companionPort = await freePort();
const testSource = expected => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './model.js';\ntest('addition', () => assert.equal(add(2, 3), ${expected}));\n`;
const evidence = stage => { const id = receipts.get(`qa-${stage}`)?.id; assert.ok(id, `tool result for stage ${stage} contains its genuine evidence ID`); return id; };
const update = (step, stages) => ({ updates: [{ step, status: 'ok', evidence: stages.map(evidence), reason: 'The referenced actual file acknowledgements and execution cover this step.' }] });
const steps = ['Implement model.js and store.js', 'Implement index.html and ui.js', 'Write counter.test.js and run the tests', 'Write TESTBERICHT.md'];
const api = createServer(async (req, res) => {
  try {
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'synthetic-todo-qa' }] })); return; }
    assert.equal(req.url, '/v1/chat/completions');
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), stage = requests.length + 1;
    if (continuationProbe) {
      assert.match(String(body.messages.findLast(message => message.role === 'user')?.content), /mach weiter/);
      requests.push({ probe: 'concrete-continuation', model: body.model });
      continuationHeld = true;
      await new Promise(resolve => res.once('close', () => { continuationClosed = true; resolve(); }));
      return;
    }
    for (const message of body.messages.filter(message => message.role === 'tool')) {
      const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      const match = text.match(/(?:"plan_evidence_id"\s*:\s*"|Plan evidence ID:\s*)(e\d+)/);
      receipts.set(message.tool_call_id, { ...(match ? { id: match[1] } : {}), text });
    }
    const lastUser = body.messages.findLast(message => message.role === 'user')?.content;
    requests.push({ stage, toolResults: [...receipts.keys()], ...(stage > 19 ? { lastUser } : {}) });
    assert.ok(stage <= 21, 'at most two bounded verification reminders, never a replay loop');
    if (stage > 19) assert.doesNotMatch(String(lastUser), /Vor der Abschlussantwort die sichtbare To-do-Liste abgleichen/, 'a fully acknowledged checklist needs no further reconciliation');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if ([3, 5, 6, 8, 13, 17, 19].includes(stage)) {
      await new Promise(resolve => { gates.set(stage, resolve); res.once('close', resolve); });
      if (res.destroyed) return;
    }
    let name, args;
    if (stage === 1) { name = 'set_plan'; args = { steps, kinds: ['edit', 'edit', 'check', 'report'] }; }
    if (stage === 2) { name = 'write_file'; args = { path: 'package.json', content: '{"type":"module","private":true}\n' }; }
    if (stage === 3) { name = 'write_file'; args = { path: 'model.js', content: 'export const add = (a, b) => a + b;\n' }; }
    if (stage === 4) { name = 'write_file'; args = { path: 'store.js', content: 'export const store = new Map();\n' }; }
    if (stage === 5) { name = 'set_plan'; args = update(2, [2, 3, 4]); }
    if (stage === 6) { name = 'set_plan'; args = update(1, [3, 4]); }
    if (stage === 7) { name = 'write_file'; args = { path: 'index.html', content: '<!doctype html><title>Counter QA</title><h1>Counter QA</h1><output id="counter"></output><script type="module" src="./ui.js"></script>\n' }; }
    if (stage === 8) { name = 'write_file'; args = { path: 'ui.js', content: 'import { add } from "./model.js";\ndocument.querySelector("#counter").textContent = String(add(2, 3));\n' }; }
    if (stage === 9) { name = 'set_plan'; args = update(2, [7, 8]); }
    if (stage === 10) { name = 'write_file'; args = { path: 'counter.test.js', content: testSource(6) }; }
    if (stage === 11) { name = 'run_file'; args = { path: 'counter.test.js' }; }
    if (stage === 12) { name = 'set_plan'; args = update(3, [10, 11]); }
    if (stage === 13) { name = 'read_file'; args = { path: 'counter.test.js' }; }
    if (stage === 14) { name = 'edit_file'; args = { path: 'counter.test.js', old_string: 'add(2, 3), 6', new_string: 'add(2, 3), 5' }; }
    if (stage === 15) { name = 'run_file'; args = { path: 'counter.test.js' }; }
    if (stage === 16) { name = 'set_plan'; args = update(3, [14, 15]); }
    if (stage === 17) { name = 'write_file'; args = { path: 'TESTBERICHT.md', content: '# QA report\n\nThe first deliberately incorrect assertion failed. After the authorized assertion correction, the real Node function test passed. Browser behavior was not tested by the agent.\n' }; }
    if (stage === 18) { name = 'set_plan'; args = update(4, [17]); }
    const delta = stage >= 19 ? { content: 'TODO_QA_COMPLETE: Dateien gespeichert und Funktionstest erfolgreich. Die Browserfunktion wurde nicht geprüft.' }
      : { tool_calls: [{ index: 0, id: `qa-${stage}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
    res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: stage >= 19 ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
  } catch (error) { fixtureErrors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end('Synthetic fixture error.'); }
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${api.address().port}/v1`;
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort),
  ANVIL_COMPANION_TOKEN: 'todo-qa-only', ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'companion-token'),
  ANVIL_QA_USER_DATA: profile, ANVIL_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
const result = { realModelInference: false, source: manifest.source, outputFingerprint: manifest.outputFingerprint, profile, project, checks, snapshots, errors, consoleErrors, fixtureErrors, requests };
const job = async () => (await page.evaluate(() => window.anvilNative.agentJob('status'))).state;
const release = stage => { assert.ok(gates.has(stage)); const resolve = gates.get(stage); gates.delete(stage); resolve(); };
const inspect = async (stage, expectedDone, screenshot) => {
  await until(() => gates.has(stage), 'request gate ' + stage);
  await until(async () => {
    const state = await job();
    return state?.plan?.length === 4 && state.plan.every((step, i) => (step.status === 'ok') === expectedDone.includes(i));
  }, 'matching worker checklist ' + stage);
  const state = await job();
  await until(() => page.evaluate(expected => {
    const state = window.__anvilIde.getState();
    const message = state.chat.findLast(message => message.backgroundJobId === expected.id);
    return message?.plan?.length === 4 && message.plan.every((step, i) => (step.status === 'ok') === expected.done.includes(i))
      && expected.steps.every(step => message.steps?.some(shown => shown.id === step.id && shown.status === step.status));
  }, { id: state.id, done: expectedDone, steps: state.steps.map(({ id, status }) => ({ id, status })) }), 'matching renderer checklist and tool outcomes ' + stage);
  snapshots.push({ stage, status: state.status, plan: state.plan, steps: state.steps });
  const todo = page.getByRole('button', { name: new RegExp(`^To-do\\s*${expectedDone.length}/4`) }).last();
  await todo.waitFor({ state: 'visible' });
  if (await todo.getAttribute('aria-expanded') === 'false') await todo.click();
  await page.getByRole('button', { name: /Implement index\.html and ui\.js/ }).last().waitFor({ state: 'visible' });
  if (screenshot) await page.screenshot({ path: path.join(output, screenshot) });
};
try {
  const companionScript = executable ? path.join(path.dirname(executable), 'resources/app/companion/server.mjs') : path.resolve('companion/server.mjs');
  companion = spawn(process.execPath, [companionScript], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let companionError = ''; companion.on('error', error => { companionError += error.message; }); companion.stderr.on('data', part => { companionError += String(part).slice(0, 2000); });
  await until(async () => {
    if (companion.exitCode !== null) throw Error('Isolated Companion exited: ' + companionError);
    try { return (await fetch(`http://127.0.0.1:${companionPort}/v1/ping`, { headers: { 'x-anvil-token': 'todo-qa-only' }, signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, 'isolated Companion');
  app = await _electron.launch({ executablePath: executable || path.resolve('node_modules/electron/dist/electron.exe'), args: executable ? [] : [process.cwd()], env, timeout: 45000 });
  await app.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === '7845') { url.port = String(companionPort); return route.continue({ url: url.href, headers: { ...route.request().headers(), 'x-anvil-token': 'todo-qa-only' } }); }
    return [`http://127.0.0.1:${port}`, `http://127.0.0.1:${companionPort}`, new URL(base).origin].includes(url.origin) ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await until(() => { page = app.windows().find(window => window.url() === `http://127.0.0.1:${port}/`); return page; }, 'production window');
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 1000); window.setTitle('Anvil – isolierter To-do-Test'); });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(({ project, base }) => {
    const ide = window.__anvilIde;
    ide.setState({ setupDone: true, settingsOpen: false, autoUpdate: false, companionKeep: false, locale: 'de', workspaceCwd: project, workspaceEpoch: 2,
      files: {}, dirs: [], openPaths: [], activePath: null, dirty: {}, pendingDiffs: [], chat: [],
      backgroundAgent: true, backgroundWriteThrough: true, agentMode: 'agent', planWho: 'agent', agentQueue: [], agentInbox: null,
      autoSaveDisk: false, autoPreview: false, autoRunAgent: false, runLoop: false, graphLoop: false, testLoop: false, engineLoop: false,
      harnessAutoContinue: false, llmContextAuto: false, llmContext: 131072, llmMaxOut: 16384, llmRetries: 1, mcpServers: [] });
    const state = ide.getState(); state.setLlmProvider('custom', 'key'); state.setLlmBaseUrl(base); state.setLlmModel('synthetic-todo-qa'); state.setLlmApiKey('');
    ide.setState({ llmContextAuto: false, llmContext: 131072, llmMaxOut: 16384, llmRetries: 1 });
  }, { project, base });
  const prompt = 'Create a small artificial counter example with model.js, store.js, a static index.html and ui.js. Write counter.test.js and run it, then save TESTBERICHT.md. For this QA task deliberately use a failing addition assertion first, inspect the failure, then correct that assertion and rerun. This test correction is authorized. Do not claim browser interaction was tested. Use a checklist with the four corresponding steps.';
  await page.locator('textarea').last().fill(prompt); await page.locator('textarea').last().press('Enter');
  await inspect(3, [], 'metadata-not-implementation.png'); checks.push('A saved package.json checks neither the data-module step nor the UI step'); release(3);
  await inspect(5, [], null); checks.push('Two data module writes do not auto-certify the separate UI or their descriptive multi-file step'); release(5);
  await inspect(6, [], 'wrong-evidence-rejected.png');
  assert.match(receipts.get('qa-5')?.text || '', /does not cover every named file/); checks.push('The actual worker rejects unrelated evidence IDs for the UI step'); release(6);
  await inspect(8, [0], 'partial-ui-still-open.png'); checks.push('Confirmed data modules are checked while partial UI work stays open'); release(8);
  await inspect(13, [0, 1], 'failed-test-still-open.png');
  assert.match(receipts.get('qa-11')?.text || '', /RUN FAIL|not ok|failed/i);
  assert.match(receipts.get('qa-12')?.text || '', /failed|contradicted/); checks.push('A genuine failing Node test and a rejected success update leave the test step unchecked'); release(13);
  await inspect(17, [0, 1, 2], 'passing-test-report-open.png');
  assert.match(receipts.get('qa-15')?.text || '', /RUN OK/); checks.push('Only the corrected, genuinely passing function test checks the test step; the unsaved report stays open'); release(17);
  await inspect(19, [0, 1, 2, 3], null); release(19);
  await until(async () => (await job())?.status === 'done', 'completed job');
  await page.locator('[data-chat-msg]').filter({ hasText: 'TODO_QA_COMPLETE:' }).last().waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'all-confirmed.png') });
  const final = await job();
  assert.match(final.verification.detail, /counter\.test\.js.*1\/1 Tests bestanden/);
  assert.match(final.text, /counter\.test\.js.*1\/1 Tests bestanden/);
  checks.push('The visible completion includes the current named Node test and its actual framework count');
  assert.equal(final.steps.filter(step => step.name === 'run_file').length, 2, 'only one failing and one passing execution; no hidden repair replay');
  assert.equal(final.steps.filter(step => step.name === 'write_file').length, 7, 'each requested file is written exactly once');
  assert.equal(final.steps.filter(step => step.name === 'edit_file').length, 1, 'only the authorized assertion correction is applied');
  for (const file of ['package.json', 'model.js', 'store.js', 'index.html', 'ui.js', 'counter.test.js', 'TESTBERICHT.md']) assert.ok((await readFile(path.join(project, file), 'utf8')).length > 0, file + ' actually saved');
  checks.push('All four steps are checked only after the actual writes and successful test, with the report on disk');
  result.finalJob = { id: final.id, status: final.status, plan: final.plan, steps: final.steps };
  const originalTask = await readFile('fixtures/workshop-task.txt', 'utf8');
  const concretePlan = originalTask.split(/\r?\n/).filter(line => /^\d+\. /.test(line))
    .map((line, i) => ({ text: line.replace(/^\d+\. /, ''), status: i === 0 ? 'ok' : 'todo', kind: 'edit', ...(i === 0 ? { completedBy: 'agent' } : {}) }));
  assert.equal(concretePlan.length, 12);
  await page.waitForFunction(() => !window.__anvilIde.getState().agentBusy);
  await page.evaluate(({ originalTask, plan }) => window.__anvilIde.setState({ planWho: 'helper',
    chat: [{ id: 'continue-user', role: 'user', content: originalTask, at: Date.now() - 2000 },
      { id: 'continue-reply', role: 'assistant', content: 'Die erste Anforderung ist bearbeitet; weitere Arbeit steht aus.', plan, planLocked: false, at: Date.now() - 1000 }] }),
    { originalTask, plan: concretePlan });
  continuationProbe = true;
  await page.locator('textarea').last().fill('mach weiter'); await page.locator('textarea').last().press('Enter');
  await until(() => continuationHeld, 'continuation reaches the real worker request');
  const continued = await job();
  assert.notEqual(continued.id, final.id);
  assert.deepEqual(continued.plan, concretePlan, 'helper mode must preserve every concrete requirement and acknowledged progress');
  const continuedTodo = page.getByRole('button', { name: /^To-do\s*1\/12/ }).last();
  await continuedTodo.waitFor({ state: 'visible' });
  if (await continuedTodo.getAttribute('aria-expanded') === 'false') await continuedTodo.click();
  await page.getByRole('button', { name: /Bei schmalen Fenstern weiterhin gut bedienbar bleiben/ }).last().waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('dialog').count(), 0, 'short continuation needs no new selection or confirmation dialog');
  await page.screenshot({ path: path.join(output, 'concrete-continuation.png') });
  checks.push('Actual short continuation in helper mode preserves all twelve visible requirements and the confirmed first step without a dialog');
  result.continuedJob = { id: continued.id, status: continued.status, plan: continued.plan };
  await page.getByRole('button', { name: 'Stoppen', exact: true }).click();
  await until(async () => (await job())?.status === 'stopped', 'controlled synthetic continuation stopped');
  await until(() => continuationClosed, 'controlled fixture request closed');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(fixtureErrors, []);
  result.ok = true;
} catch (error) { result.ok = false; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  for (const resolve of gates.values()) resolve();
  if (page && !result.ok) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); result.body = await page.locator('body').innerText().catch(() => ''); }
  result.receipts = Object.fromEntries(receipts);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  if (companion && companion.exitCode === null) { const closed = new Promise(resolve => companion.once('exit', resolve)); companion.kill(); await closed; }
  api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
}
console.log(JSON.stringify({ ok: result.ok, checks, error: result.error, output }, null, 2));
