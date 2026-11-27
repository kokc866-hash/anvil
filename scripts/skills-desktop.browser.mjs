// Packaged desktop Skill QA. A fresh profile and an artificial IDB project only.
// No model replies, service fixtures, renderer imports or production test hooks.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { _electron } from 'playwright';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

const argument = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw Error(`Missing value for ${name}`);
  return value;
};
if (process.argv.includes('--help')) {
  console.log('node scripts/skills-desktop.browser.mjs --executable <fresh packaged Anvil.exe> [--output <artifact directory>]');
  process.exit(0);
}
const requested = argument('--executable') || process.env.ANVIL_QA_EXECUTABLE;
assert.ok(requested, 'Pass --executable for the freshly built packaged EXE. No old-build default is used.');
const executable = path.resolve(requested);
const output = path.resolve(argument('--output') || 'artifacts/skills-improvement-2026-10-28/desktop');
await mkdir(output, { recursive: true });
const manifest = await verifyPackageFingerprint(path.join(path.dirname(executable), 'resources/app'));
const catalog = JSON.parse(await readFile('skills/anvil/catalog.json', 'utf8'));
assert.equal(catalog.length, 23, 'The fresh package must include the 23 maintained Anvil skills.');
const newIds = ['anvil-auftrag-fortsetzen', 'anvil-anwendung-pruefen', 'anvil-assets-uebertragen', 'anvil-abhaengigkeiten-pflegen', 'anvil-eigenschaftstests', 'anvil-react', 'anvil-bedienung-verbessern'];
for (const id of newIds) assert.ok(catalog.some(skill => skill.id === id), `New skill declared: ${id}`);
const profile = await mkdtemp(path.join(output, 'profile-'));
assert.ok(profile.startsWith(output + path.sep), 'QA data is inside its own artifact directory.');
const temporary = path.join(profile, 'temp'); await mkdir(temporary);
const checks = [], errors = [], consoleErrors = [], dialogs = [], blockedExternal = [], modelRequests = [], cleanupErrors = [];
const result = { ok: false, executable, profile, source: manifest.source, outputFingerprint: manifest.outputFingerprint,
  version: manifest.version, realModelInference: false, artificialProject: true, checks, errors, consoleErrors, dialogs, blockedExternal, modelRequests, cleanupErrors, launches: 0 };

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw Error(`Packaged Skill QA timed out: ${description}`);
}
async function freePort(excluded = []) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (!excluded.includes(port)) return port;
  }
  throw Error('Could not reserve distinct app and Companion ports.');
}
const appPort = await freePort(), companionPort = await freePort([appPort]);
const origin = `http://127.0.0.1:${appPort}`, companionOrigin = `http://127.0.0.1:${companionPort}`;
Object.assign(result, { appPort, companionPort });
const token = 'isolated-skills-desktop-qa';
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(appPort),
  ANVIL_COMPANION_PORT: String(companionPort), ANVIL_COMPANION_TOKEN: token,
  ANVIL_COMPANION_TOKEN_FILE: path.join(profile, 'companion-token'), ANVIL_QA_USER_DATA: profile,
  ANVIL_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages'), ANVIL_INSTALL_DIR: path.dirname(executable), TEMP: temporary, TMP: temporary };
delete env.ELECTRON_RUN_AS_NODE;
let app, page, companion;
const launched = [], stderr = [];
const hasExited = child => child.exitCode !== null || child.signalCode !== null;

function watchPage(current) {
  current.on('pageerror', error => errors.push(error.message));
  current.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  current.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
}

