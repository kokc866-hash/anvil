import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as socketServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from 'playwright';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';
import { verifyBuild } from './build-fingerprint.mjs';

// Optional arguments: packaged EXE, output directory. The default tests the fresh source desktop build.
const packaged = Boolean(process.argv[2]);
const executable = path.resolve(process.argv[2] || 'node_modules/electron/dist/electron.exe');
const manifest = packaged ? await verifyPackageFingerprint(path.join(path.dirname(executable), 'resources/app')) : await verifyBuild(process.cwd(), true);
const output = path.resolve(process.argv[3] || 'artifacts/agent-no-acceptance-desktop');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const project = 'acceptance-free-qa', legacyId = 'legacy-stopped-qa';
const oldWorkflow = { schema: 1, id: 'legacy-workflow', inputStamp: '', definitionStamp: '', phase: 'act', nodes: [], changed: [],
  operations: [{ id: 'legacy-workflow:1', name: 'mcp_call', fingerprint: 'a'.repeat(64), effectFingerprint: 'b'.repeat(64), inputStamp: '', status: 'unclear', target: 'execute_code', external: true, at: 1, recovery: { mode: 'skip', at: 2 } }],
  planProgress: JSON.stringify({ version: 1, revision: 0, nextEvidenceId: 1, evidence: [], plan: [], acceptance: { obsolete: true } }) };
await mkdir(path.join(profile, 'agent-jobs'));
const legacyJob = { schema: 1, id: legacyId, project, revision: 1, draftRevision: 0,
  status: 'stopped', startedAt: Date.now() - 10000, finishedAt: Date.now(), prompt: 'Read notes.txt and explain it briefly. Do not make changes.', images: [],
  text: 'Gesamtabnahme: Nicht bestanden. Alte Pflichtprüfung.\n\nGesicherter Zwischenstand.', thinking: '', steps: [], plan: [], drafts: {}, directoryChanges: {},
  execution: true, writeThrough: false, dismissed: false, error: 'Der Ausgang einer gestarteten externen Aktion ist unbestätigt. Vor dem Abschließen zuerst beim Dienst oder im Werkzeugprotokoll prüfen.', connection: 'Lokale API', workflow: oldWorkflow,
  operation: { id: 1, kind: 'mcp', name: 'execute_code', digest: 'a'.repeat(64), status: 'interrupted' },
  acceptance: { state: 'failed', criteria: [{ id: 'legacy' }] }, recoveryBlockedActions: ['mcp:execute_code'], blockedMutations: ['a'.repeat(64)], mutationLedger: [] };
