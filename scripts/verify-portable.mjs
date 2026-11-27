import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { _electron } from 'playwright';
import { verifyBackgroundPackage } from './background-package-check.mjs';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

const [archive, executable = 'Anvil.exe'] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.ok(archive && path.isAbsolute(archive) && /\.zip$/i.test(archive));
assert.ok(process.env.CI === 'true' || executable === 'AnvilInstallerQA.exe', 'Use the separate QA product locally');
const output = path.resolve('artifacts/portable-acceptance'); await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(output, 'zip-'));
const target = path.join(fixture, 'app');
async function extractPortableZip() {
  await mkdir(target);
  const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  await new Promise((resolve, reject) => {
    const child = spawn(tar, ['-xf', archive, '-C', target], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`ZIP extraction failed (Windows tar: ${signal ?? code})`));
    });
  });
}
async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
const port = await freePort(), companion = await freePort();
const env = { ...process.env, ANVIL_PORT: String(port), ANVIL_COMPANION_PORT: String(companion) };
for (const key of Object.keys(env)) if (/^(path|ANVIL_QA_USER_DATA|ANVIL_USER_DATA|ANVIL_HOME|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key];
env.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`;
let app, page;
const result = { fixture, archive, checks: [], errors: [] };
async function launch() {
  app = await _electron.launch({ executablePath: path.join(target, executable), args: [`--user-data-dir=${path.join(target, 'data')}`], env, timeout: 60000 });
  for (let n = 0; n < 480; n++) { page = app.windows().find(w => w.url() === `http://127.0.0.1:${port}/`); if (page) break; await new Promise(r => setTimeout(r, 125)); }
  assert.ok(page, 'Extracted ZIP serves bundled application without external Node');
  page.on('pageerror', error => result.errors.push(error.message));
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated(), null, { timeout: 60000 });
  assert.ok((await page.locator('body').innerText()).length > 80, 'Real visible portable UI');
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), path.join(target, 'data'));
}
try {
  await extractPortableZip();
  const manifest = await verifyPackageFingerprint(path.join(target, 'resources', 'app'));
  await launch(); result.checks.push('real ZIP extraction, portable launch without external Node, profile beside executable');
  assert.equal(await app.evaluate(() => process.versions.electron), manifest.runtime, 'Portable package uses the declared Electron runtime');
  result.checks.push(`fresh package fingerprint and Electron ${manifest.runtime}`);
  result.checks.push(await verifyBackgroundPackage(page,fixture));
  await page.evaluate(() => window.__anvilIde.setState({ autoUpdate: false, setupDone: true, locale: 'en' }));
  await page.screenshot({ path: path.join(fixture, 'portable-app.png') });
  await app.close(); app = null; page = null;
  await launch();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().locale), 'en', 'Portable settings survive full restart');
  result.checks.push('portable full restart preserves settings');
  assert.deepEqual(result.errors, []); result.ok = true;
} catch (error) { result.ok = false; result.failure = String(error.stack || error); throw error; }
finally {
  if (app) { if (!result.ok) await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); else await app.close(); }
  await writeFile(path.join(fixture, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
}
