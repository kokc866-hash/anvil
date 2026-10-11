// Real built desktop, trusted IPC and durable recovery; synthetic data and model only.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { fork } from 'node:child_process';
import { _electron } from 'playwright';
import { verifyBuild } from './build-fingerprint.mjs';
import { TaskAcceptance } from '../electron/task-acceptance.mjs';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

const build = await verifyBuild(process.cwd(), true);
const executableFlag = process.argv.indexOf('--executable');
const executable = executableFlag < 0 ? undefined : path.resolve(process.argv[executableFlag + 1]);
if(executable)await verifyPackageFingerprint(path.join(path.dirname(executable),'resources/app'));
const simple=process.argv.includes('--simple');
const output = path.resolve(simple?'artifacts/resume-simple-2026-10-11':'artifacts/freecad-repair-2026-10-11',executable?'packaged-desktop':'desktop');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const project = await mkdtemp(path.join(output, 'project-'));
const bytes = Buffer.from('{"solid_count":1,"fixture":true}\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');
await mkdir(path.join(project, 'checks'));
await writeFile(path.join(project, 'checks/geometry.json'), bytes);
await writeFile(path.join(project, 'notes.txt'), 'Synthetic review fixture. No CAD operations.');
const freePort = async () => {
  const server = netServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
const port = await freePort(), companionPort = await freePort(), url = `http://127.0.0.1:${port}/`;
let requests = 0;
const model = httpServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(JSON.parse(body).model, 'synthetic-review');
  requests++;
  const delta=simple&&requests===1?{tool_calls:[{id:'inspect-current-file',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'notes.txt'})}}]}:{content:'Synthetic continuation: missing CAD checks remain unverified. No files changed.'};
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls?'tool_calls':'stop' }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const acceptance = new TaskAcceptance();
acceptance.define([
  { id: 'solid', label: 'Körperanzahl', required: true, operator: 'eq', expected: '1' },
  { id: 'persistent', label: 'Speicherung erneut geprüft', required: true, operator: 'eq', expected: true },
]);
acceptance.record('mcp_call', { anvil_acceptance: { observations: [
  { criterion: 'solid', actual: 1, artifact: 'checks/geometry.json', sha256 },
  { criterion: 'persistent', actual: true, artifact: 'checks/geometry.json', sha256: 'a'.repeat(64) },
] } }, 'e1', { failed: false, pending: false, changed: false });
const workflow = { schema: 1, id: 'review-fixture', inputStamp: '', definitionStamp: '', phase: 'abort', nodes: [], changed: [],
  planProgress: JSON.stringify({ version: 1, revision: 0, nextEvidenceId: 2, plan: [], evidence: [], acceptance: acceptance.snapshot() }),
  operations: ['execute_code', 'export_step'].map((target, i) => ({ id: `review-fixture:${i + 1}`, name: 'mcp_call', target,
    fingerprint: createHash('sha256').update(target).digest('hex'), inputStamp: '', status: 'unclear', external: true, at: 10 + i })) };
const job = { schema: 1, id: 'synthetic-review-job', revision: 1, draftRevision: 0, project, execution: true, writeThrough: true,
  prompt: 'Review the synthetic CAD test without modifying files.', status: 'failed', startedAt: Date.now() - 10000,
  finishedAt: Date.now(), dismissed: false, text: '', thinking: '', steps: [], plan: [], drafts: {}, directoryChanges: {},
  mutationLedger: [], blockedMutations: [], harness: '', error: 'Frühere Aktion unbestätigt; CAD-Abnahme offen.', connection: 'Lokale API',
  modelTarget: { provider: 'custom', model: 'synthetic-review', baseUrl: `http://127.0.0.1:${model.address().port}/v1` },
  workflow, acceptance: acceptance.result() };
await mkdir(path.join(profile, 'agent-jobs'));
await writeFile(path.join(profile, 'agent-jobs/latest.json'), JSON.stringify(job));
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort),
  ANVIL_QA_USER_DATA: profile, ANVIL_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
const companionToken = 'synthetic-review-companion';
const companion = fork(path.resolve('companion/server.mjs'), [], { env: { ...env,
  ANVIL_COMPANION_TOKEN: companionToken, ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'companion-fixture-token'),
  ANVIL_ENGINE_ROOT: project, ANVIL_INSTALL_DIR: profile }, stdio: 'ignore', windowsHide: true });
