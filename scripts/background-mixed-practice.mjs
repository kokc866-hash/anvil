/** Opt-in real local-model exercise. Only synthetic project files are sent. */
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isIP } from 'node:net';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { gitBin } from '../companion/git.mjs';

const endpoint = process.env.ANVIL_QA_MODEL_URL, model = process.env.ANVIL_QA_MODEL;
assert.ok(endpoint && model, 'Explicit local model and endpoint required');
const hostname = new URL(endpoint).hostname, octets = hostname.split('.').map(Number);
assert.ok(hostname === 'localhost' || hostname === '[::1]' || (isIP(hostname) === 4 && (
  octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) ||
  (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
)), 'Loopback or private LAN test endpoint required');
const output = resolve('artifacts/mixed-practice');
mkdirSync(output, { recursive: true });
const project = mkdtempSync(join(output, 'project-'));
const files = {
  'src/inventory.cjs': 'exports.summarize = rows => ({ valueCents: rows.reduce((sum, row) => sum + row.priceCents, 0) });\n',
  'data/items.json': JSON.stringify([
    { category: 'hardware', quantity: 3, priceCents: 199 },
    { category: 'stationery', quantity: 2, priceCents: 250 },
    { category: 'hardware', quantity: 1, priceCents: 1200 },
    { category: 'stationery', quantity: 0, priceCents: 600 },
    { category: 'invalid', quantity: -1, priceCents: 10 },
    { category: 'invalid', quantity: '4', priceCents: 10 },
  ], null, 2),
  'notes-old.txt': 'Synthetic inventory example. No real user data.\n',
  'obsolete.txt': 'Remove this obsolete fixture.\n',
  'README.md': '# Inventory fixture\nThe total calculation is incomplete.\n',
};
for (const [name, content] of Object.entries(files)) {
  mkdirSync(resolve(project, name, '..'), { recursive: true });
  writeFileSync(join(project, name), content);
}
const git = args => execFileSync(gitBin(), args, { cwd: project, encoding: 'utf8', windowsHide: true });
git(['init']); git(['config', 'user.name', 'Anvil Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
git(['add', '.']); git(['commit', '-m', 'initial fixture']);
const initialCommit = git(['rev-parse', 'HEAD']).trim();
const host = new AgentJobHost({
  snapshotPath: join(project, '.qa-state', 'latest.json'),
  runtime: new AgentProjectRuntime(),
  launch: () => fork(resolve('agent-build/worker.mjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }),
});
const started = Date.now();
let last = '', changes = 0;
host.on('change', () => {
  changes++;
  const s = host.state;
  const value = JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), status: s.status, tools: s.steps.length, lastTool: s.steps.at(-1)?.name, thinkingChars: s.thinking.length });
  if (value !== last) { last = value; console.log(value); }
});
const timer = setTimeout(() => host.stop('Mixed practice time budget reached.'), 30 * 60_000);
let failure;
const checks = {};
try {
  host.start({ project, execution: true, writeThrough: true, files, locale: 'de', maxRounds: 64, autoContinue: true,
    messages: [{ role: 'user', content: `Baue dieses künstliche Inventarprojekt vollständig fertig. Keine Downloads, Netzwerkdienste oder Pushes. Arbeite mit Anvils Werkzeugen und prüfe deine Änderungen tatsächlich.
1. Prüfe die Dateien und lege eine Checkliste an.
2. Repariere src/inventory.cjs. Exportiere summarize(rows). Gültig sind Objekte mit nichtleerem category-String sowie ganzzahligen, nichtnegativen quantity und priceCents (keine Umwandlung von Strings). Ungültige Zeilen ignorieren. Ergebnis: {validRows,ignoredRows,units,valueCents,categories}. categories ist nach name alphabetisch sortiert und enthält je Kategorie {name,units,valueCents}. valueCents summiert quantity * priceCents. Leere Eingabe ergibt Nullen und []. Die Eingabe nicht verändern.
3. Schreibe cli.cjs: Lies die JSON-Datei aus dem ersten Argument, nutze summarize und gib ausschließlich JSON auf stdout aus. Bei fehlendem Argument oder fehlerhafter Datei: Exitcode 1 und verständliche Meldung auf stderr.
4. Schreibe tests/inventory.test.cjs mit Node assert, ohne zusätzliche Pakete. Prüfe das Beispiel, leere Eingabe, ungültige Zeilen, Menge null sowie unveränderte Eingabe. Führe diese Tests mit shell aus und behebe Fehler.
5. Führe auch node cli.cjs data/items.json aus. Die Beispieldaten müssen validRows 4, ignoredRows 2, units 6 und valueCents 2297 ergeben.
6. Verschiebe notes-old.txt nach docs/notes.md, lösche obsolete.txt und dokumentiere Verwendung und Grenzen in README.md.
7. Prüfe git_status und erstelle mit git_commit einen lokalen Commit mit der Nachricht Inventory completed. Commit nur deine Projektänderungen. Kein Push.
8. Pflege die Checkliste anhand der tatsächlichen Ergebnisse und antworte abschließend mit Tests, Ergebnis und verbleibenden Problemen. Keine Änderungen nach dem abschließenden Commit.` }],
    model: { provider: 'ollama', baseUrl: endpoint, model, apiKey: '', context: 65536, thinking: 'low', temperature: 0, maxOut: 8192, hardStopMin: 8, toolMode: 'standard' },
  });
  while (host.busy()) await new Promise(r => setTimeout(r, 1000));
  checks.completed = host.state.status === 'done';
  const expected = { validRows: 4, ignoredRows: 2, units: 6, valueCents: 2297, categories: [
    { name: 'hardware', units: 4, valueCents: 1797 }, { name: 'stationery', units: 2, valueCents: 500 },
  ] };
  const oracle = `const assert=require('node:assert/strict');const {summarize}=require('./src/inventory.cjs');const rows=require('./data/items.json');const original=JSON.stringify(rows);assert.deepEqual(summarize(rows),${JSON.stringify(expected)});assert.equal(JSON.stringify(rows),original);assert.deepEqual(summarize([]),{validRows:0,ignoredRows:0,units:0,valueCents:0,categories:[]});assert.deepEqual(summarize([null,{}, {category:'x',quantity:1.5,priceCents:2},{category:'x',quantity:1,priceCents:-1}]),{validRows:0,ignoredRows:4,units:0,valueCents:0,categories:[]});console.log('INDEPENDENT_ORACLE_OK');`;
  execFileSync(process.execPath, ['-e', oracle], { cwd: project, timeout: 15000, windowsHide: true }); checks.independentOracle = true;
  const result = execFileSync(process.execPath, ['cli.cjs', 'data/items.json'], { cwd: project, timeout: 15000, windowsHide: true, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result), expected); checks.cli = true;
  let noArgCode = 0; try { execFileSync(process.execPath, ['cli.cjs'], { cwd: project, timeout: 15000, windowsHide: true, stdio: 'pipe' }); } catch (e) { noArgCode = e.status; }
  assert.equal(noArgCode, 1); checks.cliError = true;
  execFileSync(process.execPath, ['tests/inventory.test.cjs'], { cwd: project, timeout: 15000, windowsHide: true }); checks.modelTests = true;
  assert.equal(readFileSync(join(project, 'docs/notes.md'), 'utf8'), files['notes-old.txt']);
  assert.ok(!existsSync(join(project, 'notes-old.txt')) && !existsSync(join(project, 'obsolete.txt'))); checks.fileActions = true;
  assert.notEqual(git(['rev-parse', 'HEAD']).trim(), initialCommit); assert.equal(git(['log', '-1', '--format=%s']).trim(), 'Inventory completed');
  assert.equal(git(['diff', '--name-only', 'HEAD']).trim(), ''); checks.commit = true;
  assert.ok(host.state.steps.some(s => s.name === 'shell' && s.status === 'ok')); checks.agentExecution = true;
  assert.ok(host.state.plan.length && host.state.plan.every(s => s.status === 'ok')); checks.plan = true;
  assert.ok(Object.values(checks).every(Boolean));
} catch (error) { failure = String(error.stack || error); process.exitCode = 1; }
finally {
  clearTimeout(timer);
  const report = { ok: !failure, project, model, checks, seconds: Math.round((Date.now() - started) / 1000), changes, status: host.state?.status, error: host.state?.error, reply: host.state?.text, steps: host.state?.steps, plan: host.state?.plan, failure };
  writeFileSync(join(project, 'practice-result.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(output, 'latest-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks, seconds: report.seconds, failure }));
  await host.close();
}
