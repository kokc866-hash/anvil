// Built Anvil, isolated profile, controlled Open VSX responses; no installs or model calls.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { _electron } from 'playwright';

const root = process.cwd(), output = path.resolve('artifacts/market');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const env = { ...process.env, ANVIL_PORT: String(port), ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
const server = spawn(process.execPath, [path.join(root, '.output/server/index.mjs')], {
  cwd: root, windowsHide: true, stdio: 'ignore',
  env: { ...env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' },
});
let app, page;
const requests = [], errors = [], held = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reply = query => ({ extensions: [{ namespace: 'QA', name: query, displayName: `Result ${query}`, description: 'Controlled market result' }] });
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {}
    await pause(250);
  }
  app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [`--user-data-dir=${profile}`, path.join(root, 'fixtures/electron-boot.mjs')], env, timeout: 45000 });
  for (let i = 0; i < 360; i++) { page = app.windows().find(p => p.url() === `http://127.0.0.1:${port}/`); if (page) break; await pause(125); }
  assert.ok(page);
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://open-vsx.org/api/-/search?**', async route => {
    const query = new URL(route.request().url()).searchParams.get('query');
    requests.push(query);
    if (query.startsWith('slow')) await new Promise(resolve => held.set(query, resolve));
    if (query === 'failure') await route.fulfill({ status: 503, body: 'Unavailable' }).catch(() => {});
    else await route.fulfill({ json: reply(query) }).catch(() => {});
  });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(() => window.__anvilIde.setState({ setupDone: true, autoUpdate: false, sidebar: 'ext', locale: 'de', mcpServers: [] }));
  await page.getByRole('button', { name: 'Markt', exact: true }).click();
  await page.getByText('Result snippets', { exact: false }).waitFor();
  await pause(1500);
  assert.equal(requests.length, 1, 'market must not request again after displaying its own results');
  await page.evaluate(() => window.__anvilIde.setState({ files: { 'fixture.txt': 'unrelated editor change' } }));
  await pause(650);
  assert.equal(requests.length, 1, 'unrelated renders never restart a market request');
  const search = page.getByPlaceholder('Suchen', { exact: true });
  await search.fill('slow-old');
  while (!held.has('slow-old')) await pause(25);
  await search.fill('current');
  await page.getByText('Result current', { exact: false }).waitFor();
  held.get('slow-old')();
  await pause(500);
  assert.equal(await page.getByText('Result slow-old', { exact: false }).count(), 0, 'old response never replaces a newer search');
  await search.fill('slow-tab');
  while (!held.has('slow-tab')) await pause(25);
  await page.getByRole('button', { name: 'Alle Plugins', exact: true }).click();
  held.get('slow-tab')();
  await pause(400);
  const beforeReturn = requests.length;
  await page.getByRole('button', { name: 'Markt', exact: true }).click();
  await search.fill('failure');
  await page.getByText('Markt: HTTP 503', { exact: true }).waitFor();
  await pause(900);
  assert.equal(requests.length, beforeReturn + 1, 'failed search remains stable without retry loop');
  await search.fill('final');
  await page.getByText('Result final', { exact: false }).waitFor();
  await page.evaluate(() => window.__anvilIde.setState({ locale: 'en' }));
  await pause(1000);
  assert.equal(await page.getByText('Result final', { exact: false }).count(), 1);
  const stable = requests.length;
  await pause(700);
  assert.equal(requests.length, stable, 'language change settles without a new request loop');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'market-stable.png') });
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, requests, errors, profile }, null, 2));
  console.log('PASS: idle market, unrelated renders, changed query, tab cancellation, error state and language switch remain stable');
} finally {
  for (const resolve of held.values()) resolve();
  await app?.close().catch(() => {});
  server.kill();
}