let app, page;
const errors = [], consoleErrors = [], blockedRequests = [];
const launch = async () => {
  app = await _electron.launch({ ...(executable?{executablePath:executable,args:[]}:{args:[path.resolve('fixtures/electron-boot.mjs')]}), env });
  await app.context().route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (target.origin === 'http://127.0.0.1:7845') {
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
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ message: message.text(), resource: message.location().url }); });
  await page.waitForFunction(() => document.readyState === 'complete' && window.__anvilIde?.persist.hasHydrated());
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.isDestroyed())?.setSize(1440, 1000));
  await page.evaluate(async ({ project, companionPort, companionToken, modelPort }) => {
    await window.anvilNative.secretsSave({ companionToken });
    localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false, autoUpdate: false, autonomy: 'off' }, version: 0 }));
    localStorage.setItem('anvil-intern', JSON.stringify({ state: { prefs: { on: false, autoHeal: false, autoSoft: false } }, version: 0 }));
    window.__anvilIde.setState({ setupDone: true, autoUpdate: false, locale: 'de', workspaceCwd: project, memoryWorkspace: project,
      companionUrl: `http://127.0.0.1:${companionPort}`, companionKeep: false, files: { 'notes.txt': 'Synthetic review fixture. No CAD operations.' }, dirs: [], dirty: {}, pendingDiffs: [], editBases: {},
      openPaths: ['notes.txt'], activePath: 'notes.txt', attached: [], recentPaths: [], autoSaveDisk: false, autoRunAgent: false, autoPreview: false,
      llmProvider: 'custom', llmAuthMode: 'key', llmModel: 'synthetic-review', llmBaseUrl: `http://127.0.0.1:${modelPort}/v1`, llmApiKey: '', llmContext: 32768, llmContextAuto: false, llmRetries: 1,
      llmThinking: 'off', llmHardStopMin: 1, planWho: 'agent', runLoop: false, graphLoop: false, testLoop: false, engineLoop: false, harnessAutoContinue: false,
      backgroundAgent: true, backgroundWriteThrough: true, mcpServers: [], agentBusy: false, agentJob: null,
      panels: { editor: true, agent: true, trail: false, output: false }, sidebar: null, settingsOpen: false, agentMode: 'agent' });
  }, { project, companionPort, companionToken, modelPort: model.address().port });
  await page.getByRole('region', { name: 'Hintergrundauftrag', exact: true }).waitFor();
};
const until = async predicate => {
  const deadline = Date.now() + 20000;
  while (!await predicate()) { assert.ok(Date.now() < deadline, 'Synthetic desktop state did not settle'); await new Promise(resolve => setTimeout(resolve, 50)); }
};
const status = () => page.evaluate(async () => (await window.anvilNative.agentJob('status')).state);
const deadline = setTimeout(() => { app?.process()?.kill(); process.exitCode = 1; }, 120000);
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { ready = (await fetch(`http://127.0.0.1:${companionPort}/v1/run-active`, { headers: { 'x-anvil-token': companionToken }, signal: AbortSignal.timeout(500) })).ok; } catch { /* Owned finite QA service starting. */ }
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'Owned Companion required');
  await launch();
  const pane = page.getByRole('region', { name: 'Hintergrundauftrag', exact: true });
  const compactHeight = (await pane.boundingBox()).height;
  assert.ok(compactHeight <= 56, `Paused task stays compact: ${compactHeight}px`);
  assert.equal(await pane.getByRole('textbox').count(), 0, 'No review form takes up chat space');
  const details = page.getByRole('dialog', { name: 'Auftragsdetails', exact: true });
  assert.equal(await details.isVisible(), false, 'Details never open automatically');
  await page.screenshot({ path: path.join(output, 'compact-production.png') });
  await pane.screenshot({ path: path.join(output, 'compact-bar.png') });
  await pane.getByRole('button', { name: 'Auftragsdetails öffnen', exact: true }).click();
  await details.waitFor();
  assert.equal(requests, 0, 'Opening details never resumes a task');
  const resume = details.getByRole('button', { name: 'Stand prüfen und fortsetzen', exact: true });
  assert.equal(await resume.isEnabled(), true, 'No guess about an external outcome is required');
  assert.equal(await details.getByRole('textbox').count(), 0, 'The optional review form is collapsed');
  await details.locator('summary').filter({ hasText: 'Kriterien und Nachweise' }).click();
  assert.match(await details.innerText(), /Datentyp stimmt nicht überein/);
  assert.match(await details.innerText(), /Prüfsumme ist ein Platzhalter/);
  assert.match(await details.innerText(), /Soll: eq "1"/);
  assert.ok((await details.boundingBox()).height <= 610, 'Details scroll inside a bounded dialog');
  await page.screenshot({ path: path.join(output, 'blocked-production.png') });
  await page.keyboard.press('Escape');
  assert.equal(await details.isVisible(), false, 'Escape closes the dialog');
  await pane.getByRole('button', { name: 'Auftragsdetails öffnen', exact: true }).click();
  await details.waitFor();

  // The real trusted IPC also rejects a forged file verification claim.
  const artifactChecks = await page.evaluate(async ({ project, sha256 }) => {
    const check = async digest => (await window.anvilNative.agentJob('artifact-check', { project, result: {
      anvil_acceptance: { observations: [{ criterion: 'solid', actual: 1, artifact: 'checks/geometry.json', sha256: digest }] },
      anvilArtifactChecks: [{ artifact: 'checks/geometry.json', sha256: digest, ok: true }],
    } })).result.anvilArtifactChecks;
    return { valid: await check(sha256), wrong: await check('1234567890abcdef'.repeat(4)) };
  }, { project, sha256 });
  assert.equal(artifactChecks.valid[0].ok, true); assert.equal(artifactChecks.wrong[0].ok, false);

  if(!simple){
  await details.locator('summary').filter({ hasText: 'Frühere Aktion selbst klären (optional)' }).click();
  for (const [id, outcome, note] of [
    ['review-fixture:1', 'confirmed', 'Im künstlichen Protokoll geprüft: Dokument gespeichert; keine Aktion läuft.'],
    ['review-fixture:2', 'not-executed', 'Im künstlichen Protokoll geprüft: Export wurde nicht gestartet.'],
  ]) {
    const field = details.locator('fieldset').filter({ has: page.getByRole('combobox', { name: `Ausgang von ${id}`, exact: true }) });
    const save = field.getByRole('button', { name: 'Prüfergebnis speichern', exact: true });
    assert.equal(await save.isDisabled(), true);
    await field.getByRole('combobox').selectOption(outcome);
    await field.getByRole('textbox').fill('Zu kurz');
    assert.equal(await save.isDisabled(), true);
    await field.getByRole('textbox').fill(note);
    await save.click();
    await until(async () => (await status()).workflow.operations.find(op => op.id === id).resolution?.outcome === outcome);
    assert.equal(requests, 0, 'Review never launches a model or a CAD action');
  }
  assert.equal(await details.getByRole('button',{name:'Fortsetzen',exact:true}).isEnabled(), true);
  const reviewed = await status();
  assert.notEqual(reviewed.acceptance.state, 'passed', 'Review is not geometry acceptance');
  const saved = JSON.parse(await readFile(path.join(profile, 'agent-jobs/latest.json'), 'utf8'));
  assert.equal(saved.workflow.operations[0].resolution.outcome, 'confirmed');
  await details.locator('summary').filter({ hasText: 'Geprüfte frühere Aktionen' }).click();
  }
  const reviewed = await status();
  await page.screenshot({ path: path.join(output, 'reviewed-production.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.isDestroyed())?.setSize(1100, 900));
  await page.screenshot({ path: path.join(output, 'reviewed-narrow-production.png') });
  assert.equal(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  await details.getByRole('button', { name: 'Schließen', exact: true }).click();
  const narrowCompactHeight=(await pane.boundingBox()).height;
  assert.ok(narrowCompactHeight<=56, 'Narrow chat keeps the same compact row');
  assert.equal(await pane.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  assert.equal(await pane.getByRole('button', { name: 'Auftragsdetails öffnen', exact: true }).evaluate(element=>element===document.activeElement), true, 'Closing returns keyboard focus to the trigger');
  await page.screenshot({ path: path.join(output, 'compact-narrow-production.png') });

  await app.close(); app = null; page = null;
  await launch();
  assert.equal(requests, 0, 'Reopening never automatically resumes');
  assert.equal(await page.getByRole('dialog', { name: 'Auftragsdetails', exact: true }).isVisible(), false, 'Reopening keeps details closed');
  assert.deepEqual((await status()).workflow.operations.map(op => op.resolution), reviewed.workflow.operations.map(op => op.resolution));
  await page.getByRole('region', { name: 'Hintergrundauftrag', exact: true }).getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await until(async () => {
    const current=await status();
    return ['done','failed'].includes(current?.status)&&current?.resumedFrom===job.id;
  });
  const resumed = await status();
  assert.equal(requests, simple?2:1, 'Only the explicit Resume starts the synthetic model');
  assert.equal(resumed.resumedFrom, job.id);
  assert.notEqual(resumed.acceptance.state, 'passed');
  assert.equal(resumed.acceptance.criteria[0].expected, '1', 'Existing contract stays binding');
  if(simple){
    assert.equal(resumed.workflow.operations[0].resolution,undefined);
    assert.equal(resumed.workflow.operations[0].status,'unclear');
    assert.equal(resumed.workflow.operations[0].recovery.mode,'skip');
    assert.equal(resumed.workflow.operations.filter(op=>op.name==='read_file'&&op.status==='confirmed').length,1,'Current file was actually read before completion');
    assert.ok(resumed.recoveryBlockedActions.includes('mcp:execute_code'));
    assert.ok(resumed.workflow.operations.every(op=>op.name==='read_file'||op.recovery?.mode==='skip'),'No external action was repeated');
    const persisted=JSON.parse(await readFile(path.join(profile,'agent-jobs/latest.json'),'utf8'));
    assert.equal(persisted.workflow.operations[0].status,'unclear');
    assert.ok(persisted.recoveryBlockedActions.includes('mcp:execute_code'));
  }else assert.equal(resumed.workflow.operations[0].resolution.outcome, 'confirmed');
  assert.deepEqual(await readFile(path.join(project, 'checks/geometry.json')), bytes);
  await page.getByText('Synthetic continuation: missing CAD checks remain unverified. No files changed.', { exact: false }).first().waitFor();
  await until(async () => await page.getByRole('region', { name: 'Hintergrundauftrag', exact: true }).getByRole('button', { name: 'Stoppen', exact: true }).count() === 0);
  assert.equal(resumed.status, 'done', 'Execution ends normally while CAD acceptance remains incomplete');
  await page.screenshot({ path: path.join(output, 'resumed-production.png') });
  assert.deepEqual(errors, []);
  const unexpected = consoleErrors.filter(error => !(error.message === 'Failed to load resource: net::ERR_FAILED' && blockedRequests.includes(error.resource)));
  assert.deepEqual(unexpected, []);
  const { version, commit, source, outputFingerprint, builtAt } = build;
  const result = { ok: true, build: { version, commit, source, outputFingerprint, builtAt }, requests, reviewedId: job.id, resumedId: resumed.id,
    compactChat: { compactHeight, narrowCompactHeight, detailsClosedByDefault: true, boundedDialog: true, escapeCloses: true, focusRestored: true },
    ...(simple?{oneClickResumeWithoutReviewForm:true,currentStateActuallyRead:true,unknownOutcomePreserved:true,replayProtectionPersisted:true}:{perOperationReview:true,savedReviewsSurviveReopen:true}), noAutomaticReplay: true, bindingContractPreserved: true, unchangedFixtureBytes: true, renderedFinalAnswer: true,
    artifactChecks, errors, consoleErrors, blockedRequests, profile, project, ...(executable?{executable}:{}),
    limits: 'Synthetic model, service state and measurements; no real Qwen inference or FreeCAD geometry operation.' };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, errors, consoleErrors, profile, project }, null, 2));
  try { await page?.screenshot({ path: path.join(output, 'failure.png') }); } catch { /* Preserve original failure. */ }
  throw error;
} finally {
  clearTimeout(deadline); await app?.close(); companion.kill(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
}
