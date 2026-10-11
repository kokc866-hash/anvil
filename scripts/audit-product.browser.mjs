// Production UI with an isolated browser profile and synthetic projects only.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {zipSync, strToU8} from 'fflate';

const output = path.resolve('artifacts/audit-2026-10-04/implementation/browser');
await mkdir(output, {recursive: true});
const profile = await mkdtemp(path.join(output, 'profile-'));
async function freePort() {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
const port = await freePort(), helperPort = await freePort(), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.resolve('.output/server/index.mjs')], {cwd: process.cwd(), windowsHide: true,
  env: {...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1'}, stdio: 'ignore'});
const result = {ok: false, profile, checks: [], errors: [], consoleErrors: [], blockedRequests: [], modelCalls: 0, emptyAssets: [], workers: []};
let context, page;
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {if ((await fetch(origin)).ok) break;} catch { /* Wait for our own production server. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  context = await chromium.launchPersistentContext(profile, {executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined,
    headless: true, viewport: {width: 1440, height: 960}});
  result.browser = context.browser().version();
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (/\/api\/llm(?:\/|$)/.test(url.pathname)) {result.modelCalls++; return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({error: 'No model calls in this UI fixture'})});}
      return route.continue();
    }
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    result.blockedRequests.push(url.origin + url.pathname);
    if (route.request().resourceType() === 'script') return route.fulfill({status: 200, contentType: 'application/javascript', body: '/* External script disabled in this isolated UI fixture. */'});
    if (route.request().resourceType() === 'stylesheet') return route.fulfill({status: 200, contentType: 'text/css', body: ''});
    // Discovery receives an unavailable synthetic helper, never the user's helper or model server.
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: false, error: 'Isolated fixture', models: [], data: [], tools: []})});
  });
  await context.addInitScript(({helperPort}) => {
    localStorage.setItem('anvil-ide', JSON.stringify({state: {setupDone: true, locale: 'de', autoUpdate: false, autoHw: false,
      autoSaveDisk: false, formatOnSave: false, companionKeep: false, companionUrl: `http://127.0.0.1:${helperPort}`, files: {}, openPaths: [], chat: [], sidebar: null}, savedAt: 1, version: 0}));
  }, {helperPort});
  page = await context.newPage();
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') result.consoleErrors.push(message.text());});
  page.on('worker', worker => result.workers.push(worker.url()));
  const assets = new Map();
  page.on('response', response => {
    const url = response.url();
    if (url.startsWith(origin) && /\.(?:js|css)(?:\?|$)/.test(url)) assets.set(url, response.body().then(body => ({url: new URL(url).pathname, bytes: body.length})).catch(() => ({url, bytes: 0})));
  });
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => Object.keys(window.__anvilIde.getState().files).length), 0);
  result.emptyAssets = await Promise.all([...assets.values()]);
  assert.equal(result.emptyAssets.some(asset => /compiler-worker/.test(asset.url)), false, 'Empty projects do not load the TypeScript compiler worker');
  assert.ok((await page.locator('body').innerText()).length > 80);
  await page.screenshot({path: path.join(output, 'desktop.png')});
  result.checks.push('fresh production UI visible; empty project does not load compiler worker');

  await page.getByRole('button', {name: 'Geführte Aufgaben', exact: true}).click();
  assert.equal(await page.locator('[data-testid^="workflow-"]').count(), 6);
  const understand = page.getByTestId('workflow-understand');
  await understand.locator('summary').click();
  assert.match(await understand.innerText(), /Projekt verstehen/);
  await understand.getByRole('button', {name: 'Skill-Bibliothek öffnen', exact: true}).click();
  await page.getByRole('button', {name: 'Skills', exact: true}).waitFor();
  result.checks.push('guided task opens the existing skill library');
  for (const [id, title, mode] of [['understand', 'Projekt verstehen', 'ask'], ['change', 'Änderung umsetzen', 'agent'],
    ['debug', 'Fehler beheben', 'agent'], ['review', 'Änderung prüfen', 'ask'], ['scene', 'Szene bearbeiten', 'agent'], ['cad', 'Bauteil erstellen', 'agent']]) {
    await page.getByRole('button', {name: 'Geführte Aufgaben', exact: true}).click();
    await page.locator('#anvil-chat').fill('Meine konkrete Testaufgabe');
    await page.getByTestId(`workflow-${id}`).getByRole('button', {name: new RegExp(`^${title}`)}).click();
    assert.equal(await page.evaluate(() => window.__anvilIde.getState().agentMode), mode);
    assert.match(await page.locator('#anvil-chat').inputValue(), /Mein Auftrag: Meine konkrete Testaufgabe/);
    assert.equal(await page.evaluate(() => window.__anvilIde.getState().chat.length), 0);
  }
  result.checks.push('all six tasks keep the user task editable, select the mode and never send automatically');
  await page.getByRole('button', {name: 'Geführte Aufgaben', exact: true}).click();
  await page.getByTestId('workflow-cad').locator('summary').click();
  assert.match(await page.getByTestId('workflow-cad').innerText(), /Zuerst das Zielprojekt oder die Anwendung festlegen/);
  await page.screenshot({path: path.join(output, 'tasks.png')});

  const code = value => `// @desc Isolierte Freigabeprüfung\nfunction activate(anvil) { globalThis.__auditPlugin = "${value}"; }`;
  await page.evaluate(source => {const state = window.__anvilIde.getState(); window.__anvilIde.setState({files: {'plugins/audit-probe.js': source}, sidebar: 'ext', workspaceEpoch: state.workspaceEpoch + 1});}, code('alpha'));
  await page.getByRole('button', {name: 'Projekt-Plugins', exact: true}).click();
  const plugin = page.getByRole('button', {name: 'plugins/audit-probe.js', exact: true}).locator('..');
  const toggle = plugin.getByRole('switch');
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.equal(await page.evaluate(() => globalThis.__auditPlugin), undefined);
  await toggle.click();
  const dialog = page.getByRole('dialog', {name: 'Plugin vertrauen und aktivieren', exact: true});
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /ohne Sandbox/);
  await page.waitForTimeout(300);
  const consentBounds = await dialog.boundingBox();
  assert.ok(consentBounds && consentBounds.x >= 0 && consentBounds.y >= 0
    && consentBounds.x + consentBounds.width <= 1440 && consentBounds.y + consentBounds.height <= 960, 'The trust dialog is inside the viewport');
  result.consentBounds = consentBounds;
  await page.screenshot({path: path.join(output, 'plugin-consent.png'), animations: 'disabled'});
  await page.evaluate(source => window.__anvilIde.setState({files: {'plugins/audit-probe.js': source}}), code('bravo'));
  await dialog.getByRole('button', {name: 'Vertrauen und aktivieren', exact: true}).click();
  await dialog.waitFor({state: 'hidden'});
  assert.equal(await page.evaluate(() => globalThis.__auditPlugin), undefined, 'A changed code body cannot use an older pending approval');
  await toggle.click();
  await dialog.getByRole('button', {name: 'Vertrauen und aktivieren', exact: true}).click();
  await page.waitForFunction(() => globalThis.__auditPlugin === 'bravo');
  await page.evaluate(source => window.__anvilIde.setState({files: {'plugins/audit-probe.js': source}}), code('alpha'));
  await page.waitForFunction(() => window.__anvilIde.getState().pluginDisabled.includes('ws:plugins/audit-probe.js'));
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.equal(await page.evaluate(() => globalThis.__auditPlugin), 'bravo', 'Same-length changes revoke approval before executing');
  await toggle.click();
  await dialog.getByRole('button', {name: 'Vertrauen und aktivieren', exact: true}).click();
  await page.waitForFunction(() => globalThis.__auditPlugin === 'alpha');
  await page.evaluate(source => window.__anvilIde.setState({files: {'plugins/audit-probe.js': '// @trust\n' + source}}), code('alpha'));
  await page.waitForFunction(() => window.__anvilIde.getState().pluginDisabled.includes('ws:plugins/audit-probe.js'));
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  result.checks.push('real renderer plugins remain inactive before approval; pending consent, same-length changes and @trust upgrades revoke approval');

  const manifest = {name: 'audit-offline-extension', version: '1.0.0', contributes: {snippets: [{language: 'javascript', path: 'snippets/javascript.json'}]}};
  const snippet = JSON.stringify({Proof: {prefix: 'auditProof', body: 'const auditProof = true;'}});
  const vsix = Buffer.from(zipSync({'extension/package.json': strToU8(JSON.stringify(manifest)), 'extension/snippets/javascript.json': strToU8(snippet)}));
  const chooseVsix = async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', {name: 'VSIX importieren', exact: true}).click();
    await (await chooser).setFiles({name: 'audit-offline.vsix', mimeType: 'application/octet-stream', buffer: vsix});
  };
  await chooseVsix();
  await page.waitForFunction(() => window.__anvilIde.getState().files['plugins/audit-offline/snippets/javascript.json']);
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['plugins/audit-offline/snippets/javascript.json']), snippet);
  assert.equal(await page.evaluate(() => JSON.parse(window.__anvilIde.getState().files['plugins/audit-offline/package.json']).name), manifest.name);
  assert.ok(result.workers.some(url => /archive-worker/.test(url)), 'Production VSIX import actually uses the bundled module worker');
  result.checks.push('legacy VSIX import works offline through the real production archive worker');
  await chooseVsix();
  await page.waitForFunction(() => /Bereits vorhanden, nicht überschrieben/.test(window.__anvilIde.getState().notice));
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['plugins/audit-offline/snippets/javascript.json']), snippet);
  result.checks.push('a repeated VSIX import refuses to overwrite existing files');
  const pdf = Buffer.from('%PDF-1.4\nSynthetic binary PDF\n\x00\xff\n%%EOF', 'latin1');
  const zip = zipSync({'archive-proof/result.txt': strToU8('Offline archive proof'), 'archive-proof/document.pdf': pdf});
  await page.getByRole('button', {name: 'Geführte Aufgaben', exact: true}).evaluate((button, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(bytes)], 'audit-files.zip', {type: 'application/zip'}));
    button.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer}));
  }, [...zip]);
  await page.waitForFunction(() => window.__anvilIde.getState().files['archive-proof/document.pdf']);
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['archive-proof/document.pdf']), `data:application/pdf;base64,${pdf.toString('base64')}`);
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['archive-proof/result.txt']), 'Offline archive proof');
  assert.equal(result.blockedRequests.some(url => /esm\.sh|fflate/.test(url)), false);
  result.checks.push('ZIP drag import retains the exact original binary PDF offline');

  await page.evaluate(() => window.__anvilIde.setState({files: {'main.ts': 'export const answer: number = 42;'}, activePath: 'main.ts', openPaths: ['main.ts'], sidebar: null}));
  await page.waitForFunction(() => window.__anvilIde.getState().files['main.ts']);
  for (let attempt = 0; attempt < 100 && ![...assets.keys()].some(url => /compiler-worker/.test(url)); attempt++) await page.waitForTimeout(100);
  assert.ok([...assets.keys()].some(url => /compiler-worker/.test(url)), 'The compiler loads when a TypeScript file is present');
  result.checks.push('TypeScript project loads the compiler on demand');
  // Let the preceding successful project save settle before injecting a new failure.
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('anvil-persistence', {detail: {error: 'Künstlicher Archivfehler'}})));
  await page.getByTestId('persistence-warning').waitFor();
  await page.waitForTimeout(2700);
  assert.match(await page.getByTestId('persistence-warning').innerText(), /Künstlicher Archivfehler/);
  await page.getByTestId('persistence-warning').getByRole('button', {name: 'Schließen', exact: true}).click();
  await page.getByTestId('persistence-warning').waitFor({state: 'hidden'});
  result.checks.push('backup failures stay visible beyond the normal short notice');
  await page.setViewportSize({width: 390, height: 844});
  assert.ok((await page.locator('body').innerText()).length > 80);
  const geometry = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
  assert.ok(geometry.scroll <= geometry.width, 'Small viewport has no horizontal overflow');
  await page.screenshot({path: path.join(output, 'mobile.png')});
  assert.deepEqual(result.errors, []); assert.deepEqual(result.consoleErrors, []); assert.equal(result.modelCalls, 0);
  result.checks.push('small viewport renders without overflow or uncaught errors');
  result.ok = true;
} catch (error) {
  result.failure = String(error.stack || error);
  await page?.screenshot({path: path.join(output, 'failure.png')}).catch(() => {});
  throw error;
} finally {
  await context?.close(); server.kill();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
