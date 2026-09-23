import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { buildAgentRuntime } from './build-agent-runtime.mjs';

const until = async (check, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() > end) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 25)); }
};

test('background agent runs the real loop in another process and retains recoverable drafts', { timeout: 30000 }, async t => {
  await buildAgentRuntime();
  const dir = mkdtempSync(join(tmpdir(), 'anvil-agent-'));
  let n = 0, release, requested = 0, hold = true, nativeWire = false, textWire = false, truncate = false;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); requested++;
    if (textWire) { assert.equal(payload.tools, undefined); assert.match(payload.messages[0].content, /Tool transport for this request/); }
    else assert.ok(payload.tools.every(tool => !/mcp|shell|run|git/.test(tool.function.name)));
    res.writeHead(200, { 'Content-Type': nativeWire ? 'application/x-ndjson' : 'text/event-stream' });
    const event = value => {
      if (!nativeWire) return res.write(`data: ${JSON.stringify({ choices: [value] })}\n\n`);
      const d = value.delta || {};
      res.write(JSON.stringify({ message: { role: 'assistant', content: d.content || '', thinking: d.reasoning_content,
        ...(d.tool_calls ? { tool_calls: d.tool_calls.map(call => ({ function: { name: call.function.name, arguments: JSON.parse(call.function.arguments) } })) } : {}) }, done: Boolean(value.finish_reason), done_reason: value.finish_reason }) + '\n');
    };
    if (truncate) { event({ delta: { content: 'Unvollständig' } }); res.end(); return; }
    if (n === 0 && hold) {
      event({ delta: { reasoning_content: 'Datei wird untersucht.' } });
      await new Promise(r => { release = r; });
    }
    const name = n++ === 0 ? 'read_file' : n === 2 ? 'edit_file' : '';
    if (name) {
      const args = name === 'read_file' ? { path: 'notes.md' } : { path: 'notes.md', old_string: '# Alt\n', new_string: '# Fertiger Entwurf\n' };
      event({ delta: textWire ? { content: JSON.stringify({ name, arguments: args }) } : { tool_calls: [{ index: 0, id: `t${n}`, function: { name, arguments: JSON.stringify(args) } }] } });
    }
    else event({ delta: { content: 'Der Dateientwurf ist fertig. Keine Ausführung geprüft.' } });
    event({ delta: {}, finish_reason: name ? 'tool_calls' : 'stop' });
    res.end(nativeWire ? '' : 'data: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const model = { provider: 'custom', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'test-local', apiKey: 'test-private-key', context: 32768, thinking: 'auto', temperature: .2, maxOut: 2048, hardStopMin: 0 };
  const request = { model, files: { 'notes.md': '# Alt\n', '.env': 'SECRET', '.anvil/harness.json': '{"runLoop":true}' }, messages: [{ role: 'user', content: 'Lies notes.md und schreibe einen fertigen Markdown-Entwurf.' }], maxRounds: 8, autoContinue: false, project: 'qa-project', locale: 'de' };
  let child;
  const snapshotPath = join(dir, 'latest.json');
  const host = new AgentJobHost({ snapshotPath, launch: () => child = fork(resolve('agent-build/worker.mjs'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }) });
  let stderr = ''; host.on('change', () => {});
  try {
    const initial = host.start(request).state;
    child.stderr.on('data', chunk => stderr += chunk);
    await until(() => release || host.state.status === 'failed');
    assert.equal(host.state.status, 'running', stderr || host.state.error);
    assert.notEqual(child.pid, process.pid);
    await until(() => host.state.thinking.length > 0);
    assert.throws(() => host.start(request), /läuft bereits/);
    const savedRevision = host.state.revision;
    // Remove every viewer; transport and loop continue with no renderer-owned callback.
    host.removeAllListeners('change'); release();
    await until(() => !host.busy());
    assert.equal(host.state.status, 'done', host.state.error || stderr);
    assert.equal(host.state.drafts['notes.md'].after, '# Fertiger Entwurf\n');
    assert.equal(host.state.drafts['notes.md'].before, '# Alt\n');
    assert.equal(requested, 3, 'reconnection never repeats a model round or tool');
    assert.ok(host.snapshot(initial.id, savedRevision).state);
    assert.deepEqual(host.snapshot(host.state.id, host.state.revision), { unchanged: true });
    const saved = readFileSync(snapshotPath, 'utf8');
    assert.ok(!saved.includes(model.apiKey)); assert.ok(!saved.includes('SECRET'));
    const restored = new AgentJobHost({ snapshotPath, launch: () => { throw new Error('must not replay'); } });
    assert.equal(restored.state.status, 'done'); assert.deepEqual(restored.state.drafts, host.state.drafts);
    restored.close();

    await t.test('stop aborts the live request and preserves received state', async () => {
      host.dismiss(host.state.id); n = 0; release = undefined;
      host.start(request); await until(() => release);
      const pid = child.pid; host.stop();
      assert.equal(host.state.status, 'stopped');
      await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
      release();
    });
    await t.test('worker death is interrupted, never successful or automatically restarted', async () => {
      host.dismiss(host.state.id); n = 0; release = undefined;
      host.start(request); await until(() => release);
      child.kill(); await until(() => host.state.status === 'interrupted');
      assert.match(host.state.error, /unerwartet/); release();
    });
    await t.test('unfinished persisted job is recoverable but never re-executed after app restart', () => {
      const p = join(dir, 'crashed.json');
      writeFileSync(p, JSON.stringify({ ...host.state, status: 'running', drafts: { 'notes.md': { before: '# Alt\n', after: '# Saved\n' } } }));
      const resumed = new AgentJobHost({ snapshotPath: p, launch() { assert.fail('no replay'); } });
      assert.equal(resumed.state.status, 'interrupted'); assert.equal(resumed.state.drafts['notes.md'].after, '# Saved\n'); resumed.close();
    });
    for (const variant of ['ollama', 'text', 'compact']) await t.test(`${variant} preserves supported local tool transport`, async () => {
      host.dismiss(host.state.id); n = 0; hold = false; nativeWire = variant === 'ollama'; textWire = variant === 'text';
      host.start({ ...request, model: { ...model, provider: nativeWire ? 'ollama' : 'custom', toolMode: nativeWire ? 'standard' : variant } });
      await until(() => !host.busy());
      assert.equal(host.state.status, 'done', host.state.error);
      assert.equal(host.state.drafts['notes.md'].after, '# Fertiger Entwurf\n');
      assert.equal(n, 3);
    });
    await t.test('truncated model stream cannot be reported as successful', async () => {
      host.dismiss(host.state.id); nativeWire = textWire = false; truncate = true;
      host.start(request); await until(() => !host.busy());
      assert.equal(host.state.status, 'failed'); assert.match(host.state.error, /Abschluss fehlt/); assert.deepEqual(host.state.drafts, {});
    });
  } finally { release?.(); host.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('background job validates lifetime and rejects oversized requests before launching', () => {
  const host = new AgentJobHost({ snapshotPath: join(mkdtempSync(join(tmpdir(), 'anvil-agent-validation-')), 'latest.json'), launch() { assert.fail('must not launch'); } });
  assert.throws(() => host.start({}), /Ungültig/);
  assert.throws(() => host.start({ model: { model: 'x' }, messages: [{}], files: { 'file.md': 'x'.repeat(13 * 1024 * 1024) } }), /12 MB/);
  host.close();
});
