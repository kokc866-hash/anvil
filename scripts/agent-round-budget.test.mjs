import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import path from 'node:path';

test('agent round boundaries continue useful work and never claim completion on a limit', async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  try {
    const { runAgentLoop } = await server.ssrLoadModule('/src/lib/agent-core.ts');
    const { beginAgent, abortAgent } = await server.ssrLoadModule('/src/lib/abort.ts');
    await server.ssrLoadModule('/src/lib/intern.ts');
    await server.ssrLoadModule('/src/lib/app-log.ts');
    const call = (name, args, n) => ({ content: '', tool_calls: [{ id: `c${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const data = { messages: [{ role: 'user', content: 'Lege die angeforderten Textdateien an. Kein Run nötig.' }], files: [], runLoop: false, afterWrite: 'none', maxRounds: 8 };
    await t.test('automatic app setting overrides generated project budget stops', async () => {
      const { startHarness, stepHarness } = await server.ssrLoadModule('/src/lib/harness.ts');
      const { mergeOpts } = await server.ssrLoadModule('/src/lib/harness-project.ts');
      const opts = mergeOpts({ ...data, autoContinueRounds: true, graphLoop: false, loopTries: 3 }, { stopOn: ['Budget', 'User-Stop'] });
      const h = startHarness(opts);
      h.used.rounds = 70; h.used.tools = 90;
      assert.equal(h.autoContinueRounds, true);
      const tick = stepHarness(h, opts);
      assert.equal(tick.stop, false);
      assert.equal(tick.strict, undefined, 'no hidden reduction to core-only tools');
      assert.equal(startHarness({ ...opts, autoContinueRounds: undefined }).autoContinueRounds, false, 'internal callers stay bounded');
    });
    await t.test('continues beyond multiple round windows with files and history intact', async () => {
      beginAgent(); let calls = 0; const bars = [];
      const result = await runAgentLoop({ ...data, autoContinueRounds: true }, async messages => {
        calls++;
        if (calls <= 70) return call('write_file', { path: `part-${calls}.txt`, content: `Part ${calls}` }, calls);
        assert.ok(messages.some(m => m.role === 'tool'), 'continuation keeps tool results');
        return { content: 'Alle 70 Dateien angelegt.' };
      }, { onHarness: bar => bars.push(bar) });
      assert.equal(result.ok, true);
      assert.equal(result.files.filter(f => /^part-/.test(f.path)).length, 70);
      assert.ok(bars.some(bar => /Runden 71/.test(bar)), 'visible model-round counter');
      assert.doesNotMatch(result.reply, /Runden-Limit/);
    });
    await t.test('manual limit returns incomplete with the actual count', async () => {
      beginAgent(); let calls = 0;
      const result = await runAgentLoop({ ...data, autoContinueRounds: false }, async () => call('write_file', { path: `part-${++calls}.txt`, content: 'x' }, calls));
      assert.equal(calls, 8);
      assert.equal(result.ok, false);
      assert.equal(result.stopReason, 'round-limit');
      assert.match(result.reply, /8 Arbeitsrunden/);
    });
    await t.test('automatic mode stops repeated reads without progress', async () => {
      beginAgent(); let calls = 0;
      const result = await runAgentLoop({ ...data, files: [{ path: 'note.txt', content: 'unchanged' }], autoContinueRounds: true }, async () => call('read_file', { path: 'note.txt' }, ++calls));
      assert.equal(result.ok, false);
      assert.ok(calls <= 12, 'repetition cannot create unlimited extensions');
    });
    await t.test('Stop still interrupts automatic continuation', async () => {
      beginAgent(); let calls = 0;
      await assert.rejects(runAgentLoop({ ...data, autoContinueRounds: true }, async () => {
        if (++calls === 10) abortAgent('Gestoppt');
        return call('write_file', { path: `part-${calls}.txt`, content: 'x' }, calls);
      }), /Gestoppt|abort|stop/i);
      assert.equal(calls, 10);
    });
  } finally {
    // Let the real asynchronous diagnostic logger settle before closing Vite.
    await new Promise(resolve => setTimeout(resolve, 30));
    await server.close();
  }
});