async function launch() {
  app = await _electron.launch({ executablePath: executable, env, timeout: 60000 });
  result.launches++;
  const own = app.process(); launched.push(own);
  own.stderr?.on('data', chunk => { stderr.push(String(chunk)); if (stderr.length > 60) stderr.shift(); });
  const context = app.context();
  context.on('page', watchPage);
  for (const existing of app.windows()) watchPage(existing);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (/\/api\/(?:llm-|chat|generate|embeddings)|\/v1\/(?:chat\/completions|responses|embeddings)/.test(url.pathname) || request.headers()['x-anvil-target']) {
      modelRequests.push({ launch: result.launches, path: url.pathname });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Model calls disabled in isolated Skill UI QA"}' });
    }
    if (url.hostname === '127.0.0.1' && url.port === '7845') {
      url.port = String(companionPort);
      return route.continue({ url: url.href, headers: { ...request.headers(), 'x-anvil-token': token } });
    }
    if ([origin, companionOrigin].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    blockedExternal.push({ launch: result.launches, origin: url.origin, path: url.pathname });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await until(() => { page = app.windows().find(window => window.url() === origin + '/'); return page; }, 'main packaged window', 60000);
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(120000);
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated(), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }, url) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
    assertMain(main);
    function assertMain(window) { if (!window) throw Error('Owned QA window missing.'); }
    main.setSize(1500, 1060);
    main.setTitle('Anvil – isolated packaged Skill QA');
  }, origin + '/');
  console.log(`[skills-desktop] launch ${result.launches}: renderer hydrated`);
}

async function closeApp() {
  if (!app) return;
  const current = app; app = undefined;
  const own = current.process();
  const exited = hasExited(own) ? Promise.resolve() : new Promise(resolve => own.once('exit', resolve));
  await current.evaluate(({ app }) => app.exit(0)).catch(() => {});
  try { await Promise.race([exited, delay(12000).then(() => { throw Error('Owned Electron process did not exit.'); })]); }
  catch (error) {
    if (!hasExited(own)) own.kill();
    await Promise.race([exited, delay(5000)]);
    cleanupErrors.push(error.message);
    throw error;
  } finally { page = undefined; }
}

async function openLibrary() {
  await page.evaluate(() => window.__anvilIde.getState().setSidebar('ext'));
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  const library = page.getByTestId('skill-library');
  await library.waitFor();
  return library;
}
async function openGroup(id) {
  const group = page.getByTestId(`skill-group-${id}`);
  await group.waitFor();
  if (!await group.evaluate(node => node.open)) await group.locator(':scope > summary').click();
}
function card(id) { return page.locator(`[data-testid="skill-card"][data-skill-id="${id}"]`); }
async function noConfirmation() {
  assert.equal(await page.getByRole('alertdialog').count(), 0, 'No additional confirmation window.');
  assert.equal(await page.getByRole('dialog').count(), 0, 'No additional dialog is required for Skill management.');
  assert.deepEqual(dialogs, [], 'No JavaScript confirmation dialog.');
}
const copyName = 'anvil-godot-projekt', copyRoot = `.anvil/skills/${copyName}/`, copyManifest = copyRoot + 'SKILL.md';
const editedWhen = 'Künstlicher Desktop-Test: Lies ausschließlich die unveränderte keep.txt.';
const editedBody = 'Lies keep.txt und berichte nur ihren aktuellen Inhalt. Keine Modellanfrage, kein Programmstart und keine Änderungen an anderen Dateien.';
const keep = 'Artificial packaged Skill QA; this file must remain unchanged.\n';

