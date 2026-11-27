// Isolated renderer profile: no real project, model, service or application settings.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readPluginZip } from '../src/lib/agent-plugin-archive.ts';
import { inspectAgentPlugin } from '../src/lib/agent-plugin-package.ts';
import { agentPluginInstallFiles, pluginRecord, pluginRoot } from '../src/lib/agent-plugin-registry.ts';
import { parseSkillMd } from '../src/lib/learn-parse.ts';

const production = process.argv.includes('--production');
const port = Number(process.env.ANVIL_SKILLS_QA_PORT) || (production ? 8198 : 8197), origin = `http://127.0.0.1:${port}`;
const output = process.env.ANVIL_SKILLS_QA_OUTPUT || `artifacts/skills/${production ? 'production' : 'dev'}`;
const skillCatalog = JSON.parse(await readFile('skills/anvil/catalog.json', 'utf8'));
const skillCount = skillCatalog.length;
const packageFixture = inspectAgentPlugin({
  '.codex-plugin/plugin.json': JSON.stringify({ name: 'ui-package-fixture', version: '2.0.0' }),
  'skills/first/SKILL.md': '---\nname: ui-package-first\ndescription: Read the artificial first fixture\n---\nRead references/check.md and report only the observed state.\n',
  'skills/first/references/check.md': 'Read only keep.txt. Do not change it.',
  'skills/second/SKILL.md': '---\nname: ui-package-second\ndescription: Read the artificial second fixture\n---\nRead the artificial fixture and report only the observed state.\n',
});
const packageFiles = agentPluginInstallFiles(packageFixture, 'artificial UI fixture', {});
packageFiles[pluginRecord(packageFixture.id)] = JSON.stringify({ ...JSON.parse(packageFiles[pluginRecord(packageFixture.id)]), enabled: true });
const packageSkills = packageFixture.skills.map(relative => {
  const file = `${pluginRoot(packageFixture.id)}/${relative}`;
  return { ...parseSkillMd(packageFiles[file], file), file, scope: 'project', ws: 'v2:local:skills-browser-fixture', kind: 'guide', uses: 0, score: .6, wins: 0, fails: 0, at: 1 };
});
await mkdir(output, { recursive: true });
let dev, server, browser, page;
try {
  if (production) {
    server = spawn(process.execPath, ['.output/server/index.mjs'], { windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' }, stdio: 'ignore' });
    let ready = false;
    for (let n = 0; n < 150; n++) { try { ready = (await fetch(origin)).ok; } catch { /* Server is still starting. */ } if (ready) break; await new Promise(resolve => setTimeout(resolve, 200)); }
    assert.ok(ready, 'built server started');
  } else { dev = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, cacheDir: 'node_modules/.vite-skills-check' }); await dev.listen(); }
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true });
  page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const errors = [], modelRequests = [], dialogs = [];
  page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /(?:Syntax|Reference|Type)Error|Error in route/.test(message.text())) errors.push(message.text()); });
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (/llm-agent|\/api\/chat|chat\/completions|\/api\/generate/.test(url.pathname)) { modelRequests.push(url.pathname); return route.abort(); }
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    return route.abort();
  });
  await page.addInitScript(({ packageFiles, packageSkills }) => {
    if (!localStorage.getItem('anvil-ide')) {
      localStorage.setItem('anvil-ide', JSON.stringify({ state: { setupDone: true, autoUpdate: false, autoSaveDisk: false, suggestOn: false, liveRun: false, helperOn: false, workspaceMemoryId: 'skills-browser-fixture', files: packageFiles }, version: 0 }));
      localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
      localStorage.setItem('anvil-learn', JSON.stringify({ state: { on: false, skills: [...packageSkills, { id: 'ui-feedback-fixture', name: 'ui-feedback-fixture', when: 'Artificial UI feedback check', body: 'Read the artificial fixture and report only its observed state.', kind: 'guide', scope: 'user', uses: 3, score: .05, wins: 0, fails: 3, at: 1, feedback: [{ id: 'feedback-fixture', jobId: 'artificial-job', version: 'artificial-version', kind: 'fail', at: 1, source: 'agent' }] }], facts: [{ id: 'private-fixture', kind: 'user', text: 'Private artificial memory', scope: 'user', conf: 1, hits: 0, at: 0 }] }, version: 0 }));
    }
  }, { packageFiles, packageSkills });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  console.log('[skills-ui] renderer hydrated');
  await page.evaluate(packageFiles => window.__anvilIde.setState({ sidebar: 'ext', sidebarWidth: 440, locale: 'de', files: { ...packageFiles, 'project.godot': '[application]\nconfig/name="Artificial skill fixture"', 'main.gd': 'extends Node\n', 'keep.txt': 'User fixture remains unchanged' }, dirs: [], workspaceCwd: '', githubRepo: '', workspaceMemoryId: 'skills-browser-fixture', mcpServers: [], agentMode: 'agent', agentBusy: false, chat: [] }), packageFiles);
  const open = async () => {
    await page.evaluate(() => window.__anvilIde.getState().setSidebar('ext'));
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await page.getByTestId('skill-library').waitFor();
    return page.getByTestId('skill-library');
  };
  let library = await open();
  assert.equal(await library.getByTestId('skill-card').count(), skillCount + 1 + packageSkills.length);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('anvil-learn')).state.on), false);
  const card = id => page.locator(`[data-skill-id="${id}"]`);
  await page.getByTestId('skill-group-custom').locator(':scope > summary').click();
  const imported = library.getByTestId('skill-card').filter({ has: page.getByRole('heading', { name: 'ui-package-first', exact: true }) });
  assert.match(await imported.innerText(), /Paket: ui-package-fixture/);
  assert.equal(await imported.getByRole('button', { name: 'Bearbeiten', exact: true }).count(), 0, 'package instructions cannot silently modify their package definition');
  await imported.getByRole('button', { name: 'Projektkopie bearbeiten', exact: true }).click();
  await page.waitForFunction(() => window.__anvilIde.getState().activePath === '.anvil/skills/ui-package-first-projekt/SKILL.md');
  const importedCopy = library.getByTestId('skill-card').filter({ has: page.getByRole('heading', { name: 'ui-package-first-projekt', exact: true }) });
  assert.match(await importedCopy.innerText(), /Dieses Projekt/);
  assert.ok(await page.evaluate(() => window.__anvilIde.getState().files['.anvil/skills/ui-package-first-projekt/references/check.md']), 'package copy keeps its own reference');
  await imported.getByRole('button', { name: 'Paket entfernen', exact: true }).click();
  await imported.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('heading', { name: 'ui-package-second', exact: true }).count(), 0, 'the other package skill is removed together');
  assert.ok(await page.evaluate(({ prefix, record }) => Object.keys(window.__anvilIde.getState().files).every(file => !file.startsWith(prefix + '/') && file !== record), { prefix: pluginRoot(packageFixture.id), record: pluginRecord(packageFixture.id) }), 'package files and registration leave together');
  assert.equal(await importedCopy.count(), 1, 'an independent project copy survives removal of the original package');
  await importedCopy.getByRole('button', { name: 'Entfernen', exact: true }).click();
  await importedCopy.waitFor({ state: 'detached' });
  console.log('[skills-ui] package ownership removal checked');
  const own = card('ui-feedback-fixture');
  assert.equal(await own.getByRole('checkbox').isChecked(), true, 'low feedback never changes the visible enabled state');
  await own.getByText('Anleitung und Voraussetzungen', { exact: true }).click();
  assert.match(await own.innerText(), /Modellrückmeldung: als nicht hilfreich gemeldet/);
  assert.match(await own.innerText(), /keine Funktionsprüfung/);
  assert.doesNotMatch(await own.innerText(), /\d+%|\d+ ok \/ \d+ fail/);
  await own.getByRole('button', { name: 'Entfernen', exact: true }).click();
  await own.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('dialog').count(), 0, 'removal opens no confirmation window');
  console.log('[skills-ui] feedback and user skill removal checked');
  await library.getByText('Skill-Auswahl ausprobieren', { exact: true }).click();
  const sample = library.getByRole('textbox', { name: 'Auftrag für Skill-Vorschau' });
  const sampleResult = sample.locator('..');
  for (const [id, prompt] of [
    ['anvil-eigenschaftstests', 'Prüfe den JSON-Roundtrip mit eigenschaftsbasierten Tests.'],
    ['anvil-bedienung-verbessern', 'Verbessere die Beschriftungen und Tastaturbedienung der Oberfläche.'],
  ]) {
    await sample.fill(prompt);
    assert.ok((await sampleResult.innerText()).includes(skillCatalog.find(skill => skill.id === id).title), id + ': actual UI selection');
  }
  await page.evaluate(() => {
    const state = window.__anvilIde.getState();
    window.__anvilIde.setState({ files: { ...state.files, 'package.json': '{"dependencies":{"react":"19"}}' } });
  });
  await sample.fill('Verringere unnötige Neurenderings der Komponenten.');
  assert.ok((await sampleResult.innerText()).includes(skillCatalog.find(skill => skill.id === 'anvil-react').title), 'React selection uses project dependencies');
  await sample.fill('Nutze kein React. Verbessere die CSS-Animation.');
  assert.ok(!(await sampleResult.innerText()).includes(skillCatalog.find(skill => skill.id === 'anvil-react').title), 'React exclusion is respected');
  assert.equal(await page.getByRole('dialog').count(), 0, 'new skill selection adds no confirmation dialog');
  console.log('[skills-ui] new native specialists and project context checked');
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
  await card('anvil-unity').getByRole('button', { name: 'Für Projekt anheften', exact: true }).click();
  await card('anvil-tests').getByRole('button', { name: 'Für Projekt anheften', exact: true }).click();
  assert.match(await preview.innerText(), /Mit Godot arbeiten/);
  assert.match(await preview.innerText(), /Mit Unity arbeiten/);
  assert.match(await preview.innerText(), /Tests entwickeln und ausführen/);
  await card('anvil-unity').getByRole('button', { name: 'Lösen', exact: true }).click();
  await card('anvil-tests').getByRole('button', { name: 'Lösen', exact: true }).click();
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
  console.log('[skills-ui] export and project copy checked');
  const customGroup = page.getByTestId('skill-group-custom');
  if (!await customGroup.evaluate(node => node.open)) await customGroup.locator(':scope > summary').click();
  const copied = library.getByTestId('skill-card').filter({ has: page.getByRole('heading', { name: 'anvil-godot-projekt', exact: true }) });
  const copiedId = await copied.getAttribute('data-skill-id');
  await copied.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await copied.getByRole('textbox', { name: 'Beschreibung für anvil-godot-projekt', exact: true }).fill('Künstliche geänderte Projektanleitung für den UI-Test.');
  await copied.getByRole('textbox', { name: 'Anleitung für anvil-godot-projekt', exact: true }).fill('Lies nur keep.txt und berichte seinen aktuellen Inhalt. Verändere keine anderen Dateien.');
  await copied.getByRole('button', { name: 'Skill speichern', exact: true }).click();
  await copied.getByText('Skill gespeichert.', { exact: true }).waitFor();
  assert.match(await copied.innerText(), /Künstliche geänderte Projektanleitung/);
  assert.equal(await copied.getByRole('textbox').count(), 0, 'inline edit closes only after confirmed save');
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().files['keep.txt']), 'User fixture remains unchanged');
  await copied.getByRole('button', { name: 'Entfernen', exact: true }).click();
  await copied.waitFor({ state: 'detached' });
  const remaining = await page.evaluate(() => window.__anvilIde.getState().files);
  assert.ok(!Object.keys(remaining).some(path => path.startsWith('.anvil/skills/anvil-godot-projekt/')), 'removal includes the owned supporting references');
  assert.equal(remaining['keep.txt'], 'User fixture remains unchanged');
  assert.equal(await page.getByRole('dialog').count(), 0);
  console.log('[skills-ui] inline save and supporting file removal checked');
  await library.getByRole('button', { name: 'Skill importieren', exact: true }).click();
  await page.getByTestId('task-packages').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Skill-Ordner importieren', exact: true }).count(), 1, 'the library leads to the existing import');
  await page.getByRole('button', { name: 'Installierte Skills verwalten', exact: true }).click();
  library = await page.getByTestId('skill-library');
  await library.waitFor();
  await page.evaluate(() => window.__anvilIde.getState().setSidebar('learn'));
  await page.getByRole('button', { name: 'Skills verwalten →', exact: true }).click();
  library = await page.getByTestId('skill-library');
  await library.waitFor();
  const removedIds = [copiedId, 'ui-feedback-fixture'];
  assert.ok(await page.evaluate(ids => { const value = JSON.parse(localStorage.getItem('anvil-learn')); return ids.every(id => !value.state.skills.some(skill => skill.id === id)); }, removedIds), 'removed skills leave the persisted catalog');
  await library.getByText('Skill-Auswahl ausprobieren', { exact: true }).click();
  await library.getByRole('textbox', { name: 'Auftrag für Skill-Vorschau' }).fill('Diesen Punkt bearbeiten');
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
  const popup = page.getByRole('dialog', { name: 'Skills des letzten Auftrags' });
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
  assert.deepEqual(dialogs, [], 'no native confirmation dialog');
  const verdict = { production, skills: skillCount, newSpecialistSelection: true, reactProjectContext: true, explicitExclusions: true, persistedChoices: true, completeExport: true, editableCopy: true, packageProjectCopy: true, ownEditingAndRemoval: true, packageReferencesRemoved: true, packageOwnershipRemoval: true, allThreePinsVisible: true, honestFeedback: true, singleManagement: true, contextStatus: true, modelRequests: 0, dialogs, errors };
  await writeFile(`${output}/result.json`, JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict));
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  console.error(error); process.exitCode = 1;
}
finally { await browser?.close(); await dev?.close(); server?.kill(); }
