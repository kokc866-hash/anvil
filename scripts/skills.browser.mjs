// Isolated renderer profile: no real project, model, service or application settings.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readPluginZip } from '../src/lib/agent-plugin-archive.ts';

const production = process.argv.includes('--production');
const port = production ? 8198 : 8197, origin = `http://127.0.0.1:${port}`;
const output = `artifacts/skills/${production ? 'production' : 'dev'}`;
await mkdir(output, { recursive: true });
let dev, server, browser;
try {
  if (production) {
    server = spawn(process.execPath, ['.output/server/index.mjs'], { windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' }, stdio: 'ignore' });
    let ready = false;
    for (let n = 0; n < 150; n++) { try { ready = (await fetch(origin)).ok; } catch { /* Server is still starting. */ } if (ready) break; await new Promise(resolve => setTimeout(resolve, 200)); }
    assert.ok(ready, 'built server started');
  } else { dev = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, cacheDir: 'node_modules/.vite-skills-check' }); await dev.listen(); }
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true }), errors = [], modelRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (/llm-agent|\/api\/chat|chat\/completions|\/api\/generate/.test(url.pathname)) { modelRequests.push(url.pathname); return route.abort(); }
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('anvil-ide')) {
      localStorage.setItem('anvil-ide', JSON.stringify({ state: { setupDone: true, autoUpdate: false, autoSaveDisk: false, suggestOn: false, liveRun: false, helperOn: false }, version: 0 }));
      localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
      localStorage.setItem('anvil-learn', JSON.stringify({ state: { on: false, skills: [], facts: [{ id: 'private-fixture', kind: 'user', text: 'Private artificial memory', scope: 'user', conf: 1, hits: 0, at: 0 }] }, version: 0 }));
    }
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await page.evaluate(() => window.__anvilIde.setState({ sidebar: 'ext', sidebarWidth: 440, locale: 'de', files: { 'project.godot': '[application]\nconfig/name="Artificial skill fixture"', 'main.gd': 'extends Node\n', 'keep.txt': 'User fixture remains unchanged' }, dirs: [], workspaceCwd: '', workspaceMemoryId: 'skills-browser-fixture', mcpServers: [], agentMode: 'agent', agentBusy: false, chat: [] }));
  const open = async () => {
    await page.evaluate(() => window.__anvilIde.getState().setSidebar('ext'));
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await page.getByTestId('skill-library').waitFor();
    return page.getByTestId('skill-library');
  };
  let library = await open();
  assert.equal(await library.getByTestId('skill-card').count(), 16);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('anvil-learn')).state.on), false);
  const card = id => page.locator(`[data-skill-id="${id}"]`);
  await library.getByText('Skill-Auswahl ausprobieren', { exact: true }).click();
  await library.getByRole('textbox', { name: 'Auftrag für Skill-Vorschau' }).fill('Ändere die Godot-Szene.');
  const preview = page.getByRole('textbox', { name: 'Auftrag für Skill-Vorschau' }).locator('..');
  assert.match(await preview.innerText(), /Mit Godot arbeiten/);
  assert.match(await preview.innerText(), /Passt zum Auftrag/);
  await page.getByTestId('skill-group-engines').locator(':scope > summary').click();
  await card('anvil-godot').getByRole('checkbox').uncheck();
  assert.doesNotMatch(await preview.innerText(), /Mit Godot arbeiten/);
  await page.waitForTimeout(650);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  library = await open();
  await page.getByTestId('skill-group-engines').locator(':scope > summary').click();
  assert.equal(await card('anvil-godot').getByRole('checkbox').isChecked(), false, 'individual choice survives reload');
  await card('anvil-godot').getByRole('checkbox').check();
  await card('anvil-godot').getByRole('button', { name: 'Für Projekt anheften', exact: true }).click();
  await library.getByRole('checkbox', { name: 'Passende Skills automatisch auswählen' }).uncheck();
  await library.getByText('Skill-Auswahl ausprobieren', { exact: true }).click();
  await library.getByRole('textbox', { name: 'Auftrag für Skill-Vorschau' }).fill('Diesen Punkt bearbeiten');
  assert.match(await library.innerText(), /Für dieses Projekt angeheftet/);
  const downloadPromise = page.waitForEvent('download');
  await card('anvil-godot').getByRole('button', { name: 'Als ZIP exportieren' }).click();
  const download = await downloadPromise;
  await download.saveAs(`${output}/anvil-godot.zip`);
  const buffer = await readFile(`${output}/anvil-godot.zip`);
  const zip = await readPluginZip(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  assert.ok(zip['SKILL.md']); assert.ok(Object.keys(zip).some(path => path.startsWith('references/')));
  await card('anvil-godot').getByRole('button', { name: 'Projektkopie bearbeiten' }).click();
  await page.waitForFunction(() => window.__anvilIde.getState().activePath?.endsWith('SKILL.md'));
  const files = await page.evaluate(() => window.__anvilIde.getState().files);
  assert.equal(files['keep.txt'], 'User fixture remains unchanged');
  assert.ok(Object.values(files).some(text => text.includes('name: anvil-godot-projekt')));
  assert.ok(Object.values(files).some(text => text.includes('name:"anvil-godot-projekt"')));
  assert.ok(Object.keys(files).some(path => path.includes('anvil-godot-projekt/references/')));
  await library.getByRole('checkbox', { name: 'Skills verwenden', exact: true }).uncheck();
  assert.match(await library.innerText(), /Skills sind ausgeschaltet/);
  await library.getByRole('checkbox', { name: 'Skills verwenden', exact: true }).check();
  await library.getByRole('checkbox', { name: 'Passende Skills automatisch auswählen' }).check();
  await library.getByRole('textbox', { name: 'Auftrag für Skill-Vorschau' }).fill('Repariere den Fehler in der Godot-Szene.');
  await library.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Arbeitsbereich' }).getByRole('button', { name: 'Dateien', exact: true }).click();
  library = await open();
  await library.getByText('Skill-Auswahl ausprobieren', { exact: true }).click();
  await library.getByRole('textbox', { name: 'Auftrag für Skill-Vorschau' }).fill('Repariere den Fehler in der Godot-Szene.');
  await library.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
  await page.screenshot({ path: `${output}/mobile.png` });
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.evaluate(() => window.__anvilIde.setState({ sidebar: 'files', chat: [{ id: 'fixture-user', role: 'user', content: 'Künstlicher abgeschlossener Auftrag', at: 1 }, { id: 'fixture-assistant', role: 'assistant', content: 'Auswahl gespeichert.', at: 2, skillSelection: [{ id: 'anvil-godot', name: 'anvil-godot', reason: 'Im Auftrag über skill_run geladen.', reasonEn: 'Loaded using skill_run.', requirements: [], explicit: true }] }] }));
  const status = page.getByTestId('skill-status');
  await status.getByRole('button', { name: /^Skills/ }).click();
  const popup = page.getByRole('dialog', { name: 'Anleitungen des letzten Auftrags' });
  assert.match(await popup.innerText(), /Mit Godot arbeiten/);
  await popup.getByRole('button', { name: 'Skill-Bibliothek öffnen' }).click();
  await page.getByTestId('skill-library').waitFor();
  await page.waitForTimeout(650);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  assert.ok(await page.evaluate(() => window.__anvilIde.getState().chat.find(message => message.id === 'fixture-assistant')?.skillSelection?.some(skill => skill.id === 'anvil-godot')), 'loaded instructions survive chat persistence');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('anvil-learn')).state.on), false, 'memory remains off');
  assert.deepEqual(modelRequests, []);
  assert.deepEqual(errors, []);
  const verdict = { production, skills: 16, persistedChoices: true, completeExport: true, editableCopy: true, contextStatus: true, modelRequests: 0, errors };
  await writeFile(`${output}/result.json`, JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await browser?.close(); await dev?.close(); server?.kill(); }
