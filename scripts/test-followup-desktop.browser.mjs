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
const request = 'Teste alle Funktionen der Browseranwendung. Keine Änderungen.';
const output = flag('--output', 'artifacts/test-followup-2026-11-01/desktop'); await mkdir(output, { recursive: true });
const manifest = executable ? await verifyPackageFingerprint(path.join(path.dirname(executable), 'resources/app')) : await verifyBuild(process.cwd(), true);
const profile = await mkdtemp(path.join(output, 'profile-')), project = path.join(profile, 'synthetic-project'); await mkdir(project);
const files = { 'index.html': '<!doctype html><html><head><meta charset="utf-8"><title>Rejection QA</title></head><body style="background:#182333;color:#e5edf7;font:22px system-ui;padding:40px"><h1>Werkzeugtest</h1><button id="start">Start</button><p id="status">Ready</p><script src="ui.js"></script></body></html>',
  'ui.js': 'const marker="WORKSHOP_MARKER";document.querySelector("#start").onclick=()=>document.querySelector("#status").textContent="Running";' };
for (const [name, content] of Object.entries(files)) await writeFile(path.join(project, name), content);
const socket = socketServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const requests = [], issues = [], checks = [], errors = [], consoleErrors = [];
let held = false, release, playResult, renderEvidence;
const toolText = (body, id) => { const value = body.messages.find(message => message.role === 'tool' && message.tool_call_id === `rejection-${id}`)?.content; assert.equal(typeof value, 'string'); return value; };
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"data":[]}'); return; }
  let name, args;
  try {
    const body = JSON.parse(raw), n = requests.push({ at: Date.now(), tools: (body.tools || []).map(tool => tool.function.name) });
    assert.ok(n <= 13, 'bounded recovery and a single fresh retest');
    if (n === 1) {
      assert.ok(body.tools.some(tool => tool.function.name === 'play'), 'play is offered before any selection call');
      name = 'shell'; args = { command: 'play index.html --actions anything' };
    }
    if (n === 2) {
      const rejected = JSON.parse(toolText(body, 1)); assert.equal(rejected.rejected, true); assert.equal(rejected.definitelyNotExecuted, true); assert.match(rejected.error, /select_tools/); assert.ok(rejected.suggestedTools.includes('play'));
      name = 'shell'; args = { command: 'node -e "console.log(123)"' };
    }
    if (n === 3) {
      const rejected = JSON.parse(toolText(body, 2)); assert.equal(rejected.ok, false); assert.equal(rejected.rejected, true); assert.equal(rejected.definitelyNotExecuted, true); assert.ok(rejected.suggestedTools.includes('play'));
      name = 'run_file'; args = { path: 'index.html' };
    }
    if (n === 4) {
      const rendered = toolText(body, 3); assert.match(rendered, /RUN OK/); assert.match(rendered,/Observed output targets/); assert.match(rendered,/#status/); renderEvidence = /Plan evidence ID: (e\d+)/.exec(rendered)?.[1]; assert.equal(typeof renderEvidence, 'string');
      name = 'set_plan'; args = { updates: [{ step: 1, status: 'ok', evidence: [renderEvidence], reason: 'HTML loaded only; this must not complete an interaction check.' }] };
    }
    if (n === 5) {
      assert.match(JSON.parse(toolText(body, 4)).error, /play.*assert/, 'a rejected completion explains the missing interaction proof');
      name = 'play'; args = { actions: [{ type: 'click', selector: '#missing' }] };
    }
    if (n === 6) {
      const rejected=JSON.parse(toolText(body,5)); assert.equal(rejected.rejected,true); assert.equal(rejected.definitelyNotExecuted,true); assert.equal(rejected.input.completed,0);
      name = 'play'; args = { actions: [{ type: 'click', selector: '#start' }, { type: 'assert', selector: '#status', text: 'Running' }] };
    }
    if (n === 7) {
      playResult = JSON.parse(toolText(body, 6)); assert.equal(playResult.ok, true, playResult.error); assert.equal(playResult.functionalChecks, true);
      assert.ok(playResult.state.observations.some(row=>row.selector==='#status' && row.text==='Running'));
      name = 'set_plan'; args = { updates: [{ step: 1, status: 'ok', kind: 'check', evidence: [playResult.plan_evidence_id], reason: 'Native click followed by confirmed expected DOM state.' }] };
    }
    if (n === 8) { assert.equal(JSON.parse(toolText(body, 7)).ok, true); held = true; await new Promise(resolve => release = resolve); }
    if (n === 9) {
      assert.ok(body.tools.some(tool=>tool.function.name==='play'));
      name='edit_file';args={path:'ui.js',old_string:'const marker',new_string:'const changed'};
    }
    if (n === 10) {
      const rejected=JSON.parse(toolText(body,9));assert.equal(rejected.rejected,true);assert.equal(rejected.definitelyNotExecuted,true);
      name='run_file';args={path:'index.html'};
    }
    if (n === 11) {assert.match(toolText(body,10),/RUN OK/);name='play';args={actions:[{type:'click',selector:'#start'},{type:'assert',selector:'#status',text:'Running'}]};}
    if (n === 12) {const proof=JSON.parse(toolText(body,11));assert.equal(proof.functionalChecks,true);name='set_plan';args={updates:[{step:1,status:'ok',evidence:[proof.plan_evidence_id],reason:'Fresh retest assertion.'}]};}
    if (n === 13) assert.equal(JSON.parse(toolText(body,12)).ok,true);
  } catch (error) { issues.push(error.stack); }
  const n = requests.length;
  const delta = name ? { tool_calls: [{ index: 0, id: `rejection-${n}`, function: { name, arguments: JSON.stringify(args) } }] }
    : { content: n>=9 ? 'PREVIEW_RETEST_OK: Erneut geprüft; Start mit einer frischen Erwartung bestätigt. Keine Dateien geändert; weitere Funktionen nicht geprüft.' : 'PREVIEW_FLOW_OK: Start angeklickt und den erwarteten Status Running bestätigt. Beide Shell-Versuche wurden vor Ausführung abgelehnt. Keine Dateien geändert; weitere Funktionen nicht geprüft.' };
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
  await page.locator('textarea').last().fill(request); await page.locator('textarea').last().press('Enter');
  await until(() => held, 'native preview assertion and verified checklist');
  const snapshot = () => page.evaluate(async () => (await window.anvilNative.agentJob('status')).state);
  const state = await snapshot(); assert.equal(state.status, 'running', state.error); assert.equal(state.steps.filter(step => step.name === 'shell' && step.status === 'err').length, 2); assert.equal(state.steps.filter(step => step.name === 'play' && step.status === 'err').length,1); checks.push('rejected preview target does not poison functional evidence or end the job'); assert.equal(state.steps.some(step => step.name === 'select_tools'), false);
  assert.deepEqual(state.mutationLedger, []); assert.equal(state.plan.filter(step => step.kind !== 'report').every(step => step.status === 'ok'), true); assert.equal(state.lastPreview.input.assertions, 1);
  assert.equal(state.workflow.harness.used.runs, 1); assert.equal(state.workflow.harness.used.sees, 1); assert.equal(state.workflow.harness.used.patches, 0);
  assert.equal(state.plan[0].kind, 'check'); assert.match(state.plan[0].text, /play/);
  checks.push('ordinary browser test wording preloads play and creates its concrete interaction checklist');
  checks.push('native shell and early task-policy rejections consume no execution or repair budget');
  assert.equal(state.workflow.operations.some(operation => ['started','unclear'].includes(operation.status)), false); checks.push('no ambiguous operation or unexecuted application test remains');
  assert.equal(await page.getByRole('dialog', { name: 'Auftragsdetails' }).count(), 0); checks.push('no additional confirmation window');
  await page.reload(); await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated()); assert.equal((await snapshot()).id, state.id); assert.equal(requests.length, 8); checks.push('renderer reload preserves the live job without replay');
  release(); release = undefined; await until(async () => (await snapshot()).status === 'done', 'honest completion'); await page.getByText(/PREVIEW_FLOW_OK:/).last().waitFor(); await page.getByText(/PREVIEW_FLOW_OK:/).last().scrollIntoViewIfNeeded();
  const final = await snapshot(); assert.equal(final.error, ''); assert.equal(final.verification.state, 'passed'); checks.push('completion uses the actual successful preview assertion');
  await page.getByText('2/2', { exact: true }).waitFor(); checks.push('rendered checklist reaches 2/2 after the final reply');
  await page.screenshot({ path: path.join(output, 'completed-agent.png') });
  await page.locator('textarea').last().fill('noch einmal');await page.locator('textarea').last().press('Enter');
  await until(async()=>{const latest=await snapshot();return latest.id!==final.id&&latest.status==='done';},'fresh read-only retest');
  const retest=await snapshot();assert.equal(retest.error,'');assert.equal(retest.humanPrompt,request);
  assert.notEqual(retest.workflow.id,final.workflow.id);assert.equal(retest.lastPreview.input.assertions,1);assert.equal(requests.length,13);
  assert.equal(retest.plan.filter(step=>step.kind==='check').every(step=>step.status==='ok'),true);
  checks.push('real composer retest preserves original read-only authority and preloads play');
  checks.push('retest starts a separate job with fresh assertion evidence and rejects attempted edits');
  await page.getByText(/PREVIEW_RETEST_OK:/).last().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'retested-agent.png')});
  const preview = app.windows().find(window => window !== page && window.url().includes('/index.html')); assert.ok(preview); await preview.screenshot({ path: path.join(output, 'native-preview.png') });
  for (const [name, content] of Object.entries(files)) assert.equal(await readFile(path.join(project, name), 'utf8'), content); checks.push('project files remain byte-identical');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(issues, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, source: manifest.source, outputFingerprint: manifest.outputFingerprint, realModelInference: false, requests, checks, errors, consoleErrors, final: { id: final.id, status: final.status, plan: final.plan, verification: final.verification, used: final.workflow.harness.used, steps: final.steps.map(step => ({name:step.name,status:step.status})), assertions: final.lastPreview.input.assertions } }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, output }));
} catch (error) { if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, issues, requests, errors, consoleErrors }, null, 2)); throw error; }
finally { release?.(); if (app) { const timer = setTimeout(() => proc?.kill(), 8000); try { await app.close(); } catch { /* Only this isolated QA process. */ } clearTimeout(timer); } server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
