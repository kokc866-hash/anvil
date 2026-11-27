// Isolated layout regression, optionally against a freshly packaged EXE.
// Artificial chat data only. No existing window, job, project or profile is used.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer as socketServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { chromium, _electron } from 'playwright';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const output = path.resolve(arg('--output') || 'artifacts/trail-layout-2026-10-28/dev');
const requested = arg('--executable');
const executable = requested && path.resolve(requested);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = process => process.exitCode !== null || process.signalCode !== null;
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const temporary = path.join(profile, 'temp'); await mkdir(temporary);
const freePort = async () => { const server = socketServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; };
const port = await freePort(), companionPort = await freePort();
const origin = `http://127.0.0.1:${port}`;
const checks = [], errors = [], modelRequests = [], cleanupErrors = [];
const result = { ok: false, packaged: Boolean(executable), checks, errors, modelRequests, cleanupErrors, profile, cases: [] };
let dev, browser, app, page, companion;
const token = 'isolated-trail-layout-qa';
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companionPort), ANVIL_COMPANION_TOKEN: token, ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'token'), ANVIL_USER_DATA: profile, ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages'), TEMP: temporary, TMP: temporary };
delete env.ELECTRON_RUN_AS_NODE;
const until = async (predicate, label) => { const deadline = Date.now() + 45000; while (Date.now() < deadline) { if (await predicate()) return; await delay(100); } throw Error(`Trail layout QA timed out: ${label}`); };

