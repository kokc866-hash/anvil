import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { buildAgentRuntime } from './build-agent-runtime.mjs';

test('real worker receives a shell rejection, chooses read_file and completes the same task', { timeout: 60000 }, async t => {
  const root = mkdtempSync(resolve('artifacts', 'tool-rejection-loop-'));
  const build = join(root, 'agent');
  await buildAgentRuntime(build);
  const source = 'export const title = "WORKSHOP_MARKER";\n';
  writeFileSync(join(root, 'ui.js'), source);
  const requests = [], errors = [];
  const result = (body, id) => {
    const message = body.messages.find(message => message.role === 'tool' && message.tool_call_id === id);
    assert.ok(message, `Missing tool response ${id}`);
    return message.content;
  };
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const n = requests.length;
      assert.ok(n <= 4, 'no repair loop or extra completion run');
      let name, args;
      if (n === 1) { name = 'select_tools'; args = { names: ['shell', 'read_file'] }; }
      if (n === 2) { name = 'shell'; args = { command: 'cat ui.js | head -100' }; }
      if (n === 3) {
        const rejected = JSON.parse(result(body, 'reject-2'));
        assert.equal(rejected.ok, false); assert.equal(rejected.rejected, true);
        assert.equal(rejected.definitelyNotExecuted, true); assert.match(rejected.error, /read_file/);
        assert.ok(body.tools.some(tool => tool.function.name === 'read_file'));
        name = 'read_file'; args = { path: 'ui.js' };
      }
      if (n === 4) assert.match(result(body, 'reject-3'), /WORKSHOP_MARKER/);
      const delta = name ? { tool_calls: [{ index: 0, id: `reject-${n}`, function: { name, arguments: JSON.stringify(args) } }] }
        : { content: 'WORKSHOP_MARKER gelesen. Shell-Befehl wurde abgelehnt; keine Datei geändert und keine Ausführung behauptet.' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: name ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(error.stack); res.writeHead(500).end('Fixture assertion failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const host = new AgentJobHost({ snapshotPath: join(root, 'state', 'latest.json'), runtime: new AgentProjectRuntime(),
    launch: () => fork(join(build, 'worker.mjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }) });
  t.after(() => host.close());
  host.start({ project: root, execution: true, writeThrough: true, files: { 'ui.js': source },
    messages: [{ role: 'user', content: 'Read ui.js and report its title. Do not edit or execute any project file. If a tool rejects a command, use its suggested read tool.' }],
    maxRounds: 6, autoContinue: false, locale: 'de', automation: { autoRunAgent: false }, plan: [],
    model: { provider: 'custom', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'synthetic-tool-rejection', context: 32768, thinking: 'off', maxOut: 1000, hardStopMin: 0 } });
  const deadline = Date.now() + 20000;
  while (host.busy()) { assert.ok(Date.now() < deadline, host.state.error || 'Worker timeout'); await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.deepEqual(errors, []);
  assert.equal(host.state.status, 'done', host.state.error);
  assert.equal(requests.length, 4);
  assert.match(host.state.text, /WORKSHOP_MARKER/);
  assert.deepEqual(host.state.steps.filter(step => ['shell', 'read_file'].includes(step.name)).map(step => [step.name, step.status]), [['shell', 'err'], ['read_file', 'ok']]);
  assert.deepEqual(host.state.mutationLedger, []);
  assert.equal(host.state.pendingRun, undefined);
  assert.equal(readFileSync(join(root, 'ui.js'), 'utf8'), source);
  assert.equal(host.state.workflow.operations.some(operation => operation.status === 'started'), false);
  const saved = JSON.parse(readFileSync(host.snapshotPath, 'utf8'));
  assert.equal(saved.status, 'done'); assert.deepEqual(saved.mutationLedger, []);
});
