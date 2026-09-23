/** Regression: category/all-files menus must survive repeated real clicks. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const dev = process.argv.includes('--dev');
const port = dev ? 8197 : 8198;
const origin = `http://127.0.0.1:${port}`;
const out = path.resolve('artifacts/tab-groups', dev ? 'dev' : 'production');
await mkdir(out, { recursive: true });
const server = spawn(process.execPath, dev
  ? ['scripts/with-app-env.mjs', './node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  : ['.output/server/index.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: dev ? 'development' : 'production' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '', browser;
server.stdout.on('data', x => { log = (log + x).slice(-6000); });
server.stderr.on('data', x => { log = (log + x).slice(-6000); });
const result = { mode: dev ? 'dev' : 'production', errors: [], checks: [] };
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw Error(log);
    try { ready = (await fetch(origin)).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(ready, log);
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => result.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 204, body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('anvil-ide', JSON.stringify({ state: { setupDone: true, autoUpdate: false, autoSaveDisk: false, suggestOn: false, liveRun: false }, version: 0 }));
    localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  const files = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`tabs/file-${i}.${i < 20 ? 'txt' : 'md'}`, `Fixture ${i}\n`]));
  await page.evaluate(files => window.__anvilIde.setState({ files, openPaths: Object.keys(files), activePath: Object.keys(files)[0], dirty: {}, pendingDiffs: [], workspaceCwd: '', previewOpen: false, runPath: null, liveRun: false, autoSaveDisk: false, agentBusy: false, panels: { ...window.__anvilIde.getState().panels, agent: false }, trailOpen: false }), files);
  const group = page.locator('button[title$=" MD"]').first();
  const all = page.getByTitle('Offene Dateien', { exact: true });
  await group.waitFor({ state: 'visible' });
  for (let i = 0; i < 6; i++) {
    await group.click();
    await page.getByRole('menuitem').filter({ hasText: 'file-39.md' }).waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Escape');
    await all.click();
    await page.getByRole('menuitem').filter({ hasText: 'tabs/file-39.md' }).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByLabel('Menü schließen', { exact: true }).click({ position: { x: 5, y: 5 } });
  }
  result.checks.push('Category and all-files menus reopen six times; Escape and outside click dismiss');
  await group.click();
  await page.screenshot({ path: path.join(out, 'category.png') });
  await page.getByRole('menuitem').filter({ hasText: 'file-39.md' }).click();
  await page.waitForFunction(() => window.__anvilIde.getState().activePath === 'tabs/file-39.md');
  await page.locator('[data-tab="tabs/file-39.md"]').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('menu').count(), 0);
  await all.click();
  await page.getByRole('menuitem').filter({ hasText: 'tabs/file-38.md' }).getByRole('button').click();
  await page.waitForFunction(() => !window.__anvilIde.getState().openPaths.includes('tabs/file-38.md'));
  await page.keyboard.press('Escape');
  result.checks.push('Hidden file selection reveals active tab; closing a listed file updates tabs');
  await page.setViewportSize({ width: 700, height: 800 });
  const closeExplorer = page.getByLabel('Explorer schließen', { exact: true });
  if (await closeExplorer.isVisible()) await closeExplorer.click();
  await all.click();
  await page.getByRole('menuitem').filter({ hasText: 'tabs/file-39.md' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(out, 'narrow.png') });
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.__anvilIde.getState().files), files);
  assert.deepEqual(result.errors, []);
  result.checks.push('Narrow window all-files menu works; file contents unchanged; no runtime errors');
  result.ok = true;
} catch (e) { result.ok = false; result.error = String(e.stack || e); process.exitCode = 1; }
finally {
  await browser?.close(); server.kill();
  await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