try {
  if (executable) {
    result.manifest = await verifyPackageFingerprint(path.join(path.dirname(executable), 'resources/app'));
    companion = spawn(process.execPath, [path.join(path.dirname(executable), 'resources/app/companion/server.mjs')], { env, stdio: 'ignore', windowsHide: true });
    companion.once('error', error => cleanupErrors.push(error.message));
    await until(async () => { try { return (await fetch(`http://127.0.0.1:${companionPort}/v1/ping`, { headers: { 'x-anvil-token': token }, signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, 'owned Companion');
    app = await _electron.launch({ executablePath: executable, env, timeout: 60000 });
    await until(() => { page = app.windows().find(window => window.url() === origin + '/'); return page; }, 'owned EXE window');
  } else {
    dev = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, cacheDir: 'node_modules/.vite-trail-layout-check' }); await dev.listen();
    browser = await chromium.launch({ headless: true, executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  }
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  await page.context().route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (/\/api\/(?:llm-|chat|generate)|\/v1\/(?:chat\/completions|responses)|\/api\/generate/.test(url.pathname) || request.headers()['x-anvil-target']) { modelRequests.push(url.pathname); return route.abort(); }
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  if (!executable) {
    await page.addInitScript(() => {
      localStorage.setItem('anvil-ide', JSON.stringify({ state: { setupDone: true, helperOn: false, suggestOn: false, liveRun: false, autoSaveDisk: false, autoUpdate: false, files: { 'keep.txt': 'Artificial layout fixture.\n' }, workspaceCwd: '', workspaceMemoryId: 'isolated-trail-layout', mcpServers: [] }, version: 0 }));
      localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(() => {
    const plan = Array.from({ length: 12 }, (_, index) => ({ text: `Artificial task ${index + 1}: preserve the current layout fixture`, status: index === 0 ? 'ok' : 'todo' }));
    const steps = Array.from({ length: 48 }, (_, index) => ({ id: `step-${index}`, name: index % 2 ? 'edit_file' : 'read_file', detail: `fixture-${index}.js`, path: `fixture-${index}.js`, status: 'ok' }));
    window.__anvilIde.setState({ setupDone: true, panels: { files: false, code: true, agent: false, trail: true, output: false }, sidebar: null, locale: 'de', trailWidth: 480, trailThinkH: 712, helperOn: false, suggestOn: false, liveRun: false, engineLoop: false, harnessAutoContinue: false, autoSaveDisk: false, backgroundAgent: false, agentBusy: false, agentQueue: [], agentInbox: null, agentJob: null, mcpServers: [], workspaceCwd: '', githubRepo: '', workspaceMemoryId: 'isolated-trail-layout', files: { 'keep.txt': 'Artificial layout fixture.\n' }, chat: [{ id: 'human-layout', role: 'user', content: 'Artificial layout probe', at: 1 }, { id: 'assistant-layout', role: 'assistant', content: '', thinking: 'Artificial reasoning.\n'.repeat(600), at: Date.now(), plan, steps }] });
  });
  const pane = page.getByTestId('trail-pane'); await pane.waitFor();
  const tools = pane.getByTestId('trail-tools'), thinking = pane.getByTestId('trail-thinking');
  const resize = async (width, height) => {
    if (app) await app.evaluate(({ BrowserWindow }, size) => { const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === size.url); main.setSize(size.width, size.height); main.setTitle('Anvil – isolated trail layout QA'); }, { width, height, url: origin + '/' });
    else await page.setViewportSize({ width, height });
    if (width < 640) await page.getByRole('navigation', { name: 'Arbeitsbereich' }).getByRole('button', { name: 'Spur', exact: true }).click();
    await pane.waitFor();
    if (!await thinking.locator('pre').count()) await thinking.getByRole('button').first().click();
  };
  const measure = async label => {
    const geometry = await tools.evaluate(node => {
      const rect = node.getBoundingClientRect(), parent = node.closest('[data-testid="trail-pane"]').getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, parent.bottom) - Math.max(rect.top, parent.top));
      return { height: rect.height, visibleHeight, parentHeight: parent.height, top: rect.top, bottom: rect.bottom, parentBottom: parent.bottom, viewport: { width: innerWidth, height: innerHeight } };
    });
    result.cases.push({ label, ...geometry });
    assert.ok(geometry.height >= 96 && geometry.visibleHeight >= geometry.height - 1, `${label}: tool trail must have at least 96 visible px, actual ${JSON.stringify(geometry)}`);
    const scroll = tools.locator('div.overflow-y-auto').first();
    assert.ok(await scroll.evaluate(node => node.clientHeight >= 90), `${label}: actual tool scroller is usable`);
    return geometry;
  };
  await resize(1440, 1000);
  await page.screenshot({ path: path.join(output, 'large-thinking.png') });
  await measure('saved thinking height 712 / desktop');
  checks.push('Saved excessive thinking height cannot hide the real tool trail.');
  const heights = pane.getByTitle('Höhe des Denkverlaufs', { exact: true }).filter({ has: page.locator('button') });
  const visibleBefore = (await thinking.boundingBox()).height;
  await heights.locator('button').first().click();
  await until(async () => (await thinking.boundingBox()).height <= visibleBefore - 25, 'minus reacts from visible height');
  await heights.locator('button').last().click();
  await until(async () => Math.abs((await thinking.boundingBox()).height - visibleBefore) <= 2, 'plus restores visible height');
  checks.push('Minus and plus act immediately from the displayed height.');
  const separator = pane.getByRole('separator', { orientation: 'horizontal' });
  const handle = await separator.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 40, { steps: 4 }); await page.mouse.up();
  await until(async () => (await thinking.boundingBox()).height <= visibleBefore - 30, 'drag responds from the displayed height');
  await measure('after dragging thinking smaller');
  checks.push('Dragging reacts from the visible split without an off-screen dead zone.');
  await tools.locator('div.overflow-y-auto').first().evaluate(node => { node.scrollTop = 0; });
  const firstStep = tools.getByText('fixture-0.js', { exact: true }).first(); await firstStep.waitFor();
  assert.ok(await firstStep.isVisible());
  await tools.locator('div.overflow-y-auto').first().evaluate(node => { node.scrollTop = node.scrollHeight; });
  assert.ok(await tools.locator('div.overflow-y-auto').first().evaluate(node => node.scrollTop > 0));
  checks.push('Earlier and current tools remain independently scrollable.');
  await page.evaluate(() => window.__anvilIde.getState().setTrailThinkH(712));
  // Keep the EXE's real 960x640 minimum intact; narrower layouts are exercised in Chromium.
  const sizes = app ? [[1440, 800], [1024, 640], [960, 640]] : [[1440, 600], [1024, 480], [1024, 320], [640, 480], [390, 844]];
  for (const [width, height] of sizes) {
    await resize(width, height); await delay(100); await measure(`${width}x${height} / expanded To-do`);
    await page.screenshot({ path: path.join(output, `layout-${width}x${height}.png`) });
  }
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().trailThinkH), 712, 'Window resize does not overwrite preferred height.');
  await resize(1440, 1300); await delay(100); await measure('large window restores preferred 712px');
  assert.equal(Math.round((await thinking.boundingBox()).height), 712);
  await resize(1440, 1000);
  await pane.getByRole('button', { name: /To-do 1\/12/ }).click();
  await delay(100); await measure('collapsed To-do');
  await pane.getByRole('button', { name: /To-do 1\/12/ }).click();
  await delay(100); await measure('expanded To-do again');
  checks.push('Resize, narrow views and To-do expansion preserve the execution region and height preference.');
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().agentBusy), false);
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().chat.at(-1).id), 'assistant-layout');
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['keep.txt']), 'Artificial layout fixture.\n');
  assert.deepEqual(errors, []); assert.deepEqual(modelRequests, []);
  checks.push('The artificial task and project data remain unchanged; no model calls.');
  await resize(1440, 1000);
  const planRows = pane.getByRole('button', { name: /To-do/ }).locator('..').locator('ol > li');
  await planRows.nth(1).getByRole('button').click();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().chat.at(-1).plan[1].completedBy), 'user');
  assert.match(await planRows.nth(1).innerText(), /manuell/);
  assert.match(await planRows.nth(1).getByRole('button').getAttribute('title'), /Manuell/);
  assert.match(await planRows.nth(0).getByRole('button').getAttribute('title'), /nicht gespeichert/);
  await measure('manual completion provenance');
  await page.screenshot({ path: path.join(output, 'manual-completion.png') });
  await planRows.nth(1).getByRole('button').click();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().chat.at(-1).plan[1].completedBy), undefined);
  checks.push('Manual ticks are visibly identified and reset cleanly; older unknown provenance is not invented.');
  result.ok = true;
} catch (error) {
  result.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  if (app) {
    const own = app.process(); const ended = exited(own) ? Promise.resolve() : new Promise(resolve => own.once('exit', resolve));
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await Promise.race([ended, delay(10000)]);
    if (!exited(own)) { own.kill(); cleanupErrors.push('Owned Electron did not exit normally.'); }
    result.electronExit = { pid: own.pid, code: own.exitCode, signal: own.signalCode };
  }
  await browser?.close(); await dev?.close();
  if (companion) { const ended = exited(companion) ? Promise.resolve() : new Promise(resolve => companion.once('exit', resolve)); if (!exited(companion)) companion.kill(); await Promise.race([ended, delay(5000)]); if (!exited(companion)) cleanupErrors.push('Owned Companion did not exit.'); result.companionExit = { pid: companion.pid, code: companion.exitCode, signal: companion.signalCode }; }
  if (cleanupErrors.length) { result.ok = false; process.exitCode = 1; }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({ ok: result.ok, output, error: result.error?.message, checks, cases: result.cases, cleanupErrors }));
