import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { buildAgentRuntime } from './build-agent-runtime.mjs';

test('abrupt Ollama stream failure survives worker IPC and persisted job recovery without replay', { timeout: 60000 }, async t => {
  const dir = mkdtempSync(resolve('artifacts', 'model-failure-qa-'));
  const runtimeDir = join(dir, 'agent');
  await buildAgentRuntime(runtimeDir);
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume synthetic request */ }
    requests++;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    if (requests === 1) {
      res.end(JSON.stringify({ message: { tool_calls: [{ function: { name: 'read_file', arguments: { path: 'notes.md' } } }] }, done: true, prompt_eval_count: 40, eval_count: 8 }) + '\n');
    } else {
      res.write(JSON.stringify({ message: { thinking: 'Prüfe Modellstand.' }, done: false }) + '\n');
      setTimeout(() => res.destroy(), 30);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const snapshotPath = join(dir, 'latest.json');
  const host = new AgentJobHost({ snapshotPath, launch: () => fork(join(runtimeDir, 'worker.mjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }) });
  t.after(() => host.close());
  host.start({ project: 'synthetic-cad-diagnostic', files: { 'notes.md': '# Fixture' }, messages: [{ role: 'user', content: 'Read notes.md and explain.' }], maxRounds: 4, autoContinue: false, locale: 'de',
    model: { provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', apiKey: 'private-fixture-key', context: 32768, thinking: 'low', temperature: 0.2, maxOut: 1024, hardStopMin: 0, retries: 4 } });
  const deadline = Date.now() + 15000;
  while (host.busy()) {
    assert.ok(Date.now() < deadline, `worker did not finish: ${host.state.error}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(host.state.status, 'failed');
  assert.equal(requests, 2, 'a partially consumed answer must never be retried');
  const failure = host.state.failure;
  assert.equal(failure?.error.name, 'TypeError');
  assert.match(failure.error.message, /terminated/);
  assert.equal(failure.error.cause.code, 'UND_ERR_SOCKET');
  assert.equal(failure.phase, 'thinking');
  assert.equal(failure.requestSequence, 2);
  assert.equal(failure.requestId, `${host.state.id}:model:2`);
  assert.deepEqual(failure.transport, { phase: 'stream', attempt: 1, status: 200 });
  const saved = readFileSync(snapshotPath, 'utf8');
  assert.ok(!saved.includes('private-fixture-key'));
  assert.deepEqual(JSON.parse(saved).failure, failure);
  const restored = new AgentJobHost({ snapshotPath, launch() { assert.fail('recovery must not replay model requests'); } });
  t.after(() => restored.close());
  assert.equal(restored.state.status, 'failed');
  assert.deepEqual(restored.state.failure, failure);
});