try {
  companion = spawn(process.execPath, [path.join(path.dirname(executable), 'resources/app/companion/server.mjs')], { env, windowsHide: true, stdio: 'ignore' });
  companion.once('error', error => cleanupErrors.push(`Companion start: ${error.message}`));
  await until(async () => {
    try { return (await fetch(companionOrigin + '/v1/ping', { headers: { 'x-anvil-token': token }, signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, 'owned Companion');
  await launch();
  // The sole project fixture is placed through the application's existing IDE store.
  // Default Learn state supplies the built-in library; no custom Learn/Brain hooks.
  await page.evaluate(keep => window.__anvilIde.setState({ setupDone: true, settingsOpen: false, autoUpdate: false,
    helperOn: false, suggestOn: false, liveRun: false, companionKeep: false, autoSaveDisk: false,
    autoPreview: false, autoRunAgent: false, runLoop: false, graphLoop: false, testLoop: false,
    engineLoop: false, harnessAutoContinue: false, agentMode: 'agent', agentBusy: false,
    backgroundAgent: false, agentQueue: [], agentInbox: null, agentJob: null, chat: [], mcpServers: [],
    activeSurfaceId: 'anvil', surfaceMode: 'bridge', locale: 'de', sidebar: 'ext', sidebarWidth: 470,
    workspaceCwd: '', githubRepo: '', workspaceMemoryId: 'packaged-skills-idb-fixture', workspaceEpoch: 2,
    files: { 'project.godot': '[application]\nconfig/name="Artificial packaged Skill QA"\n', 'main.gd': 'extends Node\n', 'keep.txt': keep },
    dirs: [], openPaths: [], activePath: null, dirty: {}, editBases: {}, pendingDiffs: [], checkpoints: [] }), keep);
  let library = await openLibrary();
  assert.equal(await library.getByTestId('skill-card').count(), catalog.length);
  for (const id of newIds) {
    const expected = catalog.find(skill => skill.id === id);
    await openGroup(expected.category);
    const entry = card(id);
    assert.match(await entry.innerText(), new RegExp(expected.version.replaceAll('.', '\\.')));
    await entry.getByText('Anleitung und Voraussetzungen', { exact: true }).click();
    assert.match(await entry.innerText(), /Kompatibilität:.*Anvil/s, `New skill declares its actual Anvil requirement: ${id}`);
    await entry.getByText('Anleitung und Voraussetzungen', { exact: true }).click();
  }
  checks.push('All 23 native built-ins, including the new specialist Skills with explicit Anvil compatibility, are visible in the packaged UI.');
  await library.getByText('Skill-Auswahl ausprobieren', { exact: true }).click();
  const sample = library.getByRole('textbox', { name: 'Auftrag für Skill-Vorschau', exact: true });
  const preview = sample.locator('..');
  await sample.fill('Nutze weder FreeCAD noch Git. Erkläre nur den Projektaufbau.');
  assert.match(await preview.innerText(), /Projekt verstehen/);
  assert.doesNotMatch(await preview.innerText(), /Parametrisch mit FreeCAD|Mit Git arbeiten/);
  await sample.fill('Füge der geöffneten Szene einen Doppelsprung hinzu.');
  assert.match(await preview.innerText(), /Mit Godot arbeiten/);
  await library.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'selection.png') });
  checks.push('Packaged automatic selection respects explicit exclusions and infers Godot from the artificial open scene.');
  await openGroup('engines');
  await card('anvil-godot').getByRole('button', { name: 'Projektkopie bearbeiten', exact: true }).click();
  await page.waitForFunction(file => window.__anvilIde.getState().activePath === file, copyManifest);
  await openGroup('custom');
  const ownCard = library.getByTestId('skill-card').filter({ has: page.getByRole('heading', { name: copyName, exact: true }) });
  assert.match(await ownCard.innerText(), /Dieses Projekt/);
  const references = await page.evaluate(root => Object.keys(window.__anvilIde.getState().files).filter(file => file.startsWith(root + 'references/')), copyRoot);
  assert.ok(references.length > 0, 'The editable copy contains its supporting references.');
  await ownCard.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await ownCard.getByRole('textbox', { name: `Beschreibung für ${copyName}`, exact: true }).fill(editedWhen);
  await ownCard.getByRole('textbox', { name: `Anleitung für ${copyName}`, exact: true }).fill(editedBody);
  await ownCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'inline-editor.png') });
  await ownCard.getByRole('button', { name: 'Skill speichern', exact: true }).click();
  await ownCard.getByText('Skill gespeichert.', { exact: true }).waitFor();
  assert.equal(await ownCard.getByRole('textbox').count(), 0);
  await page.waitForFunction(({ file, body }) => window.__anvilIde.getState().files[file]?.includes(body), { file: copyManifest, body: editedBody });
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['keep.txt']), keep);
  await noConfirmation();
  checks.push('Real packaged Skill copy -> supporting resource -> inline description/body edit -> confirmed persistent save, without changing keep.txt or asking for confirmation.');
  console.log('[skills-desktop] saved edited project copy; restarting the complete application');
  await closeApp();
  await launch();
  await page.waitForFunction(() => window.__anvilIde.getState().workspaceMemoryId === 'packaged-skills-idb-fixture');
  library = await openLibrary(); await openGroup('custom');
  const recovered = library.getByTestId('skill-card').filter({ has: page.getByRole('heading', { name: copyName, exact: true }) });
  assert.match(await recovered.innerText(), /Künstlicher Desktop-Test/);
  await recovered.getByText('Anleitung und Voraussetzungen', { exact: true }).click();
  assert.match(await recovered.innerText(), /Lies keep\.txt und berichte nur ihren aktuellen Inhalt/);
  assert.deepEqual(await page.evaluate(root => Object.keys(window.__anvilIde.getState().files).filter(file => file.startsWith(root + 'references/')), copyRoot), references);
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['keep.txt']), keep);
  await recovered.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'recovered-after-restart.png') });
  checks.push('The complete EXE restarted with the same isolated profile and recovered the edited Skill and its references from actual persistence.');
  await recovered.getByRole('button', { name: 'Entfernen', exact: true }).click();
  await recovered.waitFor({ state: 'detached' });
  assert.ok(await page.evaluate(root => !Object.keys(window.__anvilIde.getState().files).some(file => file.startsWith(root)), copyRoot));
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['keep.txt']), keep);
  await noConfirmation();
  await closeApp();
  await launch();
  await page.waitForFunction(() => window.__anvilIde.getState().workspaceMemoryId === 'packaged-skills-idb-fixture');
  library = await openLibrary();
  assert.equal(await library.getByTestId('skill-card').count(), catalog.length, 'The deleted Skill does not return after a second complete restart.');
  assert.ok(await page.evaluate(root => !Object.keys(window.__anvilIde.getState().files).some(file => file.startsWith(root)), copyRoot));
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['keep.txt']), keep);
  await noConfirmation();
  await page.screenshot({ path: path.join(output, 'removed-after-restart.png') });
  checks.push('Skill and owned references were removed together and stayed absent after another complete application restart.');
  assert.deepEqual(modelRequests, []);
  assert.deepEqual(dialogs, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(cleanupErrors, []);
  result.ok = true;
} catch (error) {
  result.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (page && !result.ok) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    result.body = await page.locator('body').innerText().catch(() => '');
  }
  try { await closeApp(); } catch (error) { cleanupErrors.push(error.message); }
  if (companion && !hasExited(companion)) {
    const exited = new Promise(resolve => companion.once('exit', resolve));
    companion.kill();
    await Promise.race([exited, delay(5000)]);
    if (!hasExited(companion)) cleanupErrors.push('Owned Companion did not exit.');
  }
  if (companion) result.companionExit = { pid: companion.pid, code: companion.exitCode, signal: companion.signalCode };
  result.electronExits = launched.map(child => ({ pid: child.pid, code: child.exitCode, signal: child.signalCode }));
  if (launched.some(child => !hasExited(child))) cleanupErrors.push('An owned Electron process is still running.');
  if (cleanupErrors.length) { result.ok = false; process.exitCode = 1; }
  result.stderrTail = stderr.join('').slice(-8000);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({ ok: result.ok, error: result.error?.message, checks, output, launches: result.launches, modelRequests: modelRequests.length, dialogs: dialogs.length, errors, consoleErrors, cleanupErrors }));
