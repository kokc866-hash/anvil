/** Built React UI + real isolated Companion Git repositories. No actual model/profile use. */
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';
import { AgentJobRegistry } from '../electron/agent-job-registry.mjs';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { JobResourceGate } from '../electron/resource-gate.mjs';

const output = path.resolve('artifacts/cursor-adoption-2026-10-19/worktrees'); await mkdir(output, { recursive: true });
const area = await mkdtemp(path.join(output, 'browser-')), repo = path.join(area, 'main'), home = path.join(area, 'home');
await mkdir(repo); await mkdir(home);
const git = (...args) => { const r = spawnSync('git', ['-c', 'core.hooksPath=', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
git('init'); git('config', 'user.name', 'Anvil browser fixture'); git('config', 'user.email', 'fixture@example.invalid');
await writeFile(path.join(repo, 'one.txt'), 'base one\n'); await writeFile(path.join(repo, 'two.txt'), 'base two\n'); git('add', '.'); git('commit', '-m', 'Synthetic base');
await writeFile(path.join(repo, 'two.txt'), 'foreign dirty main\n');
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(r => socket.close(r));
const companionBase = `http://127.0.0.1:${port}`, token = 'synthetic-worktree-browser-token';
let companion, server, browser, registry; const errors = [], requests = [], nativeCalls = [], checks = [], consoleErrors = [];
const gate = new JobResourceGate();
const request = async body => { const response = await fetch(`${companionBase}/v1/worktrees`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-anvil-token': token }, body: JSON.stringify({ cwd: repo, ...body }) }); const result = await response.json(); assert.equal(result.ok, true, result.error); return result; };
async function startCompanion() {
  companion = spawn(process.execPath, ['companion/server.mjs'], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, ANVIL_ENGINE_ROOT: repo, ANVIL_HOME: home, ANVIL_HOME_FILE: path.join(area, 'home.txt'), ANVIL_COMPANION_PORT: String(port), ANVIL_COMPANION_HOST: '127.0.0.1', ANVIL_COMPANION_TOKEN: token, ANVIL_RUN_ROOT: path.join(home, 'runs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Synthetic Companion did not start.')), 15000);
    companion.once('error', error => { clearTimeout(timer); reject(error); });
    companion.stdout.on('data', data => { if (String(data).includes('Anvil companion')) { clearTimeout(timer); resolve(); } });
    companion.stderr.on('data', data => errors.push('companion: ' + String(data)));
  });
}
function createHost({ snapshotPath }) {
  return new AgentJobHost({ snapshotPath, runtime: { begin() {}, async execute() { throw Error('No tool execution in browser fixture.'); }, async finish() {}, async close() {} }, launch() {
    const child = new EventEmitter(); child.send = () => {}; child.kill = () => {};
    queueMicrotask(() => child.emit('message', { type: 'ready' })); return child;
  } });
}
const nativeReply = async (action, payload = {}) => {
  nativeCalls.push({ action, payload });
  if (action === 'jobs') return { available: true, ...registry.jobs() };
  if (action === 'select') return { available: true, ...registry.select(payload.jobId) };
  if (action === 'status') return { available: true, ...registry.snapshot(payload.id, payload.revision, payload.draftRevision, payload.jobId) };
  if (action === 'permissions') { const host = registry.hostFor(payload); return registry.wrap(host, host?.snapshot() || { state: null }); }
  if (action === 'workspace-acquire') return registry.acquireWorkspace(payload.projects, `foreground:42:${payload.owner}`);
  if (action === 'workspace-release') return registry.releaseWorkspace(payload.leaseId, `foreground:42:${payload.owner}`);
  if (action === 'resource-acquire') return gate.acquire(`foreground:42:${payload.owner}`, payload.key);
  if (action === 'resource-release') return gate.release(payload.leaseId, `foreground:42:${payload.owner}`);
  if (action === 'stop') { const host = registry.hostFor(payload); return registry.wrap(host, host?.stop() || { state: null }); }
  if (action === 'dismiss') { const host = registry.hostFor(payload); const result = host.dismiss(payload.id); await host.waitForCleanup(); return registry.wrap(host, result); }
  throw Error(`Unexpected native action: ${action}`);
};
async function syntheticJob(project, prompt) {
  return registry.start({ project, files: { 'one.txt': await readFile(path.join(project, 'one.txt'), 'utf8'), 'two.txt': await readFile(path.join(project, 'two.txt'), 'utf8') }, execution: true, model: { provider: 'custom', model: 'synthetic-no-inference', baseUrl: 'http://127.0.0.1:1' }, messages: [{ role: 'user', content: prompt }], userPrompt: prompt });
}
const fixture = path.join(area, 'fixture'); await mkdir(fixture);
await writeFile(path.join(fixture, 'index.html'), '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anvil Worktree QA</title></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
const relativeCss = path.relative(fixture, path.resolve('src/styles.css')).replaceAll('\\', '/');
await writeFile(path.join(fixture, 'fixture.css'), `@import "${relativeCss}";\n@source "${path.relative(fixture, path.resolve('src')).replaceAll('\\', '/')}";\nbody{margin:0;background:var(--color-bg,#151515)}#root{min-height:100dvh}button{min-height:28px}\n`);
await writeFile(path.join(fixture, 'fixture.tsx'), `
import React from 'react'; import {createRoot} from 'react-dom/client'; import './fixture.css';
import {GitPane} from '@/components/ide/git-pane'; import {BackgroundAgentPane} from '@/components/ide/background-agent-pane';
import {useIde} from '@/store/ide'; import {useBrain} from '@/lib/brain/store'; import {useIntern} from '@/lib/intern'; import {useLearn} from '@/lib/learn';
import {setCompanionToken} from '@/lib/companion'; import {startBackgroundAgentMonitor,useBackgroundAgent} from '@/lib/background-agent';
await useIde.persist.rehydrate(); useBrain.setState({on:false,autoLoad:false,autoUpdate:false,autonomy:'off',jobs:Object.fromEntries(Object.keys(useBrain.getState().jobs).map(k=>[k,false]))}); useIntern.getState().setPrefs({on:false,autoHeal:false}); useLearn.setState({on:false});
setCompanionToken(${JSON.stringify(token)});
useIde.setState({setupDone:true,autoUpdate:false,companionKeep:false,companionUrl:${JSON.stringify(companionBase)},workspaceCwd:${JSON.stringify(repo)},memoryWorkspace:'synthetic-workspaces-browser',workspaceEpoch:1,files:{'one.txt':'base one\\n','two.txt':'foreign dirty main\\n'},dirs:[],dirty:{},pendingDiffs:[],chat:[],agentBusy:false,agentJob:null,agentInbox:null,agentQueue:[],backgroundAgent:true,backgroundWriteThrough:false,agentMode:'agent',locale:'de',mcpServers:[],activeSurfaceId:'anvil',surfaceMode:'bridge',autoSaveDisk:false,autoPreview:false});
(window as any).anvilNative={agentJob:(action:string,payload:any)=>(window as any).__nativeAgentJob(action,payload),workspacePick:async()=>${JSON.stringify(repo)}};
(window as any).fixture={ide:useIde,bg:useBackgroundAgent}; startBackgroundAgentMonitor();
createRoot(document.getElementById('root')!).render(<main className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 gap-4 p-2 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"><div className="min-w-0"><GitPane/></div><aside className="min-w-0"><h1 className="mb-3 text-lg text-fg">Aufgaben und Arbeitsstände</h1><BackgroundAgentPane/><p className="mt-3 text-xs text-muted">Künstliche Prüfprojekte. Kein Modellaufruf.</p></aside></main>);
`);
const config = { configFile: false, root: fixture, publicDir: false, logLevel: 'warn', resolve: { alias: { '@': path.resolve('src') } }, plugins: [{ name: 'worktree-ui-rpc-boundaries', enforce: 'pre', transform(code, id) {
  const normalized = id.replaceAll('\\', '/'), rpc = { agent: ['grokRound', 'chatWithAgent', 'completePrompt'], github: ['cloneGithub', 'pushGithub'], 'llm-proxy': ['proxyLlm', 'toAnthropicMessages'], 'run-server': ['runRemote'], 'web-fetch': ['fetchWeb', 'readWebPage', 'isPrivateHost'] };
  for (const [name, exports] of Object.entries(rpc)) if (normalized.endsWith('/src/lib/' + name + '.ts')) return exports.map(name => `export function ${name}(){throw Error('Unexpected server/model RPC in worktree UI fixture: ${name}');}`).join('\n');
} }, react(), tailwindcss()], build: { outDir: path.join(fixture, 'dist'), emptyOutDir: true, target: 'esnext', minify: false } };
try {
  await startCompanion();
  assert.equal((await fetch(`${companionBase}/v1/worktrees`, { method: 'POST', body: '{}' })).status, 401); checks.push('Token authentication checked on the real Companion route');
  registry = new AgentJobRegistry({ directory: path.join(area, 'jobs'), createHost, gate });
  await build(config); server = await preview({ ...config, preview: { host: '127.0.0.1', port: 8198, strictPort: true } });
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1180, height: 1000 } }), page = await context.newPage();
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.exposeFunction('__nativeAgentJob', nativeReply);
  await page.route('**/*', route => { const target = route.request().url(); requests.push(target); return target.startsWith(url) || target.startsWith(companionBase + '/') ? route.continue() : route.abort(); });
  await page.goto(url); const pane = page.getByRole('region', { name: 'Getrennte Arbeitsstände' }); await pane.waitFor();
  assert.equal(await pane.getByPlaceholder('Name der Aufgabe').isVisible(), false, 'advanced workspace controls start collapsed');
  await pane.locator('summary').first().click();
  await pane.getByPlaceholder('Name der Aufgabe').fill('Auftrag Alpha'); await pane.getByRole('button', { name: 'Erstellen', exact: true }).click(); await pane.getByText('Auftrag Alpha', { exact: true }).waitFor();
  await pane.getByPlaceholder('Name der Aufgabe').fill('Auftrag Beta'); await pane.getByRole('button', { name: 'Erstellen', exact: true }).click(); await pane.getByText('Auftrag Beta', { exact: true }).waitFor();
  const rows = (await request({ action: 'list' })).worktrees, alpha = rows.find(w => w.name === 'Auftrag Alpha'), beta = rows.find(w => w.name === 'Auftrag Beta');
  assert.ok(alpha && beta); assert.equal(await readFile(path.join(repo, 'two.txt'), 'utf8'), 'foreign dirty main\n'); checks.push('Two task checkouts created through the real UI and HTTP Git API; dirty main retained');
  await pane.locator('li').filter({ hasText: 'Auftrag Alpha' }).first().getByRole('button', { name: 'Öffnen', exact: true }).click();
  await page.waitForFunction(expected => window.fixture.ide.getState().workspaceCwd === expected, alpha.path); await pane.getByText('Auftrag Alpha · Geöffnet', { exact: true }).waitFor();
  await page.evaluate(() => window.fixture.ide.setState({ agentBusy: true })); assert.equal(await pane.getByRole('button', { name: 'Hauptprojekt öffnen', exact: true }).isDisabled(), true); await page.evaluate(() => window.fixture.ide.setState({ agentBusy: false })); checks.push('Active foreground work disables workspace switches');
  const jobA = await syntheticJob(alpha.path, 'Synthetic Alpha job'), jobB = await syntheticJob(beta.path, 'Synthetic Beta job');
  await page.waitForFunction(() => (window.fixture.bg.getState().jobs || []).length === 2);
  // The selector belongs to the real BackgroundAgentPane. No fabricated UI is rendered.
  const selector = page.getByRole('combobox', { name: /Hintergrundauftrag auswählen|Auftrag auswählen/ }); await selector.waitFor();
  await selector.selectOption(jobA.jobId); await page.waitForFunction(id => window.fixture.bg.getState().job?.id === id, jobA.state.id);
  await pane.getByRole('button', { name: 'Hauptprojekt öffnen', exact: true }).click();
  await page.waitForFunction(expected => window.fixture.ide.getState().workspaceCwd === expected, repo);
  assert.equal(registry.hostFor({ jobId: jobA.jobId }).busy(), true); assert.equal(registry.hostFor({ jobId: jobB.jobId }).busy(), true); checks.push('Job selection and switching to a disjoint project leave both background jobs running');
  await selector.selectOption(jobB.jobId); await page.waitForFunction(id => window.fixture.bg.getState().selectedJobId === id, jobB.jobId);
  assert.deepEqual(await page.evaluate(() => window.fixture.ide.getState().files), { 'one.txt': 'base one\n', 'two.txt': 'foreign dirty main\n' }); checks.push('Selecting another job never copies its project snapshot into the opened project');
  await pane.getByText('Auftrag Alpha', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'jobs-selection-desktop.png'), fullPage: true });
  registry.hostFor({ jobId: jobA.jobId }).stop(); registry.hostFor({ jobId: jobB.jobId }).stop(); await registry.waitForCleanup();
  await page.waitForFunction(() => !window.fixture.ide.getState().agentBusy);
  await writeFile(path.join(alpha.path, 'one.txt'), 'alpha returned\n'); await writeFile(path.join(beta.path, 'one.txt'), 'beta conflicts\n');
  await pane.locator('li').filter({ hasText: 'Auftrag Alpha' }).first().getByRole('button', { name: 'Änderungen', exact: true }).click();
  await pane.getByText('Auftrag Alpha → Hauptprojekt', { exact: true }).waitFor();
  assert.equal(await pane.locator('li').filter({ hasText: 'Auftrag Alpha' }).first().getByRole('button', { name: 'Leeren Stand entfernen', exact: true }).isDisabled(),true);
  await pane.getByRole('button', { name: 'Ins Hauptprojekt rückführen', exact: true }).click();
  await pane.getByText(/1 Datei\(en\) ins Hauptprojekt zurückgeführt/).waitFor();
  assert.equal(await readFile(path.join(repo, 'one.txt'), 'utf8'), 'alpha returned\n'); assert.equal(await readFile(path.join(repo, 'two.txt'), 'utf8'), 'foreign dirty main\n');
  await page.waitForFunction(() => window.fixture.ide.getState().files['one.txt'] === 'alpha returned\n'); checks.push('Return action updates only checked source paths and refreshes the opened editor');
  await pane.locator('li').filter({ hasText: 'Auftrag Beta' }).first().getByRole('button', { name: 'Änderungen', exact: true }).click();
  await pane.getByText('Konflikte · beide Stände bleiben erhalten', { exact: true }).waitFor(); assert.equal(await pane.getByRole('button', { name: 'Ins Hauptprojekt rückführen', exact: true }).isDisabled(), true);
  assert.equal(await readFile(path.join(repo, 'one.txt'), 'utf8'), 'alpha returned\n'); assert.equal(await readFile(path.join(beta.path, 'one.txt'), 'utf8'), 'beta conflicts\n'); checks.push('Conflicting second return is visibly blocked and preserves both file contents');
  await pane.getByPlaceholder('Name der Aufgabe').fill('Leerer Teststand'); await pane.getByRole('button', { name: 'Erstellen', exact: true }).click(); await pane.getByText('Leerer Teststand', { exact: true }).waitFor();
  const empty = (await request({ action: 'list' })).worktrees.find(w => w.name === 'Leerer Teststand');
  await pane.locator('li').filter({ hasText: 'Leerer Teststand' }).first().getByRole('button', { name: 'Leeren Stand entfernen', exact: true }).click(); await pane.getByText('Leeren, unveränderten Arbeitsstand entfernt. Der Git-Branch bleibt erhalten.', { exact: true }).waitFor();
  assert.equal(existsSync(empty.path), false); checks.push('Cleanup removes only a clean owned checkout through an explicit UI action');
  await page.screenshot({ path: path.join(output, 'worktrees-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(output, 'worktrees-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); checks.push('Mobile layout at 390 by 844 has no horizontal document overflow');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.equal(nativeCalls.some(call => ['start', 'resume'].includes(call.action)), false, 'browser fixture never dispatches a model start');
  await context.close();
  await writeFile(path.join(output, 'browser-verification.json'), JSON.stringify({ ok: true, at: new Date().toISOString(), checks, errors, consoleErrors, area, syntheticModel: true, realGitAndCompanion: true, requests: requests.filter(url => !url.startsWith(server.resolvedUrls.local[0])) }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, area }, null, 2));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: path.join(output, 'worktrees-failed.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'browser-verification.json'), JSON.stringify({ ok: false, checks, error: String(error), errors, consoleErrors, requests, area }, null, 2)); throw error;
} finally {
  await registry?.close(); await browser?.close(); if (server) await new Promise(r => server.httpServer.close(r));
  if (companion?.exitCode == null) { const exited = once(companion, 'exit'); companion.kill(); await exited; }
}
