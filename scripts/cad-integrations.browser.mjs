// Isolated UI checks. No CAD processes, model calls or external services started.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const production = process.argv.includes('--production');
const port = production ? 8196 : 8195, origin = `http://127.0.0.1:${port}`;
const output = `artifacts/cad-integrations/${production ? 'production' : 'dev'}`;
await mkdir(output, { recursive: true });
let dev, server, browser;
try {
  if (production) {
    server = spawn(process.execPath, ['.output/server/index.mjs'], { windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' }, stdio: 'ignore' });
    let ready = false;
    for (let n = 0; n < 150; n++) { try { ready = (await fetch(origin)).ok; } catch { /* Retry while the production server is starting. */ } if (ready) break; await new Promise(r => setTimeout(r, 200)); }
    assert.ok(ready, 'production server started');
  } else { dev = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, cacheDir: 'node_modules/.vite-cad-check' }); await dev.listen(); }
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('anvil-ide')) {
      localStorage.setItem('anvil-ide', JSON.stringify({ state: { setupDone: true, autoUpdate: false, autoSaveDisk: false, suggestOn: false, liveRun: false }, version: 0 }));
      localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
    }
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  const legacy = { id: 'existing-blender', name: 'My Blender', command: 'uvx', args: ['blender-mcp', '--port', '9877'], transport: 'stdio', enabled: false, url: '' };
  await page.evaluate(legacy => window.__anvilIde.setState({ sidebar: 'ext', sidebarWidth: 480, locale: 'de', mcpServers: [legacy], agentDraft: 'Mein Auftrag bleibt erhalten.', agentBusy: false, pathOperation: null }), legacy);
  const open = async () => {
    await page.evaluate(() => window.__anvilIde.getState().setSidebar('ext'));
    await page.getByRole('button', { name: 'Dienste', exact: true }).click();
    const section = page.getByTestId('engine-connections');
    if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
    return section;
  };
  let section = await open();
  const select = () => section.getByRole('combobox');
  await select().selectOption('unity-official');
  await section.getByRole('button', { name: 'In MCP vorbereiten', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().mcpServers.length), 1, 'existing required relay validation retained');
  for (const [id, pkg] of [['blender-mcp', 'mcp-for-blender'], ['freecad-mcp', 'freecad-mcp'], ['openscad-mcp', 'openscad-mcp']]) {
    await select().selectOption(id);
    await section.getByRole('button', { name: 'In MCP vorbereiten', exact: true }).click();
    const actual = await page.evaluate(() => window.__anvilIde.getState().mcpServers.at(-1));
    assert.equal(actual.command, 'uvx'); assert.deepEqual(actual.args, [pkg]); assert.equal(actual.enabled, false); assert.equal(actual.transport, 'stdio');
    await section.getByRole('button', { name: 'Beispiel zum Chat hinzufügen', exact: true }).click();
    const draft = await page.evaluate(() => window.__anvilIde.getState().agentDraft);
    assert.ok(draft.startsWith('Mein Auftrag bleibt erhalten.'));
    await section.getByRole('button', { name: 'Beispiel zum Chat hinzufügen', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__anvilIde.getState().agentDraft), draft, 'example not duplicated');
    assert.equal(await page.evaluate(() => window.__anvilIde.getState().agentBusy), false);
  }
  await page.evaluate(() => window.__anvilIde.setState({ agentBusy: true }));
  assert.equal(await section.getByRole('button', { name: 'In MCP vorbereiten', exact: true }).isEnabled(), false);
  await page.evaluate(() => window.__anvilIde.setState({ agentBusy: false }));
  await section.getByRole('button', { name: 'MCP-Verbindungen öffnen', exact: true }).click();
  await page.waitForFunction(() => window.__anvilIde.getState().sidebar === 'mcp');
  section = await open(); await select().selectOption('freecad-mcp');
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Arbeitsbereich' }).getByRole('button', { name: 'Dateien', exact: true }).click();
  section = await open(); await select().selectOption('freecad-mcp');
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.waitForTimeout(600); // wait for the existing debounced workspace persistence
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  const saved = await page.evaluate(() => window.__anvilIde.getState().mcpServers);
  assert.equal(saved.length, 4); assert.deepEqual(saved[0], legacy);
  assert.deepEqual(saved.slice(1).map(s => s.args), [['mcp-for-blender'], ['freecad-mcp'], ['openscad-mcp']]);
  assert.ok(saved.every(s => !s.enabled)); assert.deepEqual(errors, []);
  const result = { ok: true, production, newDrafts: 3, savedAfterReload: true, existingConnectionPreserved: true, draftAppendOnly: true, errors, liveCadModeling: 'not exercised' };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); await dev?.close(); server?.kill(); }