async function freePort() { const s = socketServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
const port = await freePort(), companionPort = await freePort();
const checks = [], errors = [], consoleErrors = [], requests = [], fixtureErrors = [];
let holdNext = false, held = false, heldClosed = false, responseCount = 0;
const api = createServer(async (req, res) => {
  try {
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'synthetic-no-acceptance' }] })); return; }
    assert.equal(req.url, '/v1/chat/completions');
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    assert.doesNotMatch(JSON.stringify(body.messages), /Binding task acceptance|anvil_acceptance|criteria_change_reason/);
    assert.ok(body.tools.every(t => !Object.hasOwn(t.function.parameters.properties || {}, 'criteria')));
    requests.push({ model: body.model, lastRole: body.messages.at(-1).role, lastToolContent: body.messages.at(-1).role === 'tool' ? body.messages.at(-1).content : undefined });
    if (holdNext) { holdNext = false; held = true; await new Promise(r => res.once('close', () => { heldClosed = true; r(); })); return; }
    const isResult = body.messages.at(-1).role === 'tool';
    if (isResult) assert.ok(body.messages.at(-1).content.includes('Artificial note'));
    const delta = isResult ? { content: `NO_ASSESSMENT_OK ${++responseCount}: Artificial note read.` }
      : { tool_calls: [{ index: 0, id: 'read-note', type: 'function', function: { name: 'read_file', arguments: '{"path":"notes.txt"}' } }] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: isResult ? 'stop' : 'tool_calls' }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
  } catch (e) { fixtureErrors.push(e.message); if (!res.headersSent) res.writeHead(500); res.end('Fixture assertion failed.'); }
});
await new Promise(r => api.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${api.address().port}/v1`;
// The legacy acceptance fields are intentional; an absent model binding is not.
// Resume must retain the same synthetic provider/model/URL as the original job.
await writeFile(path.join(profile, 'agent-jobs', 'latest.json'), JSON.stringify({ ...legacyJob,
  modelTarget: { provider: 'custom', model: 'synthetic-no-acceptance', baseUrl: base } }));
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort),
  ANVIL_COMPANION_TOKEN: 'no-acceptance-qa', ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'companion-token'), ANVIL_QA_USER_DATA: profile, ANVIL_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
const result = { profile, source: manifest.source, outputFingerprint: manifest.outputFingerprint, checks, errors, consoleErrors, requests, fixtureErrors, realModelInference: false };
let app, page;
const until = async (test, label) => { for (let n = 0; n < 300; n++) { if (await test()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Desktop QA timeout: ' + label); };
async function state() { return (await page.evaluate(() => window.anvilNative.agentJob('status'))).state; }
async function finishedAfter(id) {
  await until(async () => { const s = await state(); return s.id !== id && ['done', 'failed', 'interrupted'].includes(s.status); }, 'next task completed');
  const s = await state(); assert.equal(s.status, 'done', s.error); assert.ok(s.text.startsWith('NO_ASSESSMENT_OK')); assert.equal(Object.hasOwn(s, 'acceptance'), false);
  await page.waitForFunction(() => !window.__anvilIde.getState().agentBusy);
  return s;
}
async function noReviewUi() {
  assert.equal(await page.getByRole('region', { name: 'Gesamtabnahme', exact: true }).count(), 0);
  assert.equal(await page.getByRole('region', { name: 'Hintergrundauftrag', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Auftragsdetails öffnen', exact: true }).count(), 0);
  assert.equal(await page.getByRole('dialog', { name: 'Auftragsdetails', exact: true }).count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /Gesamtabnahme:|Prüfergebnis speichern|Frühere Aktion selbst klären|Letzte Aktion selbst bestätigen|Vor dem Abschließen zuerst/);
}
try {
  app = await _electron.launch({ executablePath: executable, args: packaged ? [] : [process.cwd()], env, timeout: 45000 });
  await app.context().route('**/*', route => {
    const req = route.request(), url = new URL(req.url()), target = req.headers()['x-anvil-target'];
    if (target && new URL(target).origin === new URL(base).origin) return route.continue();
    if (url.origin === `http://127.0.0.1:${port}`) return route.continue();
    return route.fulfill({ status: 200, contentType: req.resourceType() === 'script' ? 'application/javascript' : req.resourceType() === 'stylesheet' ? 'text/css' : 'application/json', body: ['script', 'stylesheet'].includes(req.resourceType()) ? '' : '{}' });
  });
  await until(() => { page = app.windows().find(w => w.url() === `http://127.0.0.1:${port}/`); return page; }, 'window');
  page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.waitForFunction(() => document.readyState === 'complete' && window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1080));
  await page.evaluate(({ project, base, workflow }) => {
    const ide = window.__anvilIde;
    ide.setState({ setupDone: true, settingsOpen: false, autoUpdate: false, companionKeep: false, locale: 'de', workspaceCwd: '', memoryWorkspace: project,
      workspaceEpoch: 2, files: { 'notes.txt': 'Artificial note. No personal data.' }, dirs: [], openPaths: [], activePath: null, dirty: {}, pendingDiffs: [],
      backgroundAgent: true, backgroundWriteThrough: false, agentMode: 'agent', agentQueue: [], agentInbox: null, agentBusy: false, agentJob: null,
      autoSaveDisk: false, autoPreview: false, autoRunAgent: false, runLoop: false, graphLoop: false, testLoop: false, engineLoop: false, harnessAutoContinue: false, planWho: 'agent',
      llmContextAuto: false, llmContext: 32768, llmRetries: 1, llmMaxOut: 1024, mcpServers: [],
      chat: [{ id: 'old-user', role: 'user', content: 'Read the artificial note.', at: Date.now() - 10000 },
        { id: 'old-reply', role: 'assistant', content: 'Gesamtabnahme: Nicht bestanden. Alte Pflichtprüfung.\n\nGesicherter Zwischenstand.', acceptance: { state: 'failed' }, workflow, at: Date.now() - 9000 }] });
    const s = ide.getState(); s.setLlmProvider('custom', 'key'); s.setLlmBaseUrl(base); s.setLlmModel('synthetic-no-acceptance'); s.setLlmApiKey(''); s.setLlmThinking('off');
  }, { project, base, workflow: oldWorkflow });
  const resume = page.getByRole('button', { name: 'Fortsetzen', exact: true }); await resume.waitFor();
  await noReviewUi(); await page.screenshot({ path: path.join(output, 'legacy-without-panel.png') });
  checks.push('Older stopped task has no continuation card, details dialog, outcome fields or confirmation checkbox');
  await resume.click();
  let done = await finishedAfter(legacyId); await noReviewUi();
  checks.push('One-click resume completes two real worker tool turns without certifying the earlier service outcome');
  let previous = done.id;
  const retainedJobId = (await page.evaluate(() => window.anvilNative.agentJob('status'))).jobId;
  const input = page.locator('textarea').last(); await input.fill('Read notes.txt again. Do not make changes.'); await input.press('Enter');
  done = await finishedAfter(previous); await noReviewUi();
  const retainedPath = retainedJobId === 'legacy' ? path.join(profile, 'agent-jobs', 'latest.json')
    : path.join(profile, 'agent-jobs', 'jobs', retainedJobId, 'latest.json');
  const retained = JSON.parse(await readFile(retainedPath, 'utf8'));
  assert.equal(retained.id, previous); assert.equal(retained.text, `NO_ASSESSMENT_OK 1: Artificial note read.`);
  checks.push('Next chat message starts directly; the prior job remains separately saved without confirmation');
  previous = done.id;
  await page.locator('[data-chat-msg]').last().hover();
  await page.locator('[data-chat-msg]').last().getByRole('button', { name: 'Wiederholen', exact: true }).click();
  done = await finishedAfter(previous); await noReviewUi();
  checks.push('Actual Repeat button starts the next task without finishing or confirming the previous one');
  holdNext = true; previous = done.id; await input.fill('Read notes.txt for the controlled stop test.'); await input.press('Enter');
  await until(() => held, 'held model request');
  await page.getByRole('button', { name: 'Stoppen', exact: true }).click();
  await until(async () => (await state()).status === 'stopped', 'stopped task');
  await until(() => heldClosed, 'owned HTTP connection closed');
  const stopped = await state(); assert.notEqual(stopped.id, previous);
  await page.getByRole('button', { name: 'Fortsetzen', exact: true }).waitFor();
  await input.press('Enter');
  done = await finishedAfter(stopped.id); await noReviewUi();
  checks.push('Real Stop closes the owned request; Resume starts new work directly without review');
  await page.screenshot({ path: path.join(output, 'finished-chat.png') });
  assert.equal(responseCount, 4); assert.equal(requests.length, 9);
  await page.evaluate(() => window.__anvilIde.setState({ backgroundAgent: false, agentJob: null, pendingAsk: null, agentInbox: null, agentQueue: [], dirty: {}, pendingDiffs: [] }));
  await input.fill('Read notes.txt and explain it briefly.'); await input.press('Enter');
  await page.waitForFunction(() => !window.__anvilIde.getState().agentBusy && window.__anvilIde.getState().chat.some(m => m.role === 'assistant' && m.content.includes('NO_ASSESSMENT_OK 5')));
  await noReviewUi();
  assert.equal(responseCount, 5); assert.equal(requests.length, 11);
  checks.push('Foreground chat also completes real tool turns without an acceptance verdict or confirmation fields');
  await page.screenshot({ path: path.join(output, 'foreground-chat.png') });
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(fixtureErrors, []);
  result.ok = true;
} catch (e) { result.ok = false; result.error = { message: e.message, stack: e.stack }; process.exitCode = 1; }
finally {
  if (page && !result.ok) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); result.body = await page.locator('body').innerText().catch(() => ''); }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  api.closeAllConnections(); await new Promise(r => api.close(r));
  console.log(JSON.stringify({ ok: result.ok, checks, errors, consoleErrors, fixtureErrors, error: result.error?.message }));
}
