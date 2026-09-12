import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { _electron } from 'playwright';

const [installer, executable = 'Anvil.exe'] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.ok(installer && path.isAbsolute(installer), 'Absolute installer path required');
assert.ok(process.env.CI === 'true' || executable === 'AnvilInstallerQA.exe', 'Local tests may only install the distinct QA product');
if (process.env.CI !== 'true') {
  const buildConfig = await readFile(path.join(path.dirname(installer), 'builder-effective-config.yaml'), 'utf8');
  assert.match(buildConfig, /^appId: ['"]?app\.anvil\.installerqa['"]?\s*$/m, 'QA package must have a separate Windows registration identity');
  assert.match(path.basename(installer), /AnvilInstallerQA/);
}
const root = path.resolve('artifacts/installer-acceptance'); await mkdir(root, { recursive: true });
const fixture = await mkdtemp(path.join(root, 'install-'));
const target = path.join(fixture, 'app');
const project = path.join(fixture, 'project'); await mkdir(project);
const before = '<!doctype html><title>Installer QA</title><h1>Before</h1>';
const after = '<!doctype html><title>Installer QA</title><h1>Saved through packaged Anvil</h1>';
await writeFile(path.join(project, 'index.html'), before);
const result = { fixture, checks: [], errors: [] };
let app, page;
async function command(file, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => reject(new Error(`Timed out; inspect fixture manually: ${file}`)), 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(code); });
  });
}
async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
// Production keeps a stable origin (normally :8080). Changing it on restart
// would create a new browser storage origin and test a different profile.
const port = await freePort(); const companion = await freePort();
async function launch() {
  const env = { ...process.env, ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companion) };
  for (const key of Object.keys(env)) if (/^(path|ANVIL_QA_USER_DATA|ANVIL_USER_DATA|ANVIL_HOME|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key];
  env.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`;
  app = await _electron.launch({ executablePath: path.join(target, executable), args: [`--user-data-dir=${path.join(target, 'data')}`], env, timeout: 60000 });
  for (let n = 0; n < 480; n++) { page = app.windows().find(w => w.url() === `http://127.0.0.1:${port}/`); if (page) break; await new Promise(r => setTimeout(r, 125)); }
  assert.ok(page, 'Installed application loads its bundled UI without external Node.js');
  page.on('pageerror', e => result.errors.push(e.message));
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated(), null, { timeout: 60000 });
  await page.evaluate(companion => window.__anvilIde.setState({ autoUpdate: false, setupDone: true, companionKeep: true, companionUrl: `http://127.0.0.1:${companion}` }), companion);
  assert.ok((await page.locator('body').innerText()).length > 50, 'Visible app content');
  const profile = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(path.resolve(profile), path.join(target, 'data'), 'Installed data stays beside the app');
}
async function close() { await app.close(); app = null; page = null; }
try {
  assert.equal(await command(installer, ['/S', `/D=${target}`]), 0, 'Fresh install');
  await launch(); result.checks.push('fresh installed UI, own data directory, external Node absent from PATH');
  await page.evaluate(({ project, before, after }) => {
    const store = window.__anvilIde;
    store.setState({ files: { 'index.html': before }, dirs: [], dirty: {}, editBases: {}, activePath: 'index.html', openPaths: ['index.html'], workspaceCwd: project, diskName: 'project', pendingDiffs: [], autoSaveDisk: false, formatOnSave: false });
    store.getState().setContent('index.html', after);
  }, { project, before, after });
  assert.equal(await command(installer, ['/S', `/D=${target}`]), 2, 'Update must refuse a running app');
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['index.html']), after, 'Unsaved buffer survives update refusal');
  const uninstall = path.join(target, `Uninstall ${path.basename(executable, '.exe')}.exe`);
  assert.equal(await command(uninstall, ['/S', `_?=${target}`]), 2, 'Uninstall must refuse a running app');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http://127.0.0.1:'))?.close());
  await page.getByText('Ungespeicherte Änderungen', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['index.html']), after);
  result.checks.push('running update/uninstall refused; canceled close retains unsaved editor buffer');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => Object.keys(window.__anvilIde.getState().dirty).length === 0, null, { timeout: 30000 });
  assert.equal(await readFile(path.join(project, 'index.html'), 'utf8'), after, 'Packaged Companion saves without Node on PATH');
  await page.screenshot({ path: path.join(fixture, 'installed-app.png') });
  await close(); await launch();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['index.html']), after, 'Saved workspace survives full restart');
  await close();
  const retained = path.join(target, 'runs/fixture/program.txt'); await mkdir(path.dirname(retained), { recursive: true }); await writeFile(retained, 'user output');
  assert.equal(await command(installer, ['/S', `/D=${target}`]), 0, 'Closed-app update succeeds');
  await launch();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['index.html']), after, 'Workspace survives reinstall/update');
  assert.equal(await readFile(retained, 'utf8'), 'user output');
  await close(); result.checks.push('real disk save, restart, closed-app update and second launch preserve project/data/run output');
  const localState = await readFile(path.join(target, 'data/Local State'));
  const packagedPaths = (await readdir(target)).filter(name => !['data', 'runs', path.basename(uninstall)].includes(name));
  assert.equal(await command(uninstall, ['/S', `_?=${target}`]), 0, 'Closed-app uninstall');
  await assert.rejects(readFile(path.join(target, executable)), /ENOENT/);
  for (const name of ['dxcompiler.dll', 'dxil.dll', 'resources.pak']) await assert.rejects(readFile(path.join(target, name)), /ENOENT/, `Packaged runtime removed: ${name}`);
  for (const name of packagedPaths) await assert.rejects(access(path.join(target, name)), /ENOENT/, `Packaged entry removed: ${name}`);
  assert.deepEqual(await readFile(path.join(target, 'data/Local State')), localState, 'Uninstall preserves actual Chromium profile data');
  assert.equal(await readFile(retained, 'utf8'), 'user output');
  assert.equal(await readFile(path.join(project, 'index.html'), 'utf8'), after);
  result.checks.push('uninstall removes executable and preserves user files');
  assert.deepEqual(result.errors, []);
  result.ok = true;
} catch (error) {
  result.ok = false; result.failure = String(error.stack || error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(fixture, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) {
    if (!result.ok) await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
    else await close().catch(() => {});
  }
  await writeFile(path.join(fixture, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
