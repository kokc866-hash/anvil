/** Real local-model regression: an expected failed command must not hide Git/file tools. */
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isIP } from 'node:net';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { gitBin } from '../companion/git.mjs';

const endpoint = process.env.ANVIL_QA_MODEL_URL, model = process.env.ANVIL_QA_MODEL;
assert.ok(endpoint && model, 'Explicit local endpoint and model required');
const hostname = new URL(endpoint).hostname, octets = hostname.split('.').map(Number);
assert.ok(hostname === 'localhost' || hostname === '[::1]' || (isIP(hostname) === 4 && (
  octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) ||
  (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
)), 'Local endpoint required');
const output = resolve('artifacts/negative-exit-practice');
mkdirSync(output, { recursive: true });
const project = mkdtempSync(join(output, 'project-'));
const files = {
  'expected-exit.cjs': "console.error('Expected negative test'); process.exit(1);\n",
  'main.cjs': 'exports.add = (a, b) => a - b;\n',
  'test.cjs': "const assert = require('node:assert/strict'); const {add} = require('./main.cjs'); assert.equal(add(2,3),5); assert.equal(add(-2,3),1); console.log('ADD_OK');\n",
  'original.txt': 'Keep this exact content.\n',
  'obsolete.txt': 'Synthetic obsolete file.\n',
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(project, name), content);
const git = args => execFileSync(gitBin(), args, { cwd: project, encoding: 'utf8', windowsHide: true });
git(['init']); git(['config', 'user.name', 'Anvil Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
git(['add', '.']); git(['commit', '-m', 'initial fixture']);
const host = new AgentJobHost({ snapshotPath: join(project, '.qa-state', 'latest.json'), runtime: new AgentProjectRuntime(),
  launch: () => fork(resolve('agent-build/worker.mjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }) });
const started = Date.now();
let last = '';
const executions = new Map();
host.on('change', () => {
  const s = host.state, key = `${s.status}/${s.steps.length}/${s.steps.at(-1)?.status}`;
  if(s.lastRun?.command && s.lastRun.stage?.id) executions.set(s.lastRun.stage.id, {
    command:s.lastRun.command,code:s.lastRun.code,ok:s.lastRun.ok,expectedExitCode:s.lastRun.expectedExitCode,exitExpectationMatched:s.lastRun.exitExpectationMatched,
  });
  if (key !== last) { last = key; console.log(JSON.stringify({ seconds: Math.round((Date.now()-started)/1000), status: s.status, tools: s.steps.length, lastTool: s.steps.at(-1)?.name })); }
});
const timer = setTimeout(() => host.stop('Focused practice time budget reached.'), 10 * 60_000);
let failure;
const checks = {};
try {
  host.start({ project, execution: true, writeThrough: true, files, locale: 'de', maxRounds: 32, autoContinue: true,
    messages: [{ role: 'user', content: `Erledige diesen kleinen Regressionstest mit den angebotenen Werkzeugen. Keine Downloads, Dienste oder Pushes.
1. Führe zuerst mit shell genau node expected-exit.cjs aus und setze dabei expected_exit_code auf 1. Exitcode 1 ist hier ausdrücklich erwartet; diese Datei NICHT reparieren.
2. Rufe danach git_status auf. Verschiebe original.txt mit rename unverändert nach docs/original.txt und lösche obsolete.txt.
3. Repariere main.cjs: add(a,b) soll addieren. test.cjs bleibt unverändert. Führe node test.cjs mit shell aus.
4. Erstelle einen lokalen git_commit mit Nachricht Regression completed. Commit nur deine Projektänderungen. Danach keine Dateiänderungen mehr. Berichte kurz das Ergebnis.` }],
    model: { provider: 'ollama', baseUrl: endpoint, model, apiKey: '', context: 65536, thinking: 'low', temperature: 0, maxOut: 4096, hardStopMin: 5, toolMode: 'standard' },
  });
  while (host.busy()) await new Promise(r => setTimeout(r, 1000));
  checks.completed = host.state.status === 'done';
  const firstShell = host.state.steps.findIndex(s => s.name === 'shell');
  checks.expectedNegativeThenGit = firstShell >= 0 && host.state.steps[firstShell].status === 'ok' && host.state.steps.slice(firstShell+1).some(t => t.name === 'git_status' && t.status === 'ok');
  const negative=[...executions.values()].find(r=>r.command==='node expected-exit.cjs');
  checks.actualExitCode = negative?.code === 1 && negative.ok === true && negative.expectedExitCode === 1 && negative.exitExpectationMatched === true;
  checks.successfulExecution = host.state.steps.some(s => s.name === 'shell' && s.status === 'ok');
  checks.fileActions = readFileSync(join(project,'docs/original.txt'),'utf8') === files['original.txt'] && !existsSync(join(project,'original.txt')) && !existsSync(join(project,'obsolete.txt'));
  checks.fixturesPreserved = ['expected-exit.cjs','test.cjs'].every(p => readFileSync(join(project,p),'utf8') === files[p]);
  execFileSync(process.execPath,['test.cjs'],{cwd:project,timeout:15000,windowsHide:true});
  execFileSync(process.execPath,['-e',"const a=require('node:assert/strict');const {add}=require('./main.cjs');a.equal(add(7,9),16);a.equal(add(-9,-1),-10);"],{cwd:project,timeout:15000,windowsHide:true});
  checks.independentOracle = true;
  checks.commit = git(['log','-1','--format=%s']).trim() === 'Regression completed' && git(['diff','--name-only','HEAD']).trim() === '';
  checks.plan = host.state.plan.every(s => s.status === 'ok');
  assert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));
} catch(error) { failure=String(error.stack||error); process.exitCode=1; }
finally {
  clearTimeout(timer);
  const report = {ok:!failure,project,model,checks,seconds:Math.round((Date.now()-started)/1000),status:host.state?.status,error:host.state?.error,steps:host.state?.steps,plan:host.state?.plan,executions:[...executions.values()],failure};
  writeFileSync(join(output,'latest-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  await host.close();
}
