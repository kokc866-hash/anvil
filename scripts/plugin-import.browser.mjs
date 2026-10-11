// Real marketplace UI, isolated browser profile; all model/provider traffic blocked.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { skillPackageZip } from '../src/lib/skill-package.ts';
const production = process.argv.includes('--production');
const port = production ? 8198 : 8197, origin = `http://127.0.0.1:${port}`;
const output = `artifacts/plugin-import/${production ? 'production' : 'dev'}`;
await mkdir(output, { recursive: true });
let dev, processServer, browser, logs = '';
const schema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const skill = '---\nname: plugin-proof\ndescription: Verify the requested project change.\nscope: user\nkind: plugin\n---\nRead references/check.md. Never execute scripts unless the task explicitly needs it.\n';
const fixtures = {
  agent: { 'bundle/plugin.json': JSON.stringify({ $schema: schema, name: 'agent-proof', version: '1.0.0', license: 'MIT' }), 'bundle/skills/proof/SKILL.md': skill, 'bundle/skills/proof/references/check.md': 'Preserved reference', 'bundle/assets/pixel.bin': 'data:application/octet-stream;base64,AAECA/8=' },
  codex: { 'bundle/.codex-plugin/plugin.json': JSON.stringify({ name: 'codex-proof', description: 'Codex instructions with retained references.', license: 'MIT' }), 'bundle/skills/proof/SKILL.md': skill, 'bundle/skills/proof/references/check.md': 'Preserved reference', 'bundle/.mcp.json': JSON.stringify({ mcpServers: { docs: { url: 'https://example.org/mcp' } } }), 'bundle/.app.json': '{"apps":[]}' },
  cursor: { 'bundle/.cursor-plugin/plugin.json': JSON.stringify({ name: 'cursor-proof', description: 'Cursor instructions with unsupported hook disclosed.', skills: './guides/', license: 'MIT' }), 'bundle/guides/proof/SKILL.md': skill, 'bundle/guides/proof/references/check.md': 'Preserved reference', 'bundle/skills/ignored/SKILL.md': skill.replace('plugin-proof', 'ignored-proof'), 'bundle/hooks/hooks.json': '{"hooks":{"sessionStart":[{"command":"must-not-run"}]}}' },
};
const zip = files => Buffer.from(skillPackageZip(files));
try {
  if (production) {
    processServer = spawn(process.execPath, ['.output/server/index.mjs'], { windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
    processServer.stdout.on('data', chunk => logs = (logs + chunk).slice(-10000));
    processServer.stderr.on('data', chunk => logs = (logs + chunk).slice(-10000));
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) { try { ready = (await fetch(origin)).ok; } catch { /* Retry while the production server is starting. */ } if (ready) break; if (processServer.exitCode !== null) throw new Error(logs); await new Promise(resolve => setTimeout(resolve, 200)); }
    assert.ok(ready, logs);
  } else {
    dev = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, cacheDir: 'node_modules/.vite-plugin-import' });
    await dev.listen();
  }
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], blocked = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'open-vsx.org') return route.fulfill({ json: { extensions: [] } });
    if (url.origin !== origin && !['blob:', 'data:'].includes(url.protocol)) { blocked.push(url.origin); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('anvil-ide')) {
      localStorage.setItem('anvil-ide', JSON.stringify({ state: { setupDone: true, autoUpdate: false, autoSaveDisk: false, suggestOn: false, liveRun: false }, version: 0 }));
      localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
    }
  });
  console.log('OPEN', origin);
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(() => {
    const state = window.__anvilIde;
    state.setState({ files: { 'keep.txt': 'USER DATA' }, dirs: [], openPaths: [], activePath: null, dirty: {}, editBases: {}, workspaceCwd: '', workspaceEpoch: state.getState().workspaceEpoch + 1, workspaceMemoryId: 'plugin-browser-fixture', agentBusy: false, pathOperation: null, autoSaveDisk: false, suggestOn: false, liveRun: false, mcpServers: [], sidebar: 'ext', sidebarWidth: 440, locale: 'de' });
  });
  const market = async () => { await page.evaluate(() => window.__anvilIde.getState().setSidebar('ext')); await page.getByRole('button', { name: 'Marktplatz', exact: true }).click(); await page.getByTestId('agent-plugin-packages').waitFor(); };
  await market();
  console.log('MARKET_READY');
  // Two copies with the same identity must retain the actual selected manifest.
  const multi = Object.fromEntries(['first', 'second'].flatMap((root, i) => Object.entries(fixtures.agent).map(([file, body]) => [file.replace('bundle/', `${root}/`), file.endsWith('plugin.json') ? JSON.stringify({ ...JSON.parse(body), version: `${i + 1}.0.0` }) : body])));
  await page.getByLabel('Plugin ZIP', { exact: true }).setInputFiles({ name: 'multi.zip', mimeType: 'application/zip', buffer: zip(multi) });
  const selector = page.getByRole('combobox', { name: 'Paket im Archiv auswählen' });
  await selector.selectOption('second/plugin.json');
  await page.getByTestId('plugin-preview').getByRole('heading', { name: /agent-proof 2\.0\.0/ }).waitFor();
  assert.equal(await selector.inputValue(), 'second/plugin.json');
  await page.getByTestId('plugin-preview').getByRole('button', { name: 'Verwerfen' }).click();
  for (const [format, files] of Object.entries(fixtures)) {
    console.log('IMPORT', format);
    if (format === 'codex') {
      const directory = resolve(output, 'folder-input');
      for (const [relative, body] of Object.entries(files)) { const file = resolve(directory, relative); await mkdir(dirname(file), { recursive: true }); await writeFile(file, body); }
      await page.getByLabel('Plugin folder', { exact: true }).setInputFiles(resolve(directory, 'bundle'));
    } else await page.getByLabel('Plugin ZIP', { exact: true }).setInputFiles({ name: `${format}.zip`, mimeType: 'application/zip', buffer: zip(files) });
    const preview = page.getByTestId('plugin-preview');
    await preview.getByRole('heading', { name: new RegExp(`${format}-proof`) }).waitFor();
    if (format !== 'agent') assert.match(await preview.innerText(), /noch nicht unterstützt/);
    await preview.getByRole('button', { name: 'Unterstützte Teile importieren' }).click();
    const pack = page.getByTestId('imported-plugin').filter({ has: page.getByRole('heading', { name: new RegExp(`${format}-proof`) }) });
    await pack.getByRole('button', { name: 'Skills aktivieren', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__anvilIde.getState().mcpServers.length), 0);
    await pack.getByRole('button', { name: 'Skills aktivieren', exact: true }).click();
    await pack.getByRole('button', { name: 'Skills deaktivieren', exact: true }).waitFor();
    await pack.getByRole('button', { name: 'Im Chat verwenden', exact: true }).click();
    assert.match(await page.evaluate(() => window.__anvilIde.getState().agentDraft), new RegExp(`${format}-proof`));
    await pack.getByRole('button', { name: 'Skills deaktivieren', exact: true }).click();
    await pack.getByRole('button', { name: 'Skills aktivieren', exact: true }).waitFor();
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await market();
  assert.equal(await page.getByTestId('imported-plugin').count(), 3);
  assert.equal(await page.getByTestId('imported-plugin').getByRole('button', { name: 'Skills aktivieren', exact: true }).count(), 3);
  assert.ok(await page.evaluate(() => Object.entries(window.__anvilIde.getState().files).some(([path, body]) => path.endsWith('pixel.bin') && body === 'data:application/octet-stream;base64,AAECA/8=')));
  await page.getByTestId('imported-plugin').filter({ hasText: 'codex-proof' }).getByRole('button', { name: 'Dienste einrichten' }).click();
  await page.waitForFunction(() => window.__anvilIde.getState().mcpServers.length === 1);
  assert.deepEqual(await page.evaluate(() => { const s = window.__anvilIde.getState().mcpServers[0]; return { enabled: s.enabled, allowed: s.allowedTools, url: s.url }; }), { enabled: false, allowed: [], url: 'https://example.org/mcp' });
  await market();
  await page.getByTestId('imported-plugin').filter({ hasText: 'codex-proof' }).getByRole('button', { name: 'Dienste einrichten' }).click();
  await market();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().mcpServers.length), 1);
  await page.screenshot({ path: `${output}/desktop.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Arbeitsbereich' }).getByRole('button', { name: 'Dateien', exact: true }).click();
  await market();
  await page.getByTestId('agent-plugin-packages').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${output}/mobile.png`, animations: 'disabled' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
  await page.setViewportSize({ width: 1280, height: 900 });
  await market();
  for (const format of Object.keys(fixtures)) {
    const pack = page.getByTestId('imported-plugin').filter({ has: page.getByRole('heading', { name: new RegExp(`${format}-proof`) }) });
    await pack.getByRole('button', { name: 'Entfernen', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Entfernen', exact: true }).click();
    await pack.waitFor({ state: 'detached' });
    // The card disappears before async persistence finishes. Reload only after
    // the operation releases the UI, as indicated by enabled import controls.
    await page.getByRole('button', { name: 'Plugin-ZIP prüfen', exact: true }).click({ trial: true });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await market();
  assert.equal(await page.getByTestId('imported-plugin').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__anvilIde.getState().files), { 'keep.txt': 'USER DATA' });
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().mcpServers.length), 1, 'Separately configured service survives package removal');
  // Error stays reviewable and cannot create an installation.
  await page.getByLabel('Plugin ZIP', { exact: true }).setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('broken') });
  await page.getByTestId('agent-plugin-packages').getByRole('status').filter({ hasText: /ZIP/ }).waitFor();
  assert.equal(await page.getByTestId('imported-plugin').count(), 0);
  let realPackage;
  if (process.env.ANVIL_PLUGIN_SAMPLE) {
    await page.getByLabel('Plugin folder', { exact: true }).setInputFiles(process.env.ANVIL_PLUGIN_SAMPLE);
    const preview = page.getByTestId('plugin-preview');
    await preview.waitFor();
    realPackage = await preview.getByRole('heading').innerText();
    await preview.getByRole('button', { name: 'Unterstützte Teile importieren' }).click();
    const pack = page.getByTestId('imported-plugin');
    await pack.getByRole('button', { name: 'Skills aktivieren', exact: true }).click();
    await pack.getByRole('button', { name: 'Skills deaktivieren', exact: true }).waitFor();
    await page.screenshot({ path: `${output}/real-plugin.png`, animations: 'disabled' });
    await pack.getByRole('button', { name: 'Entfernen', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Entfernen', exact: true }).click();
    await pack.waitFor({ state: 'detached' });
  }
  assert.deepEqual(errors, []);
  const result = { production, threeFormats: true, folderAndZip: true, sameNameSelection: true, activateDeactivate: true, persistedRestart: true, binaryPreserved: true, servicesDisabledDeduplicated: true, removalAfterRestart: true, invalidArchiveRejected: true, realPackage, errors, blockedOrigins: [...new Set(blocked)] };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) { console.error(error, logs); process.exitCode = 1; }
finally { await browser?.close(); await dev?.close(); processServer?.kill('SIGTERM'); }
