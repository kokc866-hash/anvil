import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from 'playwright';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

const executable = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3] || 'artifacts/harness-adoption-desktop');
const manifest = await verifyPackageFingerprint(path.join(path.dirname(executable), 'resources/app'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const project = path.join(profile, 'synthetic-project'); await mkdir(project);
const counter = path.join(project, 'execution-count.log');
// Stay below the native runner's process-output limit while exceeding the JSON inline limit.
const files = { 'log.cjs': `const fs=require('node:fs'),n=String.fromCharCode(10);fs.appendFileSync(${JSON.stringify(counter)},'1'+n);console.log('HARNESS_LOG_BEGIN'+n+('synthetic log entry'+n).repeat(3900)+'HARNESS_LOG_END');` };
await writeFile(path.join(project, 'log.cjs'), files['log.cjs']);
const freePort = async () => { const server = netServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r)); return port; };
const port = await freePort(), companionPort = await freePort();
const checks = [], errors = [], consoleErrors = [], fixtureErrors = [], requests = [];
let id, offset = 0, complete = '', original, commandCalls = 0;
const api = createServer(async (req, res) => {
  try {
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'synthetic-harness' }] })); return; }
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), last = body.messages.at(-1);
    assert.ok(body.tools.some(tool => tool.function.name === 'read_tool_output'), 'packaged worker advertises the output-reader tool');
    requests.push({ lastRole: last.role, toolCalls: requests.length + 1 });
    let call;
    if (last.role !== 'tool') { commandCalls++; call = { name: 'shell', arguments: JSON.stringify({ command: 'node log.cjs' }) }; }
    else {
      const result = JSON.parse(last.content);
      if (!id) {
        assert.equal(result.ok, true); assert.equal(result.truncated, true); assert.equal(result.retained, true);
        assert.ok(result.text.includes('HARNESS_LOG_BEGIN'), 'preview keeps the first diagnostic'); assert.ok(result.text.includes('HARNESS_LOG_END'), 'preview keeps the final diagnostic');
        id = result.outputId; checks.push('Native shell emits a bounded head/tail preview with a task-owned output handle');
      } else {
        assert.equal(result.outputId, id); assert.equal(result.offset, offset);
        complete += result.text; offset = result.nextOffset;
        if (offset === null) { original = JSON.parse(complete); assert.equal(original.ok, true); assert.equal(original.code, 0); assert.match(original.stdout, /HARNESS_LOG_BEGIN[\s\S]*HARNESS_LOG_END/); checks.push('Packaged worker reads all pages of the original shell result without repeating its action'); }
      }
      if (offset !== null) call = { name: 'read_tool_output', arguments: JSON.stringify({ output_id: id, offset, limit: 24000 }) };
    }
    const delta = call ? { tool_calls: [{ index: 0, id: 'harness-' + requests.length, type: 'function', function: call }] } : { content: 'HARNESS_ADOPTION_OK: The complete log was read without repeating the command.' };
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  } catch (error) { fixtureErrors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end('Synthetic fixture failed.'); }
});
await new Promise(r => api.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${api.address().port}/v1`;
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort),
  ANVIL_COMPANION_TOKEN: 'harness-qa-only', ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'companion-token'), ANVIL_QA_USER_DATA: profile, ANVIL_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
const result = { profile, source: manifest.source, outputFingerprint: manifest.outputFingerprint, checks, errors, consoleErrors, fixtureErrors, requests, realModelInference: false };
let app, page;
const until = async (predicate, label) => { for (let i = 0; i < 450; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Desktop harness timeout: ' + label); };
try {
  app = await _electron.launch({ executablePath: executable, env, timeout: 45000 });
  await app.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if ([`http://127.0.0.1:${port}`, `http://127.0.0.1:${companionPort}`, new URL(base).origin].includes(url.origin)) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await until(() => { page = app.windows().find(window => window.url() === `http://127.0.0.1:${port}/`); return page; }, 'window');
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  await page.evaluate(({ project, files }) => window.__anvilIde.setState({ setupDone: true, settingsOpen: false, autoUpdate: false, companionKeep: false, locale: 'de', workspaceCwd: project, workspaceEpoch: 2,
    files, dirs: [], openPaths: ['log.cjs'], activePath: 'log.cjs', dirty: {}, pendingDiffs: [], backgroundAgent: true, backgroundWriteThrough: true, agentMode: 'agent', agentQueue: [], agentInbox: null, chat: [],
    autoSaveDisk: false, autoPreview: false, autoRunAgent: false, runLoop: false, graphLoop: false, testLoop: false, engineLoop: false, harnessAutoContinue: false, planWho: 'agent', llmContextAuto: false, llmContext: 131072, llmRetries: 1, mcpServers: [] }), { project, files });
  await page.evaluate(base => { const state = window.__anvilIde.getState(); state.setLlmProvider('custom', 'key'); state.setLlmBaseUrl(base); state.setLlmModel('synthetic-harness'); state.setLlmApiKey(''); state.setLlmThinking('off'); }, base);
  const input = page.locator('textarea').last();
  await input.fill('Run node log.cjs once. Read the retained full output through read_tool_output, then report its final marker. Do not edit files or repeat the command.');
  await input.press('Enter');
  let state;
  await until(async () => { state = (await page.evaluate(() => window.anvilNative.agentJob('status'))).state; return state && ['done', 'failed', 'stopped'].includes(state.status); }, 'job');
  assert.equal(state.status, 'done', state.error); assert.match(state.text, /HARNESS_ADOPTION_OK/);
  assert.equal(commandCalls, 1); assert.equal((await readFile(counter, 'utf8')), '1\n');
  checks.push('Independent disk counter confirms exactly one actual bundled-Node execution');
  assert.equal(Object.hasOwn(state, 'acceptance'), false);
  await page.waitForFunction(() => window.__anvilIde.getState().chat.some(message => String(message.content).includes('HARNESS_ADOPTION_OK')));
  assert.doesNotMatch(await page.locator('body').innerText(), /Gesamtabnahme|Prüfergebnis speichern/);
  await page.screenshot({ path: path.join(output, 'harness-finished.png') });
  checks.push('Visible production UI shows the completed worker task without an acceptance form');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(fixtureErrors, []);
  result.ok = true;
} catch (error) { result.ok = false; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  if (page && !result.ok) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); result.body = await page.locator('body').innerText().catch(() => ''); }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  api.closeAllConnections(); await new Promise(r => api.close(r));
  console.log(JSON.stringify({ ok: result.ok, checks, errors, consoleErrors, fixtureErrors, error: result.error?.message }));
}
